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
// …and the nineteen `cohort*` knobs take theirs from the lensed mark and the
// motes falling into it, on the same rule: each material seeds its own uniforms
// from these constants and `ColonyCohorts` overwrites them from LIVE.peer.*
// each frame, so there is ONE authority.
// ⚠️ FIFTEEN KNOBS WERE RETIRED ON 2026-09-03 AND ONLY TWO SURVIVED THE FORM
// CHANGE. `cohortApR`, `cohortPupil`, `cohortRimAmp`, `cohortIntakeAmp`,
// `cohortStriae`, `cohortStriaAmp`, `cohortHaloR`, `cohortHaloBias`,
// `cohortInteriorAmp` and `cohortLevel` belonged to the composed aperture — a
// radius, a hole, a lip, a grain and a window, each a PART of a picture that is
// now COMPUTED rather than assembled — and `cohortMistAmp`, `cohortGather`,
// `cohortReach`, `cohortWake` and `cohortShareFloor` belonged to the mist patch
// drawn beside it. `cohortIntake` (the sink's k) and `cohortSwirl` (the
// vortex-to-sink ratio) survive because they are facts about the SUBSTANCE, and
// the substance is the one thing the lensed disc kept.
// ⭐ WHAT IS HERE NOW IS THE MASS AND WHAT THE LIGHT DOES AROUND IT: the horizon
// (which every other radius is a multiple of), the disc's extent, its
// brightness near and far, the beaming, the colour temperature, the glow, the
// fold's near end, the specks, and the step count the ray march spends.
// ⭐⭐ AND SINCE 2026-09-04, THREE THAT ARE ABOUT THE COHORT AND NOT THE FORM:
// the anchor and the floor of the PER-COHORT mass (its share of the indexer's
// week, which is the one thing that makes two marks different pictures) and the
// switch on its handedness.
import {
  COHORT_DISC_OUT,
  COHORT_HORIZON,
  COHORT_LENS_BEAM,
  COHORT_LENS_DISC_AMP,
  COHORT_LENS_FAR_DISC_AMP,
  COHORT_LENS_FAR_DISC_POW,
  COHORT_LENS_FAR_STREAK,
  COHORT_LENS_FAR_SWIRL,
  COHORT_LENS_GLOW,
  COHORT_LENS_STEPS,
  COHORT_LENS_WARMTH,
  COHORT_MASS_ANCHOR_SHARE,
  COHORT_MASS_FLOOR,
  COHORT_UNFOLD_HI,
} from '../materials/colonyLens';
import { COHORT_MOTE_AMP, COHORT_MOTE_ORBIT } from '../materials/colonyMotes';
import { MIST_SINK_K, MIST_SWIRL } from '../materials/colonyMist';
// The Cell-field contact front is a scaled-down version of the peer-plane
// brightness wave: same shape, same timing, its reach divided by
// CONTACT_WAVE_SCALE — so both planes still read as sections of one event
// while the released ring stays a local ripple in the tissue. Both
// authorities are imported rather than re-typed, so the relationship survives
// a retune of either side.
import { SHOCKWAVE_SPEED, CONTACT_WAVE_SCALE } from '../ui/topologyConstants';
// The held breath's two numbers live on the tested envelope in peers.derive
// (the halo shaders inject the rest of it from the same module) — imported
// on the one-authority rule, so a retune there moves the knob's default too.
import { COMPRESS_DEPTH, COMPRESS_GAIN } from '../derives/peers.derive';
// The landing flash's two form knobs live on its material, which seeds its
// own uniforms from them and is overwritten from LIVE each frame — the same
// one-authority rule as the shockwave and accretion knobs.
import {
  LANDING_FLASH_DURATION_S,
  LANDING_FLASH_SIZE_SCALE,
} from '../materials/landingFlashMaterial';
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

// Block impact: the last hop → the contact front. The hop is a courier (the
// same mote + plume form as the peer mesh's glints, at a higher weight because
// this hop is the block's climax); the wave block is where the tissue answers.
// Every worker releases its own front, and they only compose into one field
// because they share `waveSpeed` — the peer plane's `SHOCKWAVE_SPEED` divided
// by CONTACT_WAVE_SCALE — and one shape. Retune reach/opacity freely; change
// speed WITHOUT moving reach by the same factor and fronts extinguish early
// or never complete, and the two planes stop reading as one event at two
// sizes.
export const deliverySchema = {
  ingestDur: { value: 1.2, min: 0.1, max: 1.5, step: 0.05, label: 'contact dur' },
  // The held breath: over the charge window before its hop leaves, a
  // delivering halo (every measured peer's, and the anchor's) draws in to
  // `1 − compressDepth` of its extent and burns `1 + compressGain` brighter —
  // concentration, not dimming, and short of light conservation so it never
  // pops white. Read into both halo materials every frame.
  compressDepth: { value: COMPRESS_DEPTH, min: 0, max: 0.9, step: 0.05, label: 'breath depth' },
  compressGain: { value: COMPRESS_GAIN, min: 0, max: 3, step: 0.05, label: 'breath gain' },
  // The hop's mote is the block itself, sized per tier in world units; the
  // plume is the courier plume (courierGlyph) with its own width and its
  // length range, stretched by the hop's analytic speed like every glint.
  moteHero: { value: 2.2, min: 0.2, max: 4, step: 0.05, label: 'hop mote hero' },
  motePeer: { value: 1.3, min: 0.1, max: 3, step: 0.05, label: 'hop mote peer' },
  plumeWidth: { value: 1.0, min: 0.1, max: 2, step: 0.05, label: 'hop plume width' },
  plumeMinLen: { value: 0.9, min: 0.1, max: 3, step: 0.05, label: 'hop plume min len' },
  plumeMaxLen: { value: 4.0, min: 0.5, max: 8, step: 0.1, label: 'hop plume max len' },
  // The glint's form (0.55 / 0.3) at a higher weight: this hop is the climax.
  hopBloomOpacity: { value: 1.0, min: 0, max: 1, step: 0.05, label: 'hop bloom op' },
  hopPlumeOpacity: { value: 0.75, min: 0, max: 1, step: 0.05, label: 'hop plume op' },
  waveSpeed: {
    value: SHOCKWAVE_SPEED / CONTACT_WAVE_SCALE,
    min: 1, max: 40, step: 0.5, label: 'front speed',
  },
  // 3.2 on the front's scale = 0.40 wu: the crest is part of the ring's form,
  // so it scales with it — holding it fixed would make the smaller ring
  // proportionally chunkier instead of simply smaller. Derived, not
  // hand-rounded, so a CONTACT_WAVE_SCALE retune rescales the width with
  // everything else. 0.55 → 3.2 (2026-08-28): at the overview camera (≈7 px
  // per world unit) the old crest was ≈0.5 px — a hairline — and this one is
  // ≥2.5 px, a soft crest the tissue's exhale can actually be read from.
  waveWidth: { value: 3.2 / CONTACT_WAVE_SCALE, min: 0.02, max: 1.5, step: 0.01, label: 'front width' },
  // A wider crest is more area: 2.0 → 0.9 with the width (same day).
  waveOpacity: { value: 0.9, min: 0, max: 3, step: 0.05, label: 'front opacity' },
  waveFalloff: { value: 0.5, min: 0, max: 2.5, step: 0.05, label: 'front 1/r falloff' },
  // Reach past what the window can complete — start + speed×ingestDur, 5.7 at
  // these defaults — clamps at render time (peers.derive
  // contactFrontReachCeiling), so a front's knee extinction always finishes
  // inside the ingest window instead of being cut off by the time envelope.
  waveReachHero: { value: 52 / CONTACT_WAVE_SCALE, min: 0.5, max: 30, step: 0.5, label: 'front reach hero' },
  waveReachPeer: { value: 34 / CONTACT_WAVE_SCALE, min: 0.5, max: 30, step: 0.5, label: 'front reach peer' },
  // The wake is the body of a soft front (0.14 → 0.45, 2026-08-28); the three
  // gaps stay as the agreement motif, softened (0.55 → 0.3).
  waveWake: { value: 0.45, min: 0, max: 1, step: 0.02, label: 'front wake' },
  waveSegments: { value: 0.3, min: 0, max: 1, step: 0.05, label: 'front gaps' },
  // A peer's exhale against the hero's: scales its plume length, its front's
  // intensity and its flush's amplitude (the mote is already sized per tier).
  peerPunchScale: { value: 0.7, min: 0, max: 1.5, step: 0.05, label: 'peer punch' },
  // The fibre flush — the same front, sampled along the nerve fibres it
  // crosses (nerve/fabricLifecycleShader `fabricFlushGl`). `flushAmp` scales
  // how far the flush reclaims the fabric's core-dim floor (1 = a full
  // reclaim at the crest, the way a death flash reclaims it); `flushMix` how
  // far a flushed fibre's hue leans toward the front's own (carrier → rose).
  flushAmp: { value: 1.0, min: 0, max: 3, step: 0.05, label: 'flush amp' },
  flushMix: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'flush mix' },
  // The landing flashes — plain blooms on the Cells a released front passes,
  // at the instant its crest passes them (landingFlashSchedule → the galaxy's
  // LandingFlashLayer). Three budgets: per hero front and per peer front
  // (nearest Cells first), then per pulse across every front. Then the
  // flash's own window and its sprite as a multiple of the Cell's
  // presentation size, both seeded from the material.
  landingHero: { value: 128, min: 0, max: 512, step: 8, label: 'landing budget hero' },
  landingPeer: { value: 24, min: 0, max: 128, step: 1, label: 'landing budget peer' },
  landingMax: { value: 300, min: 0, max: 1000, step: 10, label: 'landing budget pulse' },
  landingDur: { value: LANDING_FLASH_DURATION_S, min: 0.1, max: 2, step: 0.05, label: 'landing dur s' },
  landingSize: { value: LANDING_FLASH_SIZE_SCALE, min: 0.5, max: 6, step: 0.1, label: 'landing size' },
} satisfies FolderSchema;

export const peerSchema = {
  ambientAmp: { value: 0.22, min: 0, max: 1, step: 0.01, label: 'ambient amp' },
  ambientSpeed: { value: 0.05, min: 0, max: 0.5, step: 0.005, label: 'ambient speed' },
  // ⚠️ Both sigmas are WORLD UNITS now, not fractions of a link. They were
  // fractions, which made one number mean a 1 wu band on a k-NN link and a
  // 20 wu one on a chord; `ColonyEdges` divides by the link's own length. The
  // defaults are the old fractions read on the median inferred link (11.3 wu),
  // so the mesh reads as it did and only the tail moves.
  ambientSigma: { value: 2, min: 0.2, max: 12, step: 0.1, label: 'ambient sigma wu' },
  surgeAmp: { value: 1.1, min: 0, max: 4, step: 0.05, label: 'surge amp' },
  surgeSigma: { value: 1.5, min: 0.2, max: 12, step: 0.1, label: 'surge sigma wu' },
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
  // The POW channel — ONE LENSED MASS PER COHORT, plus the specks falling into
  // it. Nineteen knobs, and every one of them is a fact about the mass or about
  // the substance around it: there is no "rim amplitude" here and there must
  // never be one again, because the mark is COMPUTED (light traced backward
  // around a Schwarzschild mass) and a knob that moved a PART of the picture
  // would be the composed aperture creeping back in through the panel.
  //
  // ⭐ REACH FOR `cohortHorizon` FIRST. It is THE size parameter: the shadow is
  // 2.6 horizons, the disc's inner edge is 3, and the whole image scales with
  // it — which is what the geometry says, not a convention this file chose.
  //
  // ⭐⭐ AND `cohortSteps` IS THE ONE KNOB THAT OVERRIDES THE QUALITY TIER. The
  // cascade's `cohortLensSteps` is 96 / 64 / 40; this knob's default IS the
  // high tier's 96, and `ColonyCohorts` reads the tier while the knob sits at
  // that default and the knob the moment it is moved. So a tuner can price the
  // trace against the picture on one page without changing the tier under the
  // rest of the scene — and a panel nobody has touched still shows what the
  // tier decided. ⚠️ Measured 2026-09-03, the three tiers are within
  // SINGLE-DIGIT PERCENT of each other in cost at every camera, so this slider
  // moves the photon ring's precision and almost nothing else.
  //
  // ⚠️ NO KNOB HERE CAN CLIP THE MARK, and it is arithmetic rather than a range
  // chosen carefully: the disc's alpha is clamped to 0.85 in the fragment and
  // the shadow's is the closeness, so the amplitudes below scale a quantity
  // that is bounded after them.
  //
  // the Schwarzschild radius at the near end of the fold, in world units: the
  // shadow is 2.6 of these and the disc's inner edge 3
  cohortHorizon: { value: COHORT_HORIZON, min: 0.3, max: 2, step: 0.01, label: 'cohort horizon' },
  // the disc's outer edge near, in world units: how far the intake reaches
  cohortDiscOut: { value: COHORT_DISC_OUT, min: 6, max: 40, step: 0.5, label: 'cohort disc out' },
  // the near disc's own brightness, over the streak field the medium carries
  cohortDiscAmp: { value: COHORT_LENS_DISC_AMP, min: 0, max: 3, step: 0.05, label: 'cohort disc amp' },
  // how much brighter the approaching side of the disc is: relativistic beaming
  cohortBeam: { value: COHORT_LENS_BEAM, min: -1, max: 1, step: 0.05, label: 'cohort beaming' },
  // the far form's in-plane weight: the intake's arms, at the mouth
  cohortFarAmp: { value: COHORT_LENS_FAR_DISC_AMP, min: 0, max: 2, step: 0.05, label: 'cohort far amp' },
  // how fast the far form dies with radius: the exponent of `(h/(ρ+h))^p` —
  // up and the periphery goes, the nucleus stays
  cohortFarFall: { value: COHORT_LENS_FAR_DISC_POW, min: 0.5, max: 4, step: 0.05, label: 'cohort far fall' },
  // the far arms' contrast about their skirt — the medium's own streaks, wound
  // into the heart by the sink; 0 is a plain halo with no intake in it, and 1
  // is the ceiling (past it a lane would remove light)
  cohortFarStreak: { value: COHORT_LENS_FAR_STREAK, min: 0, max: 1, step: 0.05, label: 'cohort far streak' },
  // extra winding of the far arms, in turns per e-fold of radius on top of the
  // swirl, so a whirlpool is legible at six pixels a unit
  cohortFarSwirl: { value: COHORT_LENS_FAR_SWIRL, min: 0, max: 3, step: 0.05, label: 'cohort far swirl' },
  // the bloom this scene has no post-process for, painted by the program itself
  cohortGlow: { value: COHORT_LENS_GLOW, min: 0, max: 1.5, step: 0.05, label: 'cohort glow' },
  // the colour temperature: 0 is the mesh's cyan disc, 1 the film's orange one
  cohortWarmth: { value: COHORT_LENS_WARMTH, min: 0, max: 1, step: 0.02, label: 'cohort warmth' },
  // pixels per world unit at which the form is fully UNFOLDED: the near end of
  // the band the whole mark folds over (the far end, 20, is not a knob — it is
  // where a cohort becomes a peer-sized smudge and that is the layer's rule).
  // ⚠️ The max is 80 and not 60 because the default moved 30 → 50 on 2026-09-03,
  // when the user judged the mid range too big: a slider whose default sits at
  // five sixths of its travel cannot be tuned upward
  cohortUnfold: { value: COHORT_UNFOLD_HI, min: 10, max: 80, step: 1, label: 'cohort unfold' },
  // RK4 steps per ray: the photon ring's precision. ⚠️ Overrides the quality
  // tier the moment it moves, and the tiers cost within single-digit percent of
  // each other everywhere (measured 2026-09-03) — this is not a speed slider
  cohortSteps: { value: COHORT_LENS_STEPS, min: 24, max: 160, step: 1, label: 'cohort steps' },
  // sink strength k, in wu²/s: how fast the medium falls in (`r0² = r² + k·τ`)
  cohortIntake: { value: MIST_SINK_K, min: 0, max: 40, step: 0.5, label: 'cohort sink k' },
  // vortex-to-sink ratio: how far a streamline winds before it arrives
  cohortSwirl: { value: MIST_SWIRL, min: 0, max: 3, step: 0.05, label: 'cohort swirl' },
  // the specks' orbital swing near the mouth — the one term the disc's own
  // back-trace has none of, and the reason a tracked mote reads as an orbit
  // decaying rather than as a bead on a wire
  cohortOrbit: { value: COHORT_MOTE_ORBIT, min: 0, max: 3, step: 0.05, label: 'cohort orbit' },
  // how bright the specks are: the intake's SPEED, which a field alone cannot say
  cohortMotes: { value: COHORT_MOTE_AMP, min: 0, max: 3, step: 0.05, label: 'cohort motes' },
  // ⭐⭐⭐ THE LAST THREE ARE THE ONLY PER-COHORT ONES IN THE FOLDER. Every knob
  // above is a GLOBAL uniform — one horizon, one disc, one palette for the
  // whole colony — so before these, seven cohorts were seven copies of one
  // picture. What varies is SIZE, and what it reads is the cohort's share of
  // the indexer's SEVEN-DAY window: `clamp(cbrt(week / anchor), floor, 1)`,
  // multiplying every length in both cohort programs.
  //
  // the week share at which a cohort is FULL SIZE — today's top, and the
  // largest a single pool plausibly holds. At and above it the mass is 1, so
  // the accepted form is a CEILING and every other cohort folds down from it:
  // the colony gets quieter, never louder
  cohortMassAnchor: { value: COHORT_MASS_ANCHOR_SHARE, min: 0.05, max: 1, step: 0.01, label: 'cohort mass anchor' },
  // the smallest a cohort may be drawn, as a fraction of the full form: 0.45
  // puts the 2 % cohort's nucleus wider than a ghost peer and narrower than a
  // dark sighted one — a LESSER peer, never a vanished one.
  // ⭐⭐ AND 1 IS THE OFF SWITCH: every mass then clamps to 1 and the colony
  // draws exactly what it drew before the lane was written, which is what makes
  // the A/B for this whole channel a single knob
  cohortMassFloor: { value: COHORT_MASS_FLOOR, min: 0.2, max: 1, step: 0.01, label: 'cohort mass floor' },
  // whether each cohort winds its own way, from its key: 0 is one hand for the
  // whole colony, 1 is the seed's. Identity and not data — it is what separates
  // the middling cohorts the week makes the same size
  cohortHand: { value: 1, min: 0, max: 1, step: 1, label: 'cohort hand' },
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
  // ——— ⟨D-10⟩ Three art-direction knobs, each DEFAULTING TO TODAY ————————
  //
  // The 09-05 review's three unresolved readings about the wide camera — the
  // fabric reads as wool, the corona out-structures the core, the far half is
  // brighter than the near — are not defects with a right answer, they are
  // questions for the eye. So each is a knob whose default is the picture that
  // shipped: at these three values every pixel is byte-for-byte what it was,
  // and the A/B captures are what decide whether any of them moves.
  //
  // ⚠️ NONE OF THE THREE IS A REACH. The fabric keeps every edge it draws, the
  // halo keeps its placement and its extent, and the depth term is a scale on
  // emitted alpha bounded above by 1 — never an alpha-over fog, which would
  // lift the black this whole scene rests on.

  // (a) The mesh tier's share of its light at the OVERVIEW; the trunks keep
  // all of theirs at every camera. Full weight arrives inside
  // `CELL_DETAIL_VIEW_NEAR_DISTANCE`. Argued at `fabricTwigViewEnergy`.
  fabricTwigOverview: { value: 1, min: 0.3, max: 1, step: 0.02, label: 'twig light (overview)' },
  // (b) The halo's THREAD level at the overview — the stroke classes only, so
  // the corona's amount is stated in level and not in reach (D-8). The beads
  // are untouched: they are the same matter as a Cell body and separating them
  // is the seam this design removes. Argued at `haloThreadViewLevel`.
  haloThreadOverview: { value: 1, min: 0.3, max: 1, step: 0.02, label: 'halo thread level (overview)' },
  // (c) How much of the FAR half's light the depth term spends, in the two
  // body materials. 0 is no depth cue at all. Argued at
  // `BODY_DEPTH_ENERGY_GLSL`.
  bodyDepthEnergy: { value: 0, min: 0, max: 0.6, step: 0.02, label: 'depth energy (far)' },
  // ——— ⟨ruling 22⟩ How much light the canvas's FIRST focus spends ————————
  //
  // The camera gives the galaxy the stage back; this is the other half of
  // 光辉灿烂, and it is not a number a measurement can settle. A capture can
  // say the tissue's mean luminance moved; only the eye can say whether the
  // organism reads radiant. So it is a live knob and it is PARKED AT 1, which
  // is byte-for-byte the picture that shipped — turn it in the panel, against
  // the live scene, and whatever the eye lands on becomes the default in a
  // commit of its own.
  //
  // ⚠️ It is the TISSUE's gain and nothing else's: the Cell bodies' resting
  // cloud and the halo's beads and strands. Not events (a flare, a focus ring,
  // a landing and a recall reclaim headroom ABOVE the resting field on
  // purpose), and not the peer mesh or the colony — those are the canvas's
  // second focus and answer to their own ladder. Argued at
  // `galaxyRadianceGain`.
  galaxyRadiance: { value: 1, min: 0.6, max: 1.6, step: 0.02, label: 'galaxy radiance' },
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
  delivery: 'Block impact',
  peer: 'Peer mesh',
  cell: 'Cell structure',
  nerve: 'Nerve fabric',
} as const;
