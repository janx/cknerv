import * as THREE from 'three';
import { PEER_NETWORK_PALETTE } from '../visualPalette';

/**
 * THE MINING CHANNEL. A concentric additive ring around a colony node whose
 * RADIUS is that producer's share of the recent window, which CHARGES between
 * blocks and DISCHARGES on the block it wins.
 *
 * ⭐ IT IS A SECOND AXIS, NOT A SIXTH STOP, and the whole reason it exists is
 * that the first axis is already spoken for. `PeerCloudTone` answers "how do we
 * know this node exists", and it answers it with brightness and footprint —
 * both of them, because brightness clips under additive blending and the
 * inferred edges pile light onto every junction they cross. Mining answers a
 * different question ("what does this node do"), and drawing it in brightness
 * or dot size would have made every producer read as a better-known peer.
 *
 * So the channel is MOTION, and that is not a decoration either: mining is the
 * only thing in this scene that is a RATE. Everything else — a reach state, a
 * link, a tally — is a state. A rate wants a rhythm.
 *
 * ⭐⭐ THE RHYTHM IS HONEST FOR FREE, which is the part worth protecting from a
 * later edit that means well. EVERY producer charges from the same instant (one
 * shared `uChargeSince`, stamped on the block that just landed) and EXACTLY ONE
 * discharges (its own `aFireAt`). That is what proof of work is: every machine
 * on the network grinding on the same parent block since the same moment, one
 * of them winning. Nothing here has to be told that story — it falls out of one
 * uniform and one per-instance stamp.
 *
 * ⚠️ THE RING DELIBERATELY DOES NOT SAMPLE THE BLOCK SHOCKWAVE, unlike every
 * other material in this file's neighbourhood. The shockwave crosses the whole
 * colony on every block, so a ring that answered it would brighten for every
 * producer as the front passed — the scene showing six machines discharging on
 * a block exactly one of them won. The point cloud underneath IS wave-receptive
 * (a producer receives a block like every other node, purely spatially); the
 * ring is the one thing on screen that must stay silent unless it won.
 *
 * ⭐ NO NEW HUE. It draws in the peer mesh's existing scaffold token, the same
 * value the colony's edges and every cloud stop are drawn in. The claim it
 * makes is "this is the peer network, doing the one thing peers do that is a
 * rate" — a new colour would have made it a new species.
 */

/** Ring radius, in world units, for a producer holding none of the window.
 *
 *  Not zero, and not a floor bolted on to avoid a degenerate case: a producer
 *  with four blocks out of two hundred and forty still MADE those blocks, and
 *  the ring is what says the node is there at all — the point sprite under it
 *  deliberately rests below the additive clip. Live-tunable; see
 *  `LIVE.peer.ringRadiusMin`. */
export const PRODUCER_RING_MIN_RADIUS = 1.4;

/** World units added to the radius at a share of 1.0 — the whole window.
 *
 *  Radius rather than area, on purpose. A ring is a stroke and not a disc, so
 *  the thing a viewer compares between two of them is how far around it goes,
 *  and circumference is linear in radius. An equal-area scaling would have made
 *  the 56% producer look like 75% of the one below it. */
export const PRODUCER_RING_SHARE_RADIUS = 2.6;

/**
 * How far out the ring stands for a producer holding `share` of the window.
 *
 * ⭐⭐ THE ONE SOURCE FOR HOW BIG A RING IS, and it exists because the mark and
 * the target were once two different numbers. The first cut of this material
 * drew the ring here and let the colony size a producer's PICK TARGET off the
 * point sprite underneath it — a hit sphere of 0.375 world units under a ring
 * drawn at 1.4 to 3.0. That made the node carrying the largest mark in the
 * colony the smallest target in it, four to eight times over, and a full-canvas
 * 13-pixel hover sweep of the running app found forty peers and not one
 * producer. Nothing in a unit suite could see it: no test knows how big
 * anything is on screen. So the radius is a function now, and everything that
 * needs to know where the stroke IS asks it.
 *
 * The vertex shader evaluates this same expression from `uRingMinRadius` and
 * `uRingShareRadius` — the two uniforms the ring's owner refreshes every frame
 * from `LIVE.peer.ringRadiusMin` / `ringRadiusShare`, which is exactly what
 * this function's callers pass in. A retune therefore moves the mark and the
 * target on the same frame, and there is no pair of constants left that could
 * drift apart.
 */
export function producerRingRadius(
  share: number,
  minRadius: number = PRODUCER_RING_MIN_RADIUS,
  shareRadius: number = PRODUCER_RING_SHARE_RADIUS,
): number {
  return minRadius + Math.min(Math.max(share, 0), 1) * shareRadius;
}

/**
 * Half-width of the CLICKABLE band around the ring stroke, in world units.
 *
 * ⚠️ THE DRAWN STROKE IS FAR TOO THIN TO CLICK, so the tolerance cannot be the
 * stroke's own width. `PRODUCER_RING_WIDTH` is a Gaussian sigma of 0.22 world
 * units — a visible line about two and a half CSS pixels across at the default
 * camera, where a world unit measures roughly 5.7 px (ring radii of 8 to 17 px
 * for world radii of 1.4 to 3.0). A band of ±0.8 world units is 1.6 across, or
 * about 9 CSS px: the ordinary tolerance a one-pixel line is given in any
 * interface, and the middle of the 8-12 px this was aimed at.
 *
 * ⭐ IT IS A TOLERANCE ON THE STROKE AND NEVER THE DISC. The interior of a
 * producer's ring keeps belonging to whatever stands there — a sighted peer, a
 * ghost, a Cell, or nothing at all. A filled disc was the tempting shortcut and
 * it would have let the dominant producer's ring swallow every mark inside a
 * 17-pixel radius, which on this colony is a great many of them.
 *
 * ⚠️ AND IT MAY NEVER REACH THE BODY. The producer's own point sprite keeps its
 * own small target inside the hole, so a user aiming at the node still hits the
 * node: at the smallest ring this band leaves the hole 1.4 − 0.8 = 0.6 world
 * units of radius against the attested sprite's 0.375, and the colony's tests
 * hold that clearance rather than trusting the two numbers to stay in step.
 */
export const PRODUCER_RING_HIT_BAND = 0.8;

/**
 * Does a ray passing `perpendicular` world units off a producer's node stand on
 * its ring STROKE, rather than inside the hole the ring encloses?
 *
 * The whole geometry of the annulus, in one comparison, because the annulus is
 * a screen-space band and this is what a screen-space band is in world terms.
 * The ring is billboarded, so the set of world points that project onto the
 * drawn stroke is the set standing a ring-radius away from the node MEASURED
 * ACROSS THE VIEW — which is exactly the perpendicular distance from the
 * pointer ray to that node, at any camera angle and with no plane to keep in
 * sync. `inner` is where the hole ends and `outer` where the tolerance does.
 */
export function producerAnnulusHit(
  perpendicular: number, inner: number, outer: number,
): boolean {
  return perpendicular >= inner && perpendicular <= outer;
}

/** How much room past the ring the quad carries, as a multiple of the radius.
 *
 *  It is the DISCHARGE's runway: the fired band leaves the ring and rides out
 *  to the edge of the quad, so this is how far a win visibly travels before it
 *  is gone. It is also a contract between the two shader stages — the vertex
 *  sizes the billboard by it and the fragment puts the resting ring at its
 *  reciprocal — which is why it is one uniform read twice rather than two
 *  constants that could drift apart. */
export const PRODUCER_RING_MARGIN = 1.55;

/** Gaussian sigma of the ring stroke, in WORLD units.
 *
 *  World rather than a fraction of the radius, so a 56% producer's ring is the
 *  same weight of line as a 2% producer's and only its SIZE says anything. A
 *  proportional stroke would have encoded the share twice, once honestly and
 *  once as "the big one is also bolder". */
export const PRODUCER_RING_WIDTH = 0.22;

/** The ring's resting brightness, before any charge. */
export const PRODUCER_RING_DIM = 0.3;

/** What a full charge adds on top of `PRODUCER_RING_DIM`. */
export const PRODUCER_RING_CHARGE = 0.85;

/** Time constant of the charge, in seconds.
 *
 *  ⭐ AN EXPONENTIAL APPROACH, NEVER A FILL, and that is a lesson this repo has
 *  already paid for once: a bar that reaches full and sits there is a plate,
 *  and a plate claims a completeness nothing here can know. Nobody knows when
 *  the next block lands, so a charge that COMPLETED would be asserting an
 *  interval the chain never promised. `1 - exp(-t/tau)` rises fastest right
 *  after a block, keeps rising for as long as the wait runs long, and never
 *  arrives. At mainnet's cadence it is around four fifths of the way up when
 *  the next block takes it. */
export const PRODUCER_RING_CHARGE_TAU = 6;

/** How long one discharge takes to leave the ring, in seconds. */
export const PRODUCER_RING_FIRE_S = 0.9;

/** Peak brightness of the discharge band. */
export const PRODUCER_RING_FIRE_AMP = 2.2;

/** Which way a CANDIDATE mark is drawn: 0 the arc, 1 the whole ring dimmed.
 *
 *  ⭐ THE ARC IS WHAT SHIPS, and the choice is an argument rather than a taste.
 *  Edges in this colony mean "talks to"; a candidate tie means "may be the same
 *  machine", so if it looks like an edge it lies. Each of the N candidates
 *  carries 1/N of the producer's ring instead — six peers showing sixty degrees
 *  each, which laid over one another compose exactly one producer. The
 *  uncertainty IS the drawing, and nothing about a stub of a circle can be
 *  misread as a link.
 *
 *  The documented alternative is the whole ring at 1/N alpha, and it is a knob
 *  rather than a rewrite because it is a live-tune call this task could not
 *  make from pixels. What argues against it from here: alpha is the FIRST
 *  axis's channel, where dimmer means "we know less about this node" — a claim
 *  about identification, which is not the claim a candidate tie makes — and a
 *  ring at an eighth of its light is at the mercy of every additive edge that
 *  crosses it, while an arc at full brightness is not. Both compose correctly
 *  under additive blending; only the arc also composes GEOMETRICALLY, so it is
 *  strictly more information for the same pixels. */
export const PRODUCER_ARC_FALLBACK = 0;

/** The stamp meaning "this instance has never fired", in the same absolute
 *  simClock seconds `aFireAt` carries. Any real stamp is a positive elapsed
 *  time, so a single comparison separates them and no second attribute is
 *  needed to say "armed". Same sentinel and same reasoning as ColonyEdges'
 *  `aSurgeT0/T1`. */
export const PRODUCER_RING_UNFIRED = -1e9;

/**
 * One additive draw for every producer ring AND every candidate arc.
 *
 * The billboard is rebuilt from the view matrix's camera axes exactly as
 * `makeMeasuredPeerHalosMaterial` does it, so a ring faces the camera with zero
 * per-frame CPU. `instanceMatrix` carries PLACEMENT ONLY — the quad's size is
 * computed in the vertex shader from `aShare` and the radius uniforms, so a
 * live retune of the radius moves every ring on the next frame without
 * rewriting one byte of instance data.
 *
 * FOUR custom attributes, all scalar floats, and the split is deliberate rather
 * than incidental: `aShare` / `aArcStart` / `aArcSweep` are rewritten when the
 * producer set changes, `aFireAt` on every block. Packed into two vec2s they
 * would share buffers, and the per-block write would re-upload the static half
 * with it. The budget has the room — 4 custom + 3 injected + 4 for
 * `instanceMatrix` is 11 of 16 — and this is what the room is for.
 */
export function makeProducerRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.scaffold),
      },
      uContextEnergy: { value: 1 },
      // Zero-drift defaults (seeded once; the owner refreshes them per frame
      // from LIVE.peer.* so a panel drag reshapes rings already on screen).
      uRingMinRadius: { value: PRODUCER_RING_MIN_RADIUS },
      uRingShareRadius: { value: PRODUCER_RING_SHARE_RADIUS },
      uRingMargin: { value: PRODUCER_RING_MARGIN },
      uRingWidth: { value: PRODUCER_RING_WIDTH },
      uRingDim: { value: PRODUCER_RING_DIM },
      uRingCharge: { value: PRODUCER_RING_CHARGE },
      uChargeTau: { value: PRODUCER_RING_CHARGE_TAU },
      uFireS: { value: PRODUCER_RING_FIRE_S },
      uFireAmp: { value: PRODUCER_RING_FIRE_AMP },
      // When the block everybody is currently grinding on landed, in absolute
      // simClock seconds. Starts UNFIRED: at mount nothing has been seen
      // arriving, so nothing has been charging, and the rings rest until the
      // first block this session actually observes.
      uChargeSince: { value: PRODUCER_RING_UNFIRED },
      uArcFallback: { value: PRODUCER_ARC_FALLBACK },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute float aShare;
      attribute float aFireAt;
      attribute float aArcStart;
      attribute float aArcSweep;

      uniform float uRingMinRadius;
      uniform float uRingShareRadius;
      uniform float uRingMargin;

      varying vec2 vUv;
      varying float vExtent;
      varying float vFireAt;
      varying float vArcStart;
      varying float vArcSweep;

      void main() {
        vUv = uv;
        vFireAt = aFireAt;
        vArcStart = aArcStart;
        vArcSweep = aArcSweep;
        // Radius is the share of the window, in world units. The quad carries
        // the ring plus the discharge's runway.
        float radius = uRingMinRadius
          + clamp(aShare, 0.0, 1.0) * uRingShareRadius;
        vExtent = radius * uRingMargin;
        vec4 origin = modelMatrix
          * instanceMatrix
          * vec4(0.0, 0.0, 0.0, 1.0);
        // The camera frame off the view matrix's row axes — the same
        // silhouette a follow-Billboard produces, for no per-frame CPU.
        vec3 cameraRight = vec3(
          viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]
        );
        vec3 cameraUp = vec3(
          viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]
        );
        vec3 world = origin.xyz
          + (cameraRight * position.x + cameraUp * position.y) * vExtent;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform vec3 uColor;
      uniform float uContextEnergy;
      uniform float uRingMargin;
      uniform float uRingWidth;
      uniform float uRingDim;
      uniform float uRingCharge;
      uniform float uChargeTau;
      uniform float uChargeSince;
      uniform float uFireS;
      uniform float uFireAmp;
      uniform float uArcFallback;

      varying vec2 vUv;
      varying float vExtent;
      varying float vFireAt;
      varying float vArcStart;
      varying float vArcSweep;

      const float TAU = 6.2831853;
      const float ARMED = -1.0e8;

      float band(float r, float center, float sigma) {
        float d = (r - center) / max(sigma, 0.0005);
        return exp(-d * d);
      }

      void main() {
        vec2 d = vUv - 0.5;
        float r = length(d) * 2.0;
        if (r > 1.0) discard;

        // Where the resting ring sits inside the quad, and how thick it is —
        // both in the quad's own units. The stroke is a world width, so it is
        // divided by this instance's extent rather than carried as a fraction.
        float ring = 1.0 / max(uRingMargin, 1.0001);
        float sigma = uRingWidth / max(vExtent, 0.001);

        // Which turn of the circle this fragment stands on, and how far around
        // it is from the arc's own start. The frame is the billboard's, so it
        // is shared by every instance: N arcs of 1/N turns, laid over each
        // other, compose exactly one ring at any camera angle.
        float turn = fract(atan(d.y, d.x) / TAU + 1.0);
        float fromStart = fract(turn - vArcStart + 1.0);
        // The documented fallback for a candidate mark, as a knob rather than
        // a branch: the whole ring at the arc's own share of the light. The
        // producer's own ring carries sweep 1.0 and is identical either way.
        float sweep = mix(vArcSweep, 1.0, uArcFallback);
        float dim = mix(1.0, vArcSweep, uArcFallback);
        // Taper the arc's ends over one stroke width of ARC LENGTH, so a short
        // arc is not all taper and a long one is not hard-cut.
        float taper = sigma / (TAU * ring);
        float arc = smoothstep(0.0, taper, fromStart)
          * (1.0 - smoothstep(sweep - taper, sweep, fromStart));
        // A full ring has no ends to taper; it would otherwise be cut at its
        // own seam.
        arc = mix(arc, 1.0, step(0.999, sweep));

        // Everyone charges from the same instant. Before the first block this
        // session has seen, nobody is charging at all.
        float waited = uTime - uChargeSince;
        float charge = uChargeSince < ARMED || waited < 0.0
          ? 0.0
          : 1.0 - exp(-waited / max(uChargeTau, 0.05));
        float rest = (uRingDim + uRingCharge * charge)
          * band(r, ring, sigma)
          * arc
          * dim;

        // …and exactly one discharges: the band leaves the ring, widening and
        // fading as it goes. Candidate arcs are never armed.
        float since = uTime - vFireAt;
        float firing = vFireAt > ARMED && since >= 0.0 && since <= uFireS
          ? 1.0
          : 0.0;
        float travel = firing * clamp(since / max(uFireS, 0.05), 0.0, 1.0);
        float fade = firing * (1.0 - travel) * (1.0 - travel);
        float fired = uFireAmp
          * fade
          * band(r, mix(ring, 1.0, travel), sigma * (1.0 + travel * 2.0))
          * arc
          * dim;

        // AdditiveBlending applies alpha to RGB a second time, so the passive
        // context weight belongs in colour only — the same split every peer
        // material in this scene uses, which is what keeps a Cell inspection's
        // damping linear instead of squaring the mesh into invisibility. The
        // discharge is an EVENT and bypasses it.
        float alpha = rest + fired;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(uColor * (rest * uContextEnergy + fired), alpha);
      }
    `,
  });
}
