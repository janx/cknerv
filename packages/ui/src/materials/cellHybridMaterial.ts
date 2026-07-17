import * as THREE from 'three';
import { HASH11_GLSL, BIRTH_DEATH_GLSL } from './cellEnvelope.glsl';
import { makeShockwaveUniforms, SHOCKWAVE_SLOTS } from './shockwaveMaterial';
import { CONSENSUS_BRAID_PALETTE } from '../derives/consensusBraid.derive';

/**
 * Single-peak Gaussian cloud baseline + block shockwave for each cell.
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
 * The block shockwave is handled here, on the actual cell body. It never
 * creates a separate point beside the cell: the shader uses the anchored cell
 * position, then brightens and expands that same sprite as the wave crosses it.
 */

// Tunable feel constants — collected here so reviewers find them in one place.
const HYBRID_BASE_PX_PER_WU = 2.0; // sprite world→screen multiplier — ~2× halo outer-glow size; cell body (gl_PointCoord ≤ 0.5) renders at roughly halo-equivalent screen weight

export function makeCellHybridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:            { value: 0 },
      uBirthDurS:       { value: 0.5 },
      uDeathDurS:       { value: 0.6 },
      uViewportHeight:  { value: 800 },
      uWarmth:          { value: 0.04 }, // cool resting structure → restrained gold bias; set live from LIVE.cell.warmth
      uCenterDim:       { value: 0.3 }, // shared centre-energy floor; passive fabric applies its stronger squared form
      ...makeShockwaveUniforms(),
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
      attribute float aDetail;  // LOD: 0 for all far cells (glow unchanged); ramps →1 as the camera nears, softening the white-hot peak so the nucleus shows
      attribute float aFocus;   // eased interaction: 0 resting, ~0.46 hover, 1 selected
      attribute float aRecall;  // signed historical read: source < 0, retained target > 0
      attribute float aRecallState; // source travel / target witness resolution

      uniform float uTime;
      uniform float uBirthDurS;
      uniform float uDeathDurS;
      uniform float uViewportHeight;
      uniform float uCenterDim;
      uniform float uShockwaveAt[${SHOCKWAVE_SLOTS}];
      uniform vec2  uShockwaveOriginXZ[${SHOCKWAVE_SLOTS}];
      uniform vec3  uShockwaveColor[${SHOCKWAVE_SLOTS}];
      uniform float uShockwaveSpeed;
      uniform float uShockwaveDurS;
      uniform float uShockwaveBandBase;
      uniform float uShockwaveBandGrow;
      uniform float uShockwaveSizeBoost;
      uniform float uShockwaveTrailBoost;

      varying vec3  vColor;
      varying float vDeathRamp;
      varying float vSeed;
      varying float vShockwave;
      varying vec3  vShockwaveColor;
      varying float vDetail;
      varying float vFocus;
      varying float vRecall;
      varying float vRecallState;
      varying float vCenterDim;

      ${BIRTH_DEATH_GLSL}

      vec4 shockwaveAtVertex(vec2 worldXZ) {
        float total = 0.0;
        vec3 carrier = vec3(0.0);
        for (int i = 0; i < ${SHOCKWAVE_SLOTS}; i++) {
          float age = uTime - uShockwaveAt[i];
          if (age < 0.0 || age >= uShockwaveDurS) continue;
          float ringR = uShockwaveSpeed * age;
          float dist = length(worldXZ - uShockwaveOriginXZ[i]);
          float bandWidth = uShockwaveBandBase + uShockwaveBandGrow * age;
          float band = exp(-pow((dist - ringR) / bandWidth, 2.0));
          float behind = max(0.0, ringR - dist);
          float trail = exp(-behind / max(bandWidth * 3.2, 0.001)) * step(dist, ringR);
          float t = age / uShockwaveDurS;
          // Asymmetric envelope: rises like sin, then drops fast.
          // smoothstep(0.3, 1.0, t) starts attenuating once the wave is past
          // its early peak, and the (1 - t) linear factor stacks a steady
          // decay so brightness keeps dropping through the back half.
          float life = sin(3.14159265 * t) * (1.0 - smoothstep(0.3, 1.0, t)) * (1.0 - t);
          float signal = (band + trail * uShockwaveTrailBoost) * life;
          total += signal;
          carrier += uShockwaveColor[i] * signal;
        }
        return vec4(carrier, total);
      }

      void main() {
        vColor = aColor;
        vDetail = aDetail;
        vFocus = aFocus;
        vRecall = aRecall;
        vRecallState = aRecallState;
        float birthRamp = clamp((uTime - aBornAt) / uBirthDurS, 0.0, 1.0);
        float deathRamp = clamp((uTime - aDeathAt) / uDeathDurS, 0.0, 1.0);
        float bEase = birthEase(birthRamp);
        float dEase = deathEase(deathRamp);
        float scale = bEase * (1.0 - dEase);

        vDeathRamp = deathRamp;
        vSeed      = float(gl_VertexID) * 0.61803 + aBornAt * 0.137;

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        // Fade resting brightness down toward the galaxy centre so the
        // dense core stops piling up additively into a white-hot blob. Center is
        // world XZ origin (group sits at x=z=0, rotates about y). 1.0 past r≈16.
        vCenterDim = mix(uCenterDim, 1.0, smoothstep(2.0, 16.0, length(worldPos.xz)));
        vec4 viewPos  = viewMatrix * worldPos;
        vec4 shockwaveSignal = shockwaveAtVertex(worldPos.xz);
        vShockwave = shockwaveSignal.a;
        vShockwaveColor = vShockwave > 0.0001
          ? shockwaveSignal.rgb / vShockwave
          : vec3(0.72, 0.96, 1.0);
        gl_Position   = projectionMatrix * viewPos;
        gl_PointSize  = aSize * ${HYBRID_BASE_PX_PER_WU.toFixed(1)} * (1.0 + vShockwave * uShockwaveSizeBoost) * (1.0 + vFocus * 0.18) * (1.0 + abs(vRecall) * 0.1) * scale * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uShockwaveColorBoost;
      uniform float uShockwaveAlphaBoost;
      uniform float uShockwaveColorCeil;
      uniform float uShockwaveAlphaCeil;
      uniform float uShockwaveTrailBoost;
      uniform float uWarmth;

      varying vec3  vColor;
      varying float vDeathRamp;
      varying float vSeed;
      varying float vShockwave;
      varying vec3  vShockwaveColor;
      varying float vDetail;
      varying float vFocus;
      varying float vRecall;
      varying float vRecallState;
      varying float vCenterDim;

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

        // A body: vColor is the Cell's hash-stable point on the gold↔cyan
        // spectrum. uWarmth biases toward the shared gold contributor while the
        // core resolves toward pale consensus light, matching the near braid.
        vec3 gold = vec3(0.86, 0.61, 0.25);
        vec3 body = mix(vColor, gold, uWarmth);
        vec3 hot  = mix(body, vec3(0.86, 0.96, 1.0), 0.72);
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
        base.a *= vCenterDim; // resting body only; shock/focus events still reclaim headroom below

        float shock = vShockwave;
        float shockCore = min(1.0, shock);
        float shockWash = exp(-pow(length(uv) / 0.42, 2.0)) * shock * uShockwaveTrailBoost;
        vec3 shockTint = mix(base.rgb, vShockwaveColor, min(1.0, shockCore * 0.85));

        // Soft-knee the wave's brightness/alpha: same onset slope as the old
        // linear (1 + BOOST*shock), but the bright leading edge saturates toward
        // a warm ceiling instead of railing past white and hard-clipping (see
        // shockwaveMaterial.ts). shock=0 → factor 1.0, so resting cells are
        // untouched. This is the de-glare; the wave's reach/force is preserved.
        float shockColorK = 1.0 + uShockwaveColorCeil * (1.0 - exp(-shock * uShockwaveColorBoost / max(uShockwaveColorCeil, 0.001)));
        float shockAlphaK = 1.0 + uShockwaveAlphaCeil * (1.0 - exp(-shock * uShockwaveAlphaBoost / max(uShockwaveAlphaCeil, 0.001)));

        vec3  col = shockTint * shockColorK + vShockwaveColor * shockWash;
        float a   = (base.a * shockAlphaK + shockWash) * (1.0 - vDeathRamp);

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
        // checksum lanes only as its real witness arrivals converge.
        float recallAmount = clamp(abs(vRecall), 0.0, 1.0);
        float recallTarget = step(0.0, vRecall);
        float recallSource = 1.0 - recallTarget;
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
          * recallAmount * recallTarget;

        float checksum0 = exp(-pow((uv.y + 0.058) / 0.011, 2.0))
          * (1.0 - smoothstep(0.09, 0.16, abs(uv.x)));
        float checksum1 = exp(-pow(uv.y / 0.011, 2.0))
          * (1.0 - smoothstep(0.12, 0.2, abs(uv.x)));
        float checksum2 = exp(-pow((uv.y - 0.058) / 0.011, 2.0))
          * (1.0 - smoothstep(0.07, 0.14, abs(uv.x)));
        float checksumGate = 0.4 + 0.6 * step(
          0.32,
          hash11(floor((uv.x + 0.22) * 24.0) + vSeed)
        );
        float recordLatch = (checksum0 + checksum1 + checksum2)
          * checksumGate * clamp(vRecallState, 0.0, 1.0)
          * recallAmount * recallTarget;

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
        col += recallCyan * targetRead * 1.35;
        col += mix(recallCyan, recallPale, 0.72) * recordLatch * 1.5;
        col += recallViolet * departureRail * 0.72;
        a += targetRead * 0.54 + recordLatch * 0.68 + departureRail * 0.28;

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
