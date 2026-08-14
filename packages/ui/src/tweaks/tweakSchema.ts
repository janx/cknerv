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
// The Cell-field contact front is a quarter-scale version of the peer-plane
// brightness wave: same shape, same timing, a quarter of the reach — so both
// planes still read as sections of one event while the released ring stays a
// local ripple in the tissue. Both authorities are imported rather than
// re-typed, so the relationship survives a retune of either side.
import { SHOCKWAVE_SPEED } from '../ui/topologyConstants';
import { CONTACT_WAVE_SCALE } from '../materials/contactWaveMaterial';
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
  rotationRate: { value: 0.0025, min: 0, max: 0.02, step: 0.0005, label: 'rotation rate' },
} satisfies FolderSchema;

// Carrier glyph → contact front. The wave block is where this event lives now:
// every worker releases its own front, and they only compose into one field
// because they share `waveSpeed` (= the peer plane's `SHOCKWAVE_SPEED`) and one
// shape. Retune reach/opacity freely; change speed and the two planes stop
// reading as two sections of the same event.
export const deliverySchema = {
  heroSize: { value: 1.16, min: 0.2, max: 2, step: 0.02, label: 'hero size' },
  peerSize: { value: 0.46, min: 0.1, max: 1.5, step: 0.02, label: 'peer size' },
  ingestDur: { value: 1.2, min: 0.1, max: 1.5, step: 0.05, label: 'contact dur' },
  glyphBloom: { value: 1.6, min: 0.5, max: 5, step: 0.1, label: 'glyph core' },
  glyphCompress: { value: 0.45, min: 0, max: 0.9, step: 0.05, label: 'glyph compress' },
  coreSize: { value: 2.2, min: 0.5, max: 8, step: 0.1, label: 'contact core' },
  trailWidth: { value: 0.55, min: 0.1, max: 3, step: 0.05, label: 'streak width' },
  trailLenBase: { value: 1.0, min: 0, max: 4, step: 0.1, label: 'streak len base' },
  trailLenGain: { value: 1.6, min: 0, max: 6, step: 0.1, label: 'streak len gain' },
  trailOpacity: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'streak opacity' },
  inhaleAmount: { value: 0.55, min: 0, max: 1.5, step: 0.05, label: 'drawn breath' },
  waveSpeed: {
    value: SHOCKWAVE_SPEED / CONTACT_WAVE_SCALE,
    min: 1, max: 40, step: 0.5, label: 'front speed',
  },
  // A quarter of the pre-shrink 0.55: the crest is part of the ring's form, so
  // it scales with it — holding it fixed would make the smaller ring four times
  // chunkier in proportion instead of simply smaller.
  waveWidth: { value: 0.14, min: 0.02, max: 1.5, step: 0.01, label: 'front width' },
  waveOpacity: { value: 2.0, min: 0, max: 3, step: 0.05, label: 'front opacity' },
  waveFalloff: { value: 0.5, min: 0, max: 2.5, step: 0.05, label: 'front 1/r falloff' },
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
} satisfies FolderSchema;

export const cellSchema = {
  fabricAlpha: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'fabric alpha' },
  // Restore the living rose body used by the earlier brain-like galaxy.
  // `warmth` adds only a restrained ember bias; real packet traffic remains the
  // brighter synaptic signal.
  warmth: { value: 0.12, min: 0, max: 1, step: 0.01, label: 'body rose→ember' },
  // Shared galaxy-centre brightness floor. Cell bodies use it directly; the
  // much denser passive fabric squares it, while trunks/activity/events reclaim
  // headroom. 1.0 disables compression; Cells past the core are unaffected.
  centerDim: { value: 0.3, min: 0, max: 1, step: 0.02, label: 'center dim (core)' },
  // Neutral by default: packet identity supplies the amber/violet event hue.
  activeColorR: { value: 1.0, min: 0, max: 1, step: 0.01, label: 'packet gain R' },
  activeColorG: { value: 1.0, min: 0, max: 1, step: 0.01, label: 'packet gain G' },
  activeColorB: { value: 1.0, min: 0, max: 1, step: 0.01, label: 'packet gain B' },
  fabricWidth: { value: 2.5, min: 0.5, max: 8, step: 0.1, label: 'fabric width px' },
  activeWidth: { value: 3.4, min: 0.5, max: 8, step: 0.1, label: 'active width px' },
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
  galaxy: 'Galaxy 共识记忆',
  delivery: 'Consensus carrier 共识载体',
  peer: 'Peer mesh 对端',
  cell: 'Cell structure 数据结构',
  nerve: 'Nerve fabric 神经',
} as const;
