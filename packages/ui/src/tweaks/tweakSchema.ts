// Single source of truth for the backtick live-tuning panel. Each knob's
// `value` is the exact literal the code shipped with, so a closed/fresh panel
// renders identically to before the panel existed (see tweakSchema.test.ts).
// Consumers read the live value from `LIVE.<folder>.<key>` (liveTweaks.ts),
// NOT from these objects.
//
// The six peer-network shockwave knobs take their defaults from the SHOCKWAVE_*
// constants in materials/shockwaveMaterial.ts — the material owns those values
// (it seeds the uniforms at build time; ColonyNodes overwrites them from
// LIVE.peer.* each frame), so there is ONE authority, not a shadowed copy.
// tweakSchema.test.ts still pins them to the shipped numbers, so a drift in
// either place fails the parity test.
import {
  SHOCKWAVE_COLOR_BOOST,
  SHOCKWAVE_ALPHA_BOOST,
  SHOCKWAVE_SIZE_BOOST,
  SHOCKWAVE_TRAIL_BOOST,
  SHOCKWAVE_COLOR_CEIL,
  SHOCKWAVE_ALPHA_CEIL,
} from '../materials/shockwaveMaterial';
// …and the seventeen `cohort*` knobs take theirs from the two aperture materials
// and the mist's one, on the same rule: each material seeds its own uniforms
// from these constants and `ColonyCohorts` overwrites them from LIVE.peer.*
// each frame, so there is ONE authority. Most of the aperture is deliberately
// NOT a knob. The two knees
// (`COHORT_CLIP_KNEE` and `COHORT_AURA_KNEE`) are a PYTHAGOREAN PAIR that bound
// the two additive draws' sum below 1.0 by arithmetic and cannot be moved
// singly; the grain's sign (`COHORT_FACE_STRIA_LIFT`, purely subtractive, which
// is what keeps the silhouette round), its prefilter (`COHORT_FACE_AA`) and the
// halo's pupil (`COHORT_AURA_PUPIL_SCALE`, which is what makes the aura's hole
// the SAME hole) are layer statements rather than tastes to settle against
// pixels. What is here is the mark's SIZE, its HOLE, its BRIGHTNESS and its
// GRAIN.
import {
  COHORT_AP_PUPIL_FRAC,
  COHORT_AP_R,
  COHORT_AURA_HALO_BIAS,
  COHORT_AURA_HALO_R,
  COHORT_FACE_INTAKE_AMP,
  COHORT_FACE_INTERIOR_AMP,
  COHORT_FACE_RIM_AMP,
  COHORT_FACE_STRIA_AMP,
  COHORT_FACE_STRIAE,
  COHORT_FACE_STRIAE_FLOOR,
  COHORT_INTAKE_LEVEL,
} from '../materials/colonyCohort';
// …and the mist under the mark brings NINE more knobs, on the same rule: the
// intake patch in `colonyMist` seeds its own uniforms from these constants and
// `ColonyCohorts` overwrites them from LIVE.peer.* each frame. Only seven
// constants are imported for the nine, because the other two — the window's
// amp and the level — belong to the aperture's own file above.
// ⚠️ IT WAS NINE, THEN EIGHT, AND IS NINE AGAIN — with a different ninth both
// times. `cohortHazeAmp` dimmed the ambient sheets under the whole colony plane
// until 2026-09-02, when a live leg measured them at 2/255 at their brightest
// pixel anywhere on the canvas while costing 0.90 ms of the layer's 1.06 ms at
// the app camera, and the sheets went; the mist has ONE amplitude now. The
// ninth today is `cohortShareFloor`, which weighs no light at all — it is how
// hard the SMALLEST cohort drinks against the largest.
// ⭐ `cohortLevel` is the one knob with TWO consumers — the window's medium
// level in the face and the top of the mist's mound under it are ONE surface
// (`COHORT_INTAKE_LEVEL`), and a tuner who could move one without the other
// would be able to make a viewer looking INTO the mouth and a viewer looking at
// the mist beside it disagree about where the substance is.
import {
  MIST_AMP,
  MIST_CONTRAST_NEAR,
  MIST_REACH,
  MIST_SHARE_FLOOR,
  MIST_SINK_K,
  MIST_SWIRL,
  MIST_WAKE,
} from '../materials/colonyMist';
// The Cell-field contact front is a scaled-down version of the peer-plane
// brightness wave: same shape, same timing, its reach divided by
// CONTACT_WAVE_SCALE — so both planes still read as sections of one event
// while the released ring stays a local ripple in the tissue. Both
// authorities are imported rather than re-typed, so the relationship survives
// a retune of either side.
import { SHOCKWAVE_SPEED, CONTACT_WAVE_SCALE } from '../ui/topologyConstants';
// ② reinforcement defaults live in fabricReinforce.ts — import so there's ONE
// authority (the module owns the numbers; these knobs just expose them live).
import {
  REINFORCE_AMOUNT,
  USAGE_GAIN,
  USAGE_DECAY_HALF_LIFE_S,
} from '../nerve/fabricReinforce';
// Oversized-diff cohort staggering defaults live in fabricCohorts.ts — same
// single-authority rule (the planner owns the numbers; knobs expose them).
import {
  FABRIC_STAGGER_THRESHOLD,
  FABRIC_COHORT_SIZE,
  FABRIC_COHORT_INTERVAL_S,
} from '../nerve/fabricCohorts';
// Nerve screen-composition defaults live in passiveNeighborGraph.ts — the
// selection algorithm owns the numbers; these knobs expose them live so the
// resting-fibre density is settled by eye, then pinned back as constants.
import {
  NERVE_SCREEN_BUDGET,
  NERVE_SCREEN_BUDGET_MIN,
  NERVE_SCREEN_BUDGET_MAX,
  PASSIVE_COVERAGE_SHARE,
  PASSIVE_TRUNK_SHARE,
  PASSIVE_TWIG_SHARE,
} from '../geometry/passiveNeighborGraph';

export interface KnobDef {
  value: number;
  min: number;
  max: number;
  step: number;
  label?: string;
}
export type FolderSchema = Record<string, KnobDef>;

export const galaxySchema = {
  // One knob turns BOTH planes: the cell canopy rides it directly and the
  // peer colony counter-rotates at the same magnitude. Halved 0.0025 →
  // 0.00125 (2026-08-24) so the counter-rotation shear stays calm; the step
  // halves with it to keep the default reachable by dragging.
  rotationRate: { value: 0.00125, min: 0, max: 0.02, step: 0.00025, label: 'rotation rate' },
} satisfies FolderSchema;

// Carrier glyph → contact front. The wave block is where this event lives now:
// every worker releases its own front, and they only compose into one field
// because they share `waveSpeed` — the peer plane's `SHOCKWAVE_SPEED` divided
// by CONTACT_WAVE_SCALE — and one shape. Retune reach/opacity freely; change
// speed WITHOUT moving reach by the same factor and fronts extinguish early
// or never complete, and the two planes stop reading as one event at two
// sizes.
export const deliverySchema = {
  heroSize: { value: 1.16, min: 0.2, max: 2, step: 0.02, label: 'hero size' },
  peerSize: { value: 0.46, min: 0.1, max: 1.5, step: 0.02, label: 'peer size' },
  ingestDur: { value: 1.2, min: 0.1, max: 1.5, step: 0.05, label: 'contact dur' },
  glyphBloom: { value: 1.6, min: 0.5, max: 5, step: 0.1, label: 'glyph core' },
  glyphCompress: { value: 0.45, min: 0, max: 0.9, step: 0.05, label: 'glyph compress' },
  // The sear at the landing is on the CARRIER's scale — it consumes the glyph
  // — so it is not divided by CONTACT_WAVE_SCALE. It was trimmed 2.2 → 1.4
  // when the ring halved (2026-08-15) so the flash no longer outweighs the
  // front it releases: it still opens wider than the travelling core it
  // replaces, by ×1.09 of its width instead of the old ×1.72.
  coreSize: { value: 1.4, min: 0.5, max: 8, step: 0.1, label: 'contact core' },
  trailWidth: { value: 0.55, min: 0.1, max: 3, step: 0.05, label: 'streak width' },
  trailLenBase: { value: 1.0, min: 0, max: 4, step: 0.1, label: 'streak len base' },
  trailLenGain: { value: 1.6, min: 0, max: 6, step: 0.1, label: 'streak len gain' },
  trailOpacity: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'streak opacity' },
  inhaleAmount: { value: 0.55, min: 0, max: 1.5, step: 0.05, label: 'drawn breath' },
  waveSpeed: {
    value: SHOCKWAVE_SPEED / CONTACT_WAVE_SCALE,
    min: 1, max: 40, step: 0.5, label: 'front speed',
  },
  // The pre-shrink 0.55 on the front's scale: the crest is part of the ring's
  // form, so it scales with it — holding it fixed would make the smaller ring
  // proportionally chunkier instead of simply smaller. Derived, not
  // hand-rounded, so a CONTACT_WAVE_SCALE retune rescales the width with
  // everything else.
  waveWidth: { value: 0.55 / CONTACT_WAVE_SCALE, min: 0.02, max: 1.5, step: 0.01, label: 'front width' },
  waveOpacity: { value: 2.0, min: 0, max: 3, step: 0.05, label: 'front opacity' },
  waveFalloff: { value: 0.5, min: 0, max: 2.5, step: 0.05, label: 'front 1/r falloff' },
  // Reach past what the window can complete — start + speed×ingestDur, 5.7 at
  // these defaults — clamps at render time (peers.derive
  // contactFrontReachCeiling), so a front's knee extinction always finishes
  // inside the ingest window instead of being cut off by the time envelope.
  waveReachHero: { value: 52 / CONTACT_WAVE_SCALE, min: 0.5, max: 30, step: 0.5, label: 'front reach hero' },
  waveReachPeer: { value: 34 / CONTACT_WAVE_SCALE, min: 0.5, max: 30, step: 0.5, label: 'front reach peer' },
  waveWake: { value: 0.14, min: 0, max: 1, step: 0.02, label: 'front wake' },
  waveSegments: { value: 0.55, min: 0, max: 1, step: 0.05, label: 'front gaps' },
  peerPunchScale: { value: 0.7, min: 0, max: 1.5, step: 0.05, label: 'peer punch' },
  igniteKHero: { value: 8, min: 0, max: 30, step: 1, label: 'ignite k hero' },
  igniteKPeer: { value: 3, min: 0, max: 15, step: 1, label: 'ignite k peer' },
  igniteMax: { value: 300, min: 0, max: 1000, step: 10, label: 'ignite max' },
  igniteRipple: { value: 0.015, min: 0, max: 0.1, step: 0.005, label: 'ignite ripple s' },
} satisfies FolderSchema;

export const peerSchema = {
  ambientAmp: { value: 0.22, min: 0, max: 1, step: 0.01, label: 'ambient amp' },
  ambientSpeed: { value: 0.05, min: 0, max: 0.5, step: 0.005, label: 'ambient speed' },
  ambientSigma: { value: 0.17, min: 0.02, max: 0.5, step: 0.01, label: 'ambient sigma' },
  surgeAmp: { value: 1.1, min: 0, max: 4, step: 0.05, label: 'surge amp' },
  surgeSigma: { value: 0.13, min: 0.02, max: 0.5, step: 0.01, label: 'surge sigma' },
  surgeEase: { value: 0.12, min: 0, max: 0.5, step: 0.01, label: 'surge ease s' },
  colorBoost: { value: SHOCKWAVE_COLOR_BOOST, min: 0, max: 15, step: 0.1, label: 'shock color boost' },
  alphaBoost: { value: SHOCKWAVE_ALPHA_BOOST, min: 0, max: 12, step: 0.1, label: 'shock alpha boost' },
  sizeBoost: { value: SHOCKWAVE_SIZE_BOOST, min: 0, max: 2, step: 0.05, label: 'shock size boost' },
  trailBoost: { value: SHOCKWAVE_TRAIL_BOOST, min: 0, max: 1, step: 0.01, label: 'shock trail boost' },
  colorCeil: { value: SHOCKWAVE_COLOR_CEIL, min: 0, max: 8, step: 0.1, label: 'shock color ceil' },
  alphaCeil: { value: SHOCKWAVE_ALPHA_CEIL, min: 0, max: 8, step: 0.1, label: 'shock alpha ceil' },
  flameWidth: { value: 0.7, min: 0.1, max: 2, step: 0.05, label: 'flame width' },
  flameMinLen: { value: 0.7, min: 0.1, max: 3, step: 0.05, label: 'flame min len' },
  flameMaxLen: { value: 2.5, min: 0.5, max: 6, step: 0.1, label: 'flame max len' },
  flameBloom: { value: 0.7, min: 0.1, max: 2, step: 0.05, label: 'flame bloom' },
  glintBloomOpacity: { value: 0.55, min: 0, max: 1, step: 0.05, label: 'glint bloom op' },
  glintPlumeOpacity: { value: 0.3, min: 0, max: 1, step: 0.05, label: 'glint plume op' },
  // The POW channel — one aperture per cohort, drawn as two faces of one hole,
  // over the mist that hole is drinking. Eight knobs for the mark, nine for the
  // substance under it.
  //
  // ⭐ REACH FOR `cohortApR` FIRST. It is THE size parameter: every other length
  // on this mark is a fraction of it, so it is the one knob that moves the
  // whole form rather than a part of it. Measured band 2.4–3.8 and settled at
  // 3.0 — below 2.4 the structure stops resolving at the app camera, above 4
  // the mark starts to dominate the colony.
  //
  // ⚠️⚠️ `cohortApR` AND `cohortHaloR` BOTH MOVE A QUAD, AND THE LAYER
  // RE-DERIVES BOTH EXTENTS THROUGH `cohortFaceHalfExtent` AND
  // `cohortAuraHalfExtent` EVERY FRAME. A knob that grew a mark while its quad
  // stayed put would crop it against its own proxy on the first drag — the
  // radius tests inside the fragments stay exact, but the pixels carrying the
  // rim are never rasterised to run them, which reads as a straight edge across
  // a circle that has none. That bug has already shipped on this layer once.
  //
  // `cohortPupil` is the hole, as a fraction of the rim, and BOTH faces read
  // it — which is what makes the halo's hole the same hole rather than a second
  // one tuned to agree. `cohortRimAmp` and `cohortIntakeAmp` are the face's two
  // brightnesses, the burning ring and the skirt drawn inward around it.
  // `cohortHaloBias` weights the halo DOWNWARD in world Y: the only cue for
  // "the energy is under the plane" that costs no silhouette, and it vanishes
  // on its own from overhead, where "below" is not a direction a viewer sees.
  //
  // ⭐ NO KNOB HERE CAN CLIP THE MARK, and that is structural rather than a
  // range chosen carefully. Both fragments apply their soft knee LAST, and
  // `knee * (1 - exp(-s / knee))` is strictly below `knee` for every finite
  // input — so every amplitude below multiplies into a quantity the knee then
  // bounds anyway. The centre this replaced had no such property: its knob's
  // MAXIMUM was the guard, which is a guard a later hand can move.
  cohortApR: { value: COHORT_AP_R, min: 1.5, max: 6, step: 0.1, label: 'cohort radius' },
  cohortPupil: { value: COHORT_AP_PUPIL_FRAC, min: 0.1, max: 1.5, step: 0.02, label: 'cohort pupil' },
  cohortRimAmp: { value: COHORT_FACE_RIM_AMP, min: 0, max: 3, step: 0.05, label: 'cohort rim amp' },
  cohortIntakeAmp: { value: COHORT_FACE_INTAKE_AMP, min: 0, max: 3, step: 0.02, label: 'cohort intake amp' },
  // ⚠️⚠️ THE FLOOR HERE IS A MEASURED LAW AND NOT A TASTE. Over 48 variants and
  // four sweeps, radial structure on a small bright mark reads as a STAR at 44
  // striae or fewer — regardless of the modulation's sign, its contrast or its
  // reach. COUNT IS THE ONLY ESCAPE, and past roughly 64 the striae stop being
  // countable and become a texture. So the knob's MINIMUM is
  // `COHORT_FACE_STRIAE_FLOOR` itself: no drag of this slider can turn the
  // aperture back into a sunflower.
  cohortStriae: { value: COHORT_FACE_STRIAE, min: COHORT_FACE_STRIAE_FLOOR, max: 200, step: 1, label: 'cohort striae' },
  // ⚠️ AND THE CEILING IS THE SIGN. The modulation is `1 + amt * (bump - 1)`,
  // which lies in `[1 - amt, 1]` — purely SUBTRACTIVE, which is what keeps the
  // outer iso-brightness contour where the smooth halo put it. Past 1 the
  // depth goes negative and the fragment starts discarding its own grain
  // instead of carving it.
  cohortStriaAmp: { value: COHORT_FACE_STRIA_AMP, min: 0, max: 1, step: 0.02, label: 'cohort grain' },
  cohortHaloR: { value: COHORT_AURA_HALO_R, min: 1, max: 3, step: 0.05, label: 'cohort halo r' },
  cohortHaloBias: { value: COHORT_AURA_HALO_BIAS, min: 0, max: 1, step: 0.02, label: 'cohort halo bias' },
  // …and the OTHER SIDE of the hole: the mist the cohort drinks. The mark is
  // what a viewer sees THROUGH; these weigh and shape what is being taken.
  //
  // ⭐ `cohortInteriorAmp` is the medium seen through the window, and it sits
  // here rather than with the mist because the face draws it — the window and
  // the patch are one surface seen two ways, so the two amplitudes are read
  // side by side and turned against each other.
  //
  // ⭐⭐ `cohortLevel` MOVES BOTH READERS OF ONE CONSTANT. The window stops
  // showing wall and starts showing surface at `COHORT_INTAKE_LEVEL` below the
  // lip, and the mist's mound rises to exactly that height; the two are the
  // same surface, so the knob writes `uLevel` on the face AND on the patch in
  // the same frame. A second knob, or a knob that reached only one of them,
  // would let a viewer looking into the mouth and a viewer looking at the mist
  // beside it see the medium at two different depths.
  //
  // ⚠️ `cohortIntake` is the SINK STRENGTH `k` in wu²/s (`r0² = r² + k·τ`),
  // which is a different quantity from `cohortIntakeAmp` above — that one is
  // the brightness of the face's skirt. The labels say which is which.
  //
  // ⚠️ NO KNOB HERE CAN CLIP EITHER APERTURE, because none of them reaches the
  // mark's programs: the mist is its own draw, additive over the same pixels,
  // and its ceiling is `cohortMistAmp` measured live (see the ceiling paragraph
  // in `colonyMist.ts` — the two faces above sum to 0.808 in blue, so the
  // substance under them has 0.192 to spend).
  // …and what each one moves, one line apiece.
  // the intake patch's whole brightness, and the mist's ONLY amplitude: the
  // substance is drawn under a mouth and nowhere else
  cohortMistAmp: { value: MIST_AMP, min: 0, max: 3, step: 0.05, label: 'cohort patch amp' },
  // how hard that medium burns seen THROUGH the hole — the face's window
  cohortInteriorAmp: { value: COHORT_FACE_INTERIOR_AMP, min: 0, max: 3, step: 0.05, label: 'cohort window amp' },
  // filament gain near the mouth: how sharply the gathering medium streaks
  cohortGather: { value: MIST_CONTRAST_NEAR, min: 0, max: 3, step: 0.05, label: 'cohort gather' },
  // sink strength k, in wu²/s: how fast the medium falls in (`r0² = r² + k·τ`)
  cohortIntake: { value: MIST_SINK_K, min: 0, max: 40, step: 0.5, label: 'cohort sink k' },
  // vortex-to-sink ratio: how far a streamline winds before it arrives
  cohortSwirl: { value: MIST_SWIRL, min: 0, max: 3, step: 0.05, label: 'cohort swirl' },
  // the patch's half-extent AND its catchment radius, in world units
  cohortReach: { value: MIST_REACH, min: 4, max: 30, step: 0.5, label: 'cohort reach' },
  // how far under the lip the medium stands: the window's level AND the mound's top
  cohortLevel: { value: COHORT_INTAKE_LEVEL, min: 0.2, max: 2, step: 0.02, label: 'cohort level' },
  // how much medium the mouth has already taken downstream of itself
  cohortWake: { value: MIST_WAKE, min: 0, max: 1, step: 0.05, label: 'cohort wake' },
  // ⭐⭐ WHAT THE SMALLEST COHORT'S SINK IS WORTH, as a fraction of the
  // largest's: the patch scales its `uK` and its pile by
  // `mix(this, 1, share / shareMax)`, so this knob is the whole legibility
  // question — 0 makes a 2 % cohort draw a patch with no visible motion, 1
  // makes every cohort drink identically and throws the share away. It is the
  // ONE knob in this folder whose default is a starting value rather than a
  // measured one; the live leg settles it by looking at the smallest cohort.
  cohortShareFloor: { value: MIST_SHARE_FLOOR, min: 0, max: 1, step: 0.05, label: 'cohort share floor' },
} satisfies FolderSchema;

export const cellSchema = {
  fabricAlpha: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'fabric alpha' },
  // Restore the living rose body used by the earlier brain-like galaxy.
  // `warmth` adds only a restrained ember bias; real packet traffic remains the
  // brighter synaptic signal.
  warmth: { value: 0.12, min: 0, max: 1, step: 0.01, label: 'body rose-ember' },
  // Shared galaxy-centre brightness floor. Cell bodies use it directly; the
  // much denser passive fabric squares it, while trunks/activity/events reclaim
  // headroom. 1.0 disables compression; Cells past the core are unaffected.
  centerDim: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'center dim (core)' },
  // Neutral by default: packet identity supplies the amber/violet event hue.
  activeColorR: { value: 1.0, min: 0, max: 1, step: 0.01, label: 'packet gain R' },
  activeColorG: { value: 1.0, min: 0, max: 1, step: 0.01, label: 'packet gain G' },
  activeColorB: { value: 1.0, min: 0, max: 1, step: 0.01, label: 'packet gain B' },
  fabricWidth: { value: 2.5, min: 0.5, max: 8, step: 0.1, label: 'fabric width px' },
  // The TOP of the width ladder, and the only rung that is a hard ordering
  // guarantee rather than a look: a protocol write must never be narrower than
  // the resting tissue it crosses. 3.4 → 4.6 on 2026-08-20, moved because the
  // trunk rung under it did (`FABRIC_TRUNK_WIDTH_RATIO` 1.28 → 1.76, capped at
  // 4.5 CSS px) — the same one-tenth-of-a-pixel margin, re-cut at the new
  // scale. The route-hop lock rides ×1.3 of this and the memory route ×1–1.42,
  // so both scale with it automatically.
  activeWidth: { value: 4.6, min: 0.5, max: 8, step: 0.1, label: 'active width px' },
  // ② How strongly and how long observed packet traffic reinforces shared routes.
  reinforceAmount: { value: REINFORCE_AMOUNT, min: 0, max: 1, step: 0.02, label: 'reinforce amount' },
  reinforceGain: { value: USAGE_GAIN, min: 0, max: 5, step: 0.1, label: 'reinforce gain' },
  reinforceHalfLife: { value: USAGE_DECAY_HALF_LIFE_S, min: 0.2, max: 20, step: 0.2, label: 'reinforce half-life s' },
  // Oversized reconciliation diffs (composition/reorg replacements) admit in
  // delayed cohorts so the animating set and per-frame uploads stay bounded.
  fabricStaggerThreshold: { value: FABRIC_STAGGER_THRESHOLD, min: 200, max: 10000, step: 100, label: 'stagger threshold' },
  fabricCohortSize: { value: FABRIC_COHORT_SIZE, min: 100, max: 4000, step: 50, label: 'cohort size' },
  fabricCohortInterval: { value: FABRIC_COHORT_INTERVAL_S, min: 0.05, max: 1, step: 0.05, label: 'cohort interval s' },
} satisfies FolderSchema;

// Unlike every other folder, these four knobs change GRAPH SELECTION, not
// material uniforms: a change triggers one incremental display-graph rebuild
// (worker delta) rather than a per-frame uniform read. Defaults must stay
// equal to the module constants (zero-drift parity).
export const nerveSchema = {
  screenBudget: {
    value: NERVE_SCREEN_BUDGET,
    min: NERVE_SCREEN_BUDGET_MIN,
    max: NERVE_SCREEN_BUDGET_MAX,
    step: 250,
    label: 'screen budget',
  },
  coverageShare: { value: PASSIVE_COVERAGE_SHARE, min: 0, max: 1, step: 0.05, label: 'scatter share' },
  trunkShare: { value: PASSIVE_TRUNK_SHARE, min: 0, max: 1, step: 0.02, label: 'trunk share' },
  twigShare: { value: PASSIVE_TWIG_SHARE, min: 0, max: 1, step: 0.02, label: 'twig share' },
} satisfies FolderSchema;

export const FOLDER_LABELS = {
  galaxy: 'Galaxy',
  delivery: 'Consensus carrier',
  peer: 'Peer mesh',
  cell: 'Cell structure',
  nerve: 'Nerve fabric',
} as const;
