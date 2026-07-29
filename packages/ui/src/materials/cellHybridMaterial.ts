import * as THREE from 'three';
import { HASH11_GLSL, BIRTH_DEATH_GLSL } from './cellEnvelope.glsl';
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
const HYBRID_BASE_PX_PER_WU = 2.0; // sprite world→screen multiplier — ~2× halo outer-glow size; cell body (gl_PointCoord ≤ 0.5) renders at roughly halo-equivalent screen weight
/** Direct inspection neighbours gain enough sprite room for their split
 * interface arcs. CellPicker imports the same value so the affordance never
 * extends beyond its hit area. */
export const CELL_INSPECTION_NAVIGATION_SIZE_SCALE = 1.18;

export function makeCellHybridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:            { value: 0 },
      uBirthDurS:       { value: 0.5 },
      uDeathDurS:       { value: 0.6 },
      uViewportHeight:  { value: 800 },
      uPixelRatio:      { value: 1 },
      uMemoryMinPointPx: { value: 24 },
      uMemoryLinePx:    { value: 0.55 },
      uMemorySignalEnergy: { value: 1 },
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
      attribute float aSize;
      attribute vec4  aMemoryIdentity; // normalized asset / lock / payload / mass
      attribute float aMemorySeed; // stable content-hash word; never draw-order based
      attribute float aDetail;  // LOD: 0 for all far cells (glow unchanged); ramps →1 as the camera nears, softening the white-hot peak so the nucleus shows
      attribute float aFocus;   // eased interaction: 0 resting, ~0.46 hover, 1 selected
      attribute float aRecall;  // signed historical read: source < 0, retained target > 0
      attribute float aRecallState; // source travel / target witness resolution
      attribute float aInspection; // eased real-adjacency energy; 1 outside inspection
      attribute float aInspectionRole; // 1 = direct, navigable renderer-neighbour

      uniform float uTime;
      uniform float uBirthDurS;
      uniform float uDeathDurS;
      uniform float uViewportHeight;
      uniform float uPixelRatio;
      uniform float uMemoryMinPointPx;
      uniform float uCenterDim;

      varying vec3  vColor;
      varying float vDeathRamp;
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

      ${BIRTH_DEATH_GLSL}

      void main() {
        vColor = aColor;
        vMemoryIdentity = aMemoryIdentity;
        vDetail = aDetail;
        vFocus = aFocus;
        vRecall = aRecall;
        vRecallState = aRecallState;
        vInspection = aInspection;
        vInspectionRole = aInspectionRole;
        float birthRamp = clamp((uTime - aBornAt) / uBirthDurS, 0.0, 1.0);
        float deathRamp = clamp((uTime - aDeathAt) / uDeathDurS, 0.0, 1.0);
        float bEase = birthEase(birthRamp);
        float dEase = deathEase(deathRamp);
        float scale = bEase * (1.0 - dEase);

        vDeathRamp = deathRamp;
        vSeed      = aMemorySeed * 91.73
          + dot(position, vec3(0.071, 0.113, 0.173));

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
        gl_PointSize  = aSize * ${HYBRID_BASE_PX_PER_WU.toFixed(1)} * inspectionNavigationScale * (1.0 + vFocus * 0.18) * (1.0 + abs(vRecall) * 0.06 + retainedCore * retainedSizeBoost) * scale * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
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
      uniform float uWarmth;
      uniform float uMemoryLinePx;
      uniform float uMemorySignalEnergy;

      varying vec3  vColor;
      varying float vDeathRamp;
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

      // hash11 — small deterministic scrambler. Used for per-cell decorrelation.
      ${HASH11_GLSL}

      // Single central Gaussian peak + faint outer halo wash. The cell's
      // brightest point is anchored at sprite center (= fabric endpoint at
      // cell.pos_seed), which makes the fiber-to-cell connection visually
      // continuous: cell glow and fiber glow are both Gaussian, so they
      // meet at the same point and form one bright knot.
      //
      // Per-cell variation comes from per-tag color (vColor) and sprite size
      // (aSize).
      vec4 cloud(vec2 uv, float t) {
        float dC = length(uv);

        // Breath: non-translating sigma pulsation so the cell feels alive
        // without the centroid moving. Amplitude small enough that the
        // sprite's brightest pixel stays clearly at center.
        float br     = 0.7 + 0.6 * hash11(vSeed + 7.7);
        float breath = 1.0 + 0.08 * sin(t * br + vSeed);
        float sigma  = 0.10 * breath;
        // LOD peak suppression: near cells (vDetail→1) lose the white-hot core so
        // the nucleus reads; far cells (vDetail=0) are byte-identical to before.
        float peak   = exp(-pow(dC / sigma, 2.0)) * (1.0 - vDetail * 0.92);

        // Living Cell body: rose tissue warms toward ember while the centre
        // resolves to a soft warm-white nucleus. The colour stays visually
        // separate from the peer network's synthetic blue data plane.
        vec3 ember = mix(
          vColor,
          vec3(${CELL_GALAXY_PALETTE.ember.join(', ')}),
          0.55
        );
        vec3 body = mix(vColor, ember, uWarmth);
        vec3 hot  = mix(
          body,
          vec3(${CELL_GALAXY_PALETTE.warmWhite.join(', ')}),
          0.72
        );
        vec3 col   = mix(body, hot, peak);

        // Outer halo wash for boundary continuity — very faint full-sprite
        // glow that anchors the cell's footprint when peak alone is too
        // tight at distance.
        float wash = exp(-pow(dC / 0.32, 2.0)) * 0.18 * (1.0 - vDetail * 0.45);
        col += body * wash;

        return vec4(col, peak + wash);
      }

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        if (length(uv) > 0.5) discard;

        float t = uTime;
        if (vDeathRamp >= 1.0) discard;

        vec4 base = cloud(uv, t);
        // Both density compression and graph-distance inspection apply only to
        // the resting body. Focus, write, and recall signals below can still
        // reclaim headroom because they describe real events.
        base.a *= vCenterDim * vInspection;

        vec3  col = base.rgb;
        float a   = base.a * (1.0 - vDeathRamp);

        // A direct spatial neighbour is an interface into the next bounded
        // topology field. Three open, hash-oriented arcs express that role
        // without wrapping the Cell in a generic UI ring or adding per-Cell
        // geometry. The role changes atomically with the pick surface; the
        // eased inspection energy only softens its arrival.
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

        // Interaction feedback uses an interrupted two-fold interference ring,
        // echoing the contributor crossings of A instead of adding a generic
        // solid selection circle. Hover reveals it partially; selection closes
        // the signal and hands visual emphasis to the expanded braid.
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

        // Historical recall reads the Cell's record; it does not replay a
        // write flash. Sources emit two bounded address rails. The retained
        // target receives a segmented scan aperture, then resolves three
        // checksum lanes and one central agreement knot only as its real
        // witness arrivals converge. The knot outlasts the route aperture but
        // clears exactly when the explicit historical read ends.
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

        // A real on-chain Cell consumption is not agreement: transition the
        // fading body toward the retirement signal before it disappears. GC
        // never reaches this shader path, so quiet renderer eviction stays mute.
        vec3 retireColor = vec3(${CONSENSUS_BRAID_PALETTE.retire.join(', ')});
        float retireMix = smoothstep(0.0, 0.48, vDeathRamp);
        col = mix(col, retireColor, retireMix);
        if (a < 0.005) discard;
        gl_FragColor = vec4(col * a, a);
      }
    `,
  });
}
