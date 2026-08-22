// The HUD's palette degrades the same way every time: somebody needs a colour
// mid-edit, types the hex inline, and the token quietly stops being the single
// source of that value. Four had already drifted that far — a white hero ink,
// the module registry's slate, the ground under every meter track, and a gold
// that was neither `lockedGold` nor `goldInk` but sat between them.
//
// So this file is a source oracle rather than a render test: it reads the HUD
// directory off disk and fails on the literal, naming the token that owns the
// value now. Nothing here renders, because the point is not what one component
// paints — it is that no component anywhere writes the number down again.
//
// The list is meant to grow. Every time a value earns a name in `hudTheme.ts`,
// ban the hex it used to be spelled as.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';

const HUD_DIR = resolve(process.cwd(), 'src/components/hud');

/** The one file allowed to write a hex down: that is what a palette IS.
 *  Everything else in the directory reads it. */
const PALETTE_SOURCE = 'hudTheme.ts';

const BANNED: ReadonlyArray<{
  /** How the value used to be spelled. Case-insensitive — `#0A0A0A` is the
   *  same drift as `#0a0a0a`, just typed by a different hand. */
  pattern: RegExp;
  /** The token that owns it now. */
  token: string;
  /** Files that may still carry it, each earning the exemption above. */
  exempt?: readonly string[];
}> = [
  { pattern: /#fff(?![0-9a-fA-F])/g, token: 'HUD_COLORS.heroInk' },
  {
    pattern: /#ffffff/gi,
    token: 'HUD_COLORS.heroInk',
    // The morphology lab's artwork hands this to `new THREE.Color(...)` — a
    // material parameter in the scene medium, not HUD ink, and outside the DOM
    // palette's jurisdiction for the same reason the type scale exempts the
    // in-scene marker dialect.
    exempt: ['CellMorphologyLabArtwork.tsx'],
  },
  { pattern: /#5a6470/gi, token: 'HUD_COLORS.moduleSlate' },
  { pattern: /#0a0a0a/gi, token: 'HUD_COLORS.trackGround' },
  // Drift not toward a token but BETWEEN two: `#FFD79A` splits the difference
  // between `lockedGold #FFD7A1` and `goldInk #FFD29A` and matched neither.
  { pattern: /#ffd79a/gi, token: 'HUD_COLORS.goldInk' },
];

/** Tokens promoted out of inline literals — each has to be read by somebody,
 *  or the ban above is guarding a value nothing uses. */
const PROMOTED = ['heroInk', 'moduleSlate', 'trackGround'] as const;

type HudSource = { name: string; text: string };

function readHudSources(): HudSource[] {
  const sources: HudSource[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path, name);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      sources.push({ name, text: readFileSync(path, 'utf8') });
    }
  };
  walk(HUD_DIR, '');
  return sources;
}

const SOURCES = readHudSources();

describe('hud discipline', () => {
  it('actually reads the HUD directory', () => {
    // A source oracle pointed at nothing passes everything. This is the pin
    // that makes the assertions below mean what they claim.
    expect(SOURCES.length).toBeGreaterThan(40);
    expect(SOURCES.map((source) => source.name)).toContain(PALETTE_SOURCE);
  });

  it.each(BANNED)('$token owns its value — no file spells $pattern', ({ pattern, token, exempt = [] }) => {
    const offenders = SOURCES
      .filter((source) => source.name !== PALETTE_SOURCE && !exempt.includes(source.name))
      .filter((source) => {
        pattern.lastIndex = 0;
        return pattern.test(source.text);
      })
      .map((source) => `${source.name} → say ${token}`);

    expect(offenders).toEqual([]);
  });

  it.each(PROMOTED)('%s is read outside the palette', (token) => {
    const readers = SOURCES.filter(
      (source) => source.name !== PALETTE_SOURCE
        && source.text.includes(`HUD_COLORS.${token}`),
    );

    // Not just "the token exists": a token nobody reads is an orphan, and the
    // ban that protects it is guarding an empty room.
    expect(readers.length).toBeGreaterThan(0);
    expect(HUD_COLORS[token]).toMatch(/^#[0-9A-F]{6}$/);
  });
});
