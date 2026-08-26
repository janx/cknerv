import * as THREE from 'three';
import { PEER_NETWORK_PALETTE } from '../visualPalette';

/**
 * THE MINING CHANNEL: what a mining node draws IN.
 *
 * A soft mote travels along each of a miner's own links, from the far end
 * inward, and is swallowed at the node. Continuously, on every incident link,
 * for as long as that node is in the recent window — because that is what the
 * thing being drawn actually is. Transactions arrive over exactly these links,
 * a miner aggregates them, and what leaves is a block.
 *
 * ⭐ IT IS STILL THE MOTION CHANNEL, WHICH WAS ALWAYS THE RIGHT ONE. Mining is
 * the only thing in this scene that is a RATE; a reach state, a link, a tally
 * are all states, and the confidence ladder already spends both brightness and
 * footprint saying how well a node is known. What the first attempt got wrong
 * was taking motion's channel and spending it on brightness modulation of a
 * static ring: nothing travelled, so nothing was absorbed, and a viewer was
 * asked to read a rate off a pulsing circle. Something travels now.
 *
 * ⚠️⚠️ THE ONE THING THIS MUST NEVER BE MISTAKEN FOR IS A COURIER, and the
 * inverse reading is the exact opposite of the truth: a courier glint means "a
 * block is arriving here". Six differences ship, not one, and four of them are
 * structural rather than tuned —
 *
 *   | axis      | courier (ColonyCourierLayer)      | intake (this)                  |
 *   | --------- | --------------------------------- | ------------------------------ |
 *   | when      | one shot, only on a block         | continuous, the idle state     |
 *   | direction | outward, diverging down the tree  | inward, converging on one node |
 *   | form      | billboarded bloom + comet plume   | a band ON the line itself      |
 *   | motion    | easeOutCubic — fast, decelerating | ease IN — slow, accelerating   |
 *   | ending    | arrives and hands off onward      | extinguishes INTO the node     |
 *   | colour    | that block's carrier hue          | the mesh's own scaffold token  |
 *
 * The form row is the load-bearing one. This draws on a `lineSegments`
 * primitive, so it is STRUCTURALLY INCAPABLE of growing a plume or a bloom: it
 * has no quad to billboard and no head to stretch. That is the same primitive
 * the peer mesh's ambient current and block surge already use, which is the
 * side of the house this belongs on — soft luminous bands sliding along
 * STRAIGHT links, never the cells' sharp white spike-heads racing along curved
 * dendrites. The two vocabularies must not converge, and a shape that cannot
 * become a comet cannot drift across.
 *
 * ⭐ RATE IS THE SHARE, AND NOTHING ELSE IS. A miner holding more of the window
 * pulls faster; every mote is the same width and the same brightness whoever it
 * belongs to. Encoding the share a second time as "the big one is also bolder"
 * would be saying one fact twice and would make a small miner look like a
 * rounding error rather than a machine that made four blocks.
 *
 * ⚠️ NOTHING HERE SAMPLES THE BLOCK SHOCKWAVE, and that is deliberate rather
 * than an omission. The front crosses the whole colony on every block, so a
 * wave-receptive intake would surge for EVERY miner as it passed — the scene
 * showing six machines being fed by a block exactly one of them won. The point
 * cloud underneath IS wave-receptive (a miner receives a block like any other
 * node at that distance); this layer answers only its own clock and its own
 * node's win.
 *
 * ⭐ NO NEW HUE. It draws in the peer mesh's existing scaffold token, the value
 * the colony's links and every cloud stop are already drawn in. The claim is
 * "this is the peer network, doing the one thing peers do that is a rate"; a
 * new colour would have made it a new species.
 */

/** Peak additive brightness of one mote.
 *
 *  ⚠️ IT SITS UNDER THE BLOCK SURGE ON PURPOSE. This layer draws OVER the link
 *  that is already there, so a mote's total is the edge's own resting light
 *  plus this. At the shipped defaults that lands it clearly above the ambient
 *  drift and clearly below a block surge, which is the honest ordering: the
 *  block is the loudest thing that happens in this mesh. */
export const COLONY_INTAKE_AMP = 0.8;

/** How fast a mote travels, in WORLD units per second, averaged over its run.
 *
 *  ⭐ WORLD UNITS, NEVER PARAMETER UNITS, because this colony's links are not
 *  one length: a kNN neighbour is about ten world units away and a long-range
 *  link can be two hundred. A speed in parameter space would send a mote down
 *  the long one twenty times faster, which is the one motion in this scene that
 *  reads as a thrown packet. Every stream drifts at the same speed instead, and
 *  a distant link simply takes longer to arrive from — which is true.
 *
 *  Slow, and set against its neighbours rather than picked: the mesh's ambient
 *  current drifts about half a world unit a second and a block surge crosses a
 *  hop at a couple of hundred. This is between them and much nearer the drift —
 *  a typical link takes a few seconds, so a miner is fed a mote about twice a
 *  second across all of its links at once. First knob to reach for. */
export const COLONY_INTAKE_SPEED = 4.5;

/** Gaussian sigma of one mote, in WORLD units — a mote, not a band.
 *
 *  World rather than a fraction of the link, for the same reason the speed is:
 *  a mote is the same size on a short link and a long one, so only its MOTION
 *  says anything. It is deliberately far shorter than a block surge's band
 *  (which is a fraction of its own link) so the two never read as the same
 *  event travelling in different directions. */
export const COLONY_INTAKE_WIDTH = 0.55;

/** Travel exponent. 1 is constant speed; above 1 the mote starts slow and
 *  ACCELERATES into the node.
 *
 *  ⭐ IT IS THE EXACT INVERSE OF A COURIER'S EASING, and that is the point. A
 *  courier is flung — `easeOutCubic`, fast off the launch and coasting to
 *  rest. A mote is drawn in: it drifts off the far end and falls into the node,
 *  which is what being absorbed looks like and what being thrown does not. */
export const COLONY_INTAKE_EASE = 1.8;

/** Fraction of a mote's run spent fading in at the far end.
 *
 *  A mote is born softly out in the mesh and NEVER fades on the way in — what
 *  ends it is arriving. Ramping it out before the node would have drawn a mote
 *  that gave up rather than one that was swallowed, and the difference is the
 *  whole sentence this layer is saying. */
export const COLONY_INTAKE_BIRTH = 0.18;

/** How long a miner's stream stays spent after the block it wins, in seconds.
 *
 *  ⭐ THE RELEASE IS THE SURGE, AND THE ABSENCE IS THE PUNCTUATION. On the
 *  block a miner wins, the colony's own block surge erupts OUT of that very
 *  node along these very links — the accumulation leaving. This layer's job at
 *  that instant is to stop: the stream goes dark and rebuilds over about twice
 *  this again, so what a viewer sees is energy arriving, a block leaving, and
 *  the feeding starting over.
 *
 *  ⚠️ ONLY THE WINNER'S. It is stamped per segment from the flood's own entry
 *  node, so a miner that lost is untouched — the same discipline that kept the
 *  old ring from discharging for six machines on a block one of them won. */
export const COLONY_INTAKE_SPENT_S = 0.5;

/** What a miner holding NONE of the window still runs at, as a fraction of a
 *  miner holding all of it.
 *
 *  Not zero, and not a floor bolted on to dodge a degenerate case: a producer
 *  with four blocks out of two hundred and forty still MADE those blocks, and a
 *  stream that had stopped would say it had stopped mining. */
export const COLONY_INTAKE_RATE_FLOOR = 0.3;

/** The stamp meaning "this segment's miner has never won a block this session",
 *  in the same absolute simClock seconds `aFireAt` carries. Any real stamp is a
 *  positive elapsed time, so one comparison separates them and no second
 *  attribute is needed to say "armed" — the same sentinel and the same
 *  reasoning as ColonyEdges' `aSurgeT0`/`aSurgeT1`. */
export const COLONY_INTAKE_UNFIRED = -1e9;

/**
 * One additive draw for every intake mote in the colony.
 *
 * The geometry is a `lineSegments` over the miner's OWN links, one segment per
 * (link, miner) pair, with the vertex order baked so `aParam` runs 0 at the far
 * end and 1 at the node. Direction therefore lives in the buffer rather than in
 * a sign the shader has to decode, and there is no arrangement of this material
 * that can draw a mote travelling outward.
 *
 * FIVE custom attributes, all scalar floats, and the split follows write
 * cadence rather than tidiness: `aParam` / `aInvLen` / `aPhase` are written when
 * the colony's staged set moves, `aShare` on every attributed block, `aFireAt`
 * on the block its own miner wins. Packing them would re-upload the static ones
 * every time a numerator moved. 5 custom + 3 injected = 8 of 16.
 */
export function makeColonyIntakeMaterial(): THREE.ShaderMaterial {
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
      // Zero-drift defaults (seeded once; the owner refreshes them per frame
      // from LIVE.peer.* so a panel drag reshapes streams already on screen).
      uAmp: { value: COLONY_INTAKE_AMP },
      uSpeed: { value: COLONY_INTAKE_SPEED },
      uWidth: { value: COLONY_INTAKE_WIDTH },
      uEase: { value: COLONY_INTAKE_EASE },
      uBirth: { value: COLONY_INTAKE_BIRTH },
      uSpentS: { value: COLONY_INTAKE_SPENT_S },
      uRateFloor: { value: COLONY_INTAKE_RATE_FLOOR },
    },
    vertexShader: /* glsl */ `
      attribute float aParam;
      attribute float aInvLen;
      attribute float aShare;
      attribute float aPhase;
      attribute float aFireAt;
      varying float vParam;
      varying float vInvLen;
      varying float vShare;
      varying float vPhase;
      varying float vFireAt;
      void main() {
        vParam = aParam;
        vInvLen = aInvLen;
        vShare = aShare;
        vPhase = aPhase;
        vFireAt = aFireAt;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uAmp;
      uniform float uSpeed;
      uniform float uWidth;
      uniform float uEase;
      uniform float uBirth;
      uniform float uSpentS;
      uniform float uRateFloor;
      varying float vParam;
      varying float vInvLen;
      varying float vShare;
      varying float vPhase;
      varying float vFireAt;

      const float ARMED = -1.0e8;

      void main() {
        // How often this stream delivers: a world speed over the link's own
        // length, tilted by the miner's share of the window. Share is the RATE
        // and nothing else — width and brightness are the same for everybody.
        float rate = uSpeed * vInvLen
          * mix(uRateFloor, 1.0, clamp(vShare, 0.0, 1.0));
        float u = fract(uTime * rate + vPhase);
        // Ease IN: drifts off the far end, falls into the node. The inverse of
        // a courier's easeOutCubic fling, on purpose.
        float travel = pow(u, uEase);
        // A world-constant mote, expressed in this link's parameter units.
        float sigma = max(uWidth * vInvLen, 0.0006);
        float d = (vParam - travel) / sigma;
        float mote = exp(-d * d);
        // Born softly out in the mesh; nothing fades it on the way in, so what
        // ends it is arriving at the node.
        float born = smoothstep(0.0, uBirth, u);
        // …and the stream is SPENT for as long as the block it fed is leaving.
        // WARN: the rebuild window is FLOORED rather than a plain multiple of
        // the knob. smoothstep is undefined when its two edges are equal, and
        // the panel can drag uSpentS to exactly zero — which on a driver that
        // answers NaN would paint the winner's links NaN until its next block.
        // Floored, zero means "spend it for no time", which is what it says.
        float since = uTime - vFireAt;
        float spentEdge = uSpentS + max(uSpentS * 1.4, 0.05);
        float spent = vFireAt > ARMED && since >= 0.0
          ? 1.0 - smoothstep(uSpentS, spentEdge, since)
          : 0.0;
        float amp = uAmp * mote * born * (1.0 - spent);
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
