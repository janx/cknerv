// Single source of truth for the backtick live-tuning panel. Each knob's
// `value` is the exact literal the code shipped with, so a closed/fresh panel
// renders identically to before the panel existed (see tweakSchema.test.ts).
// Consumers read the live value from `LIVE.<folder>.<key>` (liveTweaks.ts),
// NOT from these objects.

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
  colorBoost: { value: 7.5, min: 0, max: 15, step: 0.1, label: 'shock color boost' },
  alphaBoost: { value: 5.5, min: 0, max: 12, step: 0.1, label: 'shock alpha boost' },
  sizeBoost: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'shock size boost' },
  trailBoost: { value: 0.18, min: 0, max: 1, step: 0.01, label: 'shock trail boost' },
  colorCeil: { value: 2.8, min: 0, max: 8, step: 0.1, label: 'shock color ceil' },
  alphaCeil: { value: 2.2, min: 0, max: 8, step: 0.1, label: 'shock alpha ceil' },
} satisfies FolderSchema;

export const deliverySchema = {
  heroSize: { value: 0.82, min: 0.2, max: 2, step: 0.02, label: 'hero size' },
  peerSize: { value: 0.5, min: 0.1, max: 1.5, step: 0.02, label: 'peer size' },
  ingestDur: { value: 0.5, min: 0.1, max: 1.5, step: 0.05, label: 'ingest dur' },
  ingestPull: { value: 2.2, min: 0, max: 6, step: 0.1, label: 'ingest pull' },
  bolusBloom: { value: 2.1, min: 0.5, max: 5, step: 0.1, label: 'bolus bloom' },
  flashSize: { value: 4.4, min: 1, max: 10, step: 0.1, label: 'ingest flash' },
  trailWidth: { value: 0.85, min: 0.1, max: 3, step: 0.05, label: 'trail width' },
  trailLenBase: { value: 1.2, min: 0, max: 4, step: 0.1, label: 'trail len base' },
  trailLenGain: { value: 2.0, min: 0, max: 6, step: 0.1, label: 'trail len gain' },
  trailOpacity: { value: 0.85, min: 0, max: 1, step: 0.05, label: 'trail opacity' },
  ringMax: { value: 6.5, min: 1, max: 15, step: 0.5, label: 'ring max' },
  recoil: { value: 0.22, min: 0, max: 1, step: 0.01, label: 'recoil' },
  peerPunchScale: { value: 0.55, min: 0, max: 1.5, step: 0.05, label: 'peer punch' },
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
  flameWidth: { value: 0.7, min: 0.1, max: 2, step: 0.05, label: 'flame width' },
  flameMinLen: { value: 0.7, min: 0.1, max: 3, step: 0.05, label: 'flame min len' },
  flameMaxLen: { value: 2.5, min: 0.5, max: 6, step: 0.1, label: 'flame max len' },
  flameBloom: { value: 0.7, min: 0.1, max: 2, step: 0.05, label: 'flame bloom' },
  glintBloomOpacity: { value: 0.55, min: 0, max: 1, step: 0.05, label: 'glint bloom op' },
  glintPlumeOpacity: { value: 0.3, min: 0, max: 1, step: 0.05, label: 'glint plume op' },
} satisfies FolderSchema;

export const cellSchema = {
  fabricAlpha: { value: 0.12, min: 0, max: 1, step: 0.01, label: 'fabric alpha' },
  activeColorR: { value: 1.0, min: 0, max: 1, step: 0.01, label: 'active R' },
  activeColorG: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'active G' },
  activeColorB: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'active B' },
  fabricWidth: { value: 2.5, min: 0.5, max: 8, step: 0.1, label: 'fabric width px' },
  activeWidth: { value: 3.4, min: 0.5, max: 8, step: 0.1, label: 'active width px' },
} satisfies FolderSchema;

export const FOLDER_LABELS = {
  galaxy: 'Galaxy 共识记忆',
  delivery: 'Block delivery',
  peer: 'Peer mesh 对端',
  cell: 'Cell mesh 细胞',
} as const;
