import { fnv1a } from '../geometry/edgeBezier';
import { consensusMemoryEvidenceFingerprint } from './consensusMemoryEvidence.derive';

export const CELL_CONTENT_ADDRESS_LANE_COUNT = 8;
export const CELL_CONTENT_ADDRESS_TAU = Math.PI * 2;
export const CELL_CONTENT_ADDRESS_RADIUS_MIN = 0.465;
export const CELL_CONTENT_ADDRESS_RADIUS_MAX = 0.535;
export const CELL_CONTENT_ADDRESS_HALF_SPAN_MIN = 0.18;
export const CELL_CONTENT_ADDRESS_HALF_SPAN_MAX = 0.38;
export const CELL_CONTENT_ADDRESS_SPINE_THRESHOLD = 0.76;
export const CELL_CONTENT_ADDRESS_CYAN = [0.18, 0.92, 1] as const;
export const CELL_CONTENT_ADDRESS_VIOLET = [0.72, 0.42, 1] as const;
export const CELL_CONTENT_ADDRESS_READ_LANE_SECONDS = 0.16;

export type CellContentAddressLanes = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface CellContentAddressEncoding {
  fingerprint: string;
  phase: number;
  lanes: CellContentAddressLanes;
}

export interface CellContentAddressFacet {
  index: number;
  value: number;
  angle: number;
  radius: number;
  halfSpan: number;
  hasSpine: boolean;
  color: readonly [number, number, number];
}

export type CellContentAddressReadState =
  | 'idle'
  | 'reading'
  | 'resolved'
  | 'reduced';

export interface CellContentAddressReadFrame {
  state: CellContentAddressReadState;
  activeLane: number | null;
  laneProgress: number;
  readCount: number;
  progress: number;
}

function unitHash(value: string): number {
  return fnv1a(value) / 0xffff_ffff;
}

function mix(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

/**
 * Eight stable lanes derived from the complete canonical content hash. The
 * visible fingerprint is only an audit label; every optical lane still reads
 * the full hash so no displayed substring becomes the Cell's identity.
 */
export function deriveCellContentAddressEncoding(
  contentHash: string,
): CellContentAddressEncoding {
  const body = contentHash.trim().replace(/^0x/i, '').toLowerCase()
    || 'unavailable';
  const lanes = Array.from(
    { length: CELL_CONTENT_ADDRESS_LANE_COUNT },
    (_, index) => unitHash(`cell-address:${index}:${body}`),
  ) as unknown as CellContentAddressLanes;
  return {
    fingerprint: consensusMemoryEvidenceFingerprint(contentHash),
    phase: unitHash(`cell-address:phase:${body}`) * CELL_CONTENT_ADDRESS_TAU,
    lanes,
  };
}

/**
 * Shared facet grammar used by the spatial marker and detail portrait. Radius
 * and span match the marker shader's normalized inner-horizon coordinates.
 */
export function deriveCellContentAddressFacets(
  encoding: CellContentAddressEncoding,
): CellContentAddressFacet[] {
  const sectorSpan = CELL_CONTENT_ADDRESS_TAU
    / CELL_CONTENT_ADDRESS_LANE_COUNT;
  return encoding.lanes.map((value, index) => ({
    index,
    value,
    angle: (index + 0.5) * sectorSpan - Math.PI - encoding.phase,
    radius: mix(
      CELL_CONTENT_ADDRESS_RADIUS_MIN,
      CELL_CONTENT_ADDRESS_RADIUS_MAX,
      value,
    ),
    halfSpan: mix(
      CELL_CONTENT_ADDRESS_HALF_SPAN_MIN,
      CELL_CONTENT_ADDRESS_HALF_SPAN_MAX,
      value,
    ) * sectorSpan,
    hasSpine: value >= CELL_CONTENT_ADDRESS_SPINE_THRESHOLD,
    color: [
      mix(CELL_CONTENT_ADDRESS_CYAN[0], CELL_CONTENT_ADDRESS_VIOLET[0], value),
      mix(CELL_CONTENT_ADDRESS_CYAN[1], CELL_CONTENT_ADDRESS_VIOLET[1], value),
      mix(CELL_CONTENT_ADDRESS_CYAN[2], CELL_CONTENT_ADDRESS_VIOLET[2], value),
    ],
  }));
}

/** One bounded, non-looping content read driven by the portrait render clock. */
export function cellContentAddressReadFrame(
  elapsedSeconds: number,
  contentFocused: boolean,
  reducedMotion = false,
): CellContentAddressReadFrame {
  if (!contentFocused) {
    return {
      state: 'idle',
      activeLane: null,
      laneProgress: 0,
      readCount: 0,
      progress: 0,
    };
  }
  if (reducedMotion) {
    return {
      state: 'reduced',
      activeLane: null,
      laneProgress: 1,
      readCount: CELL_CONTENT_ADDRESS_LANE_COUNT,
      progress: 1,
    };
  }
  const duration = CELL_CONTENT_ADDRESS_LANE_COUNT
    * CELL_CONTENT_ADDRESS_READ_LANE_SECONDS;
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds)
    ? elapsedSeconds
    : 0);
  if (elapsed >= duration) {
    return {
      state: 'resolved',
      activeLane: null,
      laneProgress: 1,
      readCount: CELL_CONTENT_ADDRESS_LANE_COUNT,
      progress: 1,
    };
  }
  const laneUnit = elapsed / CELL_CONTENT_ADDRESS_READ_LANE_SECONDS;
  const activeLane = Math.min(
    CELL_CONTENT_ADDRESS_LANE_COUNT - 1,
    Math.floor(laneUnit),
  );
  return {
    state: 'reading',
    activeLane,
    laneProgress: laneUnit - activeLane,
    readCount: activeLane,
    progress: elapsed / duration,
  };
}

/** Relative energy for one facet during the read; identity colors never move. */
export function cellContentAddressLaneEnergy(
  frame: CellContentAddressReadFrame,
  laneIndex: number,
): number {
  if (frame.state === 'idle') return 1;
  if (frame.state === 'resolved' || frame.state === 'reduced') return 1.16;
  if (frame.activeLane === null) return 1;
  if (laneIndex < frame.activeLane) return 0.78;
  if (laneIndex > frame.activeLane) return 0.16;
  return 1.18 + Math.sin(Math.PI * frame.laneProgress) * 0.72;
}
