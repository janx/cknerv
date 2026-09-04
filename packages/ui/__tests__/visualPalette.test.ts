import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CELL_GALAXY_PALETTE,
  PEER_NETWORK_HEX,
  PEER_NETWORK_PALETTE,
  SCENE_ACCENT_PALETTE,
  type SceneColor,
} from '../src/visualPalette';
import { CONSENSUS_BRAID_PALETTE } from '../src/derives/consensusBraid.derive';

const relativeLuminance = (color: SceneColor): number => {
  const linear = color.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};

describe('scene palette contrast', () => {
  it('keeps the Cell field warm and tissue-like', () => {
    expect(CELL_GALAXY_PALETTE.tissueRose[0])
      .toBeGreaterThan(CELL_GALAXY_PALETTE.tissueRose[2]);
    expect(CELL_GALAXY_PALETTE.veinCrimson[0])
      .toBeGreaterThan(CELL_GALAXY_PALETTE.veinCrimson[2]);
    expect(CELL_GALAXY_PALETTE.synapseAmber[0])
      .toBeGreaterThan(CELL_GALAXY_PALETTE.synapseAmber[2]);
  });

  it('keeps the peer plane bright, cold, and synthetic', () => {
    expect(PEER_NETWORK_HEX.scaffold).toBe('#1AD1FF');
    expect(PEER_NETWORK_PALETTE.scaffold[2])
      .toBeGreaterThan(PEER_NETWORK_PALETTE.scaffold[0]);
    expect(PEER_NETWORK_PALETTE.outbound[2])
      .toBeGreaterThan(PEER_NETWORK_PALETTE.outbound[0]);
    expect(PEER_NETWORK_PALETTE.version[2])
      .toBeGreaterThan(PEER_NETWORK_PALETTE.version[0]);
    expect(Object.values(PEER_NETWORK_PALETTE).every(
      (color) => relativeLuminance(color) >= 0.4,
    )).toBe(true);
  });
});

/**
 * D-6: the tissue side of the palette is one colour on screen and the ACCENT
 * side was a pile — four violets meaning memory, three golds meaning
 * agreement, five pale whites, two cyans, most of them typed straight into a
 * shader as a bare `vec3`. The measured hue census of an idle frame reads
 * rose 16,332 px, cyan 2,134, violet 409–613, gold 22: the rose family is one
 * colour, the accents were not.
 *
 * ⚠️ The rule is a DISTANCE, not a string, and the distance is the palette's
 * own. A literal a shade off an accent is the whole defect — the four violets
 * were 0.15 to 0.30 apart in the unit cube, which is invisible in a diff and
 * plain on a screen. So the tolerance is the CLOSEST TWO ACCENTS' own
 * separation: a literal nearer to an accent than the
 * palette's own members are to each other is that accent, spelled wrong. It
 * needs no number of its own and it tightens by itself if the palette ever
 * grows a closer pair. Today the pair is `paleGold` and `warmPale`, 0.228
 * apart — the two warm whites, which is the closest this palette comes to
 * saying one thing twice.
 *
 * ⚠️ A distance alone cannot be the whole gate, and it is not: a literal a
 * LITTLE further off (`recallViolet` stood 0.30 from the violet) passes it.
 * The second rule below is the other half — every file that used to type an
 * accent must now name it — and between them a site cannot regress silently.
 */
describe('the scene’s accents are a palette', () => {
  /** Every surface that paints one of the accents. */
  const ACCENT_SURFACES = [
    'derives/consensusBraid.derive.ts',
    'materials/cellHybridMaterial.ts',
    'materials/cellNucleusMaterial.ts',
    'components/CanonicalRewriteEcho.tsx',
    'components/CellGalaxy.tsx',
    'nerve/spikePool.ts',
    'nerve/DendriticBurst.tsx',
  ] as const;

  /** file → the accents it used to type as a literal and must now read by name. */
  const READS_BY_NAME: Record<string, readonly (keyof typeof SCENE_ACCENT_PALETTE)[]> = {
    'materials/cellHybridMaterial.ts': ['cyan', 'pale', 'violet', 'paleGold'],
    'materials/cellNucleusMaterial.ts': ['paleGold'],
    'components/CanonicalRewriteEcho.tsx': ['violet'],
    'components/CellGalaxy.tsx': ['pale'],
    'nerve/spikePool.ts': ['pale'],
    'nerve/DendriticBurst.tsx': ['pale'],
  };

  const src = (file: string) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8');

  const literals = (text: string): SceneColor[] => {
    const out: SceneColor[] = [];
    const triple = /(?:vec3|new THREE\.Color)\(\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*\)/g;
    for (const m of text.matchAll(triple)) {
      out.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    }
    const hex = /#([0-9a-fA-F]{6})\b/g;
    for (const m of text.matchAll(hex)) {
      const v = Number.parseInt(m[1], 16);
      out.push([((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255]);
    }
    return out;
  };

  const distance = (a: SceneColor, b: SceneColor): number => Math.hypot(
    a[0] - b[0], a[1] - b[1], a[2] - b[2],
  );

  /** How near two accents ever come. Nothing may come nearer to one. */
  const NEAREST_PAIR = (() => {
    const all = Object.values(SCENE_ACCENT_PALETTE);
    let best = Infinity;
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) best = Math.min(best, distance(all[i], all[j]));
    }
    return best;
  })();

  it('spells no accent out on any surface that paints one', () => {
    expect(NEAREST_PAIR).toBeCloseTo(0.228, 2);
    const offences: string[] = [];
    for (const file of ACCENT_SURFACES) {
      for (const literal of literals(src(file))) {
        for (const [name, accent] of Object.entries(SCENE_ACCENT_PALETTE)) {
          const d = distance(literal, accent);
          if (d < NEAREST_PAIR) {
            offences.push(`${file}: ${JSON.stringify(literal)} is ${name} (${d.toFixed(3)} away)`);
          }
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('reads by name exactly where it used to type', () => {
    for (const [file, accents] of Object.entries(READS_BY_NAME)) {
      const text = src(file);
      for (const accent of accents) {
        expect(`${file} → ${accent}: ${text.includes(`SCENE_ACCENT_PALETTE.${accent}`)}`)
          .toBe(`${file} → ${accent}: true`);
      }
    }
  });

  it('gives the braid its vocabulary without giving it the values', () => {
    // One value, two names: the braid says "agreement" and the palette says
    // "gold". Identity, not equality — a copy is a second definition.
    expect(CONSENSUS_BRAID_PALETTE.gold).toBe(SCENE_ACCENT_PALETTE.gold);
    expect(CONSENSUS_BRAID_PALETTE.paleGold).toBe(SCENE_ACCENT_PALETTE.paleGold);
    expect(CONSENSUS_BRAID_PALETTE.cyan).toBe(SCENE_ACCENT_PALETTE.cyan);
    expect(CONSENSUS_BRAID_PALETTE.violet).toBe(SCENE_ACCENT_PALETTE.violet);
    expect(CONSENSUS_BRAID_PALETTE.pale).toBe(SCENE_ACCENT_PALETTE.pale);
    expect(CONSENSUS_BRAID_PALETTE.warmPale).toBe(SCENE_ACCENT_PALETTE.warmPale);
    expect(CELL_GALAXY_PALETTE.memoryViolet).toBe(SCENE_ACCENT_PALETTE.violet);
    // …and two that are NOT accents: the block ramp's dark end and death's own
    // signal, which belong to the surfaces that own them.
    expect(CONSENSUS_BRAID_PALETTE.deepCyan).not.toBe(SCENE_ACCENT_PALETTE.cyan);
    expect(Object.values(SCENE_ACCENT_PALETTE))
      .not.toContain(CONSENSUS_BRAID_PALETTE.retire);
  });

  it('keeps one hue per meaning: the pale pair is warm and cold, the gold is one hue', () => {
    // `pale` and `warmPale` are a PAIR, and B2's ruling is which surface takes
    // which — a specimen under instruments is cold, a body in tissue is warm.
    expect(SCENE_ACCENT_PALETTE.pale[2]).toBeGreaterThan(SCENE_ACCENT_PALETTE.pale[0]);
    expect(SCENE_ACCENT_PALETTE.warmPale[0])
      .toBeGreaterThan(SCENE_ACCENT_PALETTE.warmPale[2]);
    // The two golds are two VALUES of one hue: same order, same sign.
    const hue = (c: SceneColor) => Math.atan2(
      Math.sqrt(3) * (c[1] - c[2]), 2 * c[0] - c[1] - c[2],
    );
    expect(Math.abs(hue(SCENE_ACCENT_PALETTE.gold) - hue(SCENE_ACCENT_PALETTE.paleGold)))
      .toBeLessThan(0.2);
    // …and the violet is the WARM one of the family: it reads on rose tissue.
    expect(SCENE_ACCENT_PALETTE.violet[0]).toBeGreaterThan(0.5);
  });
});
