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
//
// The palette degrades a second way too, and this file guards that as well: two
// tokens quietly holding the SAME value. `warning` was chrome orange to the
// digit, which meant the middle severity had a name, a doc comment, and no
// color — every warning the HUD ever raised looked like part of the frame.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HUD_COLORS, HUD_TYPE } from '../../../src/components/hud/hudTheme';
import {
  ASSET_COLORS,
  CLASS_MIX_COLORS,
  LOCK_COLORS,
} from '../../../src/components/hud/cellFormat';
import { SEGMENT_COLORS } from '../../../src/components/hud/CellByteBudget';
import { CELL_GALAXY_PALETTE } from '../../../src/visualPalette';

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

/** Straight euclidean distance across the RGB cube. A crude stand-in for "a
 *  person can tell these apart" — crude on purpose, because the job here is to
 *  catch one token being retyped as another's value, not to model vision. */
function rgbDistance(a: string, b: string): number {
  const channels = (hex: string): number[] => {
    const h = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

/** Below this, two colors are the same color wearing two names. */
const SEPARATION_FLOOR = 40;

/** A scene colour written the way the HUD writes colours. The stage palette
 *  keeps float triples for three.js; a HUD token derived from one has to be
 *  comparable to the hexes it will sit beside. */
function sceneHex(color: readonly [number, number, number]): string {
  return `#${color
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

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

  it('warning is its own color, not chrome orange wearing a semantic name', () => {
    // The finding this pins: `warning` shipped as `#FF9830` — the exact hex the
    // entire HUD frame is painted in. Retuning the amber is fine and expected;
    // sliding it back onto the chrome hue is the regression.
    expect(HUD_COLORS.warning).not.toBe(HUD_COLORS.orange);
    expect(rgbDistance(HUD_COLORS.warning, HUD_COLORS.orange))
      .toBeGreaterThan(SEPARATION_FLOOR);
  });

  it('warning does not collapse into caution on the other side', () => {
    // Amber only buys a rung if it is a rung: the ramp needs daylight between
    // caution yellow and warning amber as much as between amber and chrome.
    expect(rgbDistance(HUD_COLORS.warning, HUD_COLORS.caution))
      .toBeGreaterThan(SEPARATION_FLOOR);
  });

  it('cellRose is the stage organism brightened, not a second rose', () => {
    // The whole point of the token: the panel that counts Cells and the Cells
    // themselves are the same colour. Brightening for 8.5px legibility is
    // expected and is why this is a neighbourhood rather than an equality;
    // re-hueing is the regression, because then the HUD is pointing at a
    // creature the stage does not have.
    expect(rgbDistance(HUD_COLORS.cellRose, sceneHex(CELL_GALAXY_PALETTE.tissueRose)))
      .toBeLessThanOrEqual(45);
  });

  it('cellRose cannot be read as a small alarm', () => {
    // Both are reds, and one of them means something is wrong. The bar is not
    // just the floor: the identity has to sit FARTHER from danger than it does
    // from the tissue it was lifted out of, or it has stopped naming the
    // organism and started looking like a warning nobody raised.
    const toDanger = rgbDistance(HUD_COLORS.cellRose, HUD_COLORS.danger);
    const toTissue = rgbDistance(
      HUD_COLORS.cellRose,
      sceneHex(CELL_GALAXY_PALETTE.tissueRose),
    );
    expect(toDanger).toBeGreaterThan(SEPARATION_FLOOR);
    expect(toDanger).toBeGreaterThan(toTissue);
  });

  it('the two mesh identities are a pair, not a shade', () => {
    // A2, pinned: `cyanWire` and `peerWire` sit ~15 apart, which is why MESH·02
    // and MESH·03 stopped reading as two panels about two different things.
    // Whatever the cell identity is retuned to, it has to clear the peer plane.
    expect(rgbDistance(HUD_COLORS.cellRose, HUD_COLORS.peerWire))
      .toBeGreaterThan(SEPARATION_FLOOR);
  });
});

// ——— The reserve ————————————————————————————————————————————————————————
//
// Three layers, and only one of them may name a state. Semantics
// (nominal/caution/warning/danger/crit) mean health and nothing else; chrome
// orange is the instrument's own frame; the two mesh wires are identity. A
// content category — a lock family, an asset family, a class of the census, a
// byte segment — is none of those: it names WHAT a thing is, so borrowing a
// reserved hue makes an ordinary cell look like a raised alarm.
//
// The tables are walked programmatically rather than listed, so a seventh
// lock kind or a fifth byte segment added next year is checked the day it
// lands, without anyone remembering this file exists.

/** Every reserved hue a content category has to stay clear of. */
const RESERVED: Readonly<Record<string, string>> = {
  nominal: HUD_COLORS.nominal,
  caution: HUD_COLORS.caution,
  warning: HUD_COLORS.warning,
  danger: HUD_COLORS.danger,
  crit: HUD_COLORS.crit,
  orange: HUD_COLORS.orange,
  orangeDeep: HUD_COLORS.orangeDeep,
  cyanWire: HUD_COLORS.cyanWire,
  peerWire: HUD_COLORS.peerWire,
  cellRose: HUD_COLORS.cellRose,
};

/** Every palette that colours content, by the surface it paints. */
const CATEGORY_PALETTES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  lock: LOCK_COLORS,
  asset: ASSET_COLORS,
  classMix: CLASS_MIX_COLORS,
  byteSegment: SEGMENT_COLORS,
};

/** The sanctioned borrows, each `<palette>.<key> → <reserved>`, and each one
 *  argued rather than grandfathered.
 *
 *  Only one borrow is allowed and it is from the identity layer, never from
 *  the semantics: the default lock and bare CKB ARE plain consensus content,
 *  so they take the colour consensus already wears, and the byte bar's DATA
 *  segment joins them because a Cell's own bytes are the same kind of fact.
 *  `state` is the one place a semantic tone is still correct on these
 *  surfaces, and it is a branch in `selectedCellScanAccent` rather than a
 *  token, so it needs no row here.
 *
 *  Each borrow costs two rows because `cyanWire` and `peerWire` are ~15 apart
 *  — the twin-mesh collapse the palette review filed as A2. Borrow one and you
 *  have borrowed both. When that pair separates, the peerWire rows here start
 *  failing as stale permission slips, which is exactly the reminder we want. */
const SANCTIONED_BORROWS: ReadonlySet<string> = new Set([
  'lock.sighash → cyanWire',
  'lock.sighash → peerWire',
  'asset.native → cyanWire',
  'asset.native → peerWire',
  'byteSegment.data → cyanWire',
  'byteSegment.data → peerWire',
]);

describe('the colour reserve', () => {
  it('has palettes to check at all', () => {
    // Same pin as the source oracle above: an empty matrix asserts nothing.
    const tokens = Object.values(CATEGORY_PALETTES)
      .flatMap((palette) => Object.keys(palette));
    expect(tokens.length).toBeGreaterThanOrEqual(18);
    expect(Object.keys(RESERVED).length).toBeGreaterThanOrEqual(9);
  });

  it.each(Object.keys(CATEGORY_PALETTES))(
    'no %s category wears a reserved colour',
    (surface) => {
      const palette = CATEGORY_PALETTES[surface];
      const collisions: string[] = [];
      for (const [key, value] of Object.entries(palette)) {
        for (const [reservedName, reservedValue] of Object.entries(RESERVED)) {
          const pair = `${surface}.${key} → ${reservedName}`;
          if (SANCTIONED_BORROWS.has(pair)) continue;
          if (rgbDistance(value, reservedValue) > SEPARATION_FLOOR) continue;
          collisions.push(`${pair} (${value} vs ${reservedValue})`);
        }
      }

      expect(collisions).toEqual([]);
    },
  );

  it.each([...SANCTIONED_BORROWS])('%s is a borrow, not an accident', (pair) => {
    // An allowlist entry for a borrow nobody makes any more is a permission
    // slip for a rule that already holds — it should be deleted, and this
    // says so the moment the borrow ends.
    const [left, reservedName] = pair.split(' → ');
    const [surface, key] = left.split('.');
    const value = CATEGORY_PALETTES[surface][key];
    expect(value).toBeTypeOf('string');
    expect(rgbDistance(value, RESERVED[reservedName]))
      .toBeLessThanOrEqual(SEPARATION_FLOOR);
  });

  it('categories that share a bar stay apart from each other', () => {
    // Reserved-layer discipline is only half of legibility: two members of the
    // SAME bar landing on one hue makes a stacked bar unreadable no matter how
    // far both sit from the semantics. Across bars is fine and deliberate —
    // kinds that share a nature share a band.
    const collisions: string[] = [];
    for (const [surface, palette] of Object.entries(CATEGORY_PALETTES)) {
      const entries = Object.entries(palette);
      for (let i = 0; i < entries.length; i += 1) {
        for (let j = i + 1; j < entries.length; j += 1) {
          const distance = rgbDistance(entries[i][1], entries[j][1]);
          if (distance > SEPARATION_FLOOR) continue;
          collisions.push(
            `${surface}.${entries[i][0]} ~ ${surface}.${entries[j][0]} (${distance.toFixed(1)})`,
          );
        }
      }
    }

    expect(collisions).toEqual([]);
  });
});

// ——— One scale ——————————————————————————————————————————————————————————
//
// The HUD used to run two type systems side by side: the declared five-step
// scale on the inspection surfaces, and a freelance dialect in the panels that
// had drifted to 9.5, 6.8, and five unranked hero sizes. `HUD_TYPE` now covers
// the whole DOM overlay, and this is the oracle that keeps it that way — every
// size a DOM-dialect file renders has to be one of the declared rungs.
//
// The exemption is PROGRAMMATIC on purpose. A file that imports from `three` or
// `@react-three/*` is drawing inside the canvas, under a camera and a bloom
// pass — a different medium with a different legibility floor, where 6.4px is a
// marker rather than a caption. Deciding that by imports rather than by a
// hand-kept filename list means the rule maintains itself: a new in-scene
// overlay is exempt the day it is written, and a scene file that stops
// importing three has stopped being scene dialect and starts being checked.

const SCENE_DIALECT = /from '(three|@react-three\/[a-z-]+)'/;

/** The React style prop — the way most of the HUD writes a size down. */
const FONT_SIZE_PROP = /fontSize:\s*(\d+(?:\.\d+)?)/g;

/** …and the CSS `font:` shorthand the top bar's controls use to carry a line
 *  height along with their size. Missing this form is how four 8.5px controls
 *  hid from an earlier sweep. */
const FONT_SHORTHAND = /font:\s*`([^`]*)`/g;

/** Inside a shorthand, only the SIZE is a type size: `400 8.5px/20px …` also
 *  contains a 20px line height, which belongs to no scale and must not be
 *  checked against one. The size is the length before the slash — or, when the
 *  shorthand omits the line height, the only length there is. A size written as
 *  a `${HUD_TYPE.x}` interpolation yields nothing to check, which is the point
 *  of writing it that way. */
const SHORTHAND_SIZE_BEFORE_SLASH = /(\d+(?:\.\d+)?)px\s*\//;
const SHORTHAND_FIRST_LENGTH = /(\d+(?:\.\d+)?)px/;

const DECLARED_SIZES: ReadonlySet<number> = new Set(Object.values(HUD_TYPE));

function domDialect(): HudSource[] {
  return SOURCES.filter((source) => !SCENE_DIALECT.test(source.text));
}

function sizesIn(text: string): number[] {
  const found: number[] = [];

  FONT_SIZE_PROP.lastIndex = 0;
  let prop = FONT_SIZE_PROP.exec(text);
  while (prop !== null) {
    found.push(Number(prop[1]));
    prop = FONT_SIZE_PROP.exec(text);
  }

  FONT_SHORTHAND.lastIndex = 0;
  let shorthand = FONT_SHORTHAND.exec(text);
  while (shorthand !== null) {
    const value = shorthand[1];
    const size = value.includes('/')
      ? SHORTHAND_SIZE_BEFORE_SLASH.exec(value)
      : SHORTHAND_FIRST_LENGTH.exec(value);
    if (size) found.push(Number(size[1]));
    shorthand = FONT_SHORTHAND.exec(text);
  }

  return found;
}

describe('one type scale', () => {
  it('sorts the HUD into dialects, and finds both of them', () => {
    // The pin again: if the scene filter ever matched everything, the
    // membership assertion below would be checking an empty list.
    const dom = domDialect();
    const scene = SOURCES.filter((source) => SCENE_DIALECT.test(source.text));
    expect(dom.length).toBeGreaterThan(30);
    expect(scene.length).toBeGreaterThan(0);
    expect(scene.map((source) => source.name)).toContain('ConsensusMemory.tsx');
  });

  it('the scale is a ladder — every rung distinct, micro at the floor', () => {
    const rungs = Object.values(HUD_TYPE);
    expect(new Set(rungs).size).toBe(rungs.length);
    expect(Math.min(...rungs)).toBe(HUD_TYPE.micro);
    expect(HUD_TYPE.micro).toBe(7.5);
  });

  it('every DOM-dialect size is a declared rung', () => {
    const offenders: string[] = [];
    for (const source of domDialect()) {
      for (const size of sizesIn(source.text)) {
        if (DECLARED_SIZES.has(size)) continue;
        offenders.push(`${source.name}: ${size}px is not a rung of HUD_TYPE`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('nothing in the DOM overlay is written below the legibility floor', () => {
    // Stated separately from membership because it is a different promise. A
    // future rung could be added below 7.5 and pass the test above; this one
    // says that would itself be the mistake.
    const belowFloor = domDialect().flatMap((source) => sizesIn(source.text)
      .filter((size) => size < HUD_TYPE.micro)
      .map((size) => `${source.name}: ${size}px`));

    expect(belowFloor).toEqual([]);
  });
});
