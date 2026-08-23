import { describe, it, expect } from 'vitest';
import {
  formatCkb, midTruncate, formatOutpoint,
  formatAge, formatBlockRef, formatDataSize, formatExactCkb, formatFeeShannons,
  formatLockKind, formatAssetKind,
  formatScriptIdentity, formatWallClock, scriptIdentityColor,
  LOCK_COLORS, ASSET_COLORS,
} from '../../../src/components/hud/cellFormat';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';

describe('cellFormat — moved formatters', () => {
  it('formatCkb reads every magnitude in one K/M/G CKB family', () => {
    expect(formatCkb(12300000000)).toBe('123 CKB');
    expect(formatCkb(1_250_000_000_000)).toBe('12.5 K CKB');
    expect(formatCkb(4_210_000n * 100_000_000n)).toBe('4.21 M CKB');
    expect(formatCkb(57_863_233_530n * 100_000_000n)).toBe('57.86 G CKB');
    expect(formatCkb(-1_250_000_000_000)).toBe('−12.5 K CKB');
    expect(formatCkb(1_250_000_000_000, true)).toBe('+12.5 K CKB');
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
});

describe('cellFormat — new helpers', () => {
  it('formatBlockRef groups block numbers in the pinned en-US style', () => {
    expect(formatBlockRef(16204800)).toBe('#16,204,800');
    expect(formatBlockRef(42)).toBe('#42');
  });
  it('formatWallClock states one UTC instant every machine reads alike', () => {
    expect(formatWallClock(1755238020000)).toBe('2025-08-15 06:07 UTC');
    // Zero-padded through the whole stamp, epoch included.
    expect(formatWallClock(0)).toBe('1970-01-01 00:00 UTC');
    expect(formatWallClock(720000)).toBe('1970-01-01 00:12 UTC');
    // Seconds are below the resolution of anything on this surface.
    expect(formatWallClock(1755238020999)).toBe('2025-08-15 06:07 UTC');
    // UTC, never the viewer's zone: the same millisecond reads the same way
    // whichever machine the HUD is open on.
    expect(formatWallClock(1767225599000)).toBe('2025-12-31 23:59 UTC');
    // Nothing to state is stated as nothing, never as 1970.
    expect(formatWallClock(Number.NaN)).toBe('UNKNOWN');
    expect(formatWallClock(Number.POSITIVE_INFINITY)).toBe('UNKNOWN');
    expect(formatWallClock(8.64e15 + 1)).toBe('UNKNOWN');
  });
  it('formatAge humanizes an elapsed span', () => {
    expect(formatAge(0, 3 * 3600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(formatAge(0, 45 * 1000)).toBe('45s');
    expect(formatAge(0, 2 * 86400_000 + 5 * 3600_000)).toBe('2d 5h');
    expect(formatAge(100, 50)).toBe('0s'); // clamps negatives
  });
  it('formatDataSize states an exact byte count, grouped and locale-pinned', () => {
    expect(formatDataSize(0)).toBe('0 B');
    expect(formatDataSize(4)).toBe('4 B');
    // The size of a Cell whose hex preview stopped at 1 KiB: the window was
    // clipped, the number is not, and no `+` is left to suggest otherwise.
    expect(formatDataSize(6947)).toBe('6,947 B');
    expect(formatDataSize(102400)).toBe('102,400 B');
  });

  it('formatDataSize never prints a non-number at a viewer', () => {
    expect(formatDataSize(Number.NaN)).toBe('0 B');
    expect(formatDataSize(-12)).toBe('0 B');
    expect(formatDataSize(11.7)).toBe('11 B');
  });

  it('formatExactCkb keeps the unrounded reading for the hover', () => {
    expect(formatExactCkb('5776320963848000000')).toBe('57,763,209,638.48 CKB');
    expect(formatExactCkb(12300000000n)).toBe('123 CKB');
    expect(formatExactCkb(0n)).toBe('0 CKB');
    expect(formatExactCkb(-100_000_000n)).toBe('−1 CKB');
    // Not a shannon count at all: the raw figure, still said out loud.
    expect(formatExactCkb('not-a-number')).toBe('not-a-number sh');
  });
  it('formatFeeShannons reads a fee at the magnitude it actually has', () => {
    // Real CKB fees live four orders of magnitude below one CKB: rounding
    // them into the house CKB family prints `0 CKB`, which is a claim, not a
    // rounding. Below one CKB the shannon count IS the reading.
    expect(formatFeeShannons('1000')).toBe('1,000 SHANNONS');
    expect(formatFeeShannons('1')).toBe('1 SHANNON');
    expect(formatFeeShannons('0')).toBe('0 SHANNONS');
    expect(formatFeeShannons('99999999')).toBe('99,999,999 SHANNONS');
    // At one CKB and above the house capacity grammar takes over, so a fee
    // and a capacity never disagree about units.
    expect(formatFeeShannons('100000000')).toBe('1 CKB');
    expect(formatFeeShannons('250000000')).toBe('2.5 CKB');
    // Not a plain unsigned decimal: nothing is printed as if it were one.
    expect(formatFeeShannons('0x3e8')).toBeNull();
    expect(formatFeeShannons('-1000')).toBeNull();
    expect(formatFeeShannons('')).toBeNull();
  });
  it('formatLockKind / formatAssetKind label families the way the index does', () => {
    // The built-in table spells its families exactly as the script index
    // spells them, so the two naming paths never disagree about one script.
    expect(formatLockKind('sighash')).toBe('Default Lock');
    expect(formatLockKind('multisig')).toBe('Default Multisig');
    expect(formatLockKind('omnilock')).toBe('OMNI Lock');
    expect(formatLockKind('acp')).toBe('Anyone-Can-Pay Lock');
    // Unrecognized is reported as unlisted, never asserted to be "custom".
    expect(formatLockKind('other')).toBe('UNLISTED');
    expect(formatLockKind(undefined)).toBe('UNKNOWN');
    expect(formatAssetKind('xudt')).toBe('xUDT');
    expect(formatAssetKind('sudt')).toBe('Simple UDT');
    expect(formatAssetKind('native')).toBe('Native CKB');
    expect(formatAssetKind('dao')).toBe('Nervos DAO');
    expect(formatAssetKind('other')).toBe('UNLISTED');
    expect(formatAssetKind(undefined)).toBe('UNKNOWN');
  });
  it('formatScriptIdentity prefers the index name over the built-in table', () => {
    const joyid = { name: 'JoyID', code_hash: `0x${'ab'.repeat(32)}` };
    // A family cknerv cannot place but the index can.
    expect(formatScriptIdentity(formatLockKind('other'), joyid)).toBe('JoyID');
    // The index and the built-in table agreeing is the ordinary case.
    expect(formatScriptIdentity(formatLockKind('sighash'), { name: 'Default Lock' }))
      .toBe('Default Lock');
    // Index unreachable: the built-in table still names the protocol's own.
    expect(formatScriptIdentity(formatLockKind('sighash'), null)).toBe('Default Lock');
    // Nobody named it, but we know which script it is.
    expect(formatScriptIdentity(formatLockKind('other'), { code_hash: `0x${'7f'.repeat(32)}` }))
      .toBe('UNLISTED · 0x7f7f…f7f');
    // Nobody named it and we do not even hold its code hash.
    expect(formatScriptIdentity(formatLockKind('other'), null)).toBe('UNLISTED');
    expect(formatScriptIdentity(formatLockKind(undefined), null)).toBe('UNKNOWN');
    // A blank name is not a name.
    expect(formatScriptIdentity(formatLockKind('other'), { name: '  ' })).toBe('UNLISTED');
  });
  it('scriptIdentityColor stops greying out scripts the index named', () => {
    expect(scriptIdentityColor('sighash', LOCK_COLORS, null)).toBe(LOCK_COLORS.sighash);
    // Unrecognized and unnamed keeps the near-black unrecognized swatch.
    expect(scriptIdentityColor('other', LOCK_COLORS, null)).toBe(LOCK_COLORS.other);
    // Named by the index: present, but claiming no family colour.
    expect(scriptIdentityColor('other', LOCK_COLORS, { name: 'JoyID' })).toBe(HUD_COLORS.ink);
    expect(scriptIdentityColor(undefined, LOCK_COLORS, null)).toBe(HUD_COLORS.dim);
  });
  it('color maps cover every family key', () => {
    for (const k of ['sighash','multisig','acp','omnilock','other']) expect(LOCK_COLORS[k]).toMatch(/^#/);
    for (const k of ['native','sudt','xudt','dao','spore','other']) expect(ASSET_COLORS[k]).toMatch(/^#/);
  });
});
