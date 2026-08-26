import * as THREE from 'three';
import { PEER_NETWORK_PALETTE } from '../visualPalette';

/**
 * THE MINING CHANNEL, THIRD CUT: a cohort is a black hole.
 *
 * A dark event horizon with a bright, swirling accretion rim around it, and
 * motes seeded out in the empty space nearby that spiral in, accelerate, and
 * are swallowed at the throat. Continuously, for as long as that payout
 * identity is in the chain's recent window — because this is the IDLE state,
 * what a cohort does between blocks. On the block it wins, the colony's own
 * outward surge already erupts from that very node, so nothing here fires: the
 * eruption is the punctuation and this is the sentence it punctuates.
 *
 * ⭐ THE TWO CUTS THIS REPLACES, AND WHY EACH DIED. The first drew a ring
 * around the node whose BRIGHTNESS rose and fell: a hard geometric circle
 * reads as HUD chrome that escaped into the 3D scene, and modulating a static
 * shape is not motion — nothing travelled, so nothing was absorbed. The second
 * sent motes inward along the node's OWN LINKS, which is motion, and which
 * says the energy comes FROM THE NETWORK. That is a different claim and a
 * wrong one. Energy is drawn out of the surrounding void here, so the motes
 * are seeded in empty space and reach the node along no edge this colony draws.
 *
 * ⚠️⚠️ THE SCENE IS ADDITIVELY BLENDED, SO THE DARK CORE IS NOT DRAWN — IT IS
 * THE PART THAT IS NOT. Adding zero changes nothing, so there is no arrangement
 * of colour and alpha that paints black over a lit stage; the horizon exists
 * only as an ABSENCE OF GLOW INSIDE A BRIGHT STRUCTURE, and the structure is
 * the rim. Everything this shader computes — rim, motes, veil — is multiplied
 * by one `horizon` mask that is 0 inside the event horizon and 1 outside it, so
 * the hole is defined by what surrounds it and can never be defined by itself.
 *
 * ⭐⭐ WHICH IS ALSO WHY THE ATTESTED POINT CLOUD IS GONE. It drew a soft
 * additive sprite centred on the node, and an additive sprite is brightest at
 * its own centre — exactly the pixel the shadow needs to be empty. Keeping it
 * would have been arithmetically identical to filling the hole with light, and
 * the whole mark would have read as a blob with a ring around it. The two
 * requirements are mutually exclusive and the user's ruling is the black hole,
 * so the stop is subsumed rather than sat under.
 *
 * ⚠️ NOTHING HERE SAMPLES THE BLOCK SHOCKWAVE, and that is a rule rather than
 * an omission. The front crosses the WHOLE colony on every block, so a
 * wave-receptive mining mark would flare for EVERY cohort as it passed — the
 * scene showing six of them discharging on a block exactly one of them won.
 * There is no shockwave uniform in this file and no import that could carry
 * one. The cost is stated rather than hidden: with the point cloud subsumed,
 * a cohort's mark no longer brightens when a block sweeps past it.
 *
 * ⚠️⚠️ AND IT IS NOT THE CELL CANOPY'S CONTACT WAVE, which is the nearest
 * thing on stage to "a ring around a point". Four differences, three of them
 * structural:
 *
 *   | axis     | contact wave (CellGalaxy)      | this                        |
 *   | -------- | ------------------------------ | --------------------------- |
 *   | when     | one shot, only on a block      | continuous, the idle state  |
 *   | radius   | EXPANDS, and keeps expanding   | fixed — it never grows      |
 *   | size     | crosses the canopy, tens of wu | ~2 world units of rim       |
 *   | centre   | filled: the wave passes over   | empty, and that IS the mark |
 *
 * The radius row is the load-bearing one: an expanding ellipse and a standing
 * one cannot be confused for longer than a frame, and this one is a pure
 * function of `uTime` only through its SWIRL, never through its extent.
 *
 * ⚠️ Nor a courier glint, which is a billboarded bloom plus a comet plume,
 * fired once per block, travelling OUTWARD down the propagation tree and tinted
 * that block's carrier hue. This is inward, continuous, has no head to stretch
 * and is drawn in the mesh's own scaffold token.
 *
 * ⭐ RATE IS THE SHARE, AND NOTHING ELSE IS. A cohort holding more of the
 * window pulls its motes in FASTER; every mote is the same size and the same
 * brightness, and every rim is the same radius and the same light, whoever they
 * belong to. Saying the share a second time as "the big one is also bigger"
 * would say one fact twice, and would make a cohort with four blocks look like
 * a rounding error rather than one that made four blocks.
 *
 * ⭐ NO NEW HUE. It draws in the peer mesh's existing scaffold token, the value
 * the colony's links and every cloud stop are already drawn in.
 */

/** World radius of the event horizon — the edge of the shadow.
 *
 *  At the default camera the colony renders at roughly 5.7 CSS px per world
 *  unit, so this is a 4.4px radius: an 8.9px hole. Small enough that the
 *  colony's own inferred edges crossing it stay a texture rather than a
 *  contradiction, and large enough to read as a hole rather than a gap. */
export const COHORT_HORIZON_R = 0.78;

/** Where a mote finally vanishes — INSIDE the horizon, on purpose.
 *
 *  A mote that stopped exactly at the horizon would blink out at full
 *  brightness on the shadow's edge. Falling past it means the horizon mask is
 *  what extinguishes it, which is the difference between being swallowed and
 *  giving up. */
export const COHORT_THROAT_R = COHORT_HORIZON_R * 0.55;

/** World radius the accretion rim peaks at — and the cohort's whole mark.
 *
 *  ⭐⭐ THIS IS THE NUMBER THE SIZE RULING LANDED ON. The mark it replaces was
 *  a 1.8-world-unit sprite against a sighted peer's 2.0, so a node the CHAIN
 *  proves drew smaller than a node a crawler merely answered — which a viewer
 *  noticed. The old constraint that held it under 2.0 was that it would tie
 *  `reached` for the largest footprint on the confidence ladder; that
 *  constraint dissolved with the point cloud. A black hole is not a stop on the
 *  ladder at all. It is a different primitive on the "what it does" axis, so
 *  there is no rung for it to tie and nothing about its size that can be read
 *  as a claim about how well the node is known.
 *
 *  2.10 world units of ring diameter — 12.0 CSS px at the default camera,
 *  against the 11.4px a reached peer's sprite draws. Not smaller, and the
 *  structure around it (motes out to 17px) is three times either. */
export const COHORT_RIM_R = 1.05;

/** Gaussian half-width of the rim band, in world units. ~1.9 CSS px, so the
 *  bright band reads about 4px thick — a disc seen nearly edge-on, never a
 *  hairline stroke. */
export const COHORT_RIM_SIGMA = 0.34;

/** Peak additive brightness of the rim.
 *
 *  Deliberately over 1.0 on its brightest lobe: the leading edge of a real
 *  accretion disc is the brightest thing in the picture, and clipping there is
 *  what makes the shadow beside it read as a shadow. */
export const COHORT_RIM_AMP = 1.25;

/** World radius motes are seeded at — out in the empty space around the node.
 *
 *  ⭐ THE WHOLE POINT OF THIS REVISION IS IN THIS NUMBER. 3.0 world units is
 *  ~17 CSS px from the mark at the default camera, which is well clear of the
 *  rim and on nothing: no link, no edge, no neighbour. Energy comes out of the
 *  void, and a viewer can see that it does because a mote's journey begins
 *  where there is nothing. */
export const COHORT_MOTE_BIRTH_R = 3.0;

/** Gaussian half-width of one mote. ~1.4 CSS px, so a mote reads as a ~4px
 *  dot — the size the void needs it to be to be found at all. The second cut
 *  of this channel shipped a mark that could not be positively identified on a
 *  real GPU at shipped defaults, and this is the number that failure was
 *  about. */
export const COHORT_MOTE_SIGMA = 0.24;

/** Peak additive brightness of one mote. Under the clip: a mote is a fleck of
 *  matter, and the rim it falls into is the bright thing. */
export const COHORT_MOTE_AMP = 0.95;

/** Half-extent of the billboard the whole apparatus is drawn on, world units.
 *
 *  Sized from the outermost feature rather than picked: the birth radius plus
 *  three mote sigmas, rounded up, so a mote is never clipped at the moment it
 *  appears. ~44 CSS px across at the default camera. */
export const COHORT_MARK_HALF_EXTENT = 3.9;

/** Infalls per second for a cohort holding the WHOLE window. The one property
 *  the share moves. */
export const COHORT_INFALL_HZ = 0.45;

/** What a cohort holding almost none of the window still runs at, as a fraction
 *  of one holding all of it.
 *
 *  Not zero, and not a floor bolted on to dodge a degenerate case: a cohort
 *  with four blocks out of two hundred and forty still MADE those four, and a
 *  hole that had stopped eating would say it had stopped mining. Deliberately
 *  not a knob — it is a statement this layer makes, not a taste to settle
 *  against pixels. */
export const COHORT_INFALL_FLOOR = 0.35;

/** Travel exponent. 1 is constant speed; above 1 a mote drifts in the outer
 *  void and ACCELERATES down the throat, which is what falling looks like and
 *  what being thrown does not. Not a knob, for the same reason: it is the
 *  sentence, not the volume. */
export const COHORT_INFALL_EASE = 2.2;

/** Turns a mote adds on its way from the birth radius to the throat. */
export const COHORT_SWIRL_TURNS = 1.15;

/** Turns per second the rim itself makes. Slow — an order under the motes, so
 *  the disc reads as standing while things fall through it. */
export const COHORT_RIM_SPIN_HZ = 0.045;

/** A broad, dim pool of light around the hole, so the mark is FINDABLE before
 *  it is legible. It is masked by the horizon like everything else, so it never
 *  reaches inside the shadow. Not a knob: the rim's own amplitude is the volume
 *  control, and a second one would be two ways to say one thing. */
export const COHORT_VEIL_AMP = 0.22;

/** How many motes are in flight around one cohort at any moment. Compiled into
 *  the shader as a loop bound, so it is a constant here rather than a uniform. */
export const COHORT_MOTES = 14;

/** The pick target for one cohort: the rim, which is the mark.
 *
 *  ⭐ ONE NUMBER, DERIVED, exactly as a cloud stop's target is its own sprite.
 *  1.05 world units is ~6.0 CSS px of radius against the 0.9 (~5.1px) the
 *  subsumed point cloud stood — bigger, and centred on the same node — and it
 *  covers the whole shadow, so aiming at the hole hits it too. Generosity past
 *  the mark is not free: the Cell canopy yields this pixel through
 *  NETWORK_PEER_PICK_FLAG, so every pixel taken beyond the glow is stolen from
 *  the layer underneath. */
export const COHORT_HIT_RADIUS = COHORT_RIM_R;

/**
 * One additive draw for every cohort in the colony: a camera-facing quad per
 * instance, with the horizon, the rim and the motes all evaluated in the
 * fragment shader from the quad's own polar coordinates.
 *
 * TWO custom attributes, both scalar floats, split by write cadence rather than
 * tidiness: `aSeed` is written when the staged cohort set moves and `aShare` on
 * every attributed block, so packing them would re-upload the static one every
 * time a numerator moved. 2 custom + 3 injected + 4 for `instanceMatrix` =
 * 9 of 16.
 *
 * Nothing here runs per frame but a handful of uniform writes: every moving
 * part is a function of `uTime` and the two lanes, so the CPU is idle between
 * blocks no matter how many cohorts are on screen. That is the other half of
 * why the motes are procedural rather than a sprite pool — a pool of
 * continuously falling motes would be a per-frame walk for the whole idle life
 * of the scene.
 */
export function makeColonyAccretionMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.scaffold),
      },
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      uHalf: { value: COHORT_MARK_HALF_EXTENT },
      uHorizon: { value: COHORT_HORIZON_R },
      uThroat: { value: COHORT_THROAT_R },
      uRim: { value: COHORT_RIM_R },
      uRimSigma: { value: COHORT_RIM_SIGMA },
      uBirth: { value: COHORT_MOTE_BIRTH_R },
      uMoteSigma: { value: COHORT_MOTE_SIGMA },
      uEase: { value: COHORT_INFALL_EASE },
      uInfallFloor: { value: COHORT_INFALL_FLOOR },
      uVeil: { value: COHORT_VEIL_AMP },
      // Zero-drift defaults (seeded once; the owner refreshes them per frame
      // from LIVE.peer.* so a panel drag reshapes holes already on screen).
      uRimAmp: { value: COHORT_RIM_AMP },
      uMoteAmp: { value: COHORT_MOTE_AMP },
      uInfall: { value: COHORT_INFALL_HZ },
      uSwirl: { value: COHORT_SWIRL_TURNS },
      uSpin: { value: COHORT_RIM_SPIN_HZ },
    },
    vertexShader: /* glsl */ `
      attribute float aShare;
      attribute float aSeed;
      varying vec2 vUv;
      varying float vShare;
      varying float vSeed;
      void main() {
        vUv = uv;
        vShare = aShare;
        vSeed = aSeed;
        // The instance matrix carries a TRANSLATION only: the quad is rebuilt
        // from the view matrix's own row axes, which is the frame a follow
        // billboard would have produced, at zero per-frame CPU. The colony
        // counter-rotates and this layer rides inside that group, so the
        // ORIGIN turns with the colony while the quad keeps facing the camera.
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 cameraRight = vec3(
          viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]
        );
        vec3 cameraUp = vec3(
          viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]
        );
        vec3 world = origin.xyz
          + cameraRight * position.x
          + cameraUp * position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uHalf;
      uniform float uHorizon;
      uniform float uThroat;
      uniform float uRim;
      uniform float uRimSigma;
      uniform float uRimAmp;
      uniform float uBirth;
      uniform float uMoteSigma;
      uniform float uMoteAmp;
      uniform float uEase;
      uniform float uInfall;
      uniform float uInfallFloor;
      uniform float uSwirl;
      uniform float uSpin;
      uniform float uVeil;
      varying vec2 vUv;
      varying float vShare;
      varying float vSeed;

      const float TAU = 6.28318530718;
      const int MOTES = ${COHORT_MOTES};

      float hash11(float n) {
        return fract(sin(n * 127.1 + 311.7) * 43758.5453123);
      }

      void main() {
        // Quad coordinates, then WORLD offsets: every radius below is a world
        // length, so the apparatus is the same size whatever the viewport does.
        vec2 p = (vUv - 0.5) * 2.0;
        float rq = length(p);
        if (rq > 1.0) discard;
        vec2 pw = p * uHalf;
        float rw = rq * uHalf;

        // How fast this hole eats. THE ONE PROPERTY THE SHARE MOVES: the rim,
        // the motes and the radii are the same for every cohort.
        float rate = uInfall * mix(uInfallFloor, 1.0, clamp(vShare, 0.0, 1.0));

        // Angular momentum, normalised so one fall adds exactly uSwirl turns.
        // The rim divides by the same span, so the disc and the things falling
        // through it turn together instead of shearing.
        float throat = max(uThroat, 0.02);
        float span = max(uBirth / throat - 1.0, 0.001);

        // The accretion rim. Its RADIUS wanders with angle and its brightness
        // wanders with it: a disc of infalling matter, never a stroked circle.
        float rimTwist = uSwirl * TAU * 0.35
          * ((uBirth / max(rw, throat)) - 1.0) / span;
        float ang = atan(pw.y, pw.x) + rimTwist + vSeed * TAU
          - uTime * uSpin * TAU;
        float rimR = uRim
          * (1.0 + 0.16 * sin(ang * 2.0 + 0.9) + 0.09 * sin(ang * 3.0 + 2.1));
        // NB: d squared by MULTIPLICATION. pow() is undefined for a negative
        // base, and this one is negative everywhere inside the ring.
        float rd = (rw - rimR) / max(uRimSigma, 0.02);
        float band = exp(-rd * rd);
        float lobes = 0.40 + 0.34 * sin(ang) + 0.20 * sin(ang * 2.0 + 1.27)
          + 0.12 * sin(ang * 3.0 - 0.6);
        // Never to nothing: one side of a real disc outshines the other, but a
        // rim that went dark on its far side would read as two arcs rather
        // than as one thing turning.
        float rim = band * max(lobes, 0.36) * uRimAmp;

        // What is falling in. Seeded out in EMPTY SPACE at uBirth and on no
        // edge this colony draws, spiralling, accelerating, and swallowed.
        float motes = 0.0;
        if (rw < uBirth + uMoteSigma * 3.0) {
          for (int k = 0; k < MOTES; k++) {
            float fk = float(k);
            // ⭐ EACH MOTE FALLS AT ITS OWN PACE, and the ensemble is what
            // stops this reading as a heartbeat. Sharing one rate, fourteen
            // motes translate RIGIDLY: the whole pattern sweeps in together,
            // resets together, and a viewer sees the hole breathe once a
            // cycle instead of eating continuously. The jitter is a per-mote
            // constant with the same distribution for every cohort, so it
            // decorrelates the flow without saying the share a second time.
            float pace = 0.7 + 0.6 * hash11(fk * 5.3 + vSeed * 19.0);
            float t = fract(uTime * rate * pace + hash11(fk + vSeed * 37.0));
            float rm = mix(uBirth, throat, pow(t, uEase));
            float am = hash11(fk * 1.7 + vSeed * 11.0 + 3.1) * TAU
              + uSwirl * TAU * ((uBirth / max(rm, throat)) - 1.0) / span;
            float md = length(pw - vec2(cos(am), sin(am)) * rm)
              / max(uMoteSigma, 0.02);
            // Born softly out in the void; nothing fades it on the way in,
            // because what ends a mote is the horizon closing over it.
            motes += exp(-md * md) * smoothstep(0.0, 0.16, t);
          }
        }

        // A broad dim pool, so the mark is findable before it is legible.
        float veil = uVeil * exp(-(rw * rw) / max(8.0 * uRim * uRim, 0.001));

        // ⚠️⚠️ THE HOLE, AND THE ONLY WAY AN ADDITIVE SCENE CAN HAVE ONE. This
        // mask is 0 inside the event horizon and 1 outside it, and EVERY term
        // above is multiplied by it — so the shadow is the region this shader
        // declines to light, defined entirely by the rim around it. Nothing
        // here paints darkness, because adding zero paints nothing.
        float hOut = max(uHorizon, 0.03);
        float hIn = min(hOut * 0.72, hOut - 0.001);
        float horizon = smoothstep(hIn, hOut, rw);
        // …and the billboard never shows its own edge.
        float eIn = uHalf * 0.88;
        float eOut = max(uHalf, eIn + 0.001);
        float edge = 1.0 - smoothstep(eIn, eOut, rw);

        float amp = (rim + motes * uMoteAmp + veil) * horizon * edge;
        if (amp < 0.002) discard;
        // AdditiveBlending applies alpha to RGB a second time, so the passive
        // context weight belongs in colour only — the same split every peer
        // material here keeps, which is what makes a Cell inspection's damping
        // linear instead of squaring the layer into invisibility.
        gl_FragColor = vec4(uColor * amp * uContextEnergy, amp);
      }
    `,
  });
}
