import * as THREE from 'three';
import {
  HASH11_GLSL,
  BIRTH_DEATH_GLSL,
  STAGE_ENVELOPE_GLSL,
} from './cellEnvelope.glsl';
import {
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
  ENTER_FADE_MS,
  EXIT_FADE_MS,
} from '../geometry/cellPositions';
import { CONSENSUS_BRAID_PALETTE } from '../derives/consensusBraid.derive';
import {
  CONSENSUS_MEMORY_CORE_READ_FLOOR,
  CONSENSUS_MEMORY_CORE_RELEASE_EXPONENT,
} from '../derives/consensusMemoryCore.derive';
import {
  CONSENSUS_MEMORY_HANDOFF_END,
  CONSENSUS_MEMORY_HANDOFF_START,
} from '../derives/consensusMemoryLod.derive';
import { CELL_GALAXY_PALETTE } from '../visualPalette';

/**
 * Single-peak Gaussian cloud baseline for each Cell.
 *
 * - Resting state: one central Gaussian peak anchored at sprite center + a
 *   faint outer halo wash. The cell's brightest pixel always sits at sprite
 *   center (= fabric endpoint at cell.pos_seed), so fiber glow and cell glow
 *   share the same Gaussian language and meet at luminous junctions.
 * - Resting bodies use bounded screen accumulation. Thousands of overlapping
 *   Cells can therefore approach consensus-white without numerically blasting
 *   through it. The nerve-pulse discharge flare still renders in a separate
 *   additive layer (materials/cellFlareMaterial.ts), preserving event urgency.
 *
 * New-block delivery can still flash exact Cells through `aFlashAt`; the broad
 * brightness shockwave belongs to the peer network and is intentionally absent
 * from this material.
 */

// Tunable feel constants — collected here so reviewers find them in one place.
/** Sprite world→screen multiplier. Exported because the population halo is
 *  the same material family and has to shrink with distance at exactly the
 *  same rate — a second copy of this number is a seam waiting to open. */
export const HYBRID_BASE_PX_PER_WU = 2.0; // sprite world→screen multiplier — ~2× halo outer-glow size; cell body (gl_PointCoord ≤ 0.5) renders at roughly halo-equivalent screen weight
/** Direct inspection neighbours gain enough sprite room for their split
 * interface arcs. CellPicker imports the same value so the affordance never
 * extends beyond its hit area. */
export const CELL_INSPECTION_NAVIGATION_SIZE_SCALE = 1.18;

/** How far a newborn's body is pulled toward the white core it already mixes
 *  toward at its peak. Spends itself over the birth ramp, so a settled cell
 *  is byte-identical to one that was never born on this screen. */
export const BIRTH_BLOOM = 0.55;
/** Ramp fraction the withering has finished cooling by, and how much of the
 *  cooled target stays ember rather than ash. Chroma leaves first: an
 *  identity colour on a corpse is a lie the body no longer supports. */
export const WITHER_COOL_END = 0.62;
export const WITHER_EMBER_TINT = 0.6;
/** Guttering: two incommensurate rates so the flutter never reads as a
 *  metronome, and a depth shallow enough that the corpse never blinks out
 *  before `deathEase` takes its size. */
export const WITHER_GUTTER_RATE = 11.0;
export const WITHER_GUTTER_DEPTH = 0.55;

export function makeCellHybridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:            { value: 0 },
      uBirthDurS:       { value: BIRTH_DURATION_MS / 1000 },
      uDeathDurS:       { value: DEATH_DURATION_MS / 1000 },
      // Stage windows read their constant directly: the dot and the flare
      // must resolve over the identical span, and a second literal here is a
      // seam waiting to open.
      uEnterDurS:       { value: ENTER_FADE_MS / 1000 },
      uExitDurS:        { value: EXIT_FADE_MS / 1000 },
      uViewportHeight:  { value: 800 },
      uPixelRatio:      { value: 1 },
      uMemoryMinPointPx: { value: 24 },
      uMemoryLinePx:    { value: 0.55 },
      uMemorySignalEnergy: { value: 1 },
      uInspectionBlend: { value: 1 },
      uWarmth:          { value: 0.12 }, // living rose body → ember bias; set live from LIVE.cell.warmth
      uCenterDim:       { value: 0.3 }, // shared centre-energy floor; passive fabric applies its stronger squared form
    },
    transparent: true,
    depthWrite: false,
    // Screen-like accumulation bounds the resting information field. The
    // protocol flare layer remains additive, so real writes still break above
    // the shared structure instead of flattening into it.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec3  aColor;
      attribute float aBornAt;
      attribute float aDeathAt;
      attribute float aEnterAt; // stage resolution in; -1e9 = always on
      attribute float aExitAt;  // stage release out; +1e9 = not exiting
      attribute float aSize;
      attribute vec4  aMemoryIdentity; // normalized asset / lock / payload / mass
      attribute float aMemorySeed; // stable content-hash word; never draw-order based
      attribute float aDetail;  // LOD: 0 for all far cells (glow unchanged); ramps →1 as the camera nears, softening the white-hot peak so the nucleus shows
      attribute float aFocus;   // eased interaction: 0 resting, ~0.46 hover, 1 selected
      attribute float aRecall;  // signed historical read: source < 0, retained target > 0
      attribute float aRecallState; // source travel / target witness resolution
      attribute float aInspectionFrom; // previous real-adjacency energy
      attribute float aInspectionTo; // next real-adjacency energy
      attribute float aInspectionRole; // 1 = direct, navigable renderer-neighbour

      uniform float uTime;
      uniform float uBirthDurS;
      uniform float uDeathDurS;
      uniform float uEnterDurS;
      uniform float uExitDurS;
      uniform float uViewportHeight;
      uniform float uPixelRatio;
      uniform float uMemoryMinPointPx;
      uniform float uWarmth;
      uniform float uCenterDim;
      uniform float uInspectionBlend;

      varying float vBirthRamp;
      varying float vDeathRamp;
      varying float vStageAlpha;
      varying float vSeed;
      varying vec4  vMemoryIdentity;
      varying float vDetail;
      varying float vFocus;
      varying float vRecall;
      varying float vRecallState;
      varying float vInspection;
      varying float vInspectionRole;
      varying float vCenterDim;
      varying float vPointCssPx;
      varying vec3  vBodyColor;
      varying vec3  vHotColor;
      // x = inverse breathing sigma squared; y = peak LOD gain;
      // z = outer-wash LOD gain. All three are constant across one point.
      varying vec3  vCloudParams;

      ${BIRTH_DEATH_GLSL}
      ${STAGE_ENVELOPE_GLSL}
      ${HASH11_GLSL}

      void main() {
        vMemoryIdentity = aMemoryIdentity;
        vDetail = aDetail;
        vFocus = aFocus;
        vRecall = aRecall;
        vRecallState = aRecallState;
        vInspection = mix(
          aInspectionFrom,
          aInspectionTo,
          clamp(uInspectionBlend, 0.0, 1.0)
        );
        vInspectionRole = aInspectionRole;
        float birthRamp = clamp((uTime - aBornAt) / uBirthDurS, 0.0, 1.0);
        float deathRamp = clamp((uTime - aDeathAt) / uDeathDurS, 0.0, 1.0);
        float bEase = birthEase(birthRamp);
        float dEase = deathEase(deathRamp);
        vec2 stage = stageEnvelope(
          stageEase(stageRamp(uTime, aEnterAt, uEnterDurS)),
          stageEase(stageRamp(uTime, aExitAt, uExitDurS))
        );
        float scale = bEase * (1.0 - dEase) * stage.x;

        vBirthRamp = birthRamp;
        vDeathRamp = deathRamp;
        vStageAlpha = stage.y;
        vSeed      = aMemorySeed * 91.73
          + dot(position, vec3(0.071, 0.113, 0.173));

        // These values depend on the Cell and frame, never on gl_PointCoord.
        // Evaluate them once per Cell instead of once per covered fragment.
        float breathRate = 0.7 + 0.6 * hash11(vSeed + 7.7);
        float breath = 1.0 + 0.08 * sin(uTime * breathRate + vSeed);
        float sigma = 0.10 * breath;
        vec3 ember = mix(
          aColor,
          vec3(${CELL_GALAXY_PALETTE.ember.join(', ')}),
          0.55
        );
        vBodyColor = mix(aColor, ember, uWarmth);
        vHotColor = mix(
          vBodyColor,
          vec3(${CELL_GALAXY_PALETTE.warmWhite.join(', ')}),
          0.72
        );
        vCloudParams = vec3(
          1.0 / (sigma * sigma),
          1.0 - aDetail * 0.92,
          0.18 * (1.0 - aDetail * 0.45)
        );

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        // Fade resting brightness down toward the galaxy centre so the
        // dense core stops piling up additively into a white-hot blob. Center is
        // world XZ origin (group sits at x=z=0, rotates about y). 1.0 past r≈16.
        vCenterDim = mix(uCenterDim, 1.0, smoothstep(2.0, 16.0, length(worldPos.xz)));
        vec4 viewPos  = viewMatrix * worldPos;
        gl_Position   = projectionMatrix * viewPos;
        float retainedCore = pow(
          clamp(max(aRecall, 0.0), 0.0, 1.0),
          ${CONSENSUS_MEMORY_CORE_RELEASE_EXPONENT.toFixed(1)}
        )
          * smoothstep(0.0, 1.0, clamp(aRecallState, 0.0, 1.0));
        float retainedSizeBoost = mix(0.08, 0.16, aMemoryIdentity.w);
        float inspectionNavigationScale = mix(
          1.0,
          ${CELL_INSPECTION_NAVIGATION_SIZE_SCALE.toFixed(2)},
          step(0.5, aInspectionRole)
        );
        gl_PointSize  = aSize * ${HYBRID_BASE_PX_PER_WU.toFixed(1)} * inspectionNavigationScale * (1.0 + vFocus * 0.32) * (1.0 + abs(vRecall) * 0.06 + retainedCore * retainedSizeBoost) * scale * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
        // Retained records have a semantic CSS-pixel floor so 1/3/5 checksum
        // lanes survive every quality DPR. The floor recedes by the exact
        // complement used when the expanded braid takes over.
        float compactVisibility = 1.0 - smoothstep(
          ${CONSENSUS_MEMORY_HANDOFF_START.toFixed(2)},
          ${CONSENSUS_MEMORY_HANDOFF_END.toFixed(2)},
          clamp(aDetail, 0.0, 1.0)
        );
        float retainedFloor = uMemoryMinPointPx
          * max(uPixelRatio, 0.001)
          * retainedCore
          * compactVisibility
          * scale;
        gl_PointSize = max(gl_PointSize, retainedFloor);
        vPointCssPx = gl_PointSize / max(uPixelRatio, 0.001);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uMemoryLinePx;
      uniform float uMemorySignalEnergy;

      varying float vBirthRamp;
      varying float vDeathRamp;
      varying float vStageAlpha;
      varying float vSeed;
      varying vec4  vMemoryIdentity;
      varying float vDetail;
      varying float vFocus;
      varying float vRecall;
      varying float vRecallState;
      varying float vInspection;
      varying float vInspectionRole;
      varying float vCenterDim;
      varying float vPointCssPx;
      varying vec3  vBodyColor;
      varying vec3  vHotColor;
      varying vec3  vCloudParams;

      // hash11 — small deterministic scrambler. Used for per-cell decorrelation.
      ${HASH11_GLSL}

      // Single central Gaussian peak + faint outer halo wash. The cell's
      // brightest point is anchored at sprite center (= fabric endpoint at
      // cell.pos_seed), which makes the fiber-to-cell connection visually
      // continuous: cell glow and fiber glow are both Gaussian, so they
      // meet at the same point and form one bright knot.
      //
      // Per-cell variation comes from the vertex-derived tag colors and
      // sprite size (aSize).
      vec4 cloud(float radiusSquared) {
        // LOD peak suppression: near cells (vDetail→1) lose the white-hot core so
        // the nucleus reads; far cells (vDetail=0) are byte-identical to before.
        float peak = exp(-radiusSquared * vCloudParams.x) * vCloudParams.y;
        vec3 col = mix(vBodyColor, vHotColor, peak);

        // Outer halo wash for boundary continuity — very faint full-sprite
        // glow that anchors the cell's footprint when peak alone is too
        // tight at distance.
        float wash = exp(-radiusSquared / (0.32 * 0.32)) * vCloudParams.z;
        col += vBodyColor * wash;

        return vec4(col, peak + wash);
      }

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float radiusSquared = dot(uv, uv);
        if (radiusSquared > 0.25) discard;

        if (vDeathRamp >= 1.0) discard;

        vec4 base = cloud(radiusSquared);
        // Both density compression and graph-distance inspection apply only to
        // the resting body. Focus, write, and recall signals below can still
        // reclaim headroom because they describe real events.
        base.a *= vCenterDim * vInspection;

        vec3  col = base.rgb;
        float a   = base.a * (1.0 - vDeathRamp);

        // A newborn is still hot. Reuse the exact white core the cloud peak
        // already mixes toward — one mix, gated by what is LEFT of the birth
        // ramp — so the body cools as it grows and a settled cell pays
        // nothing. Stage entrants arrive with the ramp spent: only a real
        // chain birth blooms.
        col = mix(col, vHotColor, ${BIRTH_BLOOM.toFixed(2)} * (1.0 - vBirthRamp));

        // A direct spatial neighbour is an interface into the next bounded
        // topology field. Three open, hash-oriented arcs express that role
        // without wrapping the Cell in a generic UI ring or adding per-Cell
        // geometry. The role changes atomically with the pick surface; the
        // eased inspection energy only softens its arrival.
        if (vInspectionRole > 0.0001) {
          float navigationAngle = atan(uv.y, uv.x);
          float navigationPhase = vSeed * 0.19 + uTime * 0.16;
          float navigationRing = exp(
            -pow((length(uv) - 0.405) / 0.027, 2.0)
          );
          float navigationArc = smoothstep(
            0.42,
            0.88,
            cos(navigationAngle * 3.0 + navigationPhase)
          );
          float navigationNotch = exp(
            -pow((length(uv) - 0.315) / 0.021, 2.0)
          ) * smoothstep(
            0.72,
            0.96,
            cos(navigationAngle * 3.0 + navigationPhase + 1.28)
          );
          float navigationReveal = smoothstep(0.18, 0.76, vInspection);
          float navigationSignal = vInspectionRole
            * navigationReveal
            * (navigationRing * navigationArc + navigationNotch * 0.56)
            * (1.0 - vDeathRamp);
          vec3 navigationCyan = vec3(0.16, 0.86, 1.0);
          vec3 navigationGold = vec3(0.94, 0.68, 0.28);
          float navigationPolarity = 0.5 + 0.5 * sin(
            navigationAngle + navigationPhase * 0.34
          );
          col += mix(
            navigationCyan,
            navigationGold,
            navigationPolarity * 0.36
          ) * navigationSignal * 1.18;
          a += navigationSignal * 0.52;
        }

        // Interaction feedback uses an interrupted two-fold interference ring,
        // echoing the contributor crossings of A instead of adding a generic
        // solid selection circle. Hover reveals it partially; selection closes
        // the signal and hands visual emphasis to the expanded braid.
        if (vFocus > 0.0001) {
          float focusAngle = atan(uv.y, uv.x);
          float focusRing = exp(-pow((length(uv) - 0.34) / 0.045, 2.0));
          float focusArc = 0.35 + 0.65
            * smoothstep(-0.35, 0.72, sin(focusAngle * 2.0 + vSeed * 0.21));
          float focusSignal = focusRing * focusArc * vFocus * (1.0 - vDeathRamp);
          vec3 focusGold = vec3(0.86, 0.61, 0.25);
          vec3 focusCyan = vec3(0.10, 0.82, 1.00);
          vec3 focusTint = mix(focusGold, focusCyan, hash11(vSeed + 3.1));
          col += focusTint * focusSignal * 1.35;
          a += focusSignal * 0.62;
        }

        // Historical recall reads the Cell's record; it does not replay a
        // write flash. Sources emit two bounded address rails. The retained
        // target receives a segmented scan aperture, then resolves three
        // checksum lanes and one central agreement knot only as its real
        // witness arrivals converge. The knot outlasts the route aperture but
        // clears exactly when the explicit historical read ends.
        if (abs(vRecall) > 0.0001) {
          float recallAmount = clamp(abs(vRecall), 0.0, 1.0);
          float recallTarget = step(0.0, vRecall);
          float recallSource = 1.0 - recallTarget;
          float recallResolved = smoothstep(
            0.0,
            1.0,
            clamp(vRecallState, 0.0, 1.0)
          );
          float readEnergy = recallAmount * (
            1.0 - recallResolved
              * (1.0 - ${CONSENSUS_MEMORY_CORE_READ_FLOOR.toFixed(1)})
          );
          float compactVisibility = 1.0 - smoothstep(
            ${CONSENSUS_MEMORY_HANDOFF_START.toFixed(2)},
            ${CONSENSUS_MEMORY_HANDOFF_END.toFixed(2)},
            clamp(vDetail, 0.0, 1.0)
          );
          float retainedEnergy = pow(
            recallAmount,
            ${CONSENSUS_MEMORY_CORE_RELEASE_EXPONENT.toFixed(1)}
          )
            * recallResolved
            * recallTarget
            * compactVisibility;
          float readPhase = fract(uTime * 0.38 + hash11(vSeed + 9.7) * 0.15);
          float scanY = mix(-0.28, 0.28, readPhase);
          float scanAperture = exp(-pow((uv.y - scanY) / 0.018, 2.0));
          float scanWindow = 1.0 - smoothstep(0.18, 0.32, abs(uv.x));
          float addressCell = floor((uv.x + 0.36) * 18.0);
          float addressGate = 0.28 + 0.72 * step(
            0.42,
            hash11(addressCell + floor(readPhase * 16.0) + vSeed)
          );
          float targetRead = scanAperture * scanWindow * addressGate
            * readEnergy * recallTarget
            * compactVisibility
            * uMemorySignalEnergy;

        // Far retained-core identity is the compact LOD of canonical A:
        // asset rotates the record axis, lock changes its gate cadence, data
        // opens 1/3/5 checksum lanes, capacity sizes the central knot, and the
        // content hash chooses stable gaps. Gold remains the shared agreement
        // state instead of turning taxonomy into an activity colour code.
          float recordAngle = (vMemoryIdentity.x - 0.5) * 0.9;
          float recordCos = cos(recordAngle);
          float recordSin = sin(recordAngle);
          vec2 recordUv = mat2(
            recordCos, -recordSin,
            recordSin, recordCos
          ) * uv;
          float memoryUvPerPx = 1.0 / max(vPointCssPx, 1.0);
          float checksumWidth = max(
            0.0125,
            uMemoryLinePx * memoryUvPerPx
          );
          float checksumLaneStep = max(0.056, 1.34 * memoryUvPerPx);
          float recordPayload = clamp(vMemoryIdentity.z, 0.0, 1.0);
          float recordSpan = max(
            mix(0.11, 0.2, recordPayload),
            checksumLaneStep * 2.34
          );
          float recordWindow = 1.0 - smoothstep(
            recordSpan * 0.72,
            recordSpan,
            abs(recordUv.x)
          );
          float checksumCenter = exp(-pow(recordUv.y / checksumWidth, 2.0));
          float checksumInner = (
            exp(-pow((recordUv.y + checksumLaneStep) / checksumWidth, 2.0))
            + exp(-pow((recordUv.y - checksumLaneStep) / checksumWidth, 2.0))
          ) * smoothstep(0.04, 0.22, recordPayload);
          float checksumOuter = (
            exp(-pow((recordUv.y + checksumLaneStep * 2.0) / checksumWidth, 2.0))
            + exp(-pow((recordUv.y - checksumLaneStep * 2.0) / checksumWidth, 2.0))
          ) * smoothstep(0.42, 0.78, recordPayload);
          float checksumLanes = (
            checksumCenter + checksumInner + checksumOuter
          ) * recordWindow;
          float lockCadence = mix(15.0, 29.0, vMemoryIdentity.y);
          float checksumCell = floor(
            (recordUv.x + recordSpan) * lockCadence
          );
          float checksumGate = 0.4 + 0.6 * step(
            0.32,
            hash11(
              checksumCell
                + floor(vMemoryIdentity.y * 4.01) * 17.0
                + vSeed
            )
          );
          float recordLatch = checksumLanes * checksumGate * retainedEnergy
            * uMemorySignalEnergy;
          float recordKnotRadius = max(
            mix(0.03, 0.044, vMemoryIdentity.w),
            uMemoryLinePx * 1.45 * memoryUvPerPx
          );
          float recordKnot = exp(-pow(length(uv) / recordKnotRadius, 2.0))
            * retainedEnergy
            * uMemorySignalEnergy;

          float departureX = mix(
            0.06,
            0.34,
            clamp(vRecallState, 0.0, 1.0)
          );
          float departureRail = exp(-pow((abs(uv.x) - departureX) / 0.02, 2.0))
            * (1.0 - smoothstep(0.1, 0.29, abs(uv.y)))
            * recallAmount * recallSource;
          vec3 recallCyan = vec3(0.22, 0.9, 1.0);
          vec3 recallPale = vec3(0.78, 0.97, 1.0);
          vec3 recallViolet = vec3(0.54, 0.38, 1.0);
          vec3 recallGold = vec3(1.0, 0.78, 0.34);
          col += recallCyan * targetRead * 1.35;
          col += mix(recallPale, recallGold, 0.48) * recordLatch * 1.62;
          col += recallGold * recordKnot * 1.18;
          col += recallViolet * departureRail * 0.72;
          a += targetRead * 0.54
            + recordLatch * 0.72
            + recordKnot * 0.48
            + departureRail * 0.28;
        }

        // A real on-chain Cell consumption is not agreement: transition the
        // fading body toward the retirement signal before it disappears. GC
        // never reaches this shader path, so quiet renderer eviction stays mute.
        // Withering is a COOLING before it is a collapse: chroma drains toward
        // the galaxy's own ember, the body gutters on a per-cell phase, and
        // only then does deathEase take the size. A living cell resolves
        // every term here to identity, so the branch costs the resting field
        // nothing and skips it for the whole field.
        if (vDeathRamp > 0.0) {
          vec3 emberColor = vec3(${CELL_GALAXY_PALETTE.ember.join(', ')});
          vec3 ash = vec3(dot(col, vec3(0.299, 0.587, 0.114))); // Rec.601 luma
          float cooling = smoothstep(0.0, ${WITHER_COOL_END.toFixed(2)}, vDeathRamp);
          col = mix(
            col,
            mix(ash, emberColor, ${WITHER_EMBER_TINT.toFixed(2)}),
            cooling
          );

          // Each corpse gutters on its own phase; a block's worth of deaths
          // flickering in unison would read as one strobe, not many embers.
          float gutterPhase = hash11(vSeed + 5.3) * 6.2831853;
          float gutter = 0.5 - 0.5
            * sin(uTime * ${WITHER_GUTTER_RATE.toFixed(1)} + gutterPhase)
            * sin(uTime * ${(WITHER_GUTTER_RATE * 1.7).toFixed(2)} + gutterPhase * 2.1);
          a *= 1.0 - ${WITHER_GUTTER_DEPTH.toFixed(2)} * vDeathRamp * gutter;

          vec3 retireColor = vec3(${CONSENSUS_BRAID_PALETTE.retire.join(', ')});
          float retireMix = smoothstep(0.0, 0.48, vDeathRamp);
          col = mix(col, retireColor, retireMix);
        }
        // Stage resolution is a property of the view, so it dims the WHOLE
        // cell — event signals included. A cell being let go never keeps a
        // bright selection ring on its way out.
        a *= vStageAlpha;
        if (a < 0.005) discard;
        gl_FragColor = vec4(col * a, a);
      }
    `,
  });
}
