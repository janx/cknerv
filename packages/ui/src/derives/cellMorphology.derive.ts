import type { AssetKind, Cell, LockKind, ShapeSeed } from '@cknerv/types';
import { capacityMass } from './cellVisual.derive';

export const CELL_MORPHOLOGY_TAU = Math.PI * 2;
export const CELL_MORPHOLOGY_DATA_SLOTS = 16;
export const CELL_MORPHOLOGY_SAMPLES = 72;
export const CELL_MORPHOLOGY_MAX_SEGMENTS = 420;
export const CELL_MORPHOLOGY_MAX_NODES = 12;

export type MorphologyPoint3 = readonly [number, number, number];
export type MorphologyVector3 = readonly [number, number, number];
export type DataMarkKind = 'crossbar' | 'single_knot' | 'double_knot';

export interface TypeMorphology {
  family: AssetKind;
  profile: number;
  seed: ShapeSeed;
  lobes: number;
  winding: readonly [number, number, number];
  aspect: readonly [number, number, number];
  secondaryAmplitude: number;
  phase: number;
  /** Small canonical-pose perturbation. It cannot replace family shape. */
  tilt: readonly [number, number, number];
}

export interface LockMorphology {
  family: LockKind;
  seed: ShapeSeed;
  strandCount: number;
  handedness: -1 | 1;
  /** Pure braid word: every generator is emitted twice, so endpoints close. */
  braidWord: readonly number[];
  radius: number;
  /** Integral turns around the carrier. */
  closure: number;
  crossingSpacing: number;
  radialEmphasis: number;
}

export interface DataMark {
  slot: number;
  lane: number;
  pairLane: number;
  kind: DataMarkKind;
  magnitude: number;
  score: number;
}

export interface DataMorphology {
  seed: ShapeSeed;
  bytes: number;
  density: number;
  ribbonWidth: number;
  packetCount: number;
  slotMask: number;
  slots: readonly DataMark[];
}

export interface CellMorphologyGenome {
  type: TypeMorphology;
  lock: LockMorphology;
  data: DataMorphology;
  presenceScale: number;
  fallback: boolean;
}

export interface CarrierFrame {
  tangent: MorphologyVector3;
  normal: MorphologyVector3;
  binormal: MorphologyVector3;
}

export interface MorphologyBraidStrand {
  index: number;
  points: readonly MorphologyPoint3[];
}

export interface MorphologyBraidCrossing {
  parameter: number;
  pair: number;
  ordinal: number;
  generator: number;
  pointA: MorphologyPoint3;
  pointB: MorphologyPoint3;
  midpoint: MorphologyPoint3;
}

export interface MorphologyBraidDataMark extends DataMark {
  parameter: number;
  strand: number;
  pair: number;
  point: MorphologyPoint3;
  peerPoint: MorphologyPoint3;
  midpoint: MorphologyPoint3;
}

export interface MorphologyAgreement {
  parameter: number;
  pair: number;
  ordinal: number;
  crossingIndex: number;
  dataSlot: number;
  kind: DataMarkKind;
  pointA: MorphologyPoint3;
  pointB: MorphologyPoint3;
  midpoint: MorphologyPoint3;
}

/** Renderer-independent V2 structure shared by production and calibration. */
export interface CellMorphologyTopology {
  genome: CellMorphologyGenome;
  carrier: readonly MorphologyPoint3[];
  frames: readonly CarrierFrame[];
  strands: readonly MorphologyBraidStrand[];
  crossings: readonly MorphologyBraidCrossing[];
  dataMarks: readonly MorphologyBraidDataMark[];
  agreements: readonly MorphologyAgreement[];
  presenceScale: number;
  birthPhase: number;
  segmentCount: number;
  nodeCount: number;
}

export interface CellMorphologySignature {
  type: string;
  lock: string;
  data: string;
  slotMaskHex: string;
  markKinds: string;
  segments: number;
  nodes: number;
  fallback: boolean;
}

const UINT32_SCALE = 0x1_0000_0000;
const EPSILON = 1e-9;

const clamp = (value: number, low: number, high: number): number => (
  Math.max(low, Math.min(high, value))
);

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb_352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846c_a68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function namespaceWord(namespace: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < namespace.length; index += 1) {
    hash ^= namespace.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

/** Fixed four-word sfc32 stream. Both seed words and the namespace influence
 * every stream; runtime state and Math.random never participate. */
function seedStream(seed: ShapeSeed, namespace: string): () => number {
  const domain = namespaceWord(namespace);
  let a = mix32((seed[0] >>> 0) ^ domain);
  let b = mix32((seed[1] >>> 0) ^ Math.imul(domain, 0x9e37_79b1));
  let c = mix32(a ^ 0xa5a5_a5a5);
  let d = mix32(b ^ 0x3c6e_f372);
  return () => {
    const result = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + result) >>> 0;
    return result / UINT32_SCALE;
  };
}

function normalizedSeed(seed: ShapeSeed): ShapeSeed {
  return [seed[0] >>> 0, seed[1] >>> 0];
}

export function isZeroShapeSeed(seed: ShapeSeed | null): boolean {
  return seed !== null && (seed[0] >>> 0) === 0 && (seed[1] >>> 0) === 0;
}

/** Deterministic chain-generic fallback. It is intentionally not a component
 * identity: canonical CKB cells arrive with adapter-derived seeds. */
export function morphologyFallbackSeed(
  contentHash: string,
  namespace: 'lock' | 'type' | 'data',
): ShapeSeed {
  let left = namespaceWord(`morphology-v2/${namespace}/left`);
  let right = namespaceWord(`morphology-v2/${namespace}/right`);
  for (let index = 0; index < contentHash.length; index += 1) {
    const code = contentHash.charCodeAt(index);
    left = Math.imul(left ^ code, 0x0100_0193) >>> 0;
    right = mix32(right ^ Math.imul(code + index, 0x9e37_79b1));
  }
  const seed: ShapeSeed = [mix32(left), mix32(right ^ left)];
  return isZeroShapeSeed(seed) ? [namespaceWord(namespace), 1] : seed;
}

function resolveRequiredSeed(
  seed: ShapeSeed,
  contentHash: string,
  namespace: 'lock' | 'data',
): { seed: ShapeSeed; fallback: boolean } {
  const normalized = normalizedSeed(seed);
  return isZeroShapeSeed(normalized)
    ? { seed: morphologyFallbackSeed(contentHash, namespace), fallback: true }
    : { seed: normalized, fallback: false };
}

function resolveTypeSeed(cell: Cell, family: AssetKind): {
  seed: ShapeSeed;
  fallback: boolean;
} {
  if (cell.type_shape_seed === null) {
    // No type script is a first-class native silhouette, not an error path.
    if (family === 'native') return { seed: [0, 0], fallback: false };
    return {
      seed: morphologyFallbackSeed(cell.content_hash, 'type'),
      fallback: true,
    };
  }
  const seed = normalizedSeed(cell.type_shape_seed);
  return isZeroShapeSeed(seed)
    ? { seed: morphologyFallbackSeed(cell.content_hash, 'type'), fallback: true }
    : { seed, fallback: false };
}

interface TypeProfile {
  profile: number;
  lobes: readonly [number, number];
  winding: readonly (readonly [number, number, number])[];
  aspect: readonly [number, number, number];
  secondary: readonly [number, number];
}

const TYPE_PROFILES: Record<AssetKind, TypeProfile> = {
  native: {
    profile: 0,
    lobes: [1, 1],
    winding: [[1, 2, 1]],
    aspect: [1.16, 0.7, 0.78],
    secondary: [0.025, 0.055],
  },
  sudt: {
    profile: 1,
    lobes: [3, 5],
    winding: [[3, 2, 1], [4, 3, 1]],
    aspect: [1, 0.92, 0.62],
    secondary: [0.12, 0.18],
  },
  xudt: {
    profile: 2,
    lobes: [2, 3],
    winding: [[2, 3, 1], [2, 5, 3]],
    aspect: [1.08, 0.8, 0.96],
    secondary: [0.2, 0.28],
  },
  dao: {
    profile: 3,
    lobes: [2, 2],
    winding: [[1, 4, 2], [1, 5, 2]],
    aspect: [0.58, 1.32, 0.58],
    secondary: [0.08, 0.13],
  },
  spore: {
    profile: 4,
    lobes: [5, 7],
    winding: [[5, 2, 3], [7, 3, 2]],
    aspect: [1.02, 0.88, 0.9],
    secondary: [0.18, 0.26],
  },
  other: {
    profile: 5,
    lobes: [3, 6],
    winding: [[3, 4, 2], [4, 5, 3], [5, 3, 2]],
    aspect: [0.92, 1.02, 0.82],
    secondary: [0.14, 0.24],
  },
};

function deriveTypeMorphology(family: AssetKind, seed: ShapeSeed): TypeMorphology {
  const profile = TYPE_PROFILES[family];
  const random = seedStream(seed, `type/${family}`);
  const lobeSpan = profile.lobes[1] - profile.lobes[0] + 1;
  const lobes = profile.lobes[0] + Math.floor(random() * lobeSpan);
  const winding = profile.winding[Math.floor(random() * profile.winding.length)];
  const jitter = () => 0.94 + random() * 0.12;
  return {
    family,
    profile: profile.profile + (family === 'other' ? Math.floor(random() * 3) : 0),
    seed,
    lobes,
    winding,
    aspect: [
      profile.aspect[0] * jitter(),
      profile.aspect[1] * jitter(),
      profile.aspect[2] * jitter(),
    ],
    secondaryAmplitude:
      profile.secondary[0] + random() * (profile.secondary[1] - profile.secondary[0]),
    phase: (random() - 0.5) * 0.34,
    tilt: [
      (random() - 0.5) * 0.2,
      (random() - 0.5) * 0.2,
      (random() - 0.5) * 0.14,
    ],
  };
}

interface LockProfile {
  strandCount: number;
  generators: readonly number[];
  radius: number;
  closure: number;
  radialEmphasis: number;
}

const LOCK_PROFILES: Record<LockKind, LockProfile> = {
  sighash: {
    strandCount: 3,
    generators: [1, -2, 1],
    radius: 0.1,
    closure: 1,
    radialEmphasis: 0.08,
  },
  multisig: {
    strandCount: 4,
    generators: [1, 2, 3, 2],
    radius: 0.13,
    closure: 2,
    radialEmphasis: 0.13,
  },
  acp: {
    strandCount: 4,
    generators: [2, -1, 2, -3],
    radius: 0.16,
    closure: 1,
    radialEmphasis: 0.2,
  },
  omnilock: {
    strandCount: 5,
    generators: [1, -2, 3, -4, 2],
    radius: 0.115,
    closure: 3,
    radialEmphasis: 0.11,
  },
  other: {
    strandCount: 5,
    generators: [4, 2, -1, 3, -2],
    radius: 0.15,
    closure: 2,
    radialEmphasis: 0.18,
  },
};

function deriveLockMorphology(family: LockKind, seed: ShapeSeed): LockMorphology {
  const profile = LOCK_PROFILES[family];
  const random = seedStream(seed, `lock/${family}`);
  const handedness: -1 | 1 = random() < 0.5 ? -1 : 1;
  const extraGenerator = 1 + Math.floor(random() * (profile.strandCount - 1));
  const extraSign = random() < 0.5 ? -1 : 1;
  const chunks = [...profile.generators, extraGenerator * extraSign];
  const braidWord = chunks.flatMap((generator) => {
    const signed = generator * handedness;
    return [signed, signed];
  });
  return {
    family,
    seed,
    strandCount: profile.strandCount,
    handedness,
    braidWord,
    radius: profile.radius * (0.92 + random() * 0.16),
    closure: profile.closure + (random() > 0.82 ? 1 : 0),
    crossingSpacing: 0.72 + random() * 0.2,
    radialEmphasis: profile.radialEmphasis * (0.9 + random() * 0.2),
  };
}

function dataMarkCount(bytes: number): number {
  if (bytes <= 0) return 0;
  return clamp(Math.ceil(Math.log2(bytes + 1) / 2), 1, CELL_MORPHOLOGY_MAX_NODES);
}

function deriveDataMorphology(seed: ShapeSeed, rawBytes: number): DataMorphology {
  const bytes = Number.isFinite(rawBytes)
    ? clamp(Math.trunc(rawBytes), 0, 0xffff_ffff)
    : 0;
  const count = dataMarkCount(bytes);
  const candidates = Array.from({ length: CELL_MORPHOLOGY_DATA_SLOTS }, (_, slot) => {
    const random = seedStream(seed, `data/slot/${slot}`);
    const score = random();
    const kindRoll = random();
    const kind: DataMarkKind = kindRoll < 0.34
      ? 'crossbar'
      : kindRoll < 0.72 ? 'single_knot' : 'double_knot';
    return {
      slot,
      lane: Math.floor(random() * 5),
      pairLane: Math.floor(random() * 4),
      kind,
      magnitude: 0.055 + random() * 0.095,
      score,
    } satisfies DataMark;
  });
  const slots = candidates
    .sort((left, right) => right.score - left.score || left.slot - right.slot)
    .slice(0, count)
    .sort((left, right) => left.slot - right.slot);
  const slotMask = slots.reduce((mask, mark) => mask | (1 << mark.slot), 0) >>> 0;
  const density = clamp(Math.log2(bytes + 1) / 24, 0, 1);
  return {
    seed,
    bytes,
    density,
    ribbonWidth: 0.012 + density * 0.018,
    packetCount: bytes === 0 ? 0 : clamp(1 + Math.floor(Math.log2(bytes + 1) / 4), 1, 8),
    slotMask,
    slots,
  };
}

export function deriveCellMorphologyGenome(cell: Cell): CellMorphologyGenome {
  const family = cell.asset_kind ?? 'other';
  const lockFamily = cell.lock_kind ?? 'other';
  const type = resolveTypeSeed(cell, family);
  const lock = resolveRequiredSeed(cell.lock_shape_seed, cell.content_hash, 'lock');
  const data = resolveRequiredSeed(cell.data_shape_seed, cell.content_hash, 'data');
  return {
    type: deriveTypeMorphology(family, type.seed),
    lock: deriveLockMorphology(lockFamily, lock.seed),
    data: deriveDataMorphology(data.seed, cell.data_bytes),
    presenceScale: 1.02 + (capacityMass(cell.capacity) - 0.84) * 0.32,
    fallback: type.fallback || lock.fallback || data.fallback,
  };
}

type MutableVector3 = [number, number, number];

function add(left: MorphologyVector3, right: MorphologyVector3): MutableVector3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: MorphologyVector3, right: MorphologyVector3): MutableVector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale(vector: MorphologyVector3, amount: number): MutableVector3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function dot(left: MorphologyVector3, right: MorphologyVector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: MorphologyVector3, right: MorphologyVector3): MutableVector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function length(vector: MorphologyVector3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: MorphologyVector3, fallback: MorphologyVector3): MutableVector3 {
  const magnitude = length(vector);
  return magnitude <= EPSILON || !Number.isFinite(magnitude)
    ? [fallback[0], fallback[1], fallback[2]]
    : scale(vector, 1 / magnitude);
}

function midpoint(left: MorphologyPoint3, right: MorphologyPoint3): MorphologyPoint3 {
  return [
    (left[0] + right[0]) * 0.5,
    (left[1] + right[1]) * 0.5,
    (left[2] + right[2]) * 0.5,
  ];
}

function rotateAroundAxis(
  vector: MorphologyVector3,
  axis: MorphologyVector3,
  angle: number,
): MutableVector3 {
  const unit = normalize(axis, [0, 1, 0]);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add(
    add(scale(vector, cosine), scale(cross(unit, vector), sine)),
    scale(unit, dot(unit, vector) * (1 - cosine)),
  );
}

function rotateEuler(point: MorphologyPoint3, tilt: MorphologyVector3): MorphologyPoint3 {
  let [x, y, z] = point;
  const [sx, sy, sz] = tilt.map(Math.sin) as [number, number, number];
  const [cx, cy, cz] = tilt.map(Math.cos) as [number, number, number];
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return [x, y, z];
}

function carrierPoint(type: TypeMorphology, parameter: number): MorphologyPoint3 {
  const t = parameter * CELL_MORPHOLOGY_TAU + type.phase;
  const secondary = type.secondaryAmplitude;
  let point: MorphologyPoint3;
  switch (type.family) {
    case 'native':
      point = [
        Math.cos(t) * (0.78 + secondary * Math.cos(2 * t)),
        Math.sin(2 * t) * 0.24,
        Math.sin(t) * 0.58,
      ];
      break;
    case 'sudt': {
      const radius = 0.58 + secondary * Math.cos(type.lobes * t);
      point = [radius * Math.cos(t), radius * Math.sin(t), Math.sin(2 * t) * 0.22];
      break;
    }
    case 'xudt':
      point = [
        Math.sin(type.winding[0] * t) * 0.66,
        Math.sin(type.winding[1] * t + 0.42) * 0.48,
        Math.cos(type.winding[2] * t) * (0.42 + secondary * Math.cos(2 * t)),
      ];
      break;
    case 'dao': {
      const spindle = 0.28 + 0.18 * Math.sin(t) ** 2;
      point = [
        Math.sin(type.winding[1] * t) * spindle,
        Math.cos(t) * 0.72,
        Math.sin(t) * (0.28 + secondary * Math.cos(2 * t)),
      ];
      break;
    }
    case 'spore': {
      const petals = 0.52 + secondary * Math.cos(type.lobes * t);
      point = [
        petals * Math.cos(t) + 0.12 * Math.cos(2 * t),
        petals * Math.sin(t) * 0.76 + 0.08 * Math.sin(3 * t),
        Math.sin(type.winding[2] * t + 0.35) * 0.4,
      ];
      break;
    }
    default: {
      const profile = type.profile % 3;
      if (profile === 0) {
        point = [
          Math.sin(3 * t) * 0.56,
          Math.sin(4 * t + 0.3) * 0.52,
          Math.cos(2 * t) * 0.38,
        ];
      } else if (profile === 1) {
        const radius = 0.5 + secondary * Math.cos(type.lobes * t);
        point = [radius * Math.cos(2 * t), Math.sin(t) * 0.62, radius * Math.sin(2 * t)];
      } else {
        point = [
          Math.cos(t) * (0.5 + secondary * Math.cos(3 * t)),
          Math.sin(3 * t) * 0.5,
          Math.sin(2 * t) * 0.48,
        ];
      }
    }
  }
  return rotateEuler([
    point[0] * type.aspect[0],
    point[1] * type.aspect[1],
    point[2] * type.aspect[2],
  ], type.tilt);
}

export function deriveMorphologyCarrier(
  type: TypeMorphology,
  sampleCount = CELL_MORPHOLOGY_SAMPLES,
): MorphologyPoint3[] {
  const count = clamp(Math.trunc(sampleCount), 24, CELL_MORPHOLOGY_SAMPLES);
  const points = Array.from({ length: count }, (_, index) => carrierPoint(type, index / count));
  points.push([...points[0]] as [number, number, number]);
  return points;
}

function signedAngle(
  from: MorphologyVector3,
  to: MorphologyVector3,
  axis: MorphologyVector3,
): number {
  return Math.atan2(dot(cross(from, to), axis), clamp(dot(from, to), -1, 1));
}

function transportNormal(
  normal: MorphologyVector3,
  from: MorphologyVector3,
  to: MorphologyVector3,
): MutableVector3 {
  const axis = cross(from, to);
  const axisLength = length(axis);
  if (axisLength <= EPSILON) return normalize(normal, [0, 1, 0]);
  const angle = Math.atan2(axisLength, clamp(dot(from, to), -1, 1));
  return normalize(rotateAroundAxis(normal, scale(axis, 1 / axisLength), angle), [0, 1, 0]);
}

/** Closed parallel-transport frame with distributed seam correction. */
export function deriveMorphologyFrames(
  carrier: readonly MorphologyPoint3[],
): CarrierFrame[] {
  const count = Math.max(1, carrier.length - 1);
  const tangents = Array.from({ length: count }, (_, index) => normalize(
    subtract(carrier[(index + 1) % count], carrier[(index - 1 + count) % count]),
    [1, 0, 0],
  ));
  const reference: MorphologyVector3 = Math.abs(tangents[0][1]) < 0.8
    ? [0, 1, 0]
    : [1, 0, 0];
  const normals: MutableVector3[] = [normalize(cross(reference, tangents[0]), [0, 0, 1])];
  for (let index = 1; index < count; index += 1) {
    normals.push(transportNormal(normals[index - 1], tangents[index - 1], tangents[index]));
  }
  const closureNormal = transportNormal(normals[count - 1], tangents[count - 1], tangents[0]);
  const correction = signedAngle(closureNormal, normals[0], tangents[0]);
  const frames = Array.from({ length: count }, (_, index) => {
    const amount = count <= 1 ? 0 : index / (count - 1);
    const normal = normalize(
      rotateAroundAxis(normals[index], tangents[index], correction * amount),
      normals[index],
    );
    const binormal = normalize(cross(tangents[index], normal), [0, 0, 1]);
    return { tangent: tangents[index], normal, binormal } satisfies CarrierFrame;
  });
  frames.push({
    tangent: [...frames[0].tangent] as [number, number, number],
    normal: [...frames[0].normal] as [number, number, number],
    binormal: [...frames[0].binormal] as [number, number, number],
  });
  return frames;
}

function braidPerturbation(
  lock: LockMorphology,
  strand: number,
  parameter: number,
): { angle: number; radius: number } {
  const wordLength = lock.braidWord.length;
  const scaled = clamp(parameter, 0, 1 - Number.EPSILON) * wordLength;
  const wordIndex = Math.floor(scaled);
  const local = scaled - wordIndex;
  const generator = lock.braidWord[wordIndex];
  const pair = Math.abs(generator) - 1;
  if (strand !== pair && strand !== pair + 1) return { angle: 0, radius: 0 };
  const side = strand === pair ? 1 : -1;
  const sign = Math.sign(generator) || 1;
  const envelope = Math.sin(Math.PI * local);
  return {
    angle: side * sign * Math.sin(CELL_MORPHOLOGY_TAU * local)
      * envelope * (Math.PI / lock.strandCount) * lock.crossingSpacing,
    radius: side * Math.cos(CELL_MORPHOLOGY_TAU * local)
      * envelope * lock.radialEmphasis,
  };
}

function pointOnStrand(
  carrier: MorphologyPoint3,
  frame: CarrierFrame,
  lock: LockMorphology,
  strand: number,
  parameter: number,
): MorphologyPoint3 {
  const perturbation = braidPerturbation(lock, strand, parameter);
  const angle = strand / lock.strandCount * CELL_MORPHOLOGY_TAU
    + lock.handedness * lock.closure * CELL_MORPHOLOGY_TAU * parameter
    + perturbation.angle;
  const radius = lock.radius * (1 + perturbation.radius);
  return add(
    carrier,
    add(scale(frame.normal, Math.cos(angle) * radius), scale(frame.binormal, Math.sin(angle) * radius)),
  );
}

function deriveStrands(
  carrier: readonly MorphologyPoint3[],
  frames: readonly CarrierFrame[],
  lock: LockMorphology,
): MorphologyBraidStrand[] {
  const count = carrier.length - 1;
  return Array.from({ length: lock.strandCount }, (_, strand) => {
    const points = Array.from({ length: count }, (_, index) => pointOnStrand(
      carrier[index],
      frames[index],
      lock,
      strand,
      index / count,
    ));
    points.push([...points[0]] as [number, number, number]);
    return { index: strand, points };
  });
}

function sampleStrand(
  strand: MorphologyBraidStrand,
  parameter: number,
): MorphologyPoint3 {
  const count = strand.points.length - 1;
  const index = Math.round(clamp(parameter, 0, 1) * count) % count;
  return strand.points[index];
}

function deriveCrossings(
  strands: readonly MorphologyBraidStrand[],
  lock: LockMorphology,
): MorphologyBraidCrossing[] {
  const ordinals = new Map<number, number>();
  return lock.braidWord.map((generator, crossingIndex) => {
    const pair = Math.abs(generator) - 1;
    const ordinal = ordinals.get(pair) ?? 0;
    ordinals.set(pair, ordinal + 1);
    const parameter = (crossingIndex + 0.5) / lock.braidWord.length;
    const pointA = sampleStrand(strands[pair], parameter);
    const pointB = sampleStrand(strands[pair + 1], parameter);
    return {
      parameter,
      pair,
      ordinal,
      generator,
      pointA,
      pointB,
      midpoint: midpoint(pointA, pointB),
    };
  });
}

function deriveTopologyDataMarks(
  strands: readonly MorphologyBraidStrand[],
  data: DataMorphology,
): MorphologyBraidDataMark[] {
  const strandCount = strands.length;
  return data.slots.map((mark) => {
    const parameter = (mark.slot + 0.5) / CELL_MORPHOLOGY_DATA_SLOTS;
    const strand = mark.lane % strandCount;
    const pair = mark.pairLane % Math.max(1, strandCount - 1);
    const point = sampleStrand(strands[strand], parameter);
    const peerPoint = sampleStrand(strands[(strand + 1) % strandCount], parameter);
    const center = midpoint(point, peerPoint);
    const direction = normalize(subtract(center, point), [0, 1, 0]);
    const displaced = add(center, scale(direction, mark.magnitude * 0.15));
    return {
      ...mark,
      parameter,
      strand,
      pair,
      point,
      peerPoint,
      midpoint: displaced,
    };
  });
}

function agreementScore(seed: ShapeSeed, crossing: MorphologyBraidCrossing): number {
  const mixed: ShapeSeed = [
    mix32(seed[0] ^ Math.imul(crossing.pair + 1, 0x9e37_79b1)),
    mix32(seed[1] ^ Math.imul(crossing.ordinal + 1, 0x85eb_ca77)),
  ];
  return seedStream(mixed, 'data/agreement')();
}

function deriveAgreements(
  crossings: readonly MorphologyBraidCrossing[],
  data: DataMorphology,
): MorphologyAgreement[] {
  if (data.slots.length === 0) return [];
  const selected = crossings
    .map((crossing, crossingIndex) => ({
      crossing,
      crossingIndex,
      score: agreementScore(data.seed, crossing),
    }))
    .sort((left, right) => right.score - left.score || left.crossingIndex - right.crossingIndex)
    .slice(0, Math.min(data.slots.length, CELL_MORPHOLOGY_MAX_NODES));
  return selected
    .map(({ crossing, crossingIndex }, index) => {
      const mark = data.slots[index % data.slots.length];
      return {
        parameter: crossing.parameter,
        pair: crossing.pair,
        ordinal: crossing.ordinal,
        crossingIndex,
        dataSlot: mark.slot,
        kind: mark.kind,
        pointA: crossing.pointA,
        pointB: crossing.pointB,
        midpoint: crossing.midpoint,
      } satisfies MorphologyAgreement;
    })
    .sort((left, right) => (
      left.parameter - right.parameter
      || left.pair - right.pair
      || left.ordinal - right.ordinal
    ));
}

export function deriveCellMorphologyTopology(cell: Cell): CellMorphologyTopology {
  const genome = deriveCellMorphologyGenome(cell);
  const carrier = deriveMorphologyCarrier(genome.type);
  const frames = deriveMorphologyFrames(carrier);
  const strands = deriveStrands(carrier, frames, genome.lock);
  const crossings = deriveCrossings(strands, genome.lock);
  const dataMarks = deriveTopologyDataMarks(strands, genome.data);
  const agreements = deriveAgreements(crossings, genome.data);
  const segmentCount = strands.reduce(
    (total, strand) => total + Math.max(0, strand.points.length - 1),
    0,
  ) + dataMarks.length;
  const nodeCount = agreements.length;
  return {
    genome,
    carrier,
    frames,
    strands,
    crossings,
    dataMarks,
    agreements,
    presenceScale: genome.presenceScale,
    birthPhase: ((Math.trunc(cell.birth_block) % 4096) + 4096) % 4096
      / 4096 * CELL_MORPHOLOGY_TAU,
    segmentCount,
    nodeCount,
  };
}

export function morphologySignature(
  topology: CellMorphologyTopology,
): CellMorphologySignature {
  const { genome } = topology;
  return {
    type: `${genome.type.family}/p${genome.type.profile}/l${genome.type.lobes}`
      + `/w${genome.type.winding.join('.')}`,
    lock: `${genome.lock.family}/${genome.lock.strandCount}`
      + `/${genome.lock.handedness > 0 ? 'R' : 'L'}`
      + `/${genome.lock.braidWord.join('.')}`,
    data: `${genome.data.bytes}b/${genome.data.slots.map((mark) => mark.slot).join('.')}`,
    slotMaskHex: genome.data.slotMask.toString(16).padStart(4, '0'),
    markKinds: genome.data.slots.map((mark) => mark.kind).join(','),
    segments: topology.segmentCount,
    nodes: topology.nodeCount,
    fallback: genome.fallback,
  };
}
