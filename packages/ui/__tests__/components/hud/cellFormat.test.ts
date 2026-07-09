import { describe, it, expect } from 'vitest';
import {
  formatCkb, midTruncate, formatOutpoint, formatDataHex, formatCellKind,
  formatAge, formatDataSize, formatLockKind, formatAssetKind,
  LOCK_COLORS, ASSET_COLORS,
} from '../../../src/components/hud/cellFormat';

describe('cellFormat — moved formatters', () => {
  it('formatCkb converts shannons to CKB', () => {
    expect(formatCkb(12300000000)).toBe('123.00 CKB');
  });
  it('midTruncate keeps head+tail with ellipsis', () => {
    expect(midTruncate('0xabcdef0123456789', 6, 8)).toBe('0xabcd…23456789');
  });
  it('formatOutpoint truncates the tx hash and appends the index', () => {
    // tail=8 → last 8 chars of the 66-char hash ("abababab"). The brief's
    // literal ("…ababab", 6 chars) was an arithmetic typo; the verbatim
    // midTruncate(txHash, 6, 8) is the proven source of truth.
    expect(formatOutpoint('0x' + 'ab'.repeat(32), 2)).toBe('0xabab…abababab#2');
  });
  it('formatDataHex truncates past the char limit', () => {
    expect(formatDataHex('0xdeadbeefcafe1234567890', 14)).toBe('0xdeadbeefcafe…');
    expect(formatDataHex('0xdead', 14)).toBe('0xdead');
  });
  it('formatCellKind uppercases the tag, GENERIC for null', () => {
    expect(formatCellKind('wallet')).toBe('WALLET');
    expect(formatCellKind(null)).toBe('GENERIC');
  });
});

describe('cellFormat — new helpers', () => {
  it('formatAge humanizes an elapsed span', () => {
    expect(formatAge(0, 3 * 3600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(formatAge(0, 45 * 1000)).toBe('45s');
    expect(formatAge(0, 2 * 86400_000 + 5 * 3600_000)).toBe('2d 5h');
    expect(formatAge(100, 50)).toBe('0s'); // clamps negatives
  });
  it('formatDataSize reports byte count, ellipsis-aware', () => {
    expect(formatDataSize('0x')).toBe('0 B');
    expect(formatDataSize('0xdeadbeef')).toBe('4 B');
    expect(formatDataSize('0xdeadbeef…')).toBe('4 B+'); // upstream-truncated
  });
  it('formatLockKind / formatAssetKind label families with fallbacks', () => {
    expect(formatLockKind('omnilock')).toBe('omnilock');
    expect(formatLockKind(undefined)).toBe('—');
    expect(formatAssetKind('xudt')).toBe('xUDT');
    expect(formatAssetKind('native')).toBe('native');
    expect(formatAssetKind(undefined)).toBe('—');
  });
  it('color maps cover every family key', () => {
    for (const k of ['sighash','multisig','acp','omnilock','other']) expect(LOCK_COLORS[k]).toMatch(/^#/);
    for (const k of ['native','sudt','xudt','dao','spore','other']) expect(ASSET_COLORS[k]).toMatch(/^#/);
  });
});
