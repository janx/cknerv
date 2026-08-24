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

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CELL_CARD_ACCENT,
  CELL_PANEL_ACCENT,
  HUD_COLORS,
  HUD_TYPE,
  QUALITATIVE_BUCKET_COLORS,
  rgba,
} from '../../../src/components/hud/hudTheme';
import {
  PANEL_WATERMARK_PX,
  PLATE_CUT_CLIP,
  PLATE_CUT_PX,
} from '../../../src/components/hud/primitives';
import {
  ASSET_COLORS,
  CLASS_MIX_COLORS,
  CONTENT_BANDS,
  LOCK_COLORS,
  SEGMENT_COLORS,
  STORAGE_TIER_COLORS,
} from '../../../src/components/hud/cellFormat';
import {
  ACTIVITY_CATEGORY_COLORS,
  ACTIVITY_UNLISTED_COLOR,
} from '../../../src/derives/activityFeed.derive';
import {
  ECOSYSTEM_CATEGORY_COLORS,
  ECOSYSTEM_UNLISTED_COLOR,
} from '../../../src/derives/assetEcosystem.derive';
import { SCRIPT_FAMILY_COLORS } from '../../../src/derives/scriptFamilies.derive';
import { compositionTierColor } from '../../../src/components/hud/CellSemanticsReadout';
import { fpsColor } from '../../../src/tweaks/renderStatsStore';
import { CELL_GALAXY_PALETTE, CHAIN_ANCHOR_HEX } from '../../../src/visualPalette';

const HUD_DIR = resolve(process.cwd(), 'src/components/hud');

/** The whole package, for the one palette entry that does NOT live in the HUD
 *  directory: `CHAIN_ANCHOR_HEX` has readers on both sides of the canvas
 *  boundary, so an oracle about it that only read the overlay would be asking
 *  half the question. */
const SRC_DIR = resolve(process.cwd(), 'src');

/** And the app shell, for the one promoted token with no reader in this
 *  package at all: the stage's ground is painted where the Canvas is mounted,
 *  which is `ui-app`. The palette owns the value either way — a colour the HUD
 *  sits on top of is the HUD's business — but an oracle that only read the
 *  overlay would call the token an orphan and be confidently wrong, which is
 *  the same mistake in the other direction. */
const APP_DIR = resolve(process.cwd(), '../../ui-app/src');

/** The one file allowed to write a hex down: that is what a palette IS.
 *  Everything else in the directory reads it. Named on its own, because three
 *  rules below are about `HUD_COLORS` specifically — who reads a promoted
 *  token, who reads `termGreen`, who reads `crit` — and for those the question
 *  is "outside the HUD's own palette", not "outside any palette". */
const PALETTE_SOURCE = 'hudTheme.ts';

/** …and every file that IS a palette, for the rule that is about a value
 *  having one home rather than about one table's readers.
 *
 *  It was a single filename for as long as the ban list only guarded
 *  `HUD_COLORS`, and that was the reason the ban list only ever guarded
 *  `HUD_COLORS`: `CONTENT_BANDS` lives in `cellFormat.ts` and the stage's own
 *  hexes live in `visualPalette.ts`, so banning a band's value would have gone
 *  red on the table that defines it. A palette is a palette wherever it is
 *  kept, and the bands are now protected the same way the HUD's tokens are.
 *
 *  Matched on the BASENAME, because the same file arrives under two names: the
 *  HUD sweep walks `src/components/hud` and calls it `cellFormat.ts`, the
 *  package sweep walks `src` and calls it `components/hud/cellFormat.ts`. */
const PALETTE_SOURCES: ReadonlySet<string> = new Set([
  'hudTheme.ts',
  'cellFormat.ts',
  'visualPalette.ts',
]);

function isPaletteSource(name: string): boolean {
  return PALETTE_SOURCES.has(name.slice(name.lastIndexOf('/') + 1));
}

/** The same arrangement one axis over: the one file allowed to describe a
 *  shape. Everything else in the directory wears one. */
const SHAPE_SOURCE = 'primitives.tsx';

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
  // The same track, declined twice. An epoch gauge, a colony bar and a
  // transaction histogram wrote their own near-black channel instead of the
  // token that already describes the empty half of every meter in the HUD —
  // and the two spellings sit 4.2 apart, which is not two decisions, it is one
  // colour typed by two hands.
  { pattern: /#050a10/gi, token: 'HUD_COLORS.trackGround' },
  { pattern: /#080d10/gi, token: 'HUD_COLORS.trackGround' },
  // Drift not toward a token but BETWEEN two: `#FFD79A` splits the difference
  // between `lockedGold #FFD7A1` and `goldInk #FFD29A` and matched neither.
  { pattern: /#ffd79a/gi, token: 'HUD_COLORS.goldInk' },
  // The same gold, drifted the same way, in five files at once: `#FFD48C` sat
  // 14.1 from `goldInk` and 21.2 from `lockedGold` and was neither. It is the
  // WHEN proof's colour — the birth-anchor label, the glyph arm that points at
  // it, the marker's terminal ring, the lab column that reviews all three — so
  // it is one value meaning one thing, and it now says `goldInk` in all of
  // them. The alpha form went with it: `rgba(255, 212, 140, …)` was the same
  // colour retyped as the decimal triple its hex expands to, which is exactly
  // how `crit` hid from every sweep this file has ever run.
  { pattern: /#ffd48c/gi, token: 'HUD_COLORS.goldInk' },
  { pattern: /rgba\(\s*255\s*,\s*212\s*,\s*140/gi, token: 'rgba(HUD_COLORS.goldInk, …)' },
  // A tier four panels used and nobody named. The legend under a bucket bar is
  // neither the label above it nor the readings around it, so four files typed
  // the in-between out longhand. A fifth typed it for a DIFFERENT job —
  // `derives/activityFeed.derive.ts` painted a category it could not name in
  // it, so a text tier was doing duty as a category colour — and that one was
  // out of reach, because this sweep only ever read the HUD directory. It
  // reads `derives/` too now, and the feed's unnameable category takes
  // `CONTENT_BANDS.unlisted` like every other family nothing could place.
  { pattern: /#9fb0bd/gi, token: 'HUD_COLORS.legendInk' },
  // Banned in a directory it never appeared in, which is the point: the stage's
  // ground is painted by the app shell that mounts the Canvas, and the overlay
  // reaching for it by hand is how the value would come back.
  { pattern: /#02030a/gi, token: 'HUD_COLORS.stageGround' },
  // Two text tiers retyped a hair off themselves, on a pair of scene markers
  // the sweep had never been able to reach. The consensus-memory endpoints
  // print their metadata 18.7 from `dim` and their content line 30.3 from
  // `moduleSlate` — both inside the floor, which is this file's own definition
  // of one colour wearing two names, and both invisible until `nerve/` came
  // inside the fence. The two-step hierarchy they were reaching for is the one
  // the tokens already describe: a reading, then an address under it.
  { pattern: /#7b8ca6/gi, token: 'HUD_COLORS.dim' },
  { pattern: /#56738a/gi, token: 'HUD_COLORS.moduleSlate' },
  // The causal lens' four endpoint labels, which are the DOM half of four scene
  // arcs. A sibling output was painted the frame's own hex — a content role in
  // the instrument's colour, which is the reserve's whole subject — an input sat
  // 13.3 from the violet the consensus-memory surfaces already use for exactly
  // that, the identity-only fallback was a character-for-character copy of a
  // content band, and the `· FOLLOW` suffix spelled `ink` out longhand.
  { pattern: /#ff9830/gi, token: 'HUD_COLORS.orange' },
  { pattern: /#9d8bff/gi, token: 'HUD_COLORS.memory' },
  { pattern: /#e8e8e8/gi, token: 'HUD_COLORS.ink' },
  // The first two bans this file has ever made on behalf of `CONTENT_BANDS`,
  // and the reason `PALETTE_SOURCES` had to stop being one filename. The band
  // system has been the house's content palette for as long as the reserve
  // matrix has walked it, and its values were protected only where somebody
  // remembered to import the table.
  { pattern: /#9d7bd8/gi, token: 'CONTENT_BANDS.script' },
  { pattern: /#33424f/gi, token: 'CONTENT_BANDS.unlisted' },
  // Two text tiers under the chain anchor's label, 28.0 and 15.5 off the rungs
  // they were reaching for, and a third on the identity proof's evidence line
  // at 16.0. The last of those is the one that could not have been banned
  // before this commit: `CellIdentityBindingGlyph` spells the same value four
  // times as a `THREE.Color` and as two material props, and a material may keep
  // a private value. The ban lands on the DOM spelling only because the sweep
  // now reads the construct rather than the file.
  { pattern: /#86aab2/gi, token: 'HUD_COLORS.legendInk' },
  { pattern: /#d8f8fb/gi, token: 'HUD_COLORS.cyanInk' },
  { pattern: /#d9f8ff/gi, token: 'HUD_COLORS.cyanInk' },
  // A cell's bytes, decomposed, spelled a THIRD time. `SEGMENT_COLORS` was
  // moved into `cellFormat.ts` so the dossier's bar and the stage's composition
  // orbit could share one table; the portrait's occupied-byte ring kept its own
  // anyway, with a capacity arc 14.0 from chrome orange and a data arc 39.2
  // from `warning`. Three of the four are banned; the data segment's amber is
  // not, because `CellMorphologyLabArtwork`'s lab-only strand ramp still spells
  // it, and a ban that needs a file exempted from it is the trade this file
  // exists to refuse.
  { pattern: /#fb923c/gi, token: 'SEGMENT_COLORS.cap' },
  { pattern: /#67e8f9/gi, token: 'SEGMENT_COLORS.lock' },
  { pattern: /#86efac/gi, token: 'SEGMENT_COLORS.type' },
  // Not a hex, which is how it hid from every sweep this file has ever run:
  // `crit` was retyped as the decimal triple its hex expands to, because the
  // one surface that uses it needs an alpha and reached for the rgba form
  // rather than the helper that builds one from a token.
  { pattern: /rgba\(\s*139\s*,\s*0\s*,\s*0/gi, token: 'rgba(HUD_COLORS.crit, …)' },
];

/** Tokens promoted out of inline literals — each has to be read by somebody,
 *  or the ban above is guarding a value nothing uses. */
const PROMOTED = [
  'heroInk',
  'moduleSlate',
  'trackGround',
  'legendInk',
  'stageGround',
] as const;

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

/** Hue in degrees, or `null` for a colour that has none. Everything else in
 *  this file measures RGB distance, and on purpose: distance answers "can a
 *  reader tell these two apart". Exactly one claim in the palette is about a
 *  SECTOR instead of a pair — the qualitative ramp's green exclusion — and a
 *  sector is a statement about hue, so it needs the other measurement. */
function hueDegrees(hex: string): number | null {
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  if (span === 0) return null;
  const sextant = max === r
    ? ((g - b) / span) % 6
    : (max === g ? (b - r) / span + 2 : (r - g) / span + 4);
  return (sextant * 60 + 360) % 360;
}

/** Yellow-green through spring-green, about 45° either side of the two greens
 *  the palette already owns: `nominal` sits at 134° and `termGreen` at 120°.
 *  Gold at 50° and the ramp's cyan at 180° are outside it with room to spare. */
const GREEN_SECTOR: readonly [number, number] = [75, 165];

/** A colour written out by hand, in any of the forms one gets typed. */
const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/g;

/** A scene colour written the way the HUD writes colours. The stage palette
 *  keeps float triples for three.js; a HUD token derived from one has to be
 *  comparable to the hexes it will sit beside. */
function sceneHex(color: readonly [number, number, number]): string {
  return `#${color
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** A source with its comments taken out. This file is a text oracle, and a
 *  file's prose talks about the same tokens its code reads — so any question of
 *  the form "does anything actually USE this" has to be asked of what runs. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

type HudSource = { name: string; text: string };

function readSources(root: string): HudSource[] {
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
  walk(root, '');
  return sources;
}

const SOURCES = readSources(HUD_DIR);
const APP_SOURCES = readSources(APP_DIR);

/** The whole package, walked once. The oracles down the file need it — the
 *  chain anchor's readers and the cell card's surfaces both straddle the canvas
 *  boundary, so neither can be asked of the HUD directory alone — and the
 *  jurisdiction below is carved out of it. */
const PACKAGE_SOURCES = readSources(SRC_DIR);

/** Everywhere a colour has a MEANING, which is a different question from where
 *  it is drawn. `derives/` renders nothing: it hands components the colour a
 *  bucket, a byte segment or a feed category will be painted in — and being
 *  outside the HUD directory made all of that invisible to every rule in this
 *  file, which is how four palettes drifted there at once. One was a
 *  straight DUPLICATE of a table already checked in the matrix below.
 *  `tweaks/` is the render plumbing behind GL·08, and it held a private
 *  three-rung severity ramp in Tailwind defaults.
 *
 *  `nerve/` is the third, and it is the one occupant that DRAWS: the fabric,
 *  the bridges and the consensus-memory endpoint markers, the last of which
 *  are DOM labels pinned over the stage through drei's `Html`. It is here
 *  because a colour typed there is the same defect as a colour typed anywhere
 *  else — the markers had a grey 18.7 off `dim` and a second 30.3 off
 *  `moduleSlate`, which is one text tier wearing two names — and because the
 *  Chinese on those markers is the same load-bearing inventory entry as the
 *  Chinese on a panel.
 *
 *  What travels with the widening and what does not. The ban list above is
 *  about a value having one home, and a value has one home wherever it is
 *  typed, so it travels. The type ladder further down is about a medium — a
 *  rung is a reading size on a screen — and none of these directories renders
 *  in that medium, so it stays where it is. Half of `tweaks/` imports
 *  `@react-three/fiber` and would be sorted into the scene dialect anyway,
 *  which is the same answer arrived at twice; `nerve/` is that dialect
 *  outright, where 7px is a marker under a camera rather than a caption, so
 *  neither the ladder nor the shape grammar follows the colours in. Those two
 *  read `SOURCES`, which is the HUD directory and stops there.
 *
 *  Scoped by directory rather than by exemption, deliberately. `materials/` is
 *  a sibling of these and builds THREE colours for the bloom pass; a sweep that
 *  reached it would need a file exempted from a rule it was never the subject
 *  of, and an exemption list is the debt this file is paying off. */
const INK_JURISDICTION = /^(derives|nerve|tweaks)\//;

/** And the one directory a NAME cannot fence, because it is the one that
 *  genuinely mixes dialects. `components/` holds DOM overlays, drei `Html`
 *  labels pinned over the stage, and pure three.js material tints that are
 *  legitimately their own values under their own blending — often three of
 *  those in one file. Fencing it by directory would either miss the ink or
 *  police the materials; the first is how a role label came to be painted in
 *  the instrument's own frame colour, the second is how a rule acquires an
 *  exemption list.
 *
 *  So the jurisdiction here is by CONSTRUCT, and the classifier below is what
 *  draws the line. `components/hud/` is not in it: the HUD directory is swept
 *  whole by `SOURCES` and always has been, which is the stricter arrangement
 *  and the one that has been holding. */
const MIXED_INK_JURISDICTION = /^components\/[^/]+\.tsx?$/;

const MIXED_SOURCES = PACKAGE_SOURCES
  .filter((source) => MIXED_INK_JURISDICTION.test(source.name));

const INK_SOURCES = [
  ...SOURCES,
  ...PACKAGE_SOURCES.filter((source) => INK_JURISDICTION.test(source.name)),
  ...MIXED_SOURCES,
];

// ——— Which grammar a colour was written in ——————————————————————————————
//
// Two rules, and a hex belongs to exactly one of them:
//
//   DOM ink        a CSS property, a template string, a drei `Html` subtree.
//                  The token single-source rule applies in full — the ban list
//                  above is the HUD's palette speaking, and this is where it
//                  has jurisdiction.
//
//   scene material a `THREE.Color`, a material or light element's colour prop,
//                  a canvas texture's gradient stop. Only the reserve applies:
//                  a category or a state may not borrow a reserved hue, but
//                  the value itself may stay private, because it is a
//                  parameter of a surface under a camera rather than ink on a
//                  panel.
//
// The material forms are recognised POSITIVELY and everything else falls to
// ink, which is the strict side on purpose. A classifier that guessed
// "material" when it could not tell would hand every future hex a free pass
// while looking like a rule; guessing "ink" costs a file nothing unless it has
// typed out a value that already has a name, and a file that genuinely wants
// the other answer can say so by writing the construct.

/** A colour handed to three by a CALL. Anchored at the hex, so the question is
 *  "is this literal an argument to one of these" rather than "does the file
 *  mention them somewhere". No brace or semicolon may intervene, which is what
 *  holds the answer to a single expression. */
const SCENE_COLOR_CALL = /(?:new\s+THREE\.Color|new\s+Color|\.color\.set|\.setStyle|\.setHex|setClearColor|addColorStop|fillStyle\s*=|strokeStyle\s*=)\s*\(?[^;{}]{0,120}$/;

/** …and a colour handed to three by a PROP. The innermost element still open
 *  where the hex is written is the one wearing it, and the tag name is the
 *  whole difference: `<meshBasicMaterial color="…">` is a material parameter,
 *  `<div style={{ color: '…' }}>` is ink. */
const SCENE_ELEMENT = /(?:Material|Light)$/;

/** The DOM's own spelling, recognised positively rather than left to the
 *  default. Not for tidiness: the pin below has to be able to require a
 *  non-empty INK set on its own merits, or a classifier that had quietly
 *  stopped recognising anything would pass every rule by checking nothing. */
const CSS_COLOR_PROPERTY = /(?:^|[\s{;,(])(?:color|background|backgroundColor|border[A-Za-z]*|outline[A-Za-z]*|boxShadow|textShadow|textDecorationColor|caretColor|accentColor|fill|stroke)\s*:\s*(?:['"`][^'"`]*)?$/;

type Dialect = 'ink' | 'material';

type HexSite = {
  hex: string;
  start: number;
  end: number;
  dialect: Dialect;
  /** Which recogniser answered, so a pin can say more than "one of them did". */
  via: string;
};

/** The JSX element whose attribute list the offset sits in, or `null` when it
 *  sits in element CONTENT or in no element at all. Found by position rather
 *  than by parsing: the last `<` before the hex opens a tag we are still
 *  inside exactly when no `>` has closed one since. */
function openElementTag(before: string): string | null {
  const open = before.lastIndexOf('<');
  if (open < 0 || open < before.lastIndexOf('>')) return null;
  const name = /^<\/?([A-Za-z][\w.]*)/.exec(before.slice(open, open + 48));
  return name ? name[1] : null;
}

/** Every hex in a source, with the grammar it was written in. */
function hexSites(text: string): HexSite[] {
  const sites: HexSite[] = [];
  HEX_LITERAL.lastIndex = 0;
  let match = HEX_LITERAL.exec(text);
  while (match !== null) {
    const before = text.slice(0, match.index);
    const tag = openElementTag(before);
    let dialect: Dialect = 'ink';
    let via = 'ink: unclassified';
    if (SCENE_COLOR_CALL.test(before.slice(-200))) {
      dialect = 'material';
      via = 'material: THREE colour call';
    } else if (tag !== null && SCENE_ELEMENT.test(tag)) {
      dialect = 'material';
      via = `material: <${tag}> prop`;
    } else if (CSS_COLOR_PROPERTY.test(before.slice(-120))) {
      via = 'ink: CSS property';
    }
    sites.push({
      hex: match[0],
      start: match.index,
      end: match.index + match[0].length,
      dialect,
      via,
    });
    match = HEX_LITERAL.exec(text);
  }
  return sites;
}

/** The source as the INK rules see it: everything the scene owns painted out,
 *  so a material parameter cannot answer a question that was never asked of
 *  it. Spliced from the end so the earlier offsets stay true. */
function maskSceneMaterials(text: string): string {
  let masked = text;
  const material = hexSites(text).filter((site) => site.dialect === 'material');
  for (let index = material.length - 1; index >= 0; index -= 1) {
    const site = material[index];
    masked = `${masked.slice(0, site.start)}<scene material>${masked.slice(site.end)}`;
  }
  return masked;
}

/** What the ban list reads. The single-dialect directories hand over their raw
 *  text, comments and all — a comment that types a colour out is how the next
 *  one gets pasted back in. The mixed directory hands over its ink. */
function inkText(source: HudSource): string {
  return MIXED_INK_JURISDICTION.test(source.name)
    ? maskSceneMaterials(source.text)
    : source.text;
}

describe('hud discipline', () => {
  it('actually reads the HUD directory', () => {
    // A source oracle pointed at nothing passes everything. This is the pin
    // that makes the assertions below mean what they claim.
    expect(SOURCES.length).toBeGreaterThan(40);
    expect(SOURCES.map((source) => source.name)).toContain(PALETTE_SOURCE);
    // …and the shell beside it, where the ground is painted.
    expect(APP_SOURCES.map((source) => source.name)).toContain('App.tsx');
  });

  it('reaches the directories that hand the HUD its colours', () => {
    // Same pin one directory over. A jurisdiction that quietly matched nothing
    // would leave the ban list green over a file spelling every value it bans.
    const names = INK_SOURCES.map((source) => source.name);
    expect(names).toContain('derives/activityFeed.derive.ts');
    expect(names).toContain('tweaks/renderStatsStore.ts');
    expect(names).toContain('nerve/ConsensusMemoryMarkers.tsx');
    expect(names.filter((name) => INK_JURISDICTION.test(name)).length)
      .toBeGreaterThan(20);

    // And stops where it was scoped to stop. A scene-material file swept by an
    // ink rule would need exempting from it, which is the thing this scoping
    // exists to make unnecessary.
    expect(names.some((name) => name.startsWith('materials/'))).toBe(false);

    // …and the other half of the `nerve/` ruling, pinned where a reader will
    // look for it: the colour rules follow the value into the scene, the type
    // ladder and the shape grammar do not follow it anywhere. Both of those
    // read `SOURCES`, so this is what keeps them off a dialect that draws at
    // 7px under a camera on purpose.
    expect(SOURCES.some((source) => source.name.startsWith('nerve/'))).toBe(false);

    // The mixed directory, same pin. It is fenced by construct rather than by
    // name, but it still has to BE here — a jurisdiction that matched nothing
    // would leave the ban list green over the files it was widened for.
    const mixed = MIXED_SOURCES.map((source) => source.name);
    expect(mixed.length).toBeGreaterThan(20);
    expect(mixed).toContain('components/CellCausalLensLayer.tsx');
    expect(mixed).toContain('components/CellGalaxy.tsx');
    expect(mixed).toContain('components/CellIdentityBindingGlyph.tsx');
    // …and stops at the HUD directory, which is swept whole and stays that way.
    expect(mixed.some((name) => name.startsWith('components/hud/'))).toBe(false);
  });

  it('the two bans made on behalf of the bands still name the bands', () => {
    // A ban is a claim that a value has a home. These two are the first this
    // file has made about `CONTENT_BANDS` rather than `HUD_COLORS`, and a
    // retune of either band would leave the ban guarding a value nothing holds
    // any more while the new one went unprotected — which is the same defect
    // the ban exists to catch, one level up.
    expect(CONTENT_BANDS.script).toBe('#9D7BD8');
    expect(CONTENT_BANDS.unlisted).toBe('#33424F');
    const banned = BANNED.map((rule) => rule.pattern.source);
    expect(banned).toContain('#9d7bd8');
    expect(banned).toContain('#33424f');
  });

  it.each(BANNED)('$token owns its value — no file spells $pattern', ({ pattern, token, exempt = [] }) => {
    const offenders = INK_SOURCES
      .filter((source) => !isPaletteSource(source.name) && !exempt.includes(source.name))
      .filter((source) => {
        pattern.lastIndex = 0;
        return pattern.test(inkText(source));
      })
      .map((source) => `${source.name} → say ${token}`);

    expect(offenders).toEqual([]);
  });

  it.each(PROMOTED)('%s is read outside the palette', (token) => {
    const readers = [...SOURCES, ...APP_SOURCES].filter(
      (source) => source.name !== PALETTE_SOURCE
        && source.text.includes(`HUD_COLORS.${token}`),
    );

    // Not just "the token exists": a token nobody reads is an orphan, and the
    // ban that protects it is guarding an empty room.
    expect(readers.length).toBeGreaterThan(0);
    expect(HUD_COLORS[token]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('the knockout and the ground the stage sits on are two jobs', () => {
    // These land ten apart and that is not the drift this file hunts — the
    // distance rule is about colours a reader has to tell APART, and no surface
    // shows these two together. `ground` is a knockout: the black read back out
    // through a filled severity's letters and through the hole in a scrubber
    // marker, so it has to be absolute, because a knockout with a hue is a
    // fill. `stageGround` is a painted surface — the one value the CSS under
    // the canvas, the scene's clear and the body behind both have to agree on.
    //
    // Pinned because the mismatch ran the whole life of the palette: the token
    // called `ground` was never the ground, so the stage's black had no home
    // and lived as a literal in three files.
    expect(HUD_COLORS.ground).toBe('#000000');
    expect(HUD_COLORS.stageGround).not.toBe(HUD_COLORS.ground);
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

    // And the verdict the gate settled on, now that the switch that used to
    // hold three answers is gone: BOTH cell surfaces wear the rose. If either
    // one drifts back toward the peer plane's cyan, the pair collapses again —
    // asked of the constants the surfaces actually read, not of the palette.
    expect(CELL_PANEL_ACCENT).toBe(HUD_COLORS.cellRose);
    expect(CELL_CARD_ACCENT).toBe(HUD_COLORS.cellRose);
    expect(rgbDistance(CELL_PANEL_ACCENT, HUD_COLORS.peerWire))
      .toBeGreaterThan(SEPARATION_FLOOR);
    expect(rgbDistance(CELL_CARD_ACCENT, HUD_COLORS.peerWire))
      .toBeGreaterThan(SEPARATION_FLOOR);
  });

  it('the two greens are deliberate siblings, not one green typed twice', () => {
    // A3, inverted. `termGreen` shipped as an orphan — a hex in the palette
    // with no reader — and now it has exactly one: the ECG strokes its canvas
    // in phosphor while the cadence is FINE, with the `● FINE` lamp beside it
    // still lit in `nominal`. The two sit on the same panel at the same moment,
    // which only works if a person can see they are two different greens:
    // phosphor is an instrument's INK, `nominal` is a status LAMP. Held to the
    // same floor as any other pair of tokens that mean different things.
    expect(rgbDistance(HUD_COLORS.termGreen, HUD_COLORS.nominal))
      .toBeGreaterThan(SEPARATION_FLOOR);

    // And the other half of the bargain: if the phosphor is ever judged a
    // mistake at the running panel, the token leaves with it. An unread
    // `termGreen` is how this whole finding started. Asked of the CODE, because
    // the prose around it — here and in `hudTheme.ts` — says the token's name
    // out loud, and a doc comment is not a reader.
    const readers = SOURCES.filter(
      (source) => source.name !== PALETTE_SOURCE && code(source.text).includes('HUD_COLORS.termGreen'),
    );
    expect(readers.map((source) => source.name)).toEqual(['BlockCadenceEcg.tsx']);
  });

  it('crit escalates in shape, and the one surface that draws it says the name', () => {
    // The two greens, inverted twice over. `termGreen` was an orphan — a hex in
    // the palette with no reader anywhere. `crit` looked like the same finding
    // and was not: it had a reader all along, and that reader was spelling the
    // value out as `rgba(139,0,0,.35)` in a file whose third line imports the
    // palette. From here the two are indistinguishable, because they are the
    // same defect — the name is not where the value lives.
    //
    // What the token means is settled and is not a colour question: once the
    // bar is `danger` there is nothing louder, so crit escalates in SHAPE. So
    // one reader is the whole of it, and a second appearing means somebody has
    // started using the deepest red as a fifth alarm hue.
    //
    // Asked of the CODE for the reason termGreen is: the prose in `hudTheme.ts`
    // and in the bar itself says the token's name out loud, and a doc comment
    // is not a reader.
    const readers = SOURCES.filter(
      (source) => source.name !== PALETTE_SOURCE && code(source.text).includes('HUD_COLORS.crit'),
    );
    expect(readers.map((source) => source.name)).toEqual(['WarningBar.tsx']);

    // And that reading it by name costs nothing: the helper rebuilds exactly
    // the string the bar used to type, so this is a promotion and not a retune.
    expect(rgba(HUD_COLORS.crit, 0.35)).toBe('rgba(139,0,0,0.35)');
  });

  it('the metabolism panel raises no alarms', () => {
    // B6, pinned where it happened. CELL MESH counts births and deaths per
    // block; both are what a living chain does and neither is a fault. The
    // panel painted DIED and the dead tally in `danger` — the same red the HUD
    // raises for a reorg — so an ordinary block read as a small emergency, and
    // the hero above them told the same story in a third colour again.
    const panel = SOURCES.find((source) => source.name === 'CellsPanel.tsx');
    expect(panel).toBeDefined();
    expect(panel?.text).toContain('HUD_COLORS.ember');
    expect(panel?.text).not.toContain('HUD_COLORS.danger');
  });
});

// ——— One cut ————————————————————————————————————————————————————————————
//
// The corners are a language too, and it had drifted into three dialects: the
// docked panels' two brackets, the floating plates' single 12px cut, and the
// replay banner cutting BOTH diagonals at 9px — a shape nothing else in the
// HUD spoke, which is exactly how a reader stops being able to tell a card
// from a panel at a glance. `primitives.tsx` now writes the grammar down and
// owns the number; this is the oracle that keeps the number in one place.
//
// It says nothing about which form a surface should wear — that is a judgement
// about what the surface IS, and the comment in `primitives.tsx` is where it is
// argued. This only says that whatever wears the cut, wears the same cut.

/** `clipPath:` and enough of the value to tell a shared constant from a
 *  hand-typed polygon. An SVG `<polygon>` is geometry, not a corner
 *  treatment, so the property — not the function — is what is matched. */
const CLIP_PATH_PROP = /clipPath:\s*([A-Za-z_$][\w$]*|['"`])/g;

describe('one shape grammar', () => {
  it('one cut, one number, and the number is in the shape', () => {
    expect(PLATE_CUT_PX).toBe(12);
    expect(PLATE_CUT_CLIP).toContain(`${PLATE_CUT_PX}px`);
  });

  it('nothing in the HUD cuts its own corner', () => {
    const offenders: string[] = [];
    for (const source of SOURCES) {
      if (source.name === SHAPE_SOURCE) continue;
      const text = code(source.text);
      CLIP_PATH_PROP.lastIndex = 0;
      let clip = CLIP_PATH_PROP.exec(text);
      while (clip !== null) {
        if (clip[1] !== 'PLATE_CUT_CLIP') {
          offenders.push(`${source.name}: clipPath ${clip[1]}… → say PLATE_CUT_CLIP`);
        }
        clip = CLIP_PATH_PROP.exec(text);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the shared cut is worn outside the file that describes it', () => {
    // Same bargain the promoted colour tokens make: a shape nobody wears is a
    // rule with no subjects, and the assertion above would be guarding nothing.
    const wearers = SOURCES.filter(
      (source) => source.name !== SHAPE_SOURCE
        && code(source.text).includes('PLATE_CUT_CLIP'),
    );

    expect(wearers.map((source) => source.name)).toContain('BackfillBar.tsx');
  });
});

// ——— The reserve ————————————————————————————————————————————————————————
//
// Three layers, and only one of them may name a state. Semantics
// (nominal/caution/warning/danger/crit) mean health and nothing else; chrome
// orange is the instrument's own frame; the two mesh wires are identity. A
// content category — a lock family, an asset family, a class of the census, a
// byte segment — is none of those: it names WHAT a thing is, so borrowing a
// reserved hue makes an ordinary cell look like a raised alarm. A metabolic
// rate is the same kind of thing one step further out: cells being spent is a
// reading about the organism, never a verdict on it.
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

/** Metabolism is data too, so it is checked as data. `ember` is written here
 *  as a one-member palette rather than as a hand-rolled assertion, so it walks
 *  the whole matrix below — including against reserved hues nobody thought to
 *  name while tuning it, and including the day a second metabolic tone is
 *  added beside it. */
const METABOLIC_COLORS: Readonly<Record<string, string>> = {
  ember: HUD_COLORS.ember,
};

/** The house's qualitative ramp, indexed. It is an ARRAY in the palette because
 *  its slots are handed out by something that means nothing — a hash of a
 *  country code or a client version string on the atlas bars, a POSITION in a
 *  sorted census on the STAGE script bar — which is exactly why it is a ramp of
 *  its own and not a set of content bands. A slot still has to clear the
 *  reserve, so it walks the same matrix as every palette whose keys do mean
 *  something. */
const QUALITATIVE_SLOTS: Readonly<Record<string, string>> = Object.fromEntries(
  QUALITATIVE_BUCKET_COLORS.map((hex, slot) => [`slot${slot}`, hex]),
);

/** Every palette that colours DATA rather than state, by the surface it
 *  paints: a lock family, an asset family, a class of the census, a byte
 *  segment, a rate of cells being spent, an activity the chain performed, a
 *  slice of the whole chain's capacity, a bucket of the peer atlas.
 *
 *  The last three live in `derives/`, and for the life of that directory none
 *  of them was checked by anything. Each drifted the way an unchecked palette
 *  does: the feed disagreed with the bands about five words it shares with
 *  them, the ecosystem bar painted its unnameable bucket in the brightest hue
 *  on the panel, and the atlas ramp opened on a near-chrome orange. A category
 *  is a category wherever it is computed — the matrix does not care which
 *  directory a colour was decided in, and neither does a reader looking at the
 *  bar. */
const CATEGORY_PALETTES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  lock: LOCK_COLORS,
  asset: ASSET_COLORS,
  classMix: CLASS_MIX_COLORS,
  byteSegment: SEGMENT_COLORS,
  metabolic: METABOLIC_COLORS,
  // The fallback is folded in as a member rather than left out of the matrix:
  // a category nobody could name is still a category the bar paints, and it was
  // the single worst offender on both of these surfaces.
  activity: { ...ACTIVITY_CATEGORY_COLORS, unlisted: ACTIVITY_UNLISTED_COLOR },
  ecosystem: { ...ECOSYSTEM_CATEGORY_COLORS, unlisted: ECOSYSTEM_UNLISTED_COLOR },
  atlasBucket: QUALITATIVE_SLOTS,
  // The other bar that reads the ramp, and read as the bar a READER sees rather
  // than as the two tables it is assembled from: six rank slots, then the
  // plain-CKB segment, the folded remainder and the unidentified tail, all of
  // them touching in one 6px strip. Taken from the derive itself, not rebuilt
  // here, so a private rank palette growing back in that file is a hit rather
  // than an invisible divergence between what is checked and what is painted.
  // Registering it is what caught the last three: `caution` — a health tone —
  // named a script family, the remainder spelled `CONTENT_BANDS.unlisted` out
  // longhand, and the tail sat 32.5 from the remainder it shares an edge with
  // while its own comment claimed the two were kept apart.
  scriptFamily: SCRIPT_FAMILY_COLORS,
  // A RAMP rather than a set of bands, and registered here for the half of it
  // that is the same question: an ordinal still names a fact about a Cell, so
  // no rung of it may sit on a reserved hue. It shipped with four of them on
  // one — `nominal`, `cyanWire`, `caution`, `ember` — which is not a colour
  // that slid onto a reserved layer but a ramp built OUT of them, and the
  // block that draws it rails and washes a whole card in the rung's colour.
  // Nothing walked it, because nothing knew it was a palette.
  storageTier: STORAGE_TIER_COLORS,
};

/** The sanctioned borrows, each `<palette>.<key> → <reserved>`, and each one
 *  argued rather than grandfathered.
 *
 *  Only one borrow is allowed and it is from the identity layer, never from
 *  the semantics: the default lock and bare CKB ARE plain consensus content,
 *  so they take the colour consensus already wears, and the byte bar's DATA
 *  segment joins them because a Cell's own bytes are the same kind of fact.
 *  `state` is the one place a semantic tone is still correct on these
 *  surfaces, and it is a branch in `cellScanFactAccent` rather than a token,
 *  so it needs no row here.
 *
 *  The activity feed's `transfer` is the same borrow a third time and for the
 *  same reason: a plain CKB transfer is the chain doing the one thing it does
 *  without anybody's extra rules, which is what consensus cyan already names.
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
  'activity.transfer → cyanWire',
  'activity.transfer → peerWire',
  // A fourth time, on the STAGE script bar, where it is the SAME sentence as
  // `asset.native`: a cell carrying no type script is bare CKB. It is the one
  // segment of that bar which is not a rank slot, precisely because it is the
  // one that names something.
  'scriptFamily.native → cyanWire',
  'scriptFamily.native → peerWire',
]);

describe('the colour reserve', () => {
  it('has palettes to check at all', () => {
    // Same pin as the source oracle above: an empty matrix asserts nothing.
    const tokens = Object.values(CATEGORY_PALETTES)
      .flatMap((palette) => Object.keys(palette));
    expect(tokens.length).toBeGreaterThanOrEqual(36);
    expect(Object.keys(CATEGORY_PALETTES).length).toBeGreaterThanOrEqual(8);
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

  it('the one reading that is supposed to be semantic reads the semantics', () => {
    // The reserve inverted. Everything above says content may not wear a
    // severity tone; this says the surface that IS reporting health has to,
    // and by name. `fpsColor` had been answering in three Tailwind defaults —
    // a second severity ramp with its own opinion about what green means, and
    // a bottom rung 23.0 from `cellRose`, which put a dropped frame rate in
    // very nearly the colour that names the Cell organism.
    //
    // Asked of the returned values rather than the source text, because the
    // defect was never a literal in the wrong place: it was the right shape of
    // function answering out of the wrong vocabulary.
    const ramp = [fpsColor(60), fpsColor(45), fpsColor(20)];
    const semantics = new Set<string>([
      HUD_COLORS.nominal, HUD_COLORS.caution, HUD_COLORS.warning,
      HUD_COLORS.danger, HUD_COLORS.crit,
    ]);
    expect(ramp.filter((rung) => !semantics.has(rung))).toEqual([]);
    expect(new Set(ramp).size).toBe(3);
    expect(rgbDistance(ramp[2], HUD_COLORS.cellRose))
      .toBeGreaterThan(SEPARATION_FLOOR);
  });

  it('nothing in the render plumbing writes a colour down', () => {
    // The fence around the finding above, and the reason it is a rule about a
    // DIRECTORY rather than three more rows on the ban list: the three hexes
    // that were here are Tailwind defaults, and two HUD scene files legitimately
    // spell two of them as `THREE.Color` arguments. Banning the values would
    // have meant exempting those, which is the trade this file exists to refuse.
    //
    // So the claim is scoped instead: `tweaks/` is quality presets, a sim
    // clock and a stats store — plumbing that counts things. It has no business
    // deciding what any of them look like, and the one colour it ever produced
    // is a severity, which has tokens. Read RAW, because a comment that types a
    // colour out is how the next one gets pasted back in.
    const offenders = INK_SOURCES
      .filter((source) => source.name.startsWith('tweaks/'))
      .flatMap((source) => (source.text.match(HEX_LITERAL) ?? [])
        .map((hex) => `${source.name}: ${hex} → say a HUD_COLORS token`));

    expect(offenders).toEqual([]);
  });

  it('no qualitative slot strays into the green the semantics own', () => {
    // The one rule in this palette that distance cannot state, and the one the
    // ramp's own comment calls its load-bearing part: green is spoken for by
    // `nominal`, so a country must never read as health. A bar where Germany is
    // green and Singapore is amber is a bar that appears to be grading nations,
    // and the ramp already carries the amber at slot 1.
    //
    // Pinned because it was unenforced and nearly lost. The sixth slot was
    // first cut as a moss green — 155.6 from `nominal`, so every distance rule
    // in this file passed it — for the honest reason that green was the widest
    // unspent hue left. Distance was the wrong question: the defect is not that
    // a reader confuses the two greens, it is that a green ANYWHERE in a
    // qualitative bar reads as a verdict.
    const strays = QUALITATIVE_BUCKET_COLORS
      .map((hex, slot) => ({ hex, slot, hue: hueDegrees(hex) }))
      .filter(({ hue }) => hue !== null && hue >= GREEN_SECTOR[0] && hue <= GREEN_SECTOR[1])
      .map(({ hex, slot, hue }) => `slot${slot} ${hex} at ${hue?.toFixed(0)}° — green means nominal`);

    expect(strays).toEqual([]);

    // And the pin under the pin: a sector rule over a ramp of greys would pass
    // by saying nothing, because a grey has no hue to be in the wrong place.
    expect(QUALITATIVE_BUCKET_COLORS.filter((hex) => hueDegrees(hex) === null))
      .toEqual([]);
  });

  it('the quietest segment of a bar still clears the track it is drawn on', () => {
    // The half the intra-bar matrix cannot see. `scriptFamily.unidentified` is
    // the deliberately quiet tail of the STAGE bars, and it was moved DOWN to
    // put a visible edge between it and the folded remainder it touches — the
    // only direction available, because the register above it is spoken for by
    // `plain`. Down has a floor of its own: the bar is drawn on `trackGround`,
    // and a segment that reaches it has stopped being a segment and become a
    // hole in the bar. So the next hand to widen that edge spends the margin
    // it does not have here rather than at the running panel.
    expect(rgbDistance(CATEGORY_PALETTES.scriptFamily.unidentified, HUD_COLORS.trackGround))
      .toBeGreaterThan(SEPARATION_FLOOR);
    expect(rgbDistance(CATEGORY_PALETTES.scriptFamily.unidentified, HUD_COLORS.stageGround))
      .toBeGreaterThan(SEPARATION_FLOOR);
  });

  it('one decomposition, one table, on all three surfaces that draw it', () => {
    // `SEGMENT_COLORS` was moved into `cellFormat.ts` so the dossier's byte bar
    // and the stage's composition orbit could stop keeping two answers to one
    // question about one Cell. A THIRD surface draws the same four words — the
    // portrait's occupied-byte ring — and it kept a third table anyway, with a
    // capacity arc 14.0 from chrome orange and a data arc 39.2 from `warning`.
    //
    // Pinned as source text because a colour this file cannot reach is a
    // colour it cannot check: the ring hands its values to `THREE.Color` and
    // draws them under a camera, so the only question an oracle can ask is
    // whether what goes IN is the shared table.
    const ring = SOURCES.find(
      (source) => source.name === 'CellSemanticMorphologyOverlay.tsx',
    );
    expect(ring, 'the portrait ring moved — this oracle reads files off disk')
      .toBeDefined();
    const text = code(ring?.text ?? '');
    expect(text).toContain("from './cellFormat'");
    expect(text).toContain('SEGMENT_COLORS[KNOWLEDGE_SEGMENT_KEY[segment.role]]');
    expect(text).toContain('SEGMENT_COLORS.lock');
    expect(text).toContain('SEGMENT_COLORS.type');

    // …and the byte segments' own ramp, whose slots are handed out by a hash of
    // a label — nothing, which is exactly what the house's qualitative ramp is
    // for. The private four it used instead had a member 9.8 from `cellRose`,
    // so a stretch of an ordinary Cell's bytes wore the colour that names the
    // Cell organism itself, and another 39.2 from `warning`.
    expect(text).toContain('QUALITATIVE_BUCKET_COLORS[');

    // One literal left, and it is on the record: a facet glyph is not one of
    // the four byte axes and the palette holds no band for it. Asked as the
    // whole list rather than as a count, so a table growing back here says
    // which values came with it.
    expect(text.match(HEX_LITERAL) ?? []).toEqual(['#fef3c7']);
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

  it('the durability ramp ranks, and ranks in one direction', () => {
    // The half the reserve cannot state. Every other palette in the matrix is
    // NOMINAL — omnilock is other than sighash, not more than it — so distance
    // from the reserve and distance from its neighbours is the whole of what
    // legibility means there. This one is ORDERED, and a reader has to be able
    // to put two rungs in order with no legend in front of them, which is a
    // claim about brightness rather than about distance.
    //
    // Pinned because the ramp it replaced ranked in the WRONG vocabulary: it
    // stepped nominal green → consensus cyan → caution yellow → ember, which
    // is the HUD's own gradient for something going wrong, spent on a fact
    // that is not a fault. Cold-and-bright to ash is the axis the reserve does
    // not own, and it only works if it is monotone.
    const RUNGS = [
      'pure_ckb', 'btc_ckb', 'decentralized_mixture',
      'centralized_mixture', 'unknown',
    ] as const;
    expect(Object.keys(STORAGE_TIER_COLORS)).toEqual([...RUNGS]);

    const luma = (hex: string): number => {
      const [r, g, b] = [0, 2, 4]
        .map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ladder = RUNGS.map((rung) => luma(STORAGE_TIER_COLORS[rung]));
    const inversions = ladder
      .slice(1)
      .map((step, index) => ({ step, index }))
      .filter(({ step, index }) => step >= ladder[index])
      .map(({ index }) => `${RUNGS[index]} → ${RUNGS[index + 1]} does not step down`);
    expect(inversions).toEqual([]);
  });

  it('no rung of the durability ramp is a rate the organism is spending', () => {
    // The one gap the matrix above cannot close on its own. `RESERVED` is
    // states, chrome and the two identity wires; `ember` is in neither list,
    // because it is a READING — cells being spent — and readings are the thing
    // category palettes are made of. So the matrix walks it as data and
    // correctly lets other data sit near it.
    //
    // But it carries a rule of its own, written in `hudTheme.ts` and quoted in
    // this ramp's old comment three lines above where it was broken: never an
    // accent, never a border, only ever a reading. A durability rung is drawn
    // as a 2px rail and a wash across a whole card, so a rung that is `ember`
    // is `ember` as a border — which is how a Spore on somebody's web server
    // came to be framed like a state the HUD had raised.
    //
    // Walked as a table rather than pinned as a hex, so the day a second
    // metabolic tone is cut beside it, this covers it without anyone
    // remembering the rule exists.
    const collisions: string[] = [];
    for (const [rung, value] of Object.entries(STORAGE_TIER_COLORS)) {
      for (const [name, tone] of Object.entries(METABOLIC_COLORS)) {
        if (rgbDistance(value, tone) > SEPARATION_FLOOR) continue;
        collisions.push(
          `storageTier.${rung} is ${name} (${value}) — a rail and a wash, in a reading's colour`,
        );
      }
    }

    expect(collisions).toEqual([]);
  });

  it('the two ends of the ramp are tokens, not values that match tokens', () => {
    // Both ends already had names before the ramp existed, and a ramp that
    // retyped them would be the drift at the top of this file with extra
    // steps. The middle three are the ramp's own, which is why they are not
    // asserted here — they have no other home to agree with.
    expect(STORAGE_TIER_COLORS.pure_ckb).toBe(HUD_COLORS.cyanInk);
    expect(STORAGE_TIER_COLORS.unknown).toBe(CONTENT_BANDS.unlisted);
  });

  it('the one value two palettes share is a coincidence, on the record', () => {
    // `btc_ckb` is `CONTENT_BANDS.tokenExtended` to the digit, and it is
    // written out as a literal rather than read from the band ON PURPOSE. Two
    // independent decisions landed on one pale teal: widening the sUDT/xUDT
    // edge on the CELLS asset bar is a legitimate thing to want, and if the
    // ramp READ that band it would move a durability rung with it — silently,
    // and possibly through the floor. A shared value is an accident; a shared
    // NAME would be a claim that a BTC+CKB object is an extended token.
    //
    // So the accident is held here instead. If either side is retuned this
    // goes red, and the answer is to update this line rather than to wire the
    // two together.
    expect(STORAGE_TIER_COLORS.btc_ckb).toBe(CONTENT_BANDS.tokenExtended);
    expect(rgbDistance(STORAGE_TIER_COLORS.btc_ckb, CONTENT_BANDS.tokenExtended))
      .toBe(0);
  });

  it('the composition card is railed and washed in the ramp, and nothing else', () => {
    // The consumer, pinned. The rung is not a swatch beside a label: the block
    // draws a 2px rail in it and washes the whole card behind the words, so a
    // rung on a reserved layer does not tint a chip, it tints a CARD — which
    // is how an ordinary IPFS-hosted Spore came to wear the caution-yellow
    // rail and wash that a degraded state gets everywhere else, and how
    // `ember` came to be a border in a HUD whose palette says it is never one.
    //
    // Read as source text because the defect was never a literal: the block
    // asks a function for a colour, and the function answered out of the
    // severity ladder. What this can check is that the rail and the wash both
    // come from the one call, so no future hand can splice a second colour in.
    const panel = SOURCES.find((source) => source.name === 'CellDetailPanel.tsx');
    expect(panel, 'the composition block moved — this oracle reads files off disk')
      .toBeDefined();
    const text = code(panel?.text ?? '');
    expect(text).toContain('const color = compositionTierColor(tier);');
    expect(text).toContain('borderLeft: `2px solid ${rgba(color, 0.55)}`');
    expect(text).toContain('background: rgba(color, 0.07)');

    // …and that the function it asks is answering out of the ramp. Asked of
    // the values rather than the source, because the wire vocabulary is
    // upstream's and a sixth tier is a word we have not learned yet, never a
    // reason to fall off the ramp.
    const rungs = new Set(Object.values(STORAGE_TIER_COLORS));
    const answers = [
      ...Object.keys(STORAGE_TIER_COLORS),
      'quantum_mixture',
    ].map((tier) => compositionTierColor(tier));
    expect(answers.filter((answer) => !rungs.has(answer))).toEqual([]);
  });
});

// ——— One directory, two dialects ————————————————————————————————————————
//
// The classifier above is the whole jurisdiction model, so it is the thing most
// worth being suspicious of. A rule that quietly sorted every hex into
// "material" would pass the ban list, pass the reserve, and check nothing —
// and it would do it silently, because both of those rules report by staying
// green. So this section asserts the sorting itself: that both sets exist, that
// named members land on the side they belong to, and that the two constructs
// the whole model turns on come out opposite ways round.
//
// The probe is written out rather than found, deliberately. Asking the question
// of real files means the answer changes the day somebody edits one of them,
// and "the classifier stopped working" would arrive disguised as "that file no
// longer has a hex in it". The probe cannot be edited away.

/** Both grammars, side by side, with the SAME value in each — so nothing here
 *  can be passing because two hexes differ. It is a banned value on purpose:
 *  the two assertions this file most needs to be true are that the ink form
 *  reaches the ban and the material form does not. */
const CLASSIFIER_PROBE = [
  "const ink = <div style={{ color: '#FFD48C' }} />;",
  'const material = <meshBasicMaterial color="#FFD48C" />;',
  "const built = new THREE.Color('#FFD48C');",
  "const nested = <Html><span style={{ background: '#FFD48C' }} /></Html>;",
].join('\n');

describe('one directory, two dialects', () => {
  it('classifies by the construct, not by the file', () => {
    const sites = hexSites(CLASSIFIER_PROBE);

    expect(sites.map((site) => `${site.dialect} — ${site.via}`)).toEqual([
      'ink — ink: CSS property',
      'material — material: <meshBasicMaterial> prop',
      'material — material: THREE colour call',
      'ink — ink: CSS property',
    ]);
  });

  it('the ban reaches a style object and stops at a material', () => {
    // The two claims the whole fence rests on, asked of the mechanism the ban
    // list actually runs — the masked text, not the classifier's verdict.
    const masked = maskSceneMaterials(CLASSIFIER_PROBE);

    expect(masked).toContain("style={{ color: '#FFD48C' }}");
    expect(masked).toContain("style={{ background: '#FFD48C' }}");
    expect(masked).not.toContain('color="#FFD48C"');
    expect(masked).not.toContain("new THREE.Color('#FFD48C')");
    // Two of the four survive, which is the shape of the answer: a fence that
    // masked everything and a fence that masked nothing would each pass one of
    // the pairs above and fail the other.
    expect(masked.match(/#FFD48C/g)?.length).toBe(2);
  });

  it('sorts the mixed directory, and finds both dialects in it', () => {
    const sites = MIXED_SOURCES.flatMap((source) => hexSites(source.text)
      .map((site) => ({ ...site, file: source.name })));
    const material = sites.filter((site) => site.dialect === 'material');
    const ink = sites.filter((site) => site.dialect === 'ink');

    expect(material.length).toBeGreaterThan(0);
    expect(ink.length).toBeGreaterThan(0);

    // Named members, both ways, in the files that made the case for this rule.
    // `CellIdentityBindingGlyph` is the whole argument in one file: the same
    // value four times as a scene parameter, and two others written the DOM's
    // way one table above them.
    const named = (dialect: Dialect): string[] => sites
      .filter((site) => site.dialect === dialect)
      .map((site) => `${site.file}: ${site.hex}`);

    expect(named('material')).toContain('components/CellSemanticOrbit.tsx: #020712');
    expect(named('material')).toContain('components/CellGalaxy.tsx: #e0f2fe');
    expect(named('material')).toContain('components/CellBirthAnchorMarker.tsx: #050914');
    expect(named('material')
      .filter((entry) => entry === 'components/CellIdentityBindingGlyph.tsx: #D9F8FF'))
      .toHaveLength(4);
    expect(named('ink')).toContain('components/CellIdentityBindingGlyph.tsx: #9DF7FF');
  });

  it('a colour the scene keeps to itself still clears the reserve', () => {
    // The other half of the bargain, and the reason "material" is not simply a
    // pass. A material parameter may keep a private VALUE — it is a surface
    // under a camera, not ink on a panel — but it may not keep a private
    // MEANING: a hue the semantics own, or the frame's own orange, or either
    // mesh identity, says something about the whole HUD wherever it is drawn.
    // A material that genuinely wants one of these says the token's name, and
    // then it is not a literal and this rule never sees it.
    const collisions: string[] = [];
    for (const source of MIXED_SOURCES) {
      for (const site of hexSites(source.text)) {
        if (site.dialect !== 'material') continue;
        for (const [name, value] of Object.entries(RESERVED)) {
          if (rgbDistance(site.hex, value) > SEPARATION_FLOOR) continue;
          collisions.push(`${source.name}: ${site.hex} → ${name} (${value})`);
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

// ——— Thirty-two glyphs ——————————————————————————————————————————————————
//
// The HUD's Chinese face is not a font, it is a HAND-CUT SUBSET: 32 glyphs and
// no more, so the page ships a few kilobytes instead of a few megabytes. That
// makes every Chinese string in the overlay a load-bearing inventory entry, and
// makes the failure mode invisible — a glyph outside the set does not error, it
// renders in whatever serif the machine happens to have, so the panel simply
// looks slightly wrong to somebody who is not looking for it. 样本 once shipped
// a release ahead of the subset exactly this way.
//
// The watermark makes it worse by making it bigger: the same silent fallback at
// 76px is a mismatched face across a whole corner of a panel. So this is the
// oracle. The inventory is written out here rather than imported, on purpose —
// it is a claim about a binary file, and the copy that matters is the one in
// `src/fonts/README.md` beside the `pyftsubset` command that produced it. If
// this list and that list ever disagree, one of them is lying and the test
// should be the loud one.
//
// It shipped reading the `cjk=`/`watermark=` PROPS, in the HUD directory. Both
// halves of that were too narrow, and one defect walked through the gap in
// both directions at once: `nerve/ConsensusMemoryMarkers` writes its three
// endpoint labels as `cjk: '…'` FIELDS on a returned object, two directories
// away — so the oracle could not see them, ten of their twelve glyphs were
// outside the subset, and the element around them asked for
// `JetBrains Mono Local`, an ASCII face with no Chinese in it at all. Neither
// half raises anything on its own; together they put 7px of system serif on
// the stage beside Latin set in mono.
//
// So the sweep reads Han runs wherever they are written, over the whole
// package, with comments stripped — this file's own prose says these glyphs
// out loud, and so does `hudTheme.ts`, and a doc comment is not a label. And
// there is a second rule under it now, because re-subsetting alone would not
// have fixed the markers: a string may only be written where the face that
// carries it is asked for.
//
// It stops at the package boundary, and that is a decision rather than an
// oversight. `packages/ui` owns the woff2 and every reader of `HUD_FONTS.cjk`;
// the app shell's only Han is a Japanese song title inside an iframe's `title`
// attribute — an accessibility label that asks for no HUD face and could not
// be swept without an exemption, which is the debt this file is paying off.

/** Exactly the glyphs in `src/fonts/HuiwenMincho-subset.woff2`. Adding Chinese
 *  to the HUD means re-subsetting the face IN THE SAME COMMIT and updating both
 *  this string and the README's. */
const CJK_SUBSET = '共识基神经元脉搏节点场对端状态警告道样本细胞记录交易输入谱系见证';

/** The other two copies of that inventory. Three lists have to move together —
 *  the string above, the README's, and the bytes the README's `pyftsubset`
 *  line produced — and for the life of this section the file said so in prose
 *  while checking exactly one of them. A woff2 cannot be read here without a
 *  decoder, but it can be WEIGHED: the README records the subset's SHA-256, so
 *  the binary answers for itself. */
const FONT_DIR = resolve(process.cwd(), 'src/fonts');
const FONT_README = readFileSync(join(FONT_DIR, 'README.md'), 'utf8');
const CJK_FACE = 'HuiwenMincho-subset.woff2';

/** A run of Han characters, however it was written down: a JSX prop, a field
 *  on a returned object, text between tags. Interpolated values yield nothing
 *  to check, which is why every one of these is a literal at its call site. */
const CJK_RUN = /[\u4E00-\u9FFF]+/g;

/** The two props whose primitives put the face on for the writer — `HudPanel`'s
 *  `watermark`, and the `cjk` of `PanelHeader` / `SpatialPlateHeader`. A file
 *  that spells its Chinese as one of these has named the face by naming the
 *  primitive; anything else has to say `HUD_FONTS.cjk` itself. */
const CJK_PROP = /(?:watermark|cjk)="([^"]*)"/g;

function cjkRuns(text: string): string[] {
  const found: string[] = [];
  CJK_RUN.lastIndex = 0;
  let match = CJK_RUN.exec(text);
  while (match !== null) {
    found.push(match[0]);
    match = CJK_RUN.exec(text);
  }
  return found;
}

function cjkPropValues(text: string): Set<string> {
  const found = new Set<string>();
  CJK_PROP.lastIndex = 0;
  let match = CJK_PROP.exec(text);
  while (match !== null) {
    if (match[1].length > 0) found.add(match[1]);
    match = CJK_PROP.exec(text);
  }
  return found;
}

function cjkLiterals(): Array<{ source: string; text: string }> {
  return PACKAGE_SOURCES.flatMap((source) => cjkRuns(code(source.text))
    .map((text) => ({ source: source.name, text })));
}

describe('the hand-cut face', () => {
  it('is 32 glyphs, each of them once', () => {
    // The subset is a set. A duplicate here would mean the README's
    // `--text=` argument is describing a smaller font than the name claims.
    expect(CJK_SUBSET.length).toBe(32);
    expect(new Set(CJK_SUBSET).size).toBe(32);
  });

  it('the string here, the README and the bytes on disk are one inventory', () => {
    // "If this list and that list ever disagree, one of them is lying and the
    // test should be the loud one" — said in prose above since this section was
    // written, and unenforced until now. Three copies, closed into a ring: the
    // string is the README's list, the README's list is the `--text=` argument
    // that cut the face, and the face is the file whose hash the README
    // records. Re-subset without updating any one of them and this goes red
    // naming which.
    const listed = /```text\n([\u4E00-\u9FFF]+)\n```/.exec(FONT_README);
    expect(listed, 'no Han glyph block in src/fonts/README.md').not.toBeNull();
    expect(listed?.[1]).toBe(CJK_SUBSET);
    expect(FONT_README).toContain(`--text='${CJK_SUBSET}'`);

    const recorded = /checked-in subset is\n`([0-9a-f]{64})`/.exec(FONT_README);
    expect(recorded, 'no subset SHA-256 in src/fonts/README.md').not.toBeNull();
    const actual = createHash('sha256')
      .update(readFileSync(join(FONT_DIR, CJK_FACE)))
      .digest('hex');
    expect(actual).toBe(recorded?.[1]);
  });

  it('finds the strings it is supposed to be checking', () => {
    // The pin. A regex that stopped matching would pass this file silently,
    // which is the same failure as the one it exists to catch.
    const literals = cjkLiterals();
    expect(literals.length).toBeGreaterThanOrEqual(11);
    expect(literals.filter((literal) => literal.text === '神经元').length)
      .toBeGreaterThanOrEqual(2);

    // And the form that hid the defect this section was widened for: three
    // fields on an object returned by a helper, in a scene file the old sweep
    // never opened. Asked exactly — if these stop being found, the widening
    // has been undone and the file would go quiet again rather than red.
    expect(literals
      .filter((literal) => literal.source === 'nerve/ConsensusMemoryMarkers.tsx')
      .map((literal) => literal.text))
      .toEqual(['共识记录', '交易输入', '谱系见证']);
  });

  it('every glyph the HUD renders is one the face carries', () => {
    const inventory = new Set(CJK_SUBSET);
    const strays = cjkLiterals().flatMap(({ source, text }) => [...text]
      .filter((glyph) => !inventory.has(glyph))
      .map((glyph) => `${source}: "${text}" uses ${glyph} — re-subset the face (src/fonts/README.md)`));

    expect(strays).toEqual([]);
  });

  it('every Chinese literal is set in the face that has Chinese in it', () => {
    // The half an inventory cannot see. A glyph can be in the subset and still
    // never reach it: the markers' container named `JetBrains Mono Local`, so
    // re-cutting the face would have changed nothing on the stage. The claim
    // is per FILE rather than per element, deliberately — a text oracle cannot
    // tie a literal to the node that wraps it, and the honest scope of what
    // this catches is "a file that writes Chinese without ever asking for the
    // face", which is exactly what happened here.
    const offenders: string[] = [];
    for (const source of PACKAGE_SOURCES) {
      const text = code(source.text);
      const runs = cjkRuns(text);
      if (runs.length === 0) continue;
      if (text.includes('HUD_FONTS.cjk')) continue;
      const viaPrimitive = cjkPropValues(text);
      offenders.push(...runs
        .filter((run) => !viaPrimitive.has(run))
        .map((run) => `${source.name}: "${run}" is set in whatever face its container asked for — say HUD_FONTS.cjk`));
    }

    expect(offenders).toEqual([]);
  });

  it('the watermark is off the type ladder on purpose, not by drift', () => {
    // The one DOM size in the overlay that is not a rung of `HUD_TYPE`, and the
    // only reason it is allowed to be: the ladder ranks reading sizes, and the
    // watermark is a graphic. Declared here so the exception is a decision on
    // the record rather than a constant that happened to dodge the regex.
    expect(DECLARED_SIZES.has(PANEL_WATERMARK_PX)).toBe(false);
    expect(PANEL_WATERMARK_PX).toBeGreaterThan(HUD_TYPE.hero * 2);
  });
});


// ——— One anchor, one colour —————————————————————————————————————————————
//
// `CHAIN_ANCHOR_HEX` is the palette entry that does not live in `hudTheme.ts`,
// and `visualPalette.ts` argues at length why it is where it is: it has two
// readers that must never drift apart — `CellGalaxy` paints the chain
// icosahedron with it, and the floating `NodeSelfCard` tints its frame from the
// same constant, so the card and the thing the card is ABOUT are one colour by
// construction rather than by two people remembering.
//
// It shipped with that guarantee half-wired. `.halo` had a reader; `.edge` and
// `.fill` were typed back as literals inside the JSX of the very component that
// had already bound the token seventy lines above, so retuning the anchor moved
// the card's frame and left the icosahedron exactly where it was. Same bargain
// the promoted colour tokens make above, asked of every field of the token: a
// field nobody reads by name is a guarantee nobody is keeping.

/** The package minus the file that owns the value. "Outside the palette" is the
 *  whole claim, so the palette itself is not allowed to answer it — and the
 *  readers live on both sides of the canvas boundary, which is why this is the
 *  package rather than the HUD directory. */
const ANCHOR_SOURCES = PACKAGE_SOURCES
  .filter((source) => source.name !== 'visualPalette.ts');

/** Every name a file reads the anchor palette through: the token itself, plus
 *  any local binding taken straight off it. `CellGalaxy` binds it once as
 *  `palette` and spends it three times — an oracle that knew only the token's
 *  own name would call two of its fields orphans and be confidently wrong. */
function anchorNames(text: string): string[] {
  const names = ['CHAIN_ANCHOR_HEX'];
  const bound = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*CHAIN_ANCHOR_HEX\s*[;,]/g;
  let match = bound.exec(text);
  while (match !== null) {
    names.push(match[1]);
    match = bound.exec(text);
  }
  return names;
}

/** `name.field` as a field ACCESS, not as a suffix of a longer one:
 *  `CELL_GALAXY_PALETTE.edge` must not be mistaken for `palette.edge`. */
function readsField(text: string, name: string, field: string): boolean {
  const escaped = name.replace(/\$/g, '\\$');
  return new RegExp(`(?<![\\w$.])${escaped}\\.${field}\\b`).test(text);
}

describe('the chain anchor palette', () => {
  it('has the two readers its own doc comment claims, and no third', () => {
    // The pin. An oracle pointed at an empty list passes everything asked of
    // it — and a third reader appearing is not a failure so much as a notice
    // that the sentence in `visualPalette.ts` needs rewriting with it.
    expect(ANCHOR_SOURCES.length).toBeGreaterThan(100);

    const holders = ANCHOR_SOURCES
      .filter((source) => code(source.text).includes('CHAIN_ANCHOR_HEX'))
      .map((source) => source.name)
      .sort();
    expect(holders).toEqual(['components/CellGalaxy.tsx', 'components/hud/NodeSelfCard.tsx']);
  });

  it.each(Object.keys(CHAIN_ANCHOR_HEX))('%s is read by name outside the palette', (field) => {
    // Asked of the CODE: the prose in `visualPalette.ts` and around the binding
    // in `CellGalaxy` names these fields out loud, and a doc comment is not a
    // reader — that is exactly how two of the three went unnoticed.
    const readers = ANCHOR_SOURCES.filter((source) => {
      const text = code(source.text);
      return anchorNames(text).some((name) => readsField(text, name, field));
    });

    expect(readers.length).toBeGreaterThan(0);
    expect(CHAIN_ANCHOR_HEX[field as keyof typeof CHAIN_ANCHOR_HEX])
      .toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(Object.entries(CHAIN_ANCHOR_HEX))('nothing spells %s out again as %s', (field, hex) => {
    // The half a reader count cannot see. `.edge` has a reader in
    // `NodeSelfCard` whatever `CellGalaxy` does, so the assertion above stayed
    // green through the whole drift: the icosahedron was painted with a literal
    // that happened to still match the token it had stopped reading. Same ban
    // the HUD's own palette makes at the top of this file, one directory out.
    const spelled = new RegExp(hex, 'i');
    const offenders = ANCHOR_SOURCES
      .filter((source) => spelled.test(code(source.text)))
      .map((source) => `${source.name} → say CHAIN_ANCHOR_HEX.${field}`);

    expect(offenders).toEqual([]);
  });
});


// ——— The cell card wears one colour —————————————————————————————————————
//
// The rose rebind was adjudicated at the running stage and is written down in
// `hudTheme.ts`: the cell mesh wears the galaxy's rose on BOTH its surfaces and
// cyan goes back to belonging to the peer plane. It shipped as a sweep over the
// literal `cyanWire`, so it landed on everything that had been cyan — the plate
// border, the card glow, the scan beam, the specimen sweep — and touched
// nothing that had not. Three surfaces had not: the masthead was written chrome
// orange before the rebind existed, the scene tether resolved its colour
// through the asset table, and the portrait's backing plate lives in a file the
// sweep never opened.
//
// So the card said "this is a Cell" in rose everywhere except the one line that
// names the creature, the one line that ties the card to it, and the trailing
// edge of its other half.
//
// `the two mesh identities are a pair` above was supposed to catch that. It
// pins the VALUE, and the value never moved — which is exactly why three
// surfaces could drift out from under it while it stayed green. These pin the
// SURFACES, so a fourth one cannot be added in chrome or in the peer plane's
// cyan.

/** One identity surface of the cell dossier: the fragments it must speak, and
 *  the ones it may not. `within` scopes the read to the surface's own JSX where
 *  the file legitimately speaks other colours elsewhere — `CellDetailPanel`
 *  prints its provenance affordances in chrome orange, and that is correct. */
const CELL_CARD_SURFACES: ReadonlyArray<{
  surface: string;
  file: string;
  within?: readonly [string, string];
  /** Read RAW: the masthead's own text contains `//`, and stripping comments
   *  would take the title with them. */
  wears: readonly string[];
  /** Read as CODE: a comment is allowed to say which colour this used to be. */
  never: readonly string[];
}> = [
  {
    surface: 'the masthead that names the specimen',
    file: 'components/hud/CellDetailPanel.tsx',
    within: ['data-cell-scan-identity', '<CloseButton'],
    wears: [
      'CELL // #{cell.id}',
      '细胞',
      'color: CELL_CARD_ACCENT, fontFamily: HUD_FONTS.display',
      'color: CELL_CARD_ACCENT, fontFamily: HUD_FONTS.cjk',
      'rgba(CELL_CARD_ACCENT, 0.45)',
    ],
    never: ['HUD_COLORS.orange', 'ORANGE', 'HUD_COLORS.cyanWire', 'CYAN', 'peerWire'],
  },
  {
    surface: 'the tether back to the Cell on stage',
    file: 'components/CellInspectionOverlay.tsx',
    wears: [
      'if (field === null) return CELL_CARD_ACCENT;',
      'cellScanFactAccent(props.cell, field, props.semanticRecord)',
      ': CELL_CARD_ACCENT;',
    ],
    never: ['HUD_COLORS.cyanWire', 'ASSET_COLORS', 'LOCK_COLORS', 'peerWire'],
  },
  {
    surface: "the specimen column's backing plate",
    file: 'components/hud/CellPortraitInset.tsx',
    wears: ['drawPortraitPlateGradient(ctx, 256, 256, CELL_CARD_ACCENT)'],
    never: ['HUD_COLORS.cyanWire', 'peerWire'],
  },
];

/** The surface's own text, or the whole file when the surface IS the file. */
function surfaceText(text: string, within?: readonly [string, string]): string {
  if (!within) return text;
  const start = text.indexOf(within[0]);
  const end = text.indexOf(within[1], start);
  expect(start, `no ${within[0]} to scope by`).toBeGreaterThan(-1);
  expect(end, `no ${within[1]} after ${within[0]}`).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe('the cell card wears one colour', () => {
  it.each(CELL_CARD_SURFACES)('$surface says CELL_CARD_ACCENT', ({ file, within, wears }) => {
    const source = PACKAGE_SOURCES.find((entry) => entry.name === file);
    expect(source, `${file} moved — this oracle reads files off disk`).toBeDefined();
    const text = surfaceText(source?.text ?? '', within);

    // Every fragment, not just one: the masthead is two spans and a glow, and
    // the drift that started all this was one of three surfaces at a time.
    expect(wears.filter((fragment) => !text.includes(fragment))).toEqual([]);
  });

  it.each(CELL_CARD_SURFACES)('$surface says nothing else', ({ file, within, never }) => {
    const source = PACKAGE_SOURCES.find((entry) => entry.name === file);
    const text = code(surfaceText(source?.text ?? '', within));

    expect(never.filter((token) => text.includes(token)))
      .toEqual([]);
  });

  it('the register and the tether read one table, in one file', () => {
    // The other half of the same finding. `selectedCellScanAccent` used to keep
    // its own copy of "what colour is this fact", and copies drift: COMMIT went
    // orange on the tether and stayed cyan on its own button, for the one facet
    // whose colour is a declared house exception. `cellScanFactAccent` is the
    // table now, and the scene half asks it rather than answering itself.
    const panel = PACKAGE_SOURCES.find(
      (entry) => entry.name === 'components/hud/CellDetailPanel.tsx',
    );
    expect(code(panel?.text ?? '')).toContain('export function cellScanFactAccent(');

    const holders = PACKAGE_SOURCES
      .filter((entry) => code(entry.text).includes('cellScanFactAccent'))
      .map((entry) => entry.name)
      .sort();
    expect(holders).toEqual([
      'components/CellInspectionOverlay.tsx',
      'components/hud/CellDetailPanel.tsx',
    ]);
  });
});
