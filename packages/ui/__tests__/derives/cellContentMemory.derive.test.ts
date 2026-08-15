import { describe, expect, it } from 'vitest';
import type { SemanticCellContent } from '@cknerv/types';
import {
  contentSegmentAtByte,
  decodeCellDataHex,
  deriveCellContentMemory,
} from '../../src/derives/cellContentMemory.derive';

const indexed: SemanticCellContent = {
  total_bytes: 6,
  data_hex: '0x48656c6c6f00',
  data_complete: true,
  deterministic: {
    kind: 'text',
    summary: 'text with terminator',
    segments: [
      {
        label: 'body',
        start_byte: 0,
        end_byte: 5,
        meaning: 'printable body',
        value: 'Hello',
      },
      {
        label: 'terminator',
        start_byte: 5,
        end_byte: 6,
        meaning: 'zero terminator',
        value: '0',
      },
    ],
  },
  heuristics: [],
};

describe('Cell content memory derivation', () => {
  it('decodes exact bytes and a conservative printable ASCII view', () => {
    expect(decodeCellDataHex('0x48656c6c6f00')).toEqual({
      available: true,
      valid: true,
      bytes: [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0],
      observedBytes: 6,
      truncated: false,
      ascii: 'Hello·',
    });
  });

  it('uses indexed bytes only when that explicit evidence is present', () => {
    const model = deriveCellContentMemory('0xdeadbeef~', indexed);

    expect(model.origin).toBe('indexed');
    expect(model.bytes).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0]);
    expect(model.totalBytes).toBe(6);
    expect(model.complete).toBe(true);
  });

  it('keeps the direct-node prefix visible when analysis has no raw bytes', () => {
    const model = deriveCellContentMemory('0xdeadbeef~', {
      ...indexed,
      total_bytes: 99,
      data_hex: undefined,
      data_complete: false,
    });

    expect(model.origin).toBe('direct');
    expect(model.bytes).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(model.totalBytes).toBe(99);
    expect(model.complete).toBe(false);
  });

  it('does not reinterpret malformed wire content as another data path', () => {
    const model = deriveCellContentMemory('0xdeadbeef', {
      ...indexed,
      data_hex: 'not-hex',
    });

    expect(model.origin).toBe('indexed');
    expect(model.valid).toBe(false);
    expect(model.bytes).toEqual([]);
  });

  it('maps visible bytes to half-open deterministic segments', () => {
    const segments = indexed.deterministic!.segments;

    expect(contentSegmentAtByte(segments, 0)).toBe(0);
    expect(contentSegmentAtByte(segments, 4)).toBe(0);
    expect(contentSegmentAtByte(segments, 5)).toBe(1);
    expect(contentSegmentAtByte(segments, 6)).toBeNull();
  });

  it('keeps a selected overlapping interpretation mapped to its bytes', () => {
    const segments = [
      ...indexed.deterministic!.segments,
      {
        label: 'whole_value',
        start_byte: 0,
        end_byte: 6,
        meaning: 'alternate deterministic view',
        value: 'Hello\\0',
      },
    ];

    expect(contentSegmentAtByte(segments, 0)).toBe(0);
    expect(contentSegmentAtByte(segments, 0, 2)).toBe(2);
    expect(contentSegmentAtByte(segments, 6, 2)).toBeNull();
  });
});
