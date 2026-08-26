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
// …and the five `hole*` knobs take theirs from the accretion material, on the
// same rule: the material seeds its own uniforms from these constants and
// ColonyAccretion overwrites them from LIVE.peer.* each frame, so there is ONE
// authority. (`COHORT_INFALL_FLOOR`, `COHORT_INFALL_EASE` and `COHORT_VEIL_AMP`
// are deliberately NOT knobs: one says a cohort holding almost nothing is still
// mining, one that a mote FALLS rather than coasts, and one that the mark has
// to be findable before it is legible. All three are statements this layer
// makes rather than tastes to settle against pixels.)
import {
  COHORT_INFALL_HZ,
  COHORT_MOTE_AMP,
  COHORT_RIM_AMP,
  COHORT_RIM_SPIN_HZ,
  COHORT_SWIRL_TURNS,
} from '../materials/colonyAccretion';
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
  // The mining channel — one black hole per cohort. `holeInfall` is how many
  // times a second a mote completes its fall for a cohort holding the WHOLE
  // window (the share scales it, and it is the only thing the share moves);
  // `holeSwirl` is how many turns that fall adds; `holeSpin` is how fast the
  // accretion rim itself turns, and it may go NEGATIVE because which way a disc
  // spins is arbitrary. `holeRim` and `holeMotes` are the two brightnesses:
  // reach for `holeRim` first, since the rim is what makes the shadow a shadow.
  holeRim: { value: COHORT_RIM_AMP, min: 0, max: 3, step: 0.05, label: 'hole rim amp' },
  holeMotes: { value: COHORT_MOTE_AMP, min: 0, max: 3, step: 0.05, label: 'hole mote amp' },
  holeInfall: { value: COHORT_INFALL_HZ, min: 0.02, max: 3, step: 0.01, label: 'hole infall hz' },
  holeSwirl: { value: COHORT_SWIRL_TURNS, min: 0, max: 4, step: 0.05, label: 'hole swirl turns' },
  holeSpin: { value: COHORT_RIM_SPIN_HZ, min: -0.5, max: 0.5, step: 0.005, label: 'hole rim spin hz' },
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
