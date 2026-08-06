import type {
  SemanticCellContent,
  SemanticContentSegment,
} from '@cknerv/types';

export type CellContentByteOrigin = 'direct' | 'indexed';

export interface DecodedCellDataHex {
  available: boolean;
  valid: boolean;
  bytes: number[];
  observedBytes: number;
  truncated: boolean;
  ascii: string;
}

export interface CellContentMemoryModel extends DecodedCellDataHex {
  origin: CellContentByteOrigin;
  totalBytes: number | null;
  complete: boolean;
}

/** Decode the bounded snake-case wire representation without interpreting it. */
export function decodeCellDataHex(dataHex?: string): DecodedCellDataHex {
  if (dataHex == null) {
    return {
      available: false,
      valid: true,
      bytes: [],
      observedBytes: 0,
      truncated: false,
      ascii: '',
    };
  }
  const truncated = dataHex.endsWith('…');
  const observed = truncated ? dataHex.slice(0, -1) : dataHex;
  const body = observed.startsWith('0x') ? observed.slice(2) : '';
  const valid = observed.startsWith('0x')
    && body.length % 2 === 0
    && /^[0-9a-fA-F]*$/.test(body);
  if (!valid) {
    return {
      available: true,
      valid: false,
      bytes: [],
      observedBytes: 0,
      truncated,
      ascii: '',
    };
  }
  const bytes = Array.from(
    { length: body.length / 2 },
    (_, index) => Number.parseInt(body.slice(index * 2, index * 2 + 2), 16),
  );
  return {
    available: true,
    valid: true,
    bytes,
    observedBytes: bytes.length,
    truncated,
    ascii: bytes.map((byte) => (
      byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '·'
    )).join(''),
  };
}

/**
 * Select one explicit content-evidence path. Indexed bytes win only when the
 * normalized record actually carries them; otherwise the canonical direct-node
 * prefix remains visible and is labeled as such.
 */
export function deriveCellContentMemory(
  directDataHex: string,
  content?: SemanticCellContent,
): CellContentMemoryModel {
  const indexedBytes = decodeCellDataHex(content?.data_hex);
  const usesIndexedBytes = indexedBytes.available;
  const decoded = usesIndexedBytes
    ? indexedBytes
    : decodeCellDataHex(directDataHex);
  const totalBytes = content && Number.isSafeInteger(content.total_bytes)
    && content.total_bytes >= 0
    ? content.total_bytes
    : decoded.truncated
      ? null
      : decoded.observedBytes;
  const complete = usesIndexedBytes
    ? Boolean(content?.data_complete)
    : totalBytes !== null
      ? decoded.valid && !decoded.truncated && decoded.observedBytes === totalBytes
      : decoded.valid && !decoded.truncated;
  return {
    ...decoded,
    origin: usesIndexedBytes ? 'indexed' : 'direct',
    totalBytes,
    complete,
  };
}

export function contentSegmentAtByte(
  segments: readonly SemanticContentSegment[],
  byteIndex: number,
  preferredIndex: number | null = null,
): number | null {
  const preferred = preferredIndex === null
    ? undefined
    : segments[preferredIndex];
  if (preferred
    && byteIndex >= preferred.start_byte
    && byteIndex < preferred.end_byte
  ) {
    return preferredIndex;
  }
  const index = segments.findIndex((segment) => (
    byteIndex >= segment.start_byte && byteIndex < segment.end_byte
  ));
  return index < 0 ? null : index;
}
