import { describe, expect, it } from 'vitest';

import {
  formatCellKind,
  formatCkb,
  formatDataHex,
  formatOutpoint,
  midTruncate,
} from '../../src/components/CellDetailHud';

describe('formatCkb', () => {
  it('renders 1 CKB', () => {
    expect(formatCkb(100_000_000)).toBe('1.00 CKB');
  });
  it('renders sub-CKB amounts', () => {
    expect(formatCkb(50_000_000)).toBe('0.50 CKB');
  });
  it('rounds to 2 decimals', () => {
    expect(formatCkb(123_456_789)).toBe('1.23 CKB');
  });
  it('renders zero', () => {
    expect(formatCkb(0)).toBe('0.00 CKB');
  });
});

describe('midTruncate', () => {
  it('passes short strings through unchanged', () => {
    expect(midTruncate('0xabc', 6, 8)).toBe('0xabc');
  });
  it('truncates middle of long strings', () => {
    const hash = '0x' + '0'.repeat(60) + 'beef';   // 66 chars total
    expect(midTruncate(hash, 6, 8)).toBe('0x0000…0000beef');
  });
});

describe('formatOutpoint', () => {
  it('joins truncated hash with index', () => {
    // 66-char hash. slice(0, 6) = "0xabcd"; slice(-8) = "23456789"
    // (the last 8 chars of "...abcdef0123456789").
    const hash = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    expect(formatOutpoint(hash, 3)).toBe('0xabcd…23456789#3');
  });
  it('preserves index 0', () => {
    expect(formatOutpoint('0xab', 0).endsWith('#0')).toBe(true);
  });
});

describe('formatDataHex', () => {
  it('passes short hex through', () => {
    expect(formatDataHex('0xdead', 14)).toBe('0xdead');
  });
  it('truncates long hex', () => {
    // slice(0, 14) on `0xababab…` keeps `0x` + 6 ab-pairs = 14 chars total.
    expect(formatDataHex('0x' + 'ab'.repeat(50), 14)).toBe('0xabababababab…');
  });
  it('handles empty data', () => {
    expect(formatDataHex('0x', 14)).toBe('0x');
  });
});

describe('formatCellKind', () => {
  it('returns GENERIC for null', () => {
    expect(formatCellKind(null)).toBe('GENERIC');
  });
  it('uppercases dex', () => {
    expect(formatCellKind('dex')).toBe('DEX');
  });
  it('uppercases ckbloom', () => {
    expect(formatCellKind('ckbloom')).toBe('CKBLOOM');
  });
});
