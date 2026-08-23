import { describe, expect, it } from 'vitest';
import type { Cell, ShapeSeed } from '@cknerv/types';
import {
  COLLECTION_ACCENT_HUE_SPAN,
  capacityMass,
  contentHashSeeds,
  deriveCellVisual,
  hasCellTagAccent,
  observedDataBytes,
  payloadDensity,
  rotateAccentHue,
} from '../../src/derives/cellVisual.derive';

const CELL: Cell = {
  id: 7,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 42,
  tag: null,
  pos_seed: [1, 2, 3],
  out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
  capacity: 61e8,
  data_hex: '0xdeadbeef',
  data_bytes: 4,
  content_hash: '0x12345678abcdef0101020304ffffffff00000000000000000000000000000000',
  lock_shape_seed: [1, 2],
  type_shape_seed: null,
  data_shape_seed: [3, 4],
  lock_kind: 'multisig',
  asset_kind: 'dao',
};

describe('cellVisual derive', () => {
  it('recognises only renderer-owned tag accents', () => {
    expect(hasCellTagAccent('wallet')).toBe(true);
    expect(hasCellTagAccent('future-chain-tag')).toBe(false);
    expect(hasCellTagAccent(null)).toBe(false);
  });

  it('maps chain semantics to stable compact shader values', () => {
    const visual = deriveCellVisual(CELL);
    expect(visual.assetClass).toBe(3);
    expect(visual.lockClass).toBe(1);
    expect(visual.payload).toBeGreaterThan(0);
    expect(visual.mass).toBeGreaterThanOrEqual(0.84);
    expect(visual.seeds).toEqual(contentHashSeeds(CELL.content_hash));
  });

  it('uses tag only as an accent override', () => {
    const base = deriveCellVisual(CELL);
    const tagged = deriveCellVisual({ ...CELL, tag: 'wallet' });
    expect(tagged.assetClass).toBe(base.assetClass);
    expect(tagged.lockClass).toBe(base.lockClass);
    expect(tagged.accent).not.toEqual(base.accent);
  });

  it('compresses capacity monotonically into a restrained mass range', () => {
    const small = capacityMass(61e8);
    const medium = capacityMass(10_000e8);
    const whale = capacityMass(10_000_000e8);
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThanOrEqual(whale);
    expect(whale).toBeLessThanOrEqual(1.2);
  });

  it('treats a truncated data string as its observed prefix only', () => {
    expect(observedDataBytes('0xdeadbeef~')).toBe(4);
    expect(payloadDensity('0x')).toBe(0);
    expect(payloadDensity(`0x${'aa'.repeat(1024)}~`)).toBe(1);
  });
});

/** M2b — the collection channel on the galaxy BODY. The cartouche is a
 *  detail; this is what makes a Nervape swarm read as one family from the
 *  distance the galaxy is actually seen at, and it costs no vertex attribute
 *  because `accent` is already CPU-written per cell. */
describe('collection kinship on the class accent', () => {
  /** Live mainnet Spore Cluster ids, digested. */
  const CLUSTERS: readonly ShapeSeed[] = [
    [0xc5eb_230e, 0xcdd6_2018], // Nervape
    [0x9482_0ee0, 0x12ad_cca5],
    [0x37bd_9b1f, 0xa7f9_1e37],
    [0xac90_994b, 0x05b5_ac99],
    [0xf599_caa0, 0xbccf_d8e0],
    [0x7c97_8b24, 0xa6ed_2bd2],
    [0x28b3_abb1, 0x55e0_1019],
    [0x0d24_50d2, 0x63cf_3833],
    [0x163d_d232, 0x5258_bd53],
  ];

  const spore = (overrides: Partial<Cell> = {}): Cell => (
    { ...CELL, asset_kind: 'spore', ...overrides }
  );

  it('rotates hue only — saturation, lightness and grey are untouched', () => {
    const green = deriveCellVisual(spore()).accent;
    const shifted = rotateAccentHue(green, 0.25);
    const luma = (c: readonly [number, number, number]) => (
      (Math.max(...c) + Math.min(...c)) / 2
    );
    const chroma = (c: readonly [number, number, number]) => Math.max(...c) - Math.min(...c);
    expect(luma(shifted)).toBeCloseTo(luma(green), 6);
    expect(chroma(shifted)).toBeCloseTo(chroma(green), 6);
    expect(shifted).not.toEqual(green);
    // A full turn is the identity, and grey has no hue to move.
    for (const channel of rotateAccentHue(green, 1)) expect(channel).toBeGreaterThan(0);
    rotateAccentHue(green, 1).forEach((c, i) => expect(c).toBeCloseTo(green[i], 6));
    expect(rotateAccentHue([0.5, 0.5, 0.5], 0.3)).toEqual([0.5, 0.5, 0.5]);
    expect(rotateAccentHue(green, 0)).toBe(green);
  });

  it('gives every cell of one collection the same body colour', () => {
    const a = deriveCellVisual(spore({
      collection_seed: CLUSTERS[0],
      content_hash: `0x${'11'.repeat(32)}`,
      capacity: 900e8,
    }));
    const b = deriveCellVisual(spore({
      collection_seed: [CLUSTERS[0][0], CLUSTERS[0][1]],
      content_hash: `0x${'99'.repeat(32)}`,
      capacity: 61e8,
    }));
    expect(a.accent).toEqual(b.accent);
    // Everything else that separates them still does.
    expect(a.seeds).not.toEqual(b.seeds);
    expect(a.mass).not.toBe(b.mass);

    const kinless = deriveCellVisual(spore());
    expect(a.accent).not.toEqual(kinless.accent);
    const other = deriveCellVisual(spore({ collection_seed: CLUSTERS[1] }));
    expect(a.accent).not.toEqual(other.accent);
  });

  /** The guard the palette needs. `hudDiscipline` keeps the NAMED colours
   *  apart, and it cannot see a hue derived per cell — so the bound has to be
   *  proved here: no real collection may rotate a class off its own accent
   *  far enough to be mistaken for a neighbouring class. */
  it('never rotates a class accent out of its own band', () => {
    const distance = (
      a: readonly [number, number, number],
      b: readonly [number, number, number],
    ) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

    for (const kind of ['spore', 'object'] as const) {
      const home = deriveCellVisual({ ...CELL, asset_kind: kind }).accent;
      // Every LIVE collection, plus the two extremes the span allows.
      const seen = CLUSTERS.map((seed) => (
        deriveCellVisual({ ...CELL, asset_kind: kind, collection_seed: seed }).accent
      )).concat([
        rotateAccentHue(home, COLLECTION_ACCENT_HUE_SPAN),
        rotateAccentHue(home, -COLLECTION_ACCENT_HUE_SPAN),
      ]);
      for (const accent of seen) {
        // Still nearer its own class than any other class accent.
        for (const rival of ['native', 'sudt', 'xudt', 'dao', 'other', 'identity'] as const) {
          const other = deriveCellVisual({ ...CELL, asset_kind: rival }).accent;
          expect(distance(accent, home)).toBeLessThan(distance(accent, other));
        }
        for (const channel of accent) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
      // …and it is a real shift, not a rounding error nobody would see.
      expect(seen.some((accent) => distance(accent, home) > 0.02)).toBe(true);
    }
  });

  /** A renderer-owned tag is a different channel with its own palette. A
   *  collection may lean the CLASS colour; it has no standing over that one. */
  it(`leaves a tagged cell's accent alone`, () => {
    const tagged = spore({ tag: 'dex', collection_seed: CLUSTERS[0] });
    expect(deriveCellVisual(tagged).accent)
      .toEqual(deriveCellVisual({ ...tagged, collection_seed: undefined }).accent);
    expect(hasCellTagAccent('dex')).toBe(true);
  });
});
