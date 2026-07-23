import { fnv1a } from '../geometry/edgeBezier';
import { consensusMemoryEvidenceFingerprint } from './consensusMemoryEvidence.derive';

export const CELL_IDENTITY_PROOF_KINDS = [
  'address',
  'content',
  'anchor',
] as const;

/** WHERE / WHAT / WHEN facets emitted by the selected Cell portrait. */
export type CellIdentityProofKind =
  (typeof CELL_IDENTITY_PROOF_KINDS)[number];

/** One bounded, display-only scene acknowledgement. */
export interface CellIdentityProofEvent {
  kind: CellIdentityProofKind;
  cellId: number;
  sequence: number;
  emittedAtMs: number;
  reducedMotion: boolean;
}

export const CELL_OUTPOINT_LOCATOR_LANE_COUNT = 4;
export const CELL_OUTPOINT_LOCATOR_READ_SECONDS = 0.96;
export const CELL_OUTPOINT_LOCATOR_ECHO_SECONDS = 1.12;
export const CELL_OUTPOINT_LOCATOR_ECHO_REDUCED_SECONDS = 0.72;
export const CELL_OUTPOINT_LOCATOR_RADIUS_PX_START = 68;
export const CELL_OUTPOINT_LOCATOR_RADIUS_PX_END = 34;
export const CELL_OUTPOINT_LOCATOR_HALF_EXTENT = 0.61;
export const CELL_OUTPOINT_LOCATOR_BOUND_RADIUS = 0.94;

export const CELL_BIRTH_ANCHOR_READ_SECONDS = 1.04;
export const CELL_BIRTH_ANCHOR_ECHO_SECONDS = 1.52;
export const CELL_BIRTH_ANCHOR_ECHO_REDUCED_SECONDS = 0.78;

const TAU = Math.PI * 2;
const CYAN = [0.18, 0.92, 1] as const;
const VIOLET = [0.69, 0.43, 1] as const;
const GOLD = [1, 0.52, 0.12] as const;
const PALE_GOLD = [1, 0.84, 0.48] as const;

type Point3 = readonly [number, number, number];
type Color3 = readonly [number, number, number];
type Tuple4 = readonly [number, number, number, number];

export interface CellOutpointLocatorEncoding {
  fingerprint: string;
  phase: number;
  lanes: Tuple4;
  index: number;
  indexBytes: Tuple4;
}

export type CellOutpointLocatorSegmentRole =
  | 'rail'
  | 'index'
  | 'crosshair';

export interface CellOutpointLocatorSegment {
  role: CellOutpointLocatorSegmentRole;
  laneIndex: number | null;
  byteIndex: number | null;
  from: Point3;
  to: Point3;
  color: Color3;
  energy: number;
}

export interface CellBirthAnchorEncoding {
  block: number;
  hexadecimal: string;
  digits: readonly number[];
  phase: number;
}

export interface CellBirthAnchorSegment {
  role: 'spine' | 'digit';
  digitIndex: number | null;
  value: number | null;
  from: Point3;
  to: Point3;
  color: Color3;
  energy: number;
}

export type CellIdentityReadState =
  | 'idle'
  | 'reading'
  | 'resolved'
  | 'reduced';

export interface CellOutpointLocatorReadFrame {
  state: CellIdentityReadState;
  progress: number;
  activeLane: number | null;
  indexProgress: number;
  lockScale: number;
}

export interface CellBirthAnchorReadFrame {
  state: CellIdentityReadState;
  progress: number;
  depthProgress: number;
  activeDigit: number | null;
}

export type CellIdentityEchoState =
  | 'idle'
  | 'confirming'
  | 'reduced'
  | 'settled';

export interface CellOutpointLocatorEchoFrame {
  state: CellIdentityEchoState;
  progress: number;
  strength: number;
  radiusPx: number;
}

export interface CellBirthAnchorEchoFrame {
  state: CellIdentityEchoState;
  progress: number;
  strength: number;
  depthProgress: number;
  pulseStrength: number;
}

function unitHash(value: string): number {
  return fnv1a(value) / 0xffff_ffff;
}

function mix(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function mixColor(
  left: Color3,
  right: Color3,
  amount: number,
): Color3 {
  return [
    mix(left[0], right[0], amount),
    mix(left[1], right[1], amount),
    mix(left[2], right[2], amount),
  ];
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const unit = clampUnit((value - edge0) / (edge1 - edge0));
  return unit * unit * (3 - 2 * unit);
}

function finiteElapsed(elapsedSeconds: number): number {
  return Number.isFinite(elapsedSeconds)
    ? elapsedSeconds
    : Number.POSITIVE_INFINITY;
}

function normalizeU32(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0xffff_ffff, Math.trunc(value)));
}

/**
 * The transaction hash selects four asymmetric registration rails; all four
 * output-index bytes remain separately visible as the coordinate's final
 * qualifier. This is an outpoint locator, not a second content hash.
 */
export function deriveCellOutpointLocatorEncoding(
  transactionHash: string,
  outputIndex: number,
): CellOutpointLocatorEncoding {
  const body = transactionHash.trim().replace(/^0x/i, '').toLowerCase()
    || 'unavailable';
  const index = normalizeU32(outputIndex);
  const lanes = Array.from(
    { length: CELL_OUTPOINT_LOCATOR_LANE_COUNT },
    (_, lane) => unitHash(`cell-outpoint:${lane}:${body}`),
  ) as unknown as Tuple4;
  const indexBytes = [
    Math.floor(index / 0x1000000) % 0x100,
    Math.floor(index / 0x10000) % 0x100,
    Math.floor(index / 0x100) % 0x100,
    index % 0x100,
  ] as const;
  return {
    fingerprint: `${consensusMemoryEvidenceFingerprint(transactionHash)}#${index}`,
    phase: unitHash(`cell-outpoint:phase:${body}`) * TAU,
    lanes,
    index,
    indexBytes,
  };
}

/** Shared open-corner grammar for the portrait and spatial WHERE marker. */
export function deriveCellOutpointLocatorSegments(
  encoding: CellOutpointLocatorEncoding,
): CellOutpointLocatorSegment[] {
  const segments: CellOutpointLocatorSegment[] = [];
  for (let laneIndex = 0; laneIndex < encoding.lanes.length; laneIndex += 1) {
    const lane = encoding.lanes[laneIndex];
    const signX = laneIndex % 2 === 0 ? -1 : 1;
    const signY = laneIndex < 2 ? 1 : -1;
    const extent = CELL_OUTPOINT_LOCATOR_HALF_EXTENT - lane * 0.055;
    const arm = mix(0.13, 0.245, lane);
    const cornerX = signX * extent;
    const cornerY = signY * extent;
    const color = mixColor(CYAN, VIOLET, lane);
    segments.push(
      {
        role: 'rail',
        laneIndex,
        byteIndex: null,
        from: [cornerX, cornerY, 0],
        to: [cornerX - signX * arm, cornerY, 0],
        color,
        energy: 1,
      },
      {
        role: 'rail',
        laneIndex,
        byteIndex: null,
        from: [cornerX, cornerY, 0],
        to: [cornerX, cornerY - signY * arm, 0],
        color,
        energy: 1,
      },
    );
  }

  // Four byte ticks make the output index exact rather than decorative.
  for (let byteIndex = 0; byteIndex < encoding.indexBytes.length; byteIndex += 1) {
    const byte = encoding.indexBytes[byteIndex];
    const x = -0.3 + byteIndex * 0.2;
    const length = mix(0.034, 0.118, byte / 0xff);
    segments.push({
      role: 'index',
      laneIndex: null,
      byteIndex,
      from: [x, -0.665, 0],
      to: [x, -0.665 + length, 0],
      color: mixColor(GOLD, PALE_GOLD, byte / 0xff),
      energy: 0.92,
    });
  }

  // The center remains open: four short registration cuts identify the target
  // without turning the locator into another closed ring or token silhouette.
  const crossColor = mixColor(CYAN, PALE_GOLD, 0.32);
  segments.push(
    {
      role: 'crosshair',
      laneIndex: null,
      byteIndex: null,
      from: [-0.082, 0, 0],
      to: [-0.024, 0, 0],
      color: crossColor,
      energy: 0.78,
    },
    {
      role: 'crosshair',
      laneIndex: null,
      byteIndex: null,
      from: [0.024, 0, 0],
      to: [0.082, 0, 0],
      color: crossColor,
      energy: 0.78,
    },
    {
      role: 'crosshair',
      laneIndex: null,
      byteIndex: null,
      from: [0, -0.082, 0],
      to: [0, -0.024, 0],
      color: crossColor,
      energy: 0.78,
    },
    {
      role: 'crosshair',
      laneIndex: null,
      byteIndex: null,
      from: [0, 0.024, 0],
      to: [0, 0.082, 0],
      color: crossColor,
      energy: 0.78,
    },
  );
  return segments;
}

/**
 * Block height is encoded directly as hexadecimal notches. Leading zeroes are
 * presentation padding only; every significant digit remains represented.
 */
export function deriveCellBirthAnchorEncoding(
  birthBlock: number,
): CellBirthAnchorEncoding {
  const block = Number.isFinite(birthBlock)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(birthBlock)))
    : 0;
  const hexadecimal = BigInt(block).toString(16).toUpperCase().padStart(6, '0');
  const digits = [...hexadecimal].map((digit) => Number.parseInt(digit, 16));
  return {
    block,
    hexadecimal,
    digits,
    phase: Number(BigInt(block) % 4096n) / 4096 * TAU,
  };
}

/** Shared normalized chronology spine; renderers choose its physical depth. */
export function deriveCellBirthAnchorSegments(
  encoding: CellBirthAnchorEncoding,
): CellBirthAnchorSegment[] {
  const segments: CellBirthAnchorSegment[] = [{
    role: 'spine',
    digitIndex: null,
    value: null,
    from: [0, 0, 0],
    to: [0, -1, 0],
    color: GOLD,
    energy: 0.78,
  }];
  encoding.digits.forEach((digit, digitIndex) => {
    const y = -(digitIndex + 1) / (encoding.digits.length + 1);
    const sign = (digit + digitIndex) % 2 === 0 ? -1 : 1;
    const length = mix(0.055, 0.19, digit / 15);
    segments.push({
      role: 'digit',
      digitIndex,
      value: digit,
      from: [0, y, 0],
      to: [sign * length, y, 0],
      color: mixColor(GOLD, PALE_GOLD, digit / 15),
      energy: 0.82 + digit / 15 * 0.18,
    });
  });
  return segments;
}

export function cellOutpointLocatorReadFrame(
  elapsedSeconds: number,
  focused: boolean,
  reducedMotion = false,
): CellOutpointLocatorReadFrame {
  if (!focused) {
    return {
      state: 'idle',
      progress: 0,
      activeLane: null,
      indexProgress: 0,
      lockScale: 1.18,
    };
  }
  if (reducedMotion) {
    return {
      state: 'reduced',
      progress: 1,
      activeLane: null,
      indexProgress: 1,
      lockScale: 1,
    };
  }
  const elapsed = Math.max(0, finiteElapsed(elapsedSeconds));
  if (elapsed >= CELL_OUTPOINT_LOCATOR_READ_SECONDS) {
    return {
      state: 'resolved',
      progress: 1,
      activeLane: null,
      indexProgress: 1,
      lockScale: 1,
    };
  }
  const progress = elapsed / CELL_OUTPOINT_LOCATOR_READ_SECONDS;
  const railProgress = clampUnit(progress / 0.7);
  const activeLane = railProgress >= 1
    ? null
    : Math.min(
      CELL_OUTPOINT_LOCATOR_LANE_COUNT - 1,
      Math.floor(railProgress * CELL_OUTPOINT_LOCATOR_LANE_COUNT),
    );
  const lockProgress = smoothstep(0, 0.82, progress);
  return {
    state: 'reading',
    progress,
    activeLane,
    indexProgress: smoothstep(0.64, 1, progress),
    lockScale: mix(1.18, 1, lockProgress),
  };
}

export function cellOutpointLocatorSegmentEnergy(
  frame: CellOutpointLocatorReadFrame,
  segment: CellOutpointLocatorSegment,
): number {
  if (frame.state === 'idle') return 0;
  if (frame.state === 'resolved' || frame.state === 'reduced') return 1.08;
  if (segment.role === 'crosshair') {
    return 0.3 + smoothstep(0.05, 0.38, frame.progress) * 0.72;
  }
  if (segment.role === 'index') {
    const byteThreshold = (segment.byteIndex ?? 0) / 4;
    return 0.08 + smoothstep(
      byteThreshold,
      Math.min(1, byteThreshold + 0.32),
      frame.indexProgress,
    ) * 1.08;
  }
  const activeLane = frame.activeLane;
  if (activeLane === null) return 0.88;
  if ((segment.laneIndex ?? 0) < activeLane) return 0.72;
  if (segment.laneIndex === activeLane) return 1.68;
  return 0.1;
}

export function cellBirthAnchorReadFrame(
  elapsedSeconds: number,
  focused: boolean,
  digitCount: number,
  reducedMotion = false,
): CellBirthAnchorReadFrame {
  if (!focused) {
    return {
      state: 'idle',
      progress: 0,
      depthProgress: 0,
      activeDigit: null,
    };
  }
  if (reducedMotion) {
    return {
      state: 'reduced',
      progress: 1,
      depthProgress: 1,
      activeDigit: null,
    };
  }
  const elapsed = Math.max(0, finiteElapsed(elapsedSeconds));
  if (elapsed >= CELL_BIRTH_ANCHOR_READ_SECONDS) {
    return {
      state: 'resolved',
      progress: 1,
      depthProgress: 1,
      activeDigit: null,
    };
  }
  const progress = elapsed / CELL_BIRTH_ANCHOR_READ_SECONDS;
  const depthProgress = smoothstep(0.02, 0.88, progress);
  const safeDigitCount = Math.max(0, Math.trunc(digitCount));
  return {
    state: 'reading',
    progress,
    depthProgress,
    activeDigit: safeDigitCount === 0 || depthProgress >= 1
      ? null
      : Math.min(
        safeDigitCount - 1,
        Math.floor(depthProgress * safeDigitCount),
      ),
  };
}

export function cellBirthAnchorSegmentEnergy(
  frame: CellBirthAnchorReadFrame,
  segment: CellBirthAnchorSegment,
  digitCount: number,
): number {
  if (frame.state === 'idle') return 0;
  if (frame.state === 'resolved' || frame.state === 'reduced') return 1.06;
  if (segment.role === 'spine') return 0.36 + frame.depthProgress * 0.52;
  const digitPosition = ((segment.digitIndex ?? 0) + 1)
    / (Math.max(1, digitCount) + 1);
  const distance = frame.depthProgress - digitPosition;
  if (distance >= 0) return 0.86;
  if (distance >= -0.16) return 1.58;
  return 0.06;
}

export function cellOutpointLocatorEchoFrame(
  elapsedSeconds: number,
  reducedMotion = false,
): CellOutpointLocatorEchoFrame {
  const elapsed = finiteElapsed(elapsedSeconds);
  if (elapsed < 0) {
    return {
      state: 'idle',
      progress: 0,
      strength: 0,
      radiusPx: CELL_OUTPOINT_LOCATOR_RADIUS_PX_START,
    };
  }
  const duration = reducedMotion
    ? CELL_OUTPOINT_LOCATOR_ECHO_REDUCED_SECONDS
    : CELL_OUTPOINT_LOCATOR_ECHO_SECONDS;
  if (elapsed >= duration) {
    return {
      state: 'settled',
      progress: 1,
      strength: 0,
      radiusPx: CELL_OUTPOINT_LOCATOR_RADIUS_PX_END,
    };
  }
  if (reducedMotion) {
    return {
      state: 'reduced',
      progress: 1,
      strength: 0.78,
      radiusPx: CELL_OUTPOINT_LOCATOR_RADIUS_PX_END,
    };
  }
  const progress = elapsed / duration;
  const strength = smoothstep(0, 0.1, progress)
    * (1 - smoothstep(0.58, 1, progress));
  return {
    state: 'confirming',
    progress,
    strength,
    radiusPx: mix(
      CELL_OUTPOINT_LOCATOR_RADIUS_PX_START,
      CELL_OUTPOINT_LOCATOR_RADIUS_PX_END,
      smoothstep(0, 0.74, progress),
    ),
  };
}

export function cellBirthAnchorEchoFrame(
  elapsedSeconds: number,
  reducedMotion = false,
): CellBirthAnchorEchoFrame {
  const elapsed = finiteElapsed(elapsedSeconds);
  if (elapsed < 0) {
    return {
      state: 'idle',
      progress: 0,
      strength: 0,
      depthProgress: 0,
      pulseStrength: 0,
    };
  }
  const duration = reducedMotion
    ? CELL_BIRTH_ANCHOR_ECHO_REDUCED_SECONDS
    : CELL_BIRTH_ANCHOR_ECHO_SECONDS;
  if (elapsed >= duration) {
    return {
      state: 'settled',
      progress: 1,
      strength: 0,
      depthProgress: 1,
      pulseStrength: 0,
    };
  }
  if (reducedMotion) {
    return {
      state: 'reduced',
      progress: 1,
      strength: 0.62,
      depthProgress: 1,
      pulseStrength: 0,
    };
  }
  const progress = elapsed / duration;
  const depthProgress = smoothstep(0.025, 0.62, progress);
  const strength = smoothstep(0, 0.1, progress)
    * (1 - smoothstep(0.7, 1, progress));
  return {
    state: 'confirming',
    progress,
    strength,
    depthProgress,
    pulseStrength: strength * (1 - smoothstep(0.6, 0.78, progress)),
  };
}
