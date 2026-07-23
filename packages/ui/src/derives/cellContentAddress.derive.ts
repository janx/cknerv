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
