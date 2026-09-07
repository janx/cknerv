// The HUD's palette degrades the same way every time: somebody needs a colour
// mid-edit, types the hex inline, and the token quietly stops being the single
// source of that value. Four had already drifted that far — a white hero ink,
// the module registry's slate, the ground under every meter track, and a gold
// that was neither `lockedGold` nor `goldInk` but sat between them.
//
// So this file is a source oracle rather than a render test: it reads the HUD
// directory off disk and fails on the literal. Nothing here renders, because
// the point is not what one component paints — it is that no component
// anywhere writes a colour down.
//
// THAT SENTENCE USED TO END DIFFERENTLY. For most of this file's life the rule
// was a DENYLIST: a table of specific hexes, each naming the token that owns it
// now, with a header that said "the list is meant to grow". It grew — a lot.
// And a denylist has a hole its own header never admitted:
//
//     it only catches values somebody already noticed.
//
// A new literal passed. And a second hole nobody found until the list was 24
// rows long: the ban matched HEX SPELLINGS, so a colour retyped as the decimal
// triple its hex expands to walked straight through. `crit` did exactly that
// for the life of the file — `rgba(139,0,0,.35)`, in a file whose third line
// imports the palette — and when it was finally caught the answer was to add
// one more row, for that one value. Then a sweep found sixty more of them.
//
// So the rule is INVERTED. Inside the ink jurisdiction a colour literal is
// illegal by default rather than illegal once noticed: no hex, and no numeric
// `rgb()`/`rgba()`, outside the files that hold the palettes. The denylist is
// gone — ZERO of its twenty-five rows survived, because every one of them is a
// strict subset of "no colour literal at all": twenty-three hexes, and the two
// decimal triples it had learned to name. The offender message survives, and
// it is better than it was: it names the token by LOOKING THE VALUE UP rather
// than by having been told about it in advance, so it can name a token nobody
// has written a rule for yet.
//
// The one exemption went with it, and by the same argument rather than by
// grandfathering. It read `#ffffff`, for `CellMorphologyLabArtwork.tsx`, and
// it was correct: the value reaches a `<pointsMaterial>` one binding below the
// ternary that spells it, so a positional classifier reads ink where a reader
// sees a material parameter. The classifier follows a binding now — a name
// whose every consumer is a material construct is material — and the file is
// clean with nothing written down about it anywhere.
//
// What that costs, stated rather than implied. A denylist can be scoped to one
// value; a blanket rule cannot, so everything the old list did not cover had
// to be resolved instead of listed — twelve near-black spellings of the stage
// ground, five ramp slots handed out by index, a triad of proof colours typed
// in two files, three protocol accents returned from a branch. That work is in
// the three commits under this one. What it buys is that the next one is
// caught the day it is typed, by nobody's vigilance.
//
// The palette degrades a second way too, and this file guards that as well: two
// tokens quietly holding the SAME value. `warning` was chrome orange to the
// digit, which meant the middle severity had a name, a doc comment, and no
// color — every warning the HUD ever raised looked like part of the frame.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CELL_CARD_ACCENT,
  CELL_PANEL_ACCENT,
  COMPANION_OPACITY,
  HUD_COLORS,
  HUD_FONTS,
  HUD_MOTION,
  HUD_THEME_STYLE_ID,
  HUD_TYPE,
  injectHudTheme,
  ORDINAL_REACH_RAMP,
  QUALITATIVE_BUCKET_COLORS,
  rgba,
  STALE_OPACITY,
} from '../../../src/components/hud/hudTheme';
import {
  PLATE_CUT_CLIP,
  PLATE_CUT_PX,
  PLATE_EDGE_ALPHA,
  PLATE_ROW_HOT_WASH_ALPHA,
  PLATE_ROW_RAIL_ALPHA,
  PLATE_ROW_RAIL_HOT_ALPHA,
  PLATE_ROW_RAIL_LIT_ALPHA,
  PLATE_ROW_SELECTED_WASH_ALPHA,
  REVEAL_GHOST_OPACITY,
  STAT_ROW_HEIGHT_PX,
  STAT_ROW_LIFTED_HEIGHT_PX,
} from '../../../src/components/hud/primitives';
import { TOP_BAND_HEIGHT } from '../../../src/components/hud/TopBand';
import {
  HAZARD_BAND_PX,
  WARNING_BAR_HEIGHT,
} from '../../../src/components/hud/WarningBar';
import {
  ASSET_COLORS,
  ASSET_STANDARD_ACCENTS,
  CLASS_MIX_COLORS,
  CONTENT_BANDS,
  FACET_GLYPH_COLOR,
  IDENTITY_PROOF_COLORS,
  LOCK_COLORS,
  SEGMENT_COLORS,
  STORAGE_TIER_COLORS,
} from '../../../src/components/hud/cellFormat';
import {
  ACTIVITY_CATEGORY_COLORS,
  ACTIVITY_UNLISTED_COLOR,
} from '../../../src/derives/activityFeed.derive';
import { INVENTORY_COLORS, SCRIPT_FAMILY_COLORS } from '../../../src/derives/scriptFamilies.derive';
import { replayPresentation } from '../../../src/components/hud/replayPresentation';
import { streamHealthPresentation } from '../../../src/components/hud/StreamHealthBanner';
import {
  BOOT_SEQUENCE_TITLE,
  bootPhaseLine,
  bootSequenceAccent,
} from '../../../src/components/hud/bootSequencePresentation';
import { STAGE_COMPOSING_TITLE } from '../../../src/components/hud/stageComposingPresentation';
import type { BootSequenceSnapshot } from '../../../src/boot/bootSequence';
import { NETWORK_ATLAS_REACH_ORDER } from '../../../src/derives/networkAtlas.derive';
import { compositionTierColor } from '../../../src/components/hud/CellSemanticsReadout';
import { fpsColor } from '../../../src/tweaks/renderStatsStore';
import {
  CELL_GALAXY_PALETTE,
  CHAIN_ANCHOR_HEX,
  PEER_NETWORK_HEX,
} from '../../../src/visualPalette';

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

/** …and every file that IS a palette — which under the inverted rule is the
 *  whole of the exception. A colour literal is legal HERE and illegal
 *  everywhere else, so this set is the one thing standing between a general
 *  rule and a growing exemption list, and it has to be read that way: not
 *  "files allowed to type a hex" but "files whose colours are UNDER AUDIT".
 *
 *  It was a single filename for as long as the ban list only guarded
 *  `HUD_COLORS`, and that was the reason the ban list only ever guarded
 *  `HUD_COLORS`: `CONTENT_BANDS` lives in `cellFormat.ts` and the stage's own
 *  hexes live in `visualPalette.ts`, so banning a band's value would have gone
 *  red on the table that defines it. A palette is a palette wherever it is
 *  kept — and two of them are kept in `derives/`, which is exactly why the
 *  reserve matrix found four drifted palettes there at once (a third, the
 *  chain's capacity-bar table, retired with that bar).
 *
 *  Membership is not free and the pin below is what charges for it: a file may
 *  only be here if this oracle IMPORTS a colour table out of it. That is the
 *  difference between a jurisdiction and an exemption. Adding a file means
 *  putting its table in front of the reserve matrix, the intra-bar separation
 *  matrix and the monotone-luma rule; it cannot be done to quiet one literal,
 *  because the import is what the pin reads.
 *
 *  Matched on the BASENAME, because the same file arrives under two names: the
 *  HUD sweep walks `src/components/hud` and calls it `cellFormat.ts`, the
 *  package sweep walks `src` and calls it `components/hud/cellFormat.ts`. */
const PALETTE_SOURCES: ReadonlySet<string> = new Set([
  'hudTheme.ts',
  'cellFormat.ts',
  'visualPalette.ts',
  'activityFeed.derive.ts',
  'scriptFamilies.derive.ts',
]);

function isPaletteSource(name: string): boolean {
  return PALETTE_SOURCES.has(name.slice(name.lastIndexOf('/') + 1));
}

/** This file, read as text. The toll above is a claim about this oracle's own
 *  import list, and the only honest way to check a claim about a file is to
 *  read the file. */
const ORACLE_SOURCE = readFileSync(fileURLToPath(import.meta.url), 'utf8');

/** The same arrangement one axis over: the one file allowed to describe a
 *  shape. Everything else in the directory wears one. */
const SHAPE_SOURCE = 'primitives.tsx';

/** Every value the palette layer holds, by the name it is held under.
 *
 *  This is NOT the rule. The rule below catches a colour literal whether or
 *  not it matches anything here — that is the whole of the inversion, and a
 *  table of known values is precisely the thing that failed. This exists so
 *  the failure message can say WHICH token a caught value already is, which is
 *  the one useful thing the old denylist did and the only thing it did that
 *  survives. It names a token nobody wrote a rule for, on the first offence.
 *
 *  Every table this oracle imports, flattened. The float triples of the scene
 *  palette are converted, because a scene value retyped in the DOM is the same
 *  defect as a DOM value retyped in the DOM. */
const PALETTE_TOKENS: ReadonlyArray<{ token: string; hex: string }> = [
  ...Object.entries(HUD_COLORS).map(([key, hex]) => ({ token: `HUD_COLORS.${key}`, hex })),
  ...QUALITATIVE_BUCKET_COLORS
    .map((hex, slot) => ({ token: `QUALITATIVE_BUCKET_COLORS[${slot}]`, hex })),
  ...Object.entries(CONTENT_BANDS).map(([key, hex]) => ({ token: `CONTENT_BANDS.${key}`, hex })),
  ...Object.entries(LOCK_COLORS).map(([key, hex]) => ({ token: `LOCK_COLORS.${key}`, hex })),
  ...Object.entries(ASSET_COLORS).map(([key, hex]) => ({ token: `ASSET_COLORS.${key}`, hex })),
  ...Object.entries(CLASS_MIX_COLORS).map(([key, hex]) => ({ token: `CLASS_MIX_COLORS.${key}`, hex })),
  ...Object.entries(SEGMENT_COLORS).map(([key, hex]) => ({ token: `SEGMENT_COLORS.${key}`, hex })),
  ...Object.entries(STORAGE_TIER_COLORS).map(([key, hex]) => ({ token: `STORAGE_TIER_COLORS.${key}`, hex })),
  ...Object.entries(IDENTITY_PROOF_COLORS).map(([key, hex]) => ({ token: `IDENTITY_PROOF_COLORS.${key}`, hex })),
  ...Object.entries(ASSET_STANDARD_ACCENTS).map(([key, hex]) => ({ token: `ASSET_STANDARD_ACCENTS.${key}`, hex })),
  { token: 'FACET_GLYPH_COLOR', hex: FACET_GLYPH_COLOR },
  ...Object.entries(ACTIVITY_CATEGORY_COLORS).map(([key, hex]) => ({ token: `ACTIVITY_CATEGORY_COLORS.${key}`, hex })),
  { token: 'ACTIVITY_UNLISTED_COLOR', hex: ACTIVITY_UNLISTED_COLOR },
  ...Object.entries(SCRIPT_FAMILY_COLORS).map(([key, hex]) => ({ token: `SCRIPT_FAMILY_COLORS.${key}`, hex })),
  ...Object.entries(INVENTORY_COLORS).map(([key, hex]) => ({ token: `INVENTORY_COLORS.${key}`, hex })),
  ...Object.entries(CHAIN_ANCHOR_HEX).map(([key, hex]) => ({ token: `CHAIN_ANCHOR_HEX.${key}`, hex })),
  ...Object.entries(PEER_NETWORK_HEX).map(([key, hex]) => ({ token: `PEER_NETWORK_HEX.${key}`, hex })),
  ...Object.entries(CELL_GALAXY_PALETTE)
    .map(([key, color]) => ({ token: `CELL_GALAXY_PALETTE.${key}`, hex: sceneHex(color) })),
];

/** `#RRGGBB` for a value written any of the ways a colour gets typed: three
 *  digits or six, upper case or lower, with or without an alpha pair. */
function canonicalHex(literal: string): string | null {
  const body = literal.replace('#', '').toLowerCase();
  if (body.length === 3) return `#${[...body].map((d) => d + d).join('')}`;
  if (body.length === 6 || body.length === 8) return `#${body.slice(0, 6)}`;
  return null;
}

const TOKEN_BY_HEX: ReadonlyMap<string, string> = new Map(
  PALETTE_TOKENS
    .map(({ token, hex }) => [canonicalHex(hex) ?? hex, token] as const)
    .reverse(),
);

/** What to say about a value the rule has caught: the token that already holds
 *  it, or — the common case for a brand new literal — that it does not have a
 *  name yet and needs one. */
function saysWhat(hex: string): string {
  const token = TOKEN_BY_HEX.get(canonicalHex(hex) ?? '');
  return token ? `say ${token}` : 'this value has no name — give it one in a palette';
}

/** Tokens promoted out of inline literals — each has to be read by somebody,
 *  or the rule above is guarding a value nothing uses. */
const PROMOTED = [
  'heroInk',
  'moduleSlate',
  'trackGround',
  'legendInk',
  'stageGround',
  'memoryUnbound',
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

/** …and the other notation, which is how `crit` hid from every sweep this file
 *  ran for a year. A LITERAL triple only: `rgba(${r},${g},${b},…)` is a value
 *  being computed, which is a different thing entirely and is what
 *  `spatialPlateTail` legitimately does. Both separators, because CSS Color 4
 *  spells the same triple with spaces and a rule that knew only commas would
 *  be the hex-only ban all over again, one notation along. */
const NUMERIC_RGB = /rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,)/\s]/g;

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
 *  What travels with the widening and what does not. The colour rule above is
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
 *  a sibling of these and builds THREE colours for the shaders the stage is
 *  drawn with; a sweep that reached it would need a file exempted from a rule
 *  it was never the subject of, and an exemption list is the debt this file is
 *  paying off. (It said "for the BLOOM PASS", which does not exist — see the
 *  scene-dialect exemption below.) */
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
//                  The no-literal rule applies in full — the palette layer is
//                  the only place a colour is written down, and this is where
//                  that has jurisdiction.
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

/** Which grammar the expression at an offset was written in. Split out of the
 *  hex sweep because the binding pass below has to ask the same question of a
 *  NAME — `color={nodeColor}` is a material parameter for exactly the reasons
 *  `color="#fef3c7"` is, and one recogniser answering both is the only way the
 *  two answers cannot drift apart. */
function dialectAt(text: string, at: number): { dialect: Dialect; via: string } {
  const before = text.slice(0, at);
  if (SCENE_COLOR_CALL.test(before.slice(-200))) {
    return { dialect: 'material', via: 'material: THREE colour call' };
  }
  const tag = openElementTag(before);
  if (tag !== null && SCENE_ELEMENT.test(tag)) {
    return { dialect: 'material', via: `material: <${tag}> prop` };
  }
  if (CSS_COLOR_PROPERTY.test(before.slice(-120))) {
    return { dialect: 'ink', via: 'ink: CSS property' };
  }
  return { dialect: 'ink', via: 'ink: unclassified' };
}

/** A binding whose initializer holds a colour, with the span of that
 *  initializer. `const nodeColor = greyscale ? '#ffffff' : '#fef3c7';` and
 *  `const WARM_STRANDS = ['#fb7185', …];` are the two forms in the tree, and
 *  they are the same shape: a name, then everything up to the terminating
 *  semicolon. */
const COLOUR_BINDING = /(?:^|[\s;{])(?:const|let)\s+([A-Za-z_$][\w$]*)(?::[^=;]*)?\s*=\s*/g;

/** Every mention of `name` in the source that is not its own declaration. */
function mentionOffsets(text: string, name: string): number[] {
  const found: number[] = [];
  const mention = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, 'g');
  let match = mention.exec(text);
  while (match !== null) {
    found.push(match.index);
    match = mention.exec(text);
  }
  return found;
}

/** The names in a source whose colour is only ever handed to the scene.
 *
 *  This is the half a positional classifier cannot see, and it is the half
 *  that used to be paid for with the file's one exemption. `nodeColor` is
 *  declared twenty lines above the `<pointsMaterial>` that wears it and
 *  `WARM_STRANDS` is an array indexed inside a `new THREE.Color(...)`, so both
 *  read as ink at the literal and as material at the use — and the old answer
 *  was to write `CellMorphologyLabArtwork.tsx` down on an exemption list.
 *
 *  A binding is material when it has at least one consumer and EVERY consumer
 *  is a material construct. Both halves matter: "every" keeps a name that also
 *  paints DOM ink on the strict side, which is the case that made
 *  `FACET_GLYPH_COLOR` a name rather than an exemption; "at least one" stops a
 *  dead constant from being quietly promoted by having no consumers to fail. */
function sceneBoundNames(text: string): Set<string> {
  const bound = new Set<string>();
  COLOUR_BINDING.lastIndex = 0;
  let declaration = COLOUR_BINDING.exec(text);
  while (declaration !== null) {
    const name = declaration[1];
    const from = declaration.index + declaration[0].length;
    const semicolon = text.indexOf(';', from);
    const initializer = text.slice(from, semicolon < 0 ? text.length : semicolon);
    if (/#[0-9a-fA-F]{3,8}\b/.test(initializer)) {
      const uses = mentionOffsets(text, name)
        .filter((at) => at < declaration!.index || at > (semicolon < 0 ? text.length : semicolon));
      if (uses.length > 0 && uses.every((at) => dialectAt(text, at).dialect === 'material')) {
        bound.add(name);
      }
    }
    declaration = COLOUR_BINDING.exec(text);
  }
  return bound;
}

/** Every hex in a source, with the grammar it was written in. */
function hexSites(text: string): HexSite[] {
  const sites: HexSite[] = [];
  const sceneBound = sceneBoundNames(text);
  HEX_LITERAL.lastIndex = 0;
  let match = HEX_LITERAL.exec(text);
  while (match !== null) {
    const answer = dialectAt(text, match.index);
    let { dialect, via } = answer;
    if (dialect === 'ink' && sceneBound.size > 0) {
      // …unless the literal is being given a NAME the scene is the only
      // consumer of, which is the same answer one binding away.
      const line = text.slice(text.lastIndexOf('\n', match.index) + 1, match.index);
      const declared = /(?:const|let)\s+([A-Za-z_$][\w$]*)/.exec(
        text.slice(Math.max(0, text.lastIndexOf(';', match.index)), match.index),
      );
      if (declared !== null && sceneBound.has(declared[1])) {
        dialect = 'material';
        via = `material: bound to ${declared[1]}, worn only by the scene`;
      } else if (line.length === 0) {
        // A continuation line inside a multi-line initializer: the declaration
        // is above, so look for the nearest one the scene owns.
        const head = text.slice(0, match.index);
        const nearest = /(?:const|let)\s+([A-Za-z_$][\w$]*)(?::[^=;]*)?\s*=\s*[^;]*$/.exec(head);
        if (nearest !== null && sceneBound.has(nearest[1])) {
          dialect = 'material';
          via = `material: bound to ${nearest[1]}, worn only by the scene`;
        }
      }
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

/** What the colour rules read: every source, with its scene materials painted
 *  out and its comments stripped.
 *
 *  BOTH halves of that changed with the inversion, and both are worth stating
 *  because both look like a relaxation and neither is.
 *
 *  MASKED EVERYWHERE. It used to mask only the mixed directory, on the ground
 *  that sweeping the HUD directory whole was "the stricter arrangement". That
 *  was true of a denylist — a material spelling one of two dozen known values
 *  was itself a finding — and it is not true of a blanket rule: sweeping a
 *  material construct whole means either exempting the file or banning a value
 *  a surface under a camera is entitled to keep. So the construct decides
 *  everywhere now.
 *
 *  What that gives up, stated rather than buried: a HUD-directory MATERIAL
 *  spelling one of the values the old list held would have gone red and will
 *  not now. Nothing does today. The obvious compensation — widening the
 *  reserve check over material literals from the mixed directory to the whole
 *  jurisdiction — was tried and does not hold, for a reason written where that
 *  rule lives: the reserve is a DOM-ink rule, and run over the scene it fails
 *  the scene's own palette.
 *
 *  COMMENTS STRIPPED. The ban list read raw text on the argument that a
 *  comment typing a colour out is how the next one gets pasted back in. Under
 *  the inversion that argument no longer buys anything — a paste into code is
 *  caught the instant it happens, by the rule itself — and it costs something
 *  real: this repository's comments ARGUE about values, including values that
 *  were deliberately deleted. `activityFeed.derive.ts` records that `#ff9d52`
 *  sat 34.4 from chrome orange, which is why it is gone; `ConsensusMemory`
 *  explains why `#E9FCFF` is deliberately not a token. A rule that read those
 *  would force the file to forget why it is the way it is. */
function inkText(source: HudSource): string {
  return code(maskSceneMaterials(source.text));
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
    // would leave the colour rules green over a file writing colours down on
    // every line.
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
    // would leave the colour rules green over the files it was widened for.
    const mixed = MIXED_SOURCES.map((source) => source.name);
    expect(mixed.length).toBeGreaterThan(20);
    expect(mixed).toContain('components/CellCausalLensLayer.tsx');
    expect(mixed).toContain('components/CellGalaxy.tsx');
    expect(mixed).toContain('components/CellIdentityBindingGlyph.tsx');
    // …and stops at the HUD directory, which is swept whole and stays that way.
    expect(mixed.some((name) => name.startsWith('components/hud/'))).toBe(false);
  });

  it('a palette source is a file whose colours this oracle has in hand', () => {
    // The toll on the one exception the inverted rule has. `PALETTE_SOURCES`
    // is what stands between "a colour literal is illegal" and a growing
    // exemption list, so it needs a cost, and the cost is that a file may only
    // be in it if this oracle IMPORTS a colour table out of it — at which
    // point that table walks the reserve matrix, the intra-bar separation
    // matrix and everything else below.
    //
    // Asked of this file's own text, because that is the only place the claim
    // can be checked. A future hand can still add a row, but not quietly and
    // not without putting a palette in front of the rules.
    const imported = new Set(
      [...code(ORACLE_SOURCE).matchAll(/from '([^']+)'/g)]
        .map((match) => match[1].slice(match[1].lastIndexOf('/') + 1)),
    );
    const unpaid = [...PALETTE_SOURCES]
      .filter((file) => !imported.has(file.replace(/\.tsx?$/, '')))
      .map((file) => `${file} is a palette source this oracle imports nothing from`);

    expect(unpaid).toEqual([]);
    // …and the pin under the pin: a reader that had stopped finding import
    // clauses would pass the line above by having nothing to complain about.
    expect(PALETTE_SOURCES.size).toBeGreaterThanOrEqual(5);
    expect(imported.size).toBeGreaterThanOrEqual(8);
    expect(imported).toContain('hudTheme');
  });

  it('no colour is written down outside the files that hold the palettes', () => {
    // THE RULE, inverted. Not "these two dozen values may not be typed" but
    // "no value may be typed" — so a colour nobody has noticed yet is caught
    // on the first commit that writes it, which is the whole of the argument
    // for turning the list inside out.
    //
    // Ink only: a material parameter is a surface under a camera and may keep
    // a private value, which the reserve rule below is what audits. Code only:
    // a comment that argues about a colour is this repository's record of why
    // that colour is gone.
    const offenders = INK_SOURCES
      .filter((source) => !isPaletteSource(source.name))
      .flatMap((source) => (inkText(source).match(HEX_LITERAL) ?? [])
        .map((hex) => `${source.name}: ${hex} → ${saysWhat(hex)}`));

    expect(offenders).toEqual([]);
  });

  it('no colour is written down as the decimal triple its hex expands to', () => {
    // The second hole, and the one that made the first one worth closing. The
    // old list matched hex SPELLINGS, so `rgba(139,0,0,.35)` — `crit`, in a
    // file whose third line imports the palette — sat in plain sight for the
    // life of the file, and the answer when it was found was one more row for
    // that one value. A sweep afterwards turned up sixty more triples spelling
    // a token: seventeen blacks, nine chrome oranges, ten consensus cyans.
    //
    // So the notation is not what the rule is about. `hudTheme.ts` exports
    // `rgba(hex, alpha)` for exactly this, and it was already the majority
    // form — the raw triples were drift, never house style.
    const offenders = INK_SOURCES
      .filter((source) => !isPaletteSource(source.name))
      .flatMap((source) => [...inkText(source).matchAll(NUMERIC_RGB)]
        .map((match) => {
          const hex = `#${[match[1], match[2], match[3]]
            .map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
          return `${source.name}: rgb(${match[1]},${match[2]},${match[3]}) is ${hex}`
            + ` → ${saysWhat(hex)}, through rgba(token, alpha)`;
        }));

    expect(offenders).toEqual([]);
  });

  it('the rule is looking at a real population, in both notations', () => {
    // A rule that accidentally matches nothing passes everything, and both
    // rules above report by staying green — so this is what says they are
    // reading a HUD rather than an empty list. Asked of the palette sources,
    // which is where the colours legitimately are: a sweep that had stopped
    // seeing hexes would show up here first.
    const palette = INK_SOURCES.filter((source) => isPaletteSource(source.name));
    const hexes = palette.flatMap((source) => inkText(source).match(HEX_LITERAL) ?? []);
    expect(palette.length).toBeGreaterThanOrEqual(4);
    expect(hexes.length).toBeGreaterThan(40);

    // …and that the naming table is a table rather than an empty map, so a
    // caught value gets told which token it already is.
    expect(PALETTE_TOKENS.length).toBeGreaterThan(60);
    expect(saysWhat('#FF9830')).toBe('say HUD_COLORS.orange');
    expect(saysWhat('#fff')).toBe('say HUD_COLORS.heroInk');
    expect(saysWhat('#123456')).toContain('has no name');

    // The swept side is a real population too — a jurisdiction with three
    // files in it would pass both rules by having nothing to read.
    expect(INK_SOURCES.filter((source) => !isPaletteSource(source.name)).length)
      .toBeGreaterThan(100);
  });

  it('catches a fresh literal in a DOM construct and lets a material tint be', () => {
    // The falsification, planted rather than found. Both rules above are
    // sweeps, and the failure mode of a sweep is silence: it is not enough to
    // watch them stay green over a clean tree, because a classifier that had
    // started sorting everything into "material" would do exactly that.
    //
    // So: a value NOTHING in this repository has ever seen, in the two
    // grammars, plus a token spelled as its triple. The hex on the ink side
    // has to be caught with no list naming it — that is the inversion in one
    // assertion — and the identical hex on the material side has to pass.
    const probe = [
      "const card = <div style={{ background: '#3B0F2A' }} />;",
      'const tint = <meshBasicMaterial color="#3B0F2A" />;',
      "const glow = <div style={{ boxShadow: '0 0 6px rgba(255,152,48,.4)' }} />;",
      'const strand = new THREE.Color(\'#3B0F2A\');',
    ].join('\n');
    const seen = code(maskSceneMaterials(probe));

    // Ink: caught, and told it has no name.
    expect(seen.match(HEX_LITERAL)).toEqual(['#3B0F2A']);
    expect(saysWhat('#3B0F2A')).toContain('has no name');
    // Material: both forms survive the classifier and are painted out.
    expect(seen).not.toContain('color="#3B0F2A"');
    expect(seen).not.toContain("new THREE.Color('#3B0F2A')");
    // The triple: caught, and named.
    const triples = [...seen.matchAll(NUMERIC_RGB)]
      .map((match) => `${match[1]},${match[2]},${match[3]}`);
    expect(triples).toEqual(['255,152,48']);
    expect(saysWhat('#FF9830')).toBe('say HUD_COLORS.orange');
  });

  it.each(PROMOTED)('%s is read outside the palette', (token) => {
    // Asked of the whole colour jurisdiction rather than of the HUD directory,
    // because that is where the jurisdiction is. `memoryUnbound` has exactly
    // one reader and it is in `nerve/` — a sweep of the overlay alone would
    // call the newest promotion an orphan on the day it was made.
    const readers = [...INK_SOURCES, ...APP_SOURCES].filter(
      (source) => !isPaletteSource(source.name)
        && source.text.includes(`HUD_COLORS.${token}`),
    );

    // Not just "the token exists": a token nobody reads is an orphan, and the
    // rule that protects it is guarding an empty room.
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
    // A2, pinned: `cyanWire` and `peerWire` sit ~15 apart, which is why PEER·02
    // and CELL·03 stopped reading as two panels about two different things.
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

  it('the other two surfaces that name a spent Cell name it the same way', () => {
    // The panel above was the first of THREE surfaces that report the same
    // event, and for a while it was the only one that had been ruled on. The
    // dossier names a consumed Cell twice more — the masthead flag over the
    // specimen, and the transaction that did the spending in the causal
    // footer — and both said it in `caution`, so opening any spent output
    // framed it in the HUD's degradation yellow. Three surfaces, one event,
    // one tone.
    //
    // Both of these are ink and only ink, which is the whole reason they could
    // take the token directly: a `color:` on a span and a `valueColor` on a
    // readout row. The dossier's third naming of it — the STATE fact — could
    // not, because its colour is also a rail and a scene tether, and that
    // split is argued and checked in `CellInspectionOverlay.test.ts`.
    const masthead = SOURCES.find((source) => source.name === 'CellDetailPanel.tsx');
    expect(masthead, 'the cell dossier moved — this oracle reads files off disk')
      .toBeDefined();
    // Read with the size beside it, because the register's STATE reading is
    // spelled the same way one screen up and the two are on different layers:
    // this is the flag over the specimen, at the `section` rung.
    expect(code(masthead?.text ?? '')).toContain(
      'color: live ? HUD_COLORS.nominal : HUD_COLORS.ember,'
      + ' fontSize: HUD_TYPE.section',
    );

    const lens = SOURCES.find((source) => source.name === 'CellCausalLensReadout.tsx');
    expect(lens, 'the causal lens moved — this oracle reads files off disk')
      .toBeDefined();
    expect(code(lens?.text ?? '')).toContain('valueColor: HUD_COLORS.ember,');
    expect(code(lens?.text ?? '')).not.toContain('HUD_COLORS.caution');
  });

  it('a market moving is not a fault the DAO reports', () => {
    // `deltaColor` painted any rise `nominal` and any fall `danger`, at two
    // call sites: the 24h deposit change and the depositor count's delta. A
    // DAO total shrinking is a direction, not a pathology — and the direction
    // is already on the figure, because both formatters sign it.
    //
    // Asked as "no `danger` anywhere in the file", which is the general form
    // this surface can carry: nothing on this panel is a fault report. The
    // freshness lamp keeps `nominal`/`caution`, and that is a status lamp
    // rather than a reading — it is reporting on the RECORD, which is the one
    // thing here that can be unwell.
    const dao = SOURCES.find((source) => source.name === 'DaoStateReadout.tsx');
    expect(dao, 'the DAO readout moved — this oracle reads files off disk')
      .toBeDefined();
    const text = code(dao?.text ?? '');
    expect(text).not.toContain('HUD_COLORS.danger');
    expect(text).not.toContain('deltaColor');
    // …and the carrier that replaced the colour, on both readings. A sign is
    // a direction marker a reader already knows how to read; a ▲/▼ would be a
    // glyph none of the three Latin faces in `src/fonts` carries, which is the
    // silent-fallback failure the hand-cut face section further down exists to
    // catch.
    expect(text).toContain('formatCkb(visual.depositChange24hShannons, true)');
    expect(text).toContain('formatSignedInteger(record.depositors_change_24h)');
  });

  it('a script lifecycle word is not a verdict on the Cell wearing it', () => {
    // `scriptStateChip` ran the whole ramp across a word an upstream registry
    // attaches to a CODE HASH: `nominal` for ACTIVE, `danger` for DEPRECATED.
    // Neither end is a condition of the Cell, and a Cell locked by a
    // superseded script is not a reorg. Round 3 took the ordinary end away
    // entirely — a chip on both CODE rows of nearly every card marks nothing —
    // so the chip is the exception or it is absent, and `dim` left with it.
    //
    // Scoped to the function rather than to the file, because the dossier
    // legitimately raises a real alarm elsewhere: a decode the index could not
    // finish is a fault, and `hudTheme.ts` names decode error in the list red
    // is reserved for.
    const panel = SOURCES.find((source) => source.name === 'CellDetailPanel.tsx');
    const text = code(panel?.text ?? '');
    const start = text.indexOf('function scriptStateChip(');
    expect(start, 'scriptStateChip moved — this oracle reads files off disk')
      .toBeGreaterThan(-1);
    const chip = text.slice(start, text.indexOf('\n}', start));
    expect(chip).not.toContain('HUD_COLORS.danger');
    expect(chip).not.toContain('HUD_COLORS.nominal');
    expect(chip).toContain('HUD_COLORS.caution');
    // …and the ordinary word is not printed at all.
    expect(chip).not.toContain('ACTIVE');
  });

  it('a stranger behind NAT is not an instrument reporting on itself', () => {
    // One line served all three card variants: EXPOSURE was `nominal` when the
    // crawler could dial the node and `caution` when it could not. On the
    // mirror that is right — an undialable local node is the operator's to
    // fix. On the peer and sighted dialects the row describes somebody else's
    // node, most of the colony is behind NAT, and none of it is actionable
    // from here. `SightedNodeCard` had already written the ruling down: steel,
    // not caution, because the alarm colours belong to links that broke.
    const plate = SOURCES.find((source) => source.name === 'PeerSightingPlate.tsx');
    expect(plate, 'the dossier plate moved — this oracle reads files off disk')
      .toBeDefined();
    const text = code(plate?.text ?? '');
    expect(text).toContain("const exposureIsOurs = variant === 'self';");
    // The severity that stayed, and the steel that replaced it everywhere else.
    expect(text).toContain('? (sighting.reachable ? HUD_COLORS.nominal : HUD_COLORS.caution)');
    expect(text).toContain(': HUD_COLORS.dim}');
    // EXPOSURE is TWO rows now — one for a peer with a sighting and one for a
    // peer the network only names — and the second is the same question with
    // more of the answer in it, so it takes the same ruling from the same
    // predicate rather than a second opinion of its own. Every tinted EXPOSURE
    // value on this plate gates on `exposureIsOurs`; a row that reached for
    // `caution` directly would put an alarm colour on somebody else's NAT.
    const exposureRows = text.split('row="exposure"').slice(1);
    expect(exposureRows.length).toBe(2);
    for (const row of exposureRows) {
      const tint = row.slice(0, row.indexOf('>'));
      expect(tint).toContain('valueColor={exposureIsOurs');
    }
  });

  it('a ping that has not come back is not a link that broke', () => {
    // The compass parks an unmeasured peer on the mid ring and dashes the rim
    // to say the ring is a fallback rather than a measurement. The DASH is the
    // argument and it stays; the HUE was the unexamined half, and it was
    // `caution` on both the rim and the UNMEASURED label — a degraded link,
    // said about a live peer whose first round trip is merely still in flight.
    //
    // The flatline is deliberately NOT swept with it: `flatlined` is
    // `linkLost`, a link that really has gone, and severity there is the one
    // correct use of it on this card.
    const card = SOURCES.find((source) => source.name === 'PeerLinkCard.tsx');
    expect(card, 'the link probe moved — this oracle reads files off disk')
      .toBeDefined();
    const text = code(card?.text ?? '');
    expect(text).toContain('stroke={rgba(HUD_COLORS.dim, 0.7)}');
    expect(text).toContain('fill={HUD_COLORS.dim}');
    expect(text).toContain('stroke={rgba(HUD_COLORS.caution, 0.72)}');
    expect(text).not.toContain('stroke={rgba(HUD_COLORS.caution, 0.5)}');
    expect(text).not.toContain('fill={HUD_COLORS.caution}');
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

/** Every box in the overlay outlined on all four sides with no ground of its
 *  own, and whether it is a BLOCK rather than a chip. The three properties are
 *  the whole classifier: an all-round `1px solid` rule, some padding, and no
 *  `background`. A meter track and a plate both have a ground; a rail-hung tag
 *  draws one edge; what is left is the outlined box that holds a word. */
function boxedOutlines(
  sources: HudSource[] = domDialect(),
): Array<{ name: string; block: boolean }> {
  const found: Array<{ name: string; block: boolean }> = [];
  for (const source of sources) {
    const text = code(source.text);
    const border = /border: `1px solid /g;
    let match = border.exec(text);
    while (match !== null) {
      const object = enclosingObject(text, match.index);
      if (
        object
        && !/(?:^|[\s{,])background:/.test(object)
        && /(?:^|[\s{,])padding:/.test(object)
      ) {
        found.push({
          name: source.name,
          block: /display: '(?:block|flex|grid)'/.test(object),
        });
      }
      match = border.exec(text);
    }
  }
  return found;
}

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

  it('nothing in the HUD cuts its own outline chip', () => {
    // The cut's rule one shape over, and found the same way: by CONSTRUCT, not
    // by filename. A box outlined on all four sides in a tinted colour, holding
    // a word, with no ground of its own IS the outline chip — `plateStateChip`
    // — and five surfaces wear it. The sixth hand-rolled it: the replay
    // banner's phase tag differed from the house grammar in every one of its
    // six properties (1px 4px against 1px 5px, a 0.36 border against 0.55,
    // `nav` against `micro`, weight 400 against 700, tracking 0.9 against 1.4,
    // mono against tech) and nothing anywhere argued a single one of them.
    //
    // Blocks are not chips and the classifier says so in the property that
    // actually distinguishes them: a chip is inline and sits beside the thing
    // it qualifies, so an outlined BLOCK — a placeholder that spans its
    // column — declares `display: 'block'` and is sorted out rather than
    // listed out.
    const chips = boxedOutlines();

    // The pin, before the assertion: the sweep has to be shown reaching both
    // the primitive it is protecting and a block it is supposed to exclude, or
    // "no offenders" would be indistinguishable from "no population".
    expect(chips.filter((chip) => chip.name === SHAPE_SOURCE)).toHaveLength(1);
    // The block half is shown against a SAMPLE rather than against a file,
    // because the overlay has no outlined block in it any more: the last one
    // was the content window's `NO OUTPUT DATA` placeholder, and that window
    // stopped printing bytes on 2026-09-05 (CKBYTES reads them under the CELL
    // SCAN square now). A classifier whose exclusion has no subject is a
    // classifier nothing proves reaches one — so the subject is written here,
    // where it cannot quietly disappear again.
    const sample = boxedOutlines([{
      name: 'sample.tsx',
      text: "style={{ display: 'block', padding: '3px 5px', border: `1px solid ${rgba(HUD_COLORS.dim, 0.14)}` }}",
    }]);
    expect(sample).toEqual([{ name: 'sample.tsx', block: true }]);

    const offenders = chips
      .filter((chip) => chip.name !== SHAPE_SOURCE && !chip.block)
      .map((chip) => `${chip.name}: hand-cut outline chip → say plateStateChip`);

    expect(offenders).toEqual([]);
  });

  it('nothing in the HUD cuts its own diamond', () => {
    // The fifth mark, and the one that was never drawn: eleven `rotate(45deg)`
    // spans in five files (report F, F-12), at four sizes, six glow alphas and
    // four spellings of the same fill. Same rule as the chip's, and it can be
    // stricter than the chip's because a rotation has exactly one legitimate
    // author: `DiamondMark`, whose transform never reaches a caller.
    //
    // The angle itself is `DIAMOND_ROTATION` in `hudTheme.ts`, because one
    // diamond cannot be a component — the route ledger's scroll marker is
    // positioned from a CSS custom property and lives in the stylesheet — and
    // two authors of one angle is what this whole file is about.
    const offenders: string[] = [];
    for (const source of PACKAGE_SOURCES) {
      if (source.name.endsWith('hudTheme.ts')) continue;
      for (const _ of code(source.text).matchAll(/rotate\(45deg\)/g)) {
        offenders.push(`${source.name}: a hand-cut diamond → say DiamondMark`);
      }
    }
    expect(offenders).toEqual([]);

    // The theme writes it once, as the constant, and the stylesheet reads it.
    const theme = code(SOURCES.find((source) => source.name === 'hudTheme.ts')?.text ?? '');
    expect(theme.match(/rotate\(45deg\)/g) ?? []).toHaveLength(1);
    expect(theme).toContain("export const DIAMOND_ROTATION = 'rotate(45deg)';");
    expect(theme).toContain('${DIAMOND_ROTATION}}`');

    // …and the mark is worn, by the four surfaces that draw a point on a line.
    const wearers = SOURCES
      .filter((source) => source.name !== SHAPE_SOURCE && code(source.text).includes('<DiamondMark'))
      .map((source) => source.name)
      .sort();
    expect(wearers).toEqual([
      'ConsensusIdentityPlate.tsx',
      'PeerLinkCard.tsx',
      'StatusStrip.tsx',
    ]);
  });

  it('a menu is a floating object, and wears the cut', () => {
    // `primitives.tsx` states four forms and the PANELS dropdown wore the
    // wrong one: two docked brackets on the most transient object in the HUD,
    // and not even the house's brackets — 10 px at opacity 1 and offset −1
    // against `HudPanel`'s 11 at 0.8 (report A, A-11).
    const strip = code(SOURCES.find((source) => source.name === 'StatusStrip.tsx')?.text ?? '');
    const menu = strip.slice(strip.indexOf('data-panel-visibility-menu'));
    expect(menu.slice(0, 900), 'the panels menu lost the floating cut')
      .toContain('clipPath: PLATE_CUT_CLIP');
    expect(menu.slice(0, 900), 'the panels menu draws brackets of its own')
      .not.toMatch(/borderLeft: `1px solid \$\{HUD_COLORS\.orange\}`/);
  });

  it('an ellipsis is never left without a nowrap', () => {
    // `textOverflow` does nothing on its own: a string with a space in it
    // wraps inside the box instead of ellipsizing, and only the strings that
    // happen to have no break opportunity — hashes — looked right (report F,
    // F-17). Three sites relied on an ANCESTOR's nowrap, which is a treatment
    // one edit from breaking.
    const offenders: string[] = [];
    let sites = 0;
    for (const source of domDialect()) {
      const text = code(source.text);
      for (const site of text.matchAll(/textOverflow:\s*'ellipsis'/g)) {
        sites += 1;
        const object = enclosingObject(text, site.index ?? 0) ?? '';
        if (/whiteSpace:\s*'nowrap'/.test(object)) continue;
        offenders.push(`${source.name}: an ellipsis with nothing stopping the wrap`);
      }
    }
    expect(offenders).toEqual([]);
    expect(sites, 'no ellipsis found — did the sweep stop reading?').toBeGreaterThan(15);
  });

  it('the dead primitive is gone, and the live one is still worn', () => {
    // `ScopeStage` had zero production uses and one unit test keeping it
    // alive, which is a component the suite is testing on behalf of nobody
    // (report F, F-13). `Gauge` has one reader and stays.
    const shape = code(SOURCES.find((source) => source.name === SHAPE_SOURCE)?.text ?? '');
    expect(shape).not.toContain('export function ScopeStage');
    expect(shape).toContain('export function Gauge');
    const gaugeReaders = SOURCES
      .filter((source) => source.name !== SHAPE_SOURCE && code(source.text).includes('<Gauge'));
    expect(gaugeReaders.map((source) => source.name)).toEqual(['BackfillBar.tsx']);
  });

  /** The base a channel expression starts from, or `null` when it starts from
   *  something with a name. A literal multiplied by something is a RATIO — the
   *  0.055 the plate tail tints by — and is not a colour; a literal added to
   *  one is a GROUND, and this palette says a ground is spelled once. */
  function literalBase(argument: string): number | null {
    for (const number of argument.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)) {
      const before = argument.slice(0, number.index).trimEnd();
      const after = argument.slice((number.index ?? 0) + number[0].length).trimStart();
      if (/[*/]$/.test(before) || /^[*/]/.test(after)) continue;
      return Number(number[1]);
    }
    return null;
  }

  /** Every `rgba(` whose three channels start from literals, with those
   *  literals. Both notations: a plain triple, and one ASSEMBLED inside a
   *  template — which is the one the palette's own literal ban cannot see,
   *  because there is never a triple in the source to find. */
  function assembledColours(text: string): number[][] {
    const found: number[][] = [];
    for (const call of text.matchAll(/rgba\(/g)) {
      const start = (call.index ?? 0) + 5;
      let depth = 1;
      let end = start;
      while (end < text.length && depth > 0) {
        if (text[end] === '(') depth += 1;
        else if (text[end] === ')') depth -= 1;
        if (depth > 0) end += 1;
      }
      const args: string[] = [];
      let current = '';
      let nested = 0;
      for (const character of text.slice(start, end)) {
        if (character === '(' || character === '{') nested += 1;
        else if (character === ')' || character === '}') nested -= 1;
        if (character === ',' && nested === 0) { args.push(current); current = ''; continue; }
        current += character;
      }
      args.push(current);
      if (args.length < 3) continue;
      const bases = args.slice(0, 3).map(literalBase);
      if (bases.some((base) => base === null)) continue;
      found.push(bases as number[]);
    }
    return found;
  }

  it('a near-black is never assembled out of numbers', () => {
    // `stageGround` is the dark every floating surface is drawn on and the
    // palette says it is spelled once. Twelve spellings of it were found and
    // retired; a THIRTEENTH survived that round because it was not a spelling
    // at all — `spatialPlateTail` built one with arithmetic, `rgba(4 + r·.055,
    // 8 + g·.055, 14 + b·.055, .95)`, 6.7 from the token and invisible to a
    // sweep looking for triples (report F, F-15).
    const NEAR_BLACK = 24;
    const offenders: string[] = [];
    for (const source of domDialect()) {
      if (PALETTE_SOURCES.has(source.name)) continue;
      for (const channels of assembledColours(code(source.text))) {
        if (channels.some((channel) => channel >= NEAR_BLACK)) continue;
        offenders.push(
          `${source.name}: rgba(${channels.join(',')}…) is a near-black — say rgba(stageGround, α)`,
        );
      }
    }
    expect(offenders).toEqual([]);

    // The pin, in both notations, because a green sweep over a shape it cannot
    // parse says nothing. The first is the tail as it was; the second is the
    // tail as it is, and the difference is where the ground comes from.
    expect(assembledColours('rgba(${Math.round(4 + r * 0.055)},${Math.round(8 + g * 0.055)},${Math.round(14 + b * 0.055)},0.95)'))
      .toEqual([[4, 8, 14]]);
    expect(assembledColours('rgba(${Math.round(gr + r * 0.055)},${Math.round(gg + g * 0.055)},${Math.round(gb + b * 0.055)},0.95)'))
      .toEqual([]);
    expect(assembledColours('rgba(2,5,12,0.9)')).toEqual([[2, 5, 12]]);

    // …and the tail reads the token rather than a number that resembles it.
    const shape = code(SOURCES.find((source) => source.name === SHAPE_SOURCE)?.text ?? '');
    expect(shape).toMatch(/spatialPlateTail[\s\S]{0,600}?channels\(HUD_COLORS\.stageGround\)/);
  });

  it('one docked panel does not outrank the others', () => {
    // The ECG carried `zIndex: 12` on its `HudPanel` and no comment said why;
    // every other rail panel is auto (report F, F-14). A docked panel that
    // lifts itself above its neighbours is claiming a stacking order the rail
    // does not have.
    const offenders: string[] = [];
    for (const source of domDialect()) {
      for (const site of code(source.text).matchAll(/<HudPanel[^>]*zIndex:\s*(\d+)/g)) {
        offenders.push(`${source.name}: a docked panel at zIndex ${site[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the outline chip is worn outside the file that describes it', () => {
    const wearers = SOURCES.filter(
      (source) => source.name !== SHAPE_SOURCE
        && code(source.text).includes('plateStateChip('),
    );

    // Six surfaces, and the replay banner is the one that hand-rolled its own
    // for the life of the file, so naming it here is what stops the
    // convergence being quietly undone. The miner card is the newest and wears
    // three of them — the evidence class beside its masthead, the caveat on
    // what the miner said about itself, and the verdict on the join over it.
    expect(wearers.map((source) => source.name).sort()).toEqual([
      'BackfillBar.tsx',
      'CellDetailPanel.tsx',
      'MinerNodeCard.tsx',
      'NodeSelfCard.tsx',
      'PeerLinkCard.tsx',
      'SightedNodeCard.tsx',
    ]);
  });
});

// ——— One hero, one register ————————————————————————————————————————————
//
// Three rules about which reading outranks which, each of them a place where
// two ladders were pointing at two different numbers.
//
// `HUD_TYPE.hero` is documented as "the single numeral a panel exists to show"
// and `HUD_COLORS.heroInk` as "the ONE hero numeral a panel exists to show".
// Two tokens, one claim, and CELL MESH was the only panel that spent both — the
// 22px net-per-block rate in its metabolic pair, and the white on a stat row
// three readings under it. DAO·05 spends both on ONE number, which is what the
// two tokens agreeing looks like; PULSE spends the size alone.
//
// ⚠️⚠️ AND THE RULE USED TO EXCUSE THE ONE SURFACE IT WAS WRITTEN FOR. The
// sweep opened with "if this file has no hero rung, skip it", which reads as a
// cheap exit and is in fact a hole the exact shape of the defect: a file
// wearing `heroInk` on something that is NOT a hero has, by definition, no
// hero rung to be found — so `BlockchainReadout.tsx` wore the hero ink on a 14
// px stat-row value for the whole life of the rule and was never once read
// (report A, A-3; report F's guard-gap table). The ink is the claim; a file
// that makes the claim is examined whether or not it also has a hero.
//
// `plateStateChip` is the second. A chip is a state word beside an identity, so
// it may be tinted by the surface it sits on or by a severity — and by nothing
// else, because anything else makes the chip a member of a family it is not in.
// `NodeSelfCard` tinted MINER in `lockedGold`, which is the token for value and
// for things HELD: the locked evidence row, the locked route hop, the identity
// proof that has been read, `CONTENT_BANDS.value`. A node that mines is none of
// those, and the same slot then read chain-anchor cyan for OBSERVER — one chip
// changing what KIND of thing it was according to what the node does.
//
// And the third is the dossier's evidence register, which is one type size. The
// rows step down to `label` and the one thing at `value` is `CompositionBlock`,
// which is at `value` because it stopped being a row.

describe('one hero, one register', () => {
  it('a panel that spends both hero tiers spends them on one number', () => {
    const offenders: string[] = [];
    const wearers: string[] = [];
    for (const source of domDialect()) {
      const text = code(source.text);
      // NO early exit on "no hero rung here" — see the chapter above.
      if (!/color: HUD_COLORS\.heroInk/.test(text)) continue;
      wearers.push(source.name);

      const heroes: string[] = [];
      const size = /fontSize: HUD_TYPE\.hero\b/g;
      let match = size.exec(text);
      while (match !== null) {
        const object = enclosingObject(text, match.index);
        if (object) heroes.push(object);
        match = size.exec(text);
      }

      const ink = /color: HUD_COLORS\.heroInk/g;
      match = ink.exec(text);
      while (match !== null) {
        const object = enclosingObject(text, match.index);
        if (object && !heroes.includes(object)) {
          offenders.push(`${source.name}: heroInk is on a reading the hero rung is not`);
        }
        match = ink.exec(text);
      }
    }

    expect(offenders).toEqual([]);

    // …and the sweep read the files that make the claim rather than none. Both
    // are named, because "the set is non-empty" would have been satisfied by
    // DAO·05 alone for the whole time CKB·01 was the offender.
    expect(wearers.sort()).toEqual(['BlockchainReadout.tsx', 'DaoStateReadout.tsx']);
  });

  it('a stat row carrying a lifted numeral is a lifted row', () => {
    // The rhythm's toll. A `StatRow` is a fixed box with a baseline-aligned
    // line inside it, so a numeral from a rung above the row's own value tier
    // takes its extra height out of the gap BELOW the baseline and the next row
    // arrives 5 px early — 12 px and 11 px measured against a 17 px rail
    // (report A, A-4). The row grows with the numeral or the rhythm breaks, so
    // the two are declared together on the same element.
    const rungs = Object.keys(STAT_ROW_LIFTED_HEIGHT_PX);
    const offenders: string[] = [];
    const lifted: string[] = [];
    for (const source of domDialect()) {
      const text = code(source.text);
      for (const row of text.matchAll(/<StatRow\b[\s\S]*?<\/StatRow>/g)) {
        const block = row[0];
        const open = /<StatRow\b[^>]*>/.exec(block)?.[0] ?? '';
        const declared = /lifted="(\w+)"/.exec(open)?.[1];
        const carried = rungs.filter(
          (rung) => new RegExp(`fontSize: HUD_TYPE\\.${rung}\\b`).test(block),
        );
        // A label may be authored (`label="Tip"`) or read from a table
        // (``label={`${POPULATION_SCOPE.observed} LIVE`}``); both are names.
        const label = /label=(\{`[^`]*`\}|\{[^}]*\}|"[^"]*")/.exec(open)?.[1] ?? '?';
        const where = `${source.name}: ${label.replace(/^\{|\}$/g, '').replace(/^"|"$/g, '')}`;
        if (carried.length > 1) {
          offenders.push(`${where} carries two lifted rungs at once`);
        } else if (declared !== carried[0]) {
          offenders.push(
            `${where} declares lifted=${declared ?? 'nothing'} and carries ${carried[0] ?? 'nothing'}`,
          );
        }
        if (declared !== undefined) lifted.push(where);
      }
    }

    expect(offenders).toEqual([]);

    // The three rows the ladder was applied to, named — a rule about lifted
    // rows passes trivially on a rail that has none.
    expect(lifted.sort()).toEqual([
      'BlockchainReadout.tsx: Tip',
      'CellsPanel.tsx: `${POPULATION_SCOPE.observed} LIVE`',
      'NetworkPanel.tsx: Peers',
    ]);
  });

  it('the rail has one rhythm and one height per lifted rung', () => {
    // The numbers themselves, so a row cannot be quietly re-heighted into the
    // collision the lift was meant to end. Each lifted height is the rhythm
    // plus the ascent its rung adds over a plain mono value — the arithmetic is
    // in `primitives.tsx`; what is pinned here is that the answers still are
    // what the rows were measured at.
    expect(STAT_ROW_HEIGHT_PX).toBe(17);
    expect(STAT_ROW_LIFTED_HEIGHT_PX).toEqual({ emphasis: 19, hero: 25 });

    // …and every lifted rung is above the row's own value tier, which is the
    // only reason a row needs a second height at all.
    for (const rung of Object.keys(STAT_ROW_LIFTED_HEIGHT_PX)) {
      expect(HUD_TYPE[rung as keyof typeof HUD_TYPE]).toBeGreaterThan(HUD_TYPE.value);
      expect(STAT_ROW_LIFTED_HEIGHT_PX[rung as keyof typeof STAT_ROW_LIFTED_HEIGHT_PX])
        .toBeGreaterThan(STAT_ROW_HEIGHT_PX);
    }
  });

  it('finds a panel spending both tiers on one number', () => {
    // The pin. The rule above passes trivially on a HUD where nothing wears
    // the hero rung at all, so it has to be shown the surface it is modelled
    // on: DAO·05's deposit total is `hero` and `heroInk` in one style object.
    const dao = SOURCES.find((source) => source.name === 'DaoStateReadout.tsx');
    const text = code(dao?.text ?? '');
    const at = text.indexOf('color: HUD_COLORS.heroInk');
    expect(at, 'the DAO hero moved — this oracle reads files off disk').toBeGreaterThan(-1);
    expect(enclosingObject(text, at)).toContain('fontSize: HUD_TYPE.hero');
  });

  it('a state chip is tinted by its surface or by a severity, never by a family', () => {
    // Every argument `plateStateChip` is called with, across the whole
    // directory. A bare identifier is the surface's own accent — `accent`,
    // `color`, `visual.color` — and a `HUD_COLORS.` name has to be one the
    // chip grammar admits: instrument grey for a condition that is merely the
    // normal one, or a rung of the ramp at or above `caution` for one worth
    // noticing. `nominal` is not on the list for the reason `scriptStateChip`
    // states: a chip that sounds the ordinary case turns it into a verdict.
    const ALLOWED_TOKENS = ['dim', 'caution', 'warning', 'danger'];
    const offenders: string[] = [];
    for (const source of SOURCES) {
      if (source.name === SHAPE_SOURCE) continue;
      const call = /plateStateChip\(\s*([^)]*?)\s*\)/g;
      let match = call.exec(code(source.text));
      while (match !== null) {
        const tint = match[1].trim();
        const tokens = [...tint.matchAll(/HUD_COLORS\.(\w+)/g)].map((hit) => hit[1]);
        for (const token of tokens) {
          if (!ALLOWED_TOKENS.includes(token)) {
            offenders.push(`${source.name}: a state chip tinted HUD_COLORS.${token}`);
          }
        }
        match = call.exec(code(source.text));
      }
    }

    expect(offenders).toEqual([]);

    // …and that the sweep is reading real call sites rather than none.
    const wearers = SOURCES.filter(
      (source) => source.name !== SHAPE_SOURCE
        && code(source.text).includes('plateStateChip('),
    );
    expect(wearers.length).toBeGreaterThanOrEqual(5);
  });

  it('the dossier evidence register is one type size', () => {
    // AMOUNT was lifted to `value` while IDENTITY directly beneath it stayed at
    // `label` — two rungs apart, both `goldInk`, both about the same asset, no
    // rule anywhere. `ClusterRow` already defaults to the evidence tier, so a
    // register with one size is a register where nobody overrides it.
    const panel = SOURCES.find((source) => source.name === 'CellDetailPanel.tsx');
    expect(panel, 'the cell dossier moved — this oracle reads files off disk')
      .toBeDefined();
    const text = code(panel?.text ?? '');
    expect(text).toContain('valueSize = HUD_TYPE.label,');

    const rows = [...text.matchAll(/<ClusterRow\b[\s\S]*?\/>/g)].map((hit) => hit[0]);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((row) => /valueSize=/.test(row))).toEqual([]);
  });

  it('STAGE·07 runs two registers and every row is wholly in one', () => {
    // The funnel's staircase is the panel's stat-row voice; the mix block is a
    // denser one. `ReserveRow` is the same three parts as `FunnelRow` in the
    // same order and takes the MIX register, because it leads the mix block —
    // which is argued in the file rather than left to be inferred from a
    // resemblance. What is checked is that it is property-for-property with
    // the block it leads, so "it is in that register" cannot quietly become
    // "it is in neither".
    const panel = SOURCES.find((source) => source.name === 'StageCapacityPanel.tsx');
    expect(panel, 'STAGE·07 moved — this oracle reads files off disk').toBeDefined();
    const text = code(panel?.text ?? '');

    const labelStyle = (fn: string, renders: string): string => {
      const start = text.indexOf(`function ${fn}(`);
      expect(start, `${fn} moved — this oracle reads files off disk`).toBeGreaterThan(-1);
      const after = text.slice(start + 1).search(/\n(?:export )?(?:function|const|type|interface) /);
      const body = text.slice(start, after === -1 ? text.length : start + 1 + after);
      return styleRendering(body, renders);
    };

    const register = (style: string) => ({
      size: /fontSize: HUD_TYPE\.(\w+)/.exec(style)?.[1],
      tracking: /letterSpacing: ([\d.]+)/.exec(style)?.[1],
    });

    const funnel = register(labelStyle('FunnelRow', '{label}'));
    const reserve = register(labelStyle('ReserveRow', '{row.label}'));
    const mix = register(labelStyle('MixBar', '{mix.label}'));

    expect(funnel).toEqual({ size: 'tech', tracking: '1.6' });
    expect(reserve).toEqual(mix);
    expect(reserve).not.toEqual(funnel);
  });
});

// ——— A limit on what we saw is not a fault ——————————————————————————————
//
// Two more places the severity ramp was being spent on something that is not a
// condition of anything, found the same way the spent Cell and the deprecated
// script were.
//
// `SemanticFacet.state` is a wire SLOT rather than a fact. The dossier draws it
// four times and the four are four different subjects: a DAO lifecycle
// position, a collection's NAME, a durability tier, and — for a facet this side
// has no block for — whatever word the index attached. Three of those are read
// in the colour of what they ARE, argued where each is drawn. The fourth was
// `caution`, which said the middle of the severity ramp about a word nobody
// here has read.
//
// And the content window said a partial decode in `caution` over `nominal`,
// which is the same pair `scriptStateChip` was carrying: a complete read
// printed as a pass mark, a partial one as a degradation. Neither is either.
// The Cell's OTHER surface for that fact had already ruled correctly and
// silently — `CellByteBudget` marks a truncated data window with an opacity
// drop, a dashed rule and a `dim` OBSERVED, and raises nothing — so this is
// two surfaces agreeing rather than a new judgement.

describe('a limit on what we saw is not a fault', () => {
  it('the four subjects behind one wire field are read as four subjects', () => {
    const readout = SOURCES.find((source) => source.name === 'CellSemanticsReadout.tsx');
    const panel = SOURCES.find((source) => source.name === 'CellDetailPanel.tsx');
    expect(readout, 'the semantics readout moved — this oracle reads files off disk')
      .toBeDefined();
    expect(panel, 'the cell dossier moved — this oracle reads files off disk')
      .toBeDefined();

    // The generic facet: no ink of its own at all now, which is the point —
    // the row takes `PlateReadoutRow`'s default, and the default is the ink a
    // fact is written in. Scoped to the function, because the file raises a
    // real alarm elsewhere: an enrichment source that has gone stale is a
    // condition of the RECORD, and that is what the middle rung is for.
    const text = code(readout?.text ?? '');
    const start = text.indexOf('export function FacetEvidenceRow(');
    expect(start, 'FacetEvidenceRow moved — this oracle reads files off disk')
      .toBeGreaterThan(-1);
    // Cut at the next top-level declaration rather than at the first `}` in
    // column one: this function's props are a multi-line type annotation, so
    // the closing `})` of the SIGNATURE is in column one and a naive cut reads
    // none of the body. That is the failure mode of a scoped assertion — it
    // passes, and it passes because it is looking at nothing.
    const after = text.slice(start + 1).search(/\n(?:export )?(?:function|const|type|interface) /);
    const row = text.slice(start, after === -1 ? text.length : start + 1 + after);
    expect(row, 'the slice missed the body').toContain('PlateReadoutRow');
    for (const severity of ['caution', 'warning', 'danger', 'nominal', 'crit']) {
      expect(row, `the generic facet row reads a state as ${severity}`)
        .not.toContain(`HUD_COLORS.${severity}`);
    }
    // …and that the file still has a use for the ramp, so the scoping above is
    // a real distinction rather than a file that happens to be clean.
    expect(text).toContain('HUD_COLORS.caution');

    // The three that are argued, each in the colour of its own subject.
    const dossier = code(panel?.text ?? '');
    expect(dossier).toContain('value={daoFacet.state.toUpperCase()}');
    expect(dossier).toContain('valueColor={collectionValueColor}');
    expect(dossier).toContain('tier={compositionHeadline}');
    expect(dossier).toContain('const color = compositionTierColor(tier);');
  });

  it('the generic facet row is the dialect\'s row, railed in its cluster\'s accent', () => {
    // It hand-drew one: a rail at 0.22 against `PLATE_ROW_RAIL_ALPHA`, in
    // `cyanWire` while every sibling row in the cluster took the cluster's
    // accent, indented 6px against 9. Nothing but the dossier ever rendered
    // it, so there was no second consumer the divergence was for.
    const readout = SOURCES.find((source) => source.name === 'CellSemanticsReadout.tsx');
    const text = code(readout?.text ?? '');
    expect(text).toContain('<PlateReadoutRow');
    expect(text, 'the facet row draws its own rail again').not.toContain('borderLeft:');

    // The accent arrives from the caller. A row that names its own rail colour
    // is a row that cannot sit in a second cluster.
    expect(text).toContain('accent={accent}');
    const panel = SOURCES.find((source) => source.name === 'CellDetailPanel.tsx');
    expect(code(panel?.text ?? '')).toContain('accent={assetAccent}\n                      revealAt');
  });

  it('both surfaces that report a partial read report it without severity', () => {
    // The general form on the budget side — nothing in a byte decomposition is
    // a fault report — and the specific reading on the window side.
    const budget = SOURCES.find((source) => source.name === 'CellByteBudget.tsx');
    expect(budget, 'the byte budget moved — this oracle reads files off disk')
      .toBeDefined();
    const budgetText = code(budget?.text ?? '');
    for (const severity of ['caution', 'warning', 'danger', 'nominal', 'crit']) {
      expect(budgetText, `the byte budget raises ${severity}`)
        .not.toContain(`HUD_COLORS.${severity}`);
    }
    // …and the carriers that do the work instead, which is what makes the
    // absence a ruling rather than an omission.
    expect(budgetText).toContain('opacity: partial ? STALE_OPACITY : 1');
    expect(budgetText).toContain('borderTop: partial ? `1px dashed');
    expect(budgetText).toContain('OBSERVED');

    // The reading side moved on 2026-09-05: the DATA cluster prints no bytes
    // and states no size, so the surface that says "we are holding a kilobyte
    // of a seven-kilobyte Cell" is CKBYTES' foot line. Same ruling, same
    // carriers — words and the ink a reading is written in, never a severity.
    const reader = SOURCES.find((source) => source.name === 'CellDataReader.tsx');
    expect(reader, 'the reader moved — this oracle reads files off disk')
      .toBeDefined();
    const readerText = code(reader?.text ?? '');
    for (const severity of ['caution', 'warning', 'danger', 'crit']) {
      expect(readerText, `the reader raises ${severity}`)
        .not.toContain(`HUD_COLORS.${severity}`);
    }
    expect(readerText).toContain("say('READING ');");
    expect(readerText).toContain('HELD');
    // `nominal` survives in exactly one place, and it is not a partial read:
    // `COMPLETE` is the one word on that line that IS a state.
    expect(readerText.match(/HUD_COLORS\.nominal/g)).toHaveLength(1);
    expect(readerText).toContain("say('COMPLETE', HUD_COLORS.nominal);");
  });
});

// ——— One case ———————————————————————————————————————————————————————————
//
// The overlay is set in capitals: the type is small, the faces are technical,
// and a word in sentence case in the middle of a panel reads as a caption from
// a different instrument. Every surface obeys that, and most of them obey it in
// CSS — `StatRow`, `MetricLabel`, `SUBHEAD` and the scope tags all declare
// `textTransform: 'uppercase'` and let the caller author whatever it likes.
//
// PEER·02 did not. Five authored words — `out`, `in`, and the three consensus
// tallies `at-tip` / `behind` / `ahead` — shipped lowercase in a panel whose
// own `StatRow` labels are uppercased one line above them.
//
// ⚠️ The second surface is GONE. `NodeSelfCard` used to state the identical
// `OUT n / IN n` reading and was the reference this rule was written against;
// it gave that reading up with the rest of the census it was copying off this
// panel (report C, C-6). The rule was never about having two witnesses — it is
// that this panel authored five lowercase words under its own uppercase
// labels — so it is stated on the panel that has them.
//
// THE WORD SIDE OF THIS IS NOT DERIVED AND THE REASON IS WORTH SAYING, because
// the obvious general rule looks derivable and is not: half the overlay's
// uppercase is declared on a COMPONENT — `<MetricLabel>Total deposited</
// MetricLabel>` is correct and a text sweep sees a lowercase word with no
// transform in sight — so a rule of the form "no lowercase text node" would
// have to resolve every JSX tag in the directory to its own style object
// before it could tell a defect from a component doing its job. So the words
// are pinned per surface, the way the three surfaces naming a spent Cell are.
//
// ⚠️ THE SECOND HALF OF THAT PARAGRAPH IS RETRACTED. It used to end "and under
// that there is a second question it would be wrong about: `net /blk` and
// `· per block` are UNITS, and lowercase units are typography rather than
// drift." They were the only authored lowercase words left on the rails, they
// stood directly under CELL·03's own uppercase labels, and the same panel's
// `+16 groups` was neither a unit nor typography (report A, A-13). The user's
// ruling is one case, units included; they are up, and this pins them.
//
// AND THE UNIT SIDE **IS** DERIVED, because a unit is written next to a value
// and that is a shape a source can be read for. Every time a span reaches a
// reader — `8.0S`, `8/MIN`, `7D`, `1M 58S`, `62H 34M` — it comes out of a
// formatter that interpolates the figure and then types the unit, so the rule
// is: no interpolation in this package is followed by a lowercase time unit.
// Three formatters printed five spellings between them (`formatAge`,
// `formatStreamAge`, `formatLinkUptime`), the rails hid two of them under a
// container's `textTransform` and the cards did not, and that is how one
// reading came to be printed in two voices.

describe('one case', () => {
  it('the panel that counts links states it in the HUD\'s one case', () => {
    const panel = SOURCES.find((source) => source.name === 'NetworkPanel.tsx');
    const card = SOURCES.find((source) => source.name === 'NodeSelfCard.tsx');
    expect(panel, 'PEER·02 moved — this oracle reads files off disk').toBeDefined();
    expect(card, 'the self probe moved — this oracle reads files off disk').toBeDefined();

    // The self probe states no link direction at all now, and may not take one
    // back without arguing it: the reading is the panel's.
    expect(code(card?.text ?? '')).not.toContain('summary.outbound');

    const text = code(panel?.text ?? '');
    expect(text).toContain('>OUT</span>');
    expect(text).toContain('>IN</span>');
    for (const lowercase of ['>out<', '>in<', ' at-tip', ' behind<', ' ahead<']) {
      expect(text, `PEER·02 says ${lowercase} in lower case`).not.toContain(lowercase);
    }
  });

  it('the consensus legend is three tallies in one case', () => {
    const panel = SOURCES.find((source) => source.name === 'NetworkPanel.tsx');
    const text = code(panel?.text ?? '');
    for (const tally of ['AT-TIP', 'BEHIND', 'AHEAD']) {
      expect(text, `the ${tally} tally lost its case`).toContain(tally);
    }
  });

  it('the rails author no lowercase word of their own, units included', () => {
    // The three the ruling names, each with its negative beside it so a
    // half-revert cannot pass.
    const says = (file: string, up: string, down: string) => {
      const source = SOURCES.find((entry) => entry.name === file);
      expect(source, `${file} moved — this oracle reads files off disk`).toBeDefined();
      const text = code(source?.text ?? '');
      expect(text, `${file} lost ${up}`).toContain(up);
      expect(text, `${file} still says ${down}`).not.toContain(down);
    };
    says('CellsPanel.tsx', '>METABOLISM · PER BLOCK<', 'per block');
    says('CellsPanel.tsx', '>NET/BLK<', 'net /blk');
    says('NetworkAtlasReadout.tsx', 'GROUPS', ' groups');
  });

  it('no figure in this package is followed by a lowercase time unit', () => {
    // A unit is typed right after the figure it belongs to, which makes the
    // rule readable off the source: an interpolation, then the unit. `ms` in a
    // CSS duration is not one of these — it is not a word in this set — and a
    // literal `160ms` inside a transition string carries no interpolation.
    const offenders: string[] = [];
    let units = 0;
    for (const source of PACKAGE_SOURCES) {
      const text = code(source.text);
      for (const hit of text.matchAll(/\}(S|M|H|D|MIN|s|m|h|d|min)\b/g)) {
        units += 1;
        if (hit[1] === hit[1].toLowerCase()) {
          const at = text.slice(Math.max(0, hit.index - 40), hit.index + 8).replace(/\n/g, ' ');
          offenders.push(`${source.name}: …${at}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // …and it read real ones: three formatters and a cadence panel print them.
    expect(units).toBeGreaterThanOrEqual(8);
  });
});

// ——— One register below ————————————————————————————————————————————————
//
// Two readouts can be on screen at once while the world is still arriving: the
// replay plate (the chain being repaired) and the boot band's composing chapter
// (the stage still being composed). One of them is a fault surface and the
// other is a disclosure, and the disclosure says in its own doc comment that
// "quiet is still the register".
//
// That claim used to be false in the one place it is easiest to check. The bar
// puts its TITLE in the accent and its counted form in `dim`; the readout that
// defers to it had them the other way round — the label `dim`, the count at
// full `cyanWire` — so its brightest element was louder than the same element
// on the surface it defers to, and a deferral that inverts the hierarchy of the
// thing it defers to is not a deferral. A claim in a doc comment that the code
// contradicts is worse than no claim, because the next reader takes it as
// settled.
//
// So the claim is checked. Not "the chapter is quieter" — that is a rendering
// question no source oracle can answer — but the two things that made it
// false: the roles its two inks are assigned to, and whether it can reach for
// a colour that means something is wrong.

describe('one register below', () => {
  it('the plate and the chapter that defers to it rank their two words alike', () => {
    // The title span and the counted-form span of each, found by the text node
    // each one renders rather than by position, so a reordered row is read
    // correctly and a renamed one fails loudly.
    const ink = (file: string, renders: string) => {
      const source = SOURCES.find((entry) => entry.name === file);
      expect(source, `${file} moved — this oracle reads files off disk`).toBeDefined();
      const style = styleRendering(code(source?.text ?? ''), renders);
      return {
        accent: /(?<![\w])(?:visual\.)?color(?=[,}\s])/.test(style)
          || /HUD_COLORS\.cyanWire/.test(style),
        dim: /HUD_COLORS\.dim/.test(style),
      };
    };

    // The bar's title is the accent; the chapter's title is the band's, handed
    // to `TopBand` as a prop rather than styled here — which is the same
    // assignment made structural.
    expect(ink('BackfillBar.tsx', '{visual.title}')).toEqual({ accent: true, dim: false });
    const chapter = SOURCES.find((entry) => entry.name === 'StageComposingBanner.tsx');
    expect(chapter, 'the composing chapter moved — this oracle reads files off disk')
      .toBeDefined();
    expect(code(chapter?.text ?? '')).toContain('accent={HUD_COLORS.cyanWire}');

    // The counted forms: `dim`, on both. The bar's span carries the accent too
    // — the same span prints its WAITING sentence when there is nothing to
    // count yet, and a sentence is words rather than a measurement — which is
    // why this is read as "does it dim its count" rather than as an equality
    // between two spans that are not doing the same number of jobs.
    expect(ink('BackfillBar.tsx', '{waiting ? visual.waiting : `${fmt(done)} / ${fmt(total)} blocks`}').dim)
      .toBe(true);
    expect(ink('StageComposingBanner.tsx', '{line.text}'))
      .toEqual({ accent: false, dim: true });
  });

  it('the chapter cannot reach for a colour that means something is wrong', () => {
    // The other half of "quiet": a composing stage is the organism living, so
    // the chapter has exactly one ink and it is the instrument's own wire.
    // Every state colour in the HUD means health, and none of them is this.
    const chapter = SOURCES.find((source) => source.name === 'StageComposingBanner.tsx');
    expect(chapter, 'the composing chapter moved — this oracle reads files off disk')
      .toBeDefined();
    const text = code(chapter?.text ?? '');
    for (const token of ['nominal', 'caution', 'warning', 'danger', 'crit', 'memory']) {
      expect(text, `the composing chapter reached for ${token}`)
        .not.toContain(`HUD_COLORS.${token}`);
    }
    // …and it does not animate. The boot chapter's stillness is a contract the
    // static shell set, and the chapter that succeeds it keeps it.
    expect(text).not.toMatch(/animation/);
  });
});

// ——— The edge-bound stack ———————————————————————————————————————————————
//
// Three surfaces span the viewport under the status strip and none of them is
// a card you could have opened, so `primitives.tsx` gives all three the same
// form: no brackets, no cut corner, the viewport ends them. What the shape
// grammar does NOT say is which of them are the same OBJECT, and that is the
// question a reader answers in a tenth of a second and this file had nothing
// to say about.
//
// Two of them are: `StreamHealthBanner` and `BootSequenceBanner` are two
// TENANTS OF ONE SLOT — `HudOverlay` renders whichever applies and never both
// — and they are one formula to the digit because two objects that swap in and
// out of one place must not read as two kinds of thing. That agreement is what
// the first assertion holds, and it is worth holding: it was reached by the
// boot band copying the health band, which is the kind of agreement that
// survives exactly as long as nobody edits one of them.
//
// The alarm is NOT the third tenant. It stands at `topBarHeight + 30` whenever
// a banner is up, so it is the second band in a STACK — co-present with a
// banner in the two states that matter most, which the banners can never be
// with each other. Two stacked bands cut to one formula are one 64px band with
// a seam in it. So it closes both edges instead of one, lays a flat ground
// instead of a gradient that fades out under `crit`'s hazard banding, and runs
// 4px taller. `WarningBar.tsx` argues each of those three; what is CHECKED
// here is the one part of it that is arithmetic rather than judgement — that
// the banding may never cross the type it is banding.

/** Everything that rents the top slot. Listed rather than discovered: a
 *  fourth tenant added without a line here is a readout nobody decided
 *  belonged in a slot that holds one voice. */
const TOP_BAND_TENANTS = [
  'BootSequenceBanner.tsx',
  'StageComposingBanner.tsx',
  'StreamHealthBanner.tsx',
] as const;

describe('the edge-bound stack', () => {
  it('every tenant of the top slot is the same band', () => {
    // Three readouts take this slot and never two at a time: the boot record,
    // the stage composing after it, and the data plane being unwell. They are
    // one OBJECT changing what it says — which used to be an AGREEMENT between
    // copies of one formula, re-read out of two files by this oracle, and an
    // agreement survives exactly as long as nobody edits one copy.
    //
    // It is now structural: the formula lives in `TopBand` and the tenants
    // render through it. So the question changed shape too — not "do the files
    // still spell the same numbers" but "does any tenant draw its own band".
    const band = SOURCES.find((source) => source.name === 'TopBand.tsx');
    expect(band, 'the band moved — this oracle reads files off disk').toBeDefined();

    const formula = (text: string): string[] => {
      const ground = /background: `linear-gradient\(90deg,transparent,\$\{rgba\([\w.]+, ([\d.]+)\)\} 28%,\$\{rgba\(HUD_COLORS\.ground, ([\d.]+)\)\} 50%,\$\{rgba\([\w.]+, ([\d.]+)\)\} 72%,transparent\)`/.exec(text);
      const edge = /borderBottom: `1px solid \$\{rgba\([\w.]+, ([\d.]+)\)\}`/.exec(text);
      const height = /\n\s+height: TOP_BAND_HEIGHT,/.exec(text);
      return [
        `ground ${ground?.slice(1).join('/') ?? 'none'}`,
        `edge ${edge?.[1] ?? 'none'}`,
        `height ${height ? String(TOP_BAND_HEIGHT) : 'none'}`,
      ];
    };
    expect(formula(code(band?.text ?? '')))
      .toEqual(['ground 0.13/0.78/0.13', 'edge 0.45', 'height 30']);

    // And that no tenant kept a copy: a band drawn anywhere else in the HUD is
    // a second kind of object in a one-object slot, which is the whole defect.
    for (const source of SOURCES) {
      if (source.name === 'TopBand.tsx') continue;
      expect(
        code(source.text),
        `${source.name} draws its own edge-bound band — the slot holds one object`,
      ).not.toMatch(/borderBottom: `1px solid \$\{rgba\([\w.]+, 0\.45\)\}`/);
    }

    // The tenants, named: each one hands `TopBand` an accent and a title and
    // owns nothing else about the shape.
    for (const name of TOP_BAND_TENANTS) {
      const tenant = SOURCES.find((source) => source.name === name);
      expect(tenant, `${name} moved — this oracle reads files off disk`).toBeDefined();
      const text = code(tenant?.text ?? '');
      expect(text, `${name} stopped renting the band`).toMatch(/<TopBand\b/);
    }
  });

  it('the alarm is a second band, and its banding never crosses its type', () => {
    // `crit` escalates in shape: 4px of hazard banding along both edges, which
    // is the one part of the alarm that still speaks when the flash is off for
    // reduced motion. It eats `2 × HAZARD_BAND_PX` of the band, and what is
    // left has to hold the tallest type in the HUD's second-largest rung.
    //
    // This does not pin 34 — the extra 4px over a banner is a judgement and
    // `WarningBar.tsx` says so. It pins the floor under that judgement: drop
    // the band far enough and the stripes run through the 警告.
    expect(WARNING_BAR_HEIGHT - 2 * HAZARD_BAND_PX).toBeGreaterThan(HUD_TYPE.heroSub);

    // And that it really is the second band rather than a third tenant: the
    // alarm's own offset adds the banner's height, so the two stack.
    const overlay = SOURCES.find((source) => source.name === 'HudOverlay.tsx');
    expect(overlay, 'the overlay moved — this oracle reads files off disk')
      .toBeDefined();
    const text = code(overlay?.text ?? '');
    expect(text).toContain('top={topBarHeight + (topBandVisible || streamInterrupted ? 30 : 0)}');
    // …while the tenants are alternatives, which is the whole reason they are
    // allowed to be one shape: the health band waits for an empty slot, and
    // the composing chapter waits for the boot chapter to finish speaking.
    // (The band derives its own summary inside a clock leaf; the slot is
    // still arbitrated on the record's presence, here, before it mounts.)
    expect(text).toContain('streamHealth && !topBandVisible');
    expect(text).toContain('const stageComposingVisible = stageCompose.visible');
    expect(text).toContain('&& !bootReadoutVisible');
  });

  it('the alarm closes both edges and the banners close one', () => {
    // The visible half of "second band, not third tenant". A banner's top edge
    // is the status strip's bottom edge, so it draws none; the alarm has a
    // band above it as often as not and needs its own.
    const alarm = SOURCES.find((source) => source.name === 'WarningBar.tsx');
    expect(alarm, 'the alarm moved — this oracle reads files off disk').toBeDefined();
    const text = code(alarm?.text ?? '');
    expect(text).toContain('borderTop: `1px solid ${color}`');
    expect(text).toContain('borderBottom: `1px solid ${color}`');

    const band = SOURCES.find((source) => source.name === 'TopBand.tsx');
    expect(code(band?.text ?? ''), 'the band grew a top edge').not.toMatch(/borderTop:/);
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
 *  bucket of the peer atlas.
 *
 *  The feed and the atlas ramp live in `derives/`, and for the life of that
 *  directory nothing there was checked by anything. Each drifted the way an
 *  unchecked palette does: the feed disagreed with the bands about five words
 *  it shares with them, the atlas ramp opened on a near-chrome orange, and the
 *  chain's capacity bar — retired since for a count bar in the census's own
 *  class hues — painted its unnameable bucket in the brightest hue on the
 *  panel. A category
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
  // the single worst offender here and on the chain's capacity bar (since
  // retired for a count bar in the census's own class hues, which has no
  // unnamed bucket to paint).
  activity: { ...ACTIVITY_CATEGORY_COLORS, unlisted: ACTIVITY_UNLISTED_COLOR },
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
  // The chain by the index's menu — CELL CENSUS's one bar: six words the
  // activity feed already speaks, in the bands it speaks them in. Registered
  // as its own surface because it is one stacked strip a reader sees whole,
  // and a matrix that only checked the feed would never see these six touch.
  inventory: INVENTORY_COLORS,
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
  // A fifth time, on the CELL CENSUS bar: bare CKB is bare CKB on the chain
  // as on the stage, and it wears the consensus's own colour there too.
  'inventory.native → cyanWire',
  'inventory.native → peerWire',
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
    // DIRECTORY rather than three more rows on a list of values: the three
    // hexes that were here are Tailwind defaults, and two HUD scene files
    // legitimately spell two of them as `THREE.Color` arguments. Naming the
    // values would have meant exempting those, which is the trade this file
    // exists to refuse. The inversion reaches the same answer from the other
    // side — a literal is illegal here whatever it is — and this stays because
    // it says something the general rule cannot: not just that the plumbing
    // writes no colour down, but that it has no business having one.
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
    // `SEGMENT_COLORS.lock` / `.type` used to be pinned here too, for the two
    // labels this overlay hung off the braid. Round 3 removed the labels (they
    // said what the LOCK and ASSET facts say, in 6 px text a 280 px box clipped),
    // and a pin on a surface that no longer draws is a pin on nothing.
    expect(text).not.toContain('<Html');

    // …and the byte segments' own ramp, whose slots are handed out by a hash of
    // a label — nothing, which is exactly what the house's qualitative ramp is
    // for. The private four it used instead had a member 9.8 from `cellRose`,
    // so a stretch of an ordinary Cell's bytes wore the colour that names the
    // Cell organism itself, and another 39.2 from `warning`.
    expect(text).toContain('QUALITATIVE_BUCKET_COLORS[');

    // …and the one literal that used to be left. A facet glyph is not one of
    // the four byte axes and no band names it, so it stayed a hex here while
    // the same value was typed again in the morphology lab. It is
    // `FACET_GLYPH_COLOR` now, in the file the other three tables come from —
    // asked as the whole list rather than as a count, so a table growing back
    // here says which values came with it.
    expect(text).toContain('FACET_GLYPH_COLOR');
    expect(text.match(HEX_LITERAL) ?? []).toEqual([]);
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

  it('the other ordinal ramp ranks too, and spends no new colour doing it', () => {
    // PEER·02's reach bar splits the peers a crawl round considered along
    // `no answer → answered from another chain → answered from this one`. That
    // is ordered, so it may not read `QUALITATIVE_BUCKET_COLORS`, whose whole
    // job is that a slot means NOTHING: a hash would scramble the progression
    // into a colour wheel and a reader could no longer put two segments in
    // order.
    //
    // And it is the second ordinal in the HUD, which is where the question got
    // interesting. The durability ramp answers with five hand-cut hues, each
    // clearing the reserve, each other, and a luma ladder — three constraints
    // at once, and the third fights the first as soon as the steps are close
    // together. A single hue stepping in ALPHA answers all three for free, and
    // the palette's own note on `stageGround` already says brightness is where
    // "darker or lighter than its neighbour" belongs. So: no new hex, and one
    // that ranks by construction rather than by a comment asking the next hand
    // to be careful.
    const composite = (paint: string): string => {
      const match = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(paint);
      expect(match, `${paint} is not rgba(token, alpha)`).not.toBeNull();
      const alpha = Number(match![4]);
      // Over the track it is drawn on, because that is the colour a reader
      // actually sees — an alpha judged against nothing is not a brightness.
      const over = [0, 2, 4].map((i) =>
        parseInt(HUD_COLORS.trackGround.replace('#', '').slice(i, i + 2), 16));
      return `#${[1, 2, 3]
        .map((channel, index) =>
          Math.round(Number(match![channel]) * alpha + over[index] * (1 - alpha))
            .toString(16).padStart(2, '0'))
        .join('')}`;
    };

    // One hue, and it is a token: the peer plane's own wire, on the peer panel,
    // about peers being dialed.
    for (const step of ORDINAL_REACH_RAMP) {
      expect(step).toContain(rgba(HUD_COLORS.peerWire, 1).slice(0, -3));
    }
    // As many steps as there are segments to paint, counted off the same list
    // the derive walks rather than off a number written here — a fourth
    // outcome without a fourth step would otherwise paint two segments the
    // same, which is the one failure a ramp cannot show on its own.
    expect(ORDINAL_REACH_RAMP).toHaveLength(NETWORK_ATLAS_REACH_ORDER.length);

    const seen = ORDINAL_REACH_RAMP.map(composite);
    const luma = (hex: string): number => {
      const [r, g, b] = [0, 2, 4]
        .map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    // It ranks, in one direction — the same claim the durability ramp makes,
    // and the reason both are ordinals rather than sets of bands.
    const inversions = seen
      .slice(1)
      .map((step, index) => ({ step, index }))
      .filter(({ step, index }) => luma(step) <= luma(seen[index]))
      .map(({ index }) => `step ${index} → ${index + 1} does not step up`);
    expect(inversions).toEqual([]);

    // Every neighbouring pair is legible as two segments, and the quietest step
    // still clears the channel it is laid in — a segment that reaches the track
    // has stopped being a segment and become a hole in the bar. Both are what
    // the `0.2` floor and the even spacing are FOR, so both are held here
    // rather than argued for in a comment nobody can run.
    const tight = seen
      .slice(1)
      .map((step, index) => ({ step, index, gap: rgbDistance(step, seen[index]) }))
      .filter(({ gap }) => gap <= SEPARATION_FLOOR)
      .map(({ index, gap }) => `step ${index} ~ ${index + 1} (${gap.toFixed(1)})`);
    expect(tight).toEqual([]);
    expect(rgbDistance(seen[0], HUD_COLORS.trackGround)).toBeGreaterThan(SEPARATION_FLOOR);
  });

  it('the two ordinals and the qualitative slots share no member', () => {
    // Three ramps in one HUD and two of them rank, so what keeps a reader from
    // reading the wrong one is that no value appears in two. It matters most on
    // PEER·02, where the ordinal bar and two qualitative strips are stacked in
    // one column and count DIFFERENT POPULATIONS — the ordinal counts every
    // peer the network named, the two below it count only the peers the
    // crawler verified. A shared swatch would invite a reader to carry one
    // denominator into the other.
    const ordinal = new Set<string>(ORDINAL_REACH_RAMP);
    expect(QUALITATIVE_BUCKET_COLORS.filter((hex) => ordinal.has(hex))).toEqual([]);
    expect(Object.values(STORAGE_TIER_COLORS).filter((hex) => ordinal.has(hex))).toEqual([]);
    // …and the ramp is not a palette table's worth of values with one reader
    // and no rule, which is what the file at the top of this oracle warns about.
    // It is read where it is meant to be read.
    const readers = [...INK_SOURCES, ...APP_SOURCES].filter(
      (source) => !isPaletteSource(source.name) && source.text.includes('ORDINAL_REACH_RAMP'),
    );
    expect(readers.map((source) => source.name)).toContain('derives/networkAtlas.derive.ts');
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
    expect(text).toContain('borderLeft: `2px solid ${rgba(color, PLATE_ROW_RAIL_LIT_ALPHA)}`');
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

// ——— A rate may be read; a rate may not frame ————————————————————————————
//
// The mirror of the section below, and the other half of the ruling that gave
// BORN/DIED a colour of their own. `hudTheme.ts` says of `ember`: "It is never
// a panel accent, never a border, only ever a reading." That sentence has been
// enforced exactly once, obliquely — the durability ramp may not contain a
// metabolic tone, because a rung is drawn as a 2px rail and a wash. This is the
// general form of the same claim, asked of every file that writes ink.
//
// It is worth stating generally because the rule keeps nearly being broken by
// people obeying the OTHER half of it. Naming a spent Cell in `ember` is
// correct and is why the token exists; three surfaces do it. The trap is that
// two of them are ink and the third is a colour that also paints a rail, a
// wash, a lamp and a leader line — so "move it to ember like the others" is
// right on two surfaces and wrong on the third, and nothing said so.
//
// What this reaches and what it does not, stated rather than implied. It reads
// the border and outline properties, which is the palette's own wording and
// the only form that is a frame beyond argument — `boxShadow` and `textShadow`
// are atmosphere and are correct in any layer, and `background` is where a bar
// FILL lives, which this file has already ruled is a reading in a shape rather
// than in letters. It follows local bindings, the way the chrome sweep does,
// because that is how a colour is usually written down. It cannot follow a
// value through a PROP — a rail spelled `${accent}` is a rail whose colour was
// decided in another file — and that is the path the cell dossier's STATE fact
// took, so the value-side oracle over `cellScanFactAccent` in
// `CellInspectionOverlay.test.ts` is the half that covers it.

/** Every name a file can reach a metabolic tone through: the tokens
 *  themselves, plus any local binding whose initializer mentions one. Same
 *  shape as `chromeNames`, and for the same reason — `const netColor =
 *  churn.netPerBlock >= 0 ? HUD_COLORS.nominal : HUD_COLORS.ember` is how the
 *  panel that owns this tone actually writes it, and an oracle that knew only
 *  the token's own spelling would read that as clean. */
function metabolicNames(text: string): string[] {
  const names = Object.keys(METABOLIC_COLORS).map((token) => `HUD_COLORS.${token}`);
  const tones = Object.keys(METABOLIC_COLORS).join('|');
  const bound = new RegExp(
    `(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*([^;]*HUD_COLORS\\.(?:${tones})\\b[^;]*);`,
    'g',
  );
  let match = bound.exec(text);
  while (match !== null) {
    names.push(match[1]);
    match = bound.exec(text);
  }
  return names;
}

/** A property that draws a FRAME. Anchored so the match is a declaration
 *  rather than a mention: `borderLeft`, `outlineColor`, `border` itself. */
const FRAME_PROPERTY = /(?:^|[\s{;,(])(border[A-Za-z]*|outline[A-Za-z]*)\s*:/g;

/** The expression a property was given, read to the end of the VALUE rather
 *  than to the next comma: `border: \`1px solid ${rgba(tone, 0.55)}\`` carries a
 *  comma of its own inside the alpha, and a scan that stopped at the first one
 *  would report half an answer for the form this rule most needs to see. */
function propertyValue(text: string, from: number): string {
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === '}') {
      if (depth === 0) return text.slice(from, index);
      depth -= 1;
    } else if ((char === ',' || char === ';' || char === '\n') && depth === 0) {
      return text.slice(from, index);
    }
  }
  return text.slice(from);
}

/** `name` as an identifier, not as a fragment of a longer one. */
function mentions(region: string, name: string): boolean {
  const escaped = name.replace(/\./g, '\\.');
  return new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`).test(region);
}

function framesIn(text: string): string[] {
  const names = metabolicNames(text);
  const found: string[] = [];
  FRAME_PROPERTY.lastIndex = 0;
  let property = FRAME_PROPERTY.exec(text);
  while (property !== null) {
    const value = propertyValue(text, property.index + property[0].length);
    found.push(...names
      .filter((name) => mentions(value, name))
      .map((name) => `${property?.[1]}: … ${name} …`));
    property = FRAME_PROPERTY.exec(text);
  }
  return found;
}

describe('a rate the organism is spending is only ever a reading', () => {
  it('nothing in the HUD frames itself in a metabolic tone', () => {
    const offenders = INK_SOURCES
      .filter((source) => !isPaletteSource(source.name))
      .flatMap((source) => framesIn(inkText(source))
        .map((hit) => `${source.name}: ${hit} — ember reads, it never frames`));

    expect(offenders).toEqual([]);
  });

  it('finds a frame, a metabolic name and a binding when there is one to find', () => {
    // The pin, and it needs the same three the chrome probe needs: a
    // recogniser that stopped seeing frame properties, one that stopped
    // resolving local bindings, and one whose value scan had quietly narrowed
    // to nothing would each pass the rule above by checking less than it
    // claims. Written out rather than found in a real file, so editing a panel
    // cannot silently disarm this.
    const probe = [
      'const netColor = up ? HUD_COLORS.nominal : HUD_COLORS.ember;',
      'const fine = <div style={{ color: netColor, boxShadow: `0 0 7px ${netColor}` }} />;',
      'const fill = <span style={{ background: HUD_COLORS.ember, width }} />;',
      'const bad = <div style={{ borderLeft: `1px solid ${rgba(netColor, 0.34)}`, gap: 3 }} />;',
      'const alsoBad = <div style={{ outlineColor: HUD_COLORS.ember }} />;',
    ].join('\n');

    expect(metabolicNames(probe)).toContain('netColor');
    // Exactly two, and neither of them is the glow, the ink or the bar fill —
    // which is the distinction the whole rule turns on.
    expect(framesIn(probe)).toEqual([
      'borderLeft: … netColor …',
      'outlineColor: … HUD_COLORS.ember …',
    ]);
  });

  it('the panel that owns the tone still wears it, in the places it may', () => {
    // The other side of the bargain, the way `PROMOTED` makes it: a ban with
    // no subjects is a rule guarding an empty room. CELL MESH writes this tone
    // as a label, a bar fill, a glow on that fill and a stat value, and every
    // one of those is a reading.
    const panel = SOURCES.find((source) => source.name === 'CellsPanel.tsx');
    const text = code(panel?.text ?? '');
    expect(text).toContain('HUD_COLORS.ember');
    expect(framesIn(text)).toEqual([]);
  });
});

// ——— Chrome is not a reading ————————————————————————————————————————————
//
// The reserve above asks whether a CATEGORY has borrowed a reserved hue. This
// asks the other half of the same sentence, the one `hudTheme.ts` states
// outright and nothing enforced: a READING may never be painted in the
// instrument's own frame colour. The frame is what you look through; a value
// is what you look at, and a HUD where those are one colour has stopped
// distinguishing the two.
//
// Three surfaces had. The DAO panel's second hero — an annualized yield —
// rendered at `heroSub` in chrome orange with an orange text-shadow, beside a
// first hero that does it correctly: white ink, orange GLOW. A glow is
// atmosphere and belongs to the frame; the letters are the reading and do not.
// Worse, orange is already spoken for as a sentence: the top bar's controls
// use cyan/orange to mean "sitting at the default" versus "you have diverged
// from it", so a yield in chrome read as a config divergence. The cell
// dossier's utilisation strip — the reading its own comment promotes to the
// head of the line — had an orange-tinted track, an orange fill and an orange
// glow, three lines under a bar that had been re-cut off chrome for exactly
// that reason. And the protocol era badge printed the chain's era name in the
// frame's orange beside an epoch number in plain ink.
//
// All three did something else as well, and it is the same something: the
// colour was `stale ? <severity> : <chrome>`, so the value changed which
// LAYER of the palette it was speaking as its record aged. A reading may not
// be chrome and may not be a severity; a number that alternates between them
// is both defects taking turns. Freshness has carriers of its own on every one
// of these panels — a `· STALE` token, an opacity drop, a title.

/** The instrument's own frame, by name. `peerWire` and `cellRose` are in the
 *  reserve above but not here: they are IDENTITY, and a reading about a peer
 *  or about a Cell may legitimately be tinted by the thing it is about. Chrome
 *  is about nothing — it is the panel. */
const CHROME: Readonly<Record<string, string>> = {
  orange: HUD_COLORS.orange,
  orangeDeep: HUD_COLORS.orangeDeep,
  cyanWire: HUD_COLORS.cyanWire,
};

/** The rungs at which a size means "this is a value", not "this is what the
 *  value is called". `label` and below are deliberately out: the HUD sets its
 *  captions, its tags and — declared in `hudTheme.ts` — the cell dossier's
 *  provenance affordances at those sizes, and the affordances are correctly
 *  chrome, being controls rather than readings. */
const READING_RUNGS = ['hero', 'heroSub', 'emphasis', 'value'] as const;

const READING_SIZE = new RegExp(
  `fontSize:\\s*HUD_TYPE\\.(${READING_RUNGS.join('|')})\\b`,
  'g',
);

/** Every name a file can reach chrome through: the tokens themselves, plus any
 *  local binding whose initializer mentions one. The binding form is not an
 *  edge case, it is how all three of these were written — `const accent =
 *  stale ? HUD_COLORS.caution : HUD_COLORS.orange` — and an oracle that only
 *  knew the token's own spelling would have read every one of them as clean. */
function chromeNames(text: string): string[] {
  const names = Object.keys(CHROME).map((token) => `HUD_COLORS.${token}`);
  const chrome = Object.keys(CHROME).join('|');
  const bound = new RegExp(
    `(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*([^;]*HUD_COLORS\\.(?:${chrome})\\b[^;]*);`,
    'g',
  );
  let match = bound.exec(text);
  while (match !== null) {
    names.push(match[1]);
    match = bound.exec(text);
  }
  return names;
}

/** The object literal an offset sits directly inside, found by balancing
 *  braces outward. A style object is the unit the question is asked of: a
 *  `fontSize` and the `color` it goes with are siblings in one, and asking the
 *  whole file instead would hit every panel that legitimately paints its frame
 *  in chrome somewhere else. */
function enclosingObject(text: string, at: number): string | null {
  let depth = 0;
  let open = -1;
  for (let index = at; index >= 0; index -= 1) {
    if (text[index] === '}') depth += 1;
    else if (text[index] === '{') {
      if (depth === 0) { open = index; break; }
      depth -= 1;
    }
  }
  if (open < 0) return null;
  depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return null;
}

/** `color:` and nothing else. `textShadow`, `boxShadow`, `background` and the
 *  borders are the frame's own properties and chrome is CORRECT in them — the
 *  DAO hero this rule was written for keeps its orange glow. Only the letters
 *  are the reading. */
function paintsInk(region: string, name: string): boolean {
  const escaped = name.replace(/\./g, '\\.');
  return new RegExp(
    `(?<![\\w$.])color:\\s*(?:[^,;{}]*\\?\\s*)?${escaped}(?![\\w$])`,
  ).test(region);
}

/** The other way a reading gets its colour, and the one a style object cannot
 *  show: `StatRow` and the plate rows take a `valueColor` and render it at
 *  `HUD_TYPE.value` inside `primitives.tsx`, so the size is a property of the
 *  primitive rather than of the call. Passing chrome to one is passing chrome
 *  to a reading, spelled somewhere the size does not appear. */
function passesToValueSlot(text: string, name: string): boolean {
  const escaped = name.replace(/\./g, '\\.');
  return new RegExp(
    `valueColor(?:=\\{|:\\s*)(?:[^,;{}]*\\?\\s*)?${escaped}(?![\\w$])`,
  ).test(text);
}

describe('chrome is the frame, not the reading', () => {
  it('no value in the HUD is painted in the instrument\'s own colour', () => {
    const offenders: string[] = [];
    for (const source of SOURCES) {
      const text = code(source.text);
      const names = chromeNames(text);
      READING_SIZE.lastIndex = 0;
      let reading = READING_SIZE.exec(text);
      while (reading !== null) {
        const region = enclosingObject(text, reading.index);
        if (region !== null) {
          offenders.push(...names
            .filter((name) => paintsInk(region, name))
            .map((name) => `${source.name}: a ${reading?.[1]} reading is painted ${name}`));
        }
        reading = READING_SIZE.exec(text);
      }
      offenders.push(...names
        .filter((name) => passesToValueSlot(text, name))
        .map((name) => `${source.name}: valueColor={${name}} is a reading in chrome`));
    }

    expect(offenders).toEqual([]);
  });

  it('finds a reading, a chrome name and a binding when there is one to find', () => {
    // The pin, and it needs three: a recogniser that stopped seeing reading
    // rungs, one that stopped resolving local bindings, and one that had
    // quietly narrowed `color:` to nothing would each pass the rule above by
    // checking less than it claims. Written out rather than found in a real
    // file, so editing a panel cannot silently disarm this.
    const probe = [
      'const accent = stale ? HUD_COLORS.caution : HUD_COLORS.orange;',
      'const fine = <div style={{ fontSize: HUD_TYPE.heroSub, color: HUD_COLORS.goldInk }} />;',
      'const glow = <div style={{ fontSize: HUD_TYPE.hero, color: HUD_COLORS.heroInk,',
      '  textShadow: `0 0 11px ${rgba(HUD_COLORS.orange, 0.32)}` }} />;',
      'const bad = <div style={{ fontSize: HUD_TYPE.heroSub, color: accent }} />;',
    ].join('\n');

    expect(chromeNames(probe)).toContain('accent');

    const hits: string[] = [];
    READING_SIZE.lastIndex = 0;
    let reading = READING_SIZE.exec(probe);
    while (reading !== null) {
      const region = enclosingObject(probe, reading.index);
      hits.push(...chromeNames(probe)
        .filter((name) => region !== null && paintsInk(region, name))
        .map((name) => `${reading?.[1]} ← ${name}`));
      reading = READING_SIZE.exec(probe);
    }

    // Exactly one, and it is the bound one: the gold reading is clean, and the
    // white hero with the orange GLOW is clean, which is the distinction the
    // whole rule turns on.
    expect(hits).toEqual(['heroSub ← accent']);
  });

  it('the DAO panel ranks its two heroes white over gold', () => {
    // The surface the rule was written for, pinned as well as swept — the
    // general form can only say the APC is not chrome, and the ruling was
    // which colour it IS. `ink` is not available at this size: beside a
    // `heroInk` hero it measures 39.8, inside the floor, so the pair would
    // read as one colour rather than as two ranks.
    expect(rgbDistance(HUD_COLORS.ink, HUD_COLORS.heroInk))
      .toBeLessThan(SEPARATION_FLOOR);
    expect(rgbDistance(HUD_COLORS.goldInk, HUD_COLORS.heroInk))
      .toBeGreaterThan(SEPARATION_FLOOR);

    const dao = SOURCES.find((source) => source.name === 'DaoStateReadout.tsx');
    const text = code(dao?.text ?? '');
    expect(text).toContain('color: HUD_COLORS.heroInk');
    expect(text).toContain('color: HUD_COLORS.goldInk');
    // Both glow in the frame's orange, which is where chrome belongs.
    expect(text).toContain('textShadow: `0 0 11px ${rgba(HUD_COLORS.orange, 0.32)}`');
    expect(text).toContain('textShadow: `0 0 9px ${rgba(HUD_COLORS.orange, 0.36)}`');
  });

  it('the three stacked sections of CKB·01 wear one accent', () => {
    // Not a reading and so not caught above: this is a section's own chrome, a
    // 5px lamp and a hairline rule. The defect is one layer over — the accent
    // was `nominal`, a health tone, so of three identical headers in one panel
    // the top one appeared to be reporting that it was well and the two under
    // it did not. None of the three is reporting anything of the kind.
    const sections = ['CellCensusReadout.tsx', 'TransactionHorizonReadout.tsx', 'ActivityFeedReadout.tsx'];
    const accents = sections.map((name) => {
      const source = SOURCES.find((entry) => entry.name === name);
      expect(source, `${name} moved — this oracle reads files off disk`).toBeDefined();
      const found = /const accent = stale \? HUD_COLORS\.(\w+) : HUD_COLORS\.(\w+);/
        .exec(code(source?.text ?? ''));
      return found ? `${found[1]}/${found[2]}` : `${name}: no accent to read`;
    });

    expect(new Set(accents).size).toBe(1);
    expect(accents[0]).toBe('caution/cyanWire');
  });

  it('the meter that leads the byte line is a meter like every other', () => {
    // Two claims the general rule cannot make, because neither is type. A
    // track is `trackGround` — that is what the token is for, and this one was
    // a 13% orange tint instead. And a bar FILL is a reading in a shape rather
    // than in letters, so it takes a band: `CONTENT_BANDS.value` is the one
    // this house gives capacity everywhere else it appears, and the strip's
    // denominator is the purchased capacity.
    //
    // Pinned rather than generalised: recognising "this span is a meter fill"
    // from source text means recognising a percentage width inside a fixed
    // height, which is a shape, and a rule that guessed at it would either
    // miss the next one or fire on every progress-shaped div in the HUD.
    const bar = SOURCES.find((source) => source.name === 'CellByteBudget.tsx');
    expect(bar, 'the byte budget moved — this oracle reads files off disk')
      .toBeDefined();
    const text = code(bar?.text ?? '');
    expect(text).toContain('height: 4, background: HUD_COLORS.trackGround');
    expect(text).toContain('background: CONTENT_BANDS.value');
    expect(text).toContain('boxShadow: `0 0 6px ${rgba(CONTENT_BANDS.value, 0.55)}`');
    // The whole file, not just the strip: nothing on this surface speaks
    // chrome any more, which is the state the bar above it was re-cut into.
    expect(Object.keys(CHROME).filter((token) => text.includes(`HUD_COLORS.${token}`)))
      .toEqual([]);
  });

  it('a placeholder wears the accent of the fact it is standing in for', () => {
    // The knock-on, and the reason it is a defect rather than a detail: the
    // byte budget's ghosts were railed in chrome orange under a CAPACITY fact
    // accented cyan, so the stack did not match its heading and then changed
    // colour when the real bar arrived. Every other cluster's ghosts take
    // their fact's accent, and this one now asks the same table.
    const panel = SOURCES.find((source) => source.name === 'CellDetailPanel.tsx');
    const text = code(panel?.text ?? '');
    const ghosts = [...text.matchAll(/<GhostRows[\s\S]{0,220}?\/>/g)]
      .map((match) => match[0])
      .filter((ghost) => !/accent=\{(?:lockAccent|assetAccent|factAccent\('[a-z]+'\))\}/.test(ghost))
      .map((ghost) => `a ghost stack is railed in something other than its fact's accent: ${ghost.slice(0, 60)}…`);

    expect(ghosts).toEqual([]);
    expect(text).toContain("accent={factAccent('capacity')}");
  });

  it('the module registry\'s grey is worn by tags, never by a reading', () => {
    // `moduleSlate` is documented as sitting below `dim` on purpose — "a tag
    // is an address, not a reading" — and the peer mesh painted the best known
    // block height in it, which made the one figure on that row quieter than
    // the words around it.
    //
    // Asked as a reader list, the way `crit` and `termGreen` are, because the
    // token's whole meaning is WHO may wear it. Two readers, both addresses:
    // the panel and plate module stamps, and the scene marker's content line
    // under its reading.
    const holders = [...SOURCES, ...PACKAGE_SOURCES.filter((source) => INK_JURISDICTION.test(source.name))]
      .filter((source) => code(source.text).includes('HUD_COLORS.moduleSlate'))
      .map((source) => source.name)
      .sort();

    expect(holders).toEqual(['nerve/ConsensusMemoryMarkers.tsx', 'primitives.tsx']);
  });

  it('the era of the chain is a fact, in the ink a fact is written in', () => {
    // The last of the three, and too small for the reading rungs: the badge
    // sets at `label`, which is where the HUD writes captions and where the
    // dossier's provenance affordances are correctly chrome. So the sweep
    // above cannot see it and this pins it instead. It sits on CKB·01's Epoch
    // row directly after `epoch.number`, which `StatRow` renders in `ink`.
    const badge = SOURCES.find((source) => source.name === 'ProtocolEraBadge.tsx');
    expect(badge, 'the era badge moved — this oracle reads files off disk')
      .toBeDefined();
    const text = code(badge?.text ?? '');
    expect(text).toContain('color: HUD_COLORS.ink');
    // Neither chrome while fresh nor a severity while stale. Freshness is
    // carried by the opacity below it and by the title and aria-label.
    expect(text).not.toContain('HUD_COLORS.orange');
    expect(text).not.toContain('HUD_COLORS.caution');
    expect(text).toContain('opacity: stale ? STALE_OPACITY : 1');
  });
});

// ——— One directory, two dialects ————————————————————————————————————————
//
// The classifier above is the whole jurisdiction model, so it is the thing most
// worth being suspicious of. A rule that quietly sorted every hex into
// "material" would pass the colour rules, pass the reserve, and check nothing —
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
 *  can be passing because two hexes differ. It is a value the palette holds,
 *  on purpose: the two assertions this file most needs to be true are that the
 *  ink form reaches the rule and the material form does not. */
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

  it('the rule reaches a style object and stops at a material', () => {
    // The two claims the whole fence rests on, asked of the mechanism the
    // colour rules actually run — the masked text, not the classifier's
    // verdict.
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

  it('follows a colour one binding into the scene, and stops if the DOM uses it too', () => {
    // The half a positional classifier cannot see, and the reason this file no
    // longer carries an exemption list. It carried exactly one row —
    // `#ffffff`, for `CellMorphologyLabArtwork.tsx` — and the row was correct:
    // the value is handed to a `<pointsMaterial>` twenty lines below the
    // ternary that spells it, so the literal reads as ink at the point it is
    // written and as material at the point it is worn. A text oracle that only
    // looks at the character before the hex cannot know that, and the answer
    // for a year was to write the filename down.
    //
    // Written out rather than found, so editing that component cannot silently
    // disarm it — and asked both ways round, because a binding pass that said
    // "material" to everything would retire the exemption by giving every
    // future literal a free pass, which is the same defect in a nicer costume.
    const scene = [
      "const nodeColor = greyscale ? '#ffffff' : '#fef3c7';",
      'const dot = <pointsMaterial color={nodeColor} size={0.05} />;',
    ].join('\n');
    expect([...sceneBoundNames(scene)]).toEqual(['nodeColor']);
    expect(hexSites(scene).map((site) => site.dialect)).toEqual(['material', 'material']);

    // The array form, which is the other spelling in that same file: a ramp
    // indexed inside a `new THREE.Color(...)`.
    const ramp = [
      "const STRANDS = ['#fb7185', '#fbbf24'];",
      'const tint = new THREE.Color(STRANDS[index % STRANDS.length]);',
    ].join('\n');
    expect([...sceneBoundNames(ramp)]).toEqual(['STRANDS']);
    expect(hexSites(ramp).every((site) => site.dialect === 'material')).toBe(true);

    // And the case that keeps it honest: the same shape with ONE DOM consumer
    // stays ink, all of it. This is the case that made `FACET_GLYPH_COLOR` a
    // name in `cellFormat.ts` rather than a second exemption — the specimen's
    // role glyphs are drawn as scene points AND as the label beside each one.
    const both = [
      "const GLYPH = '#fef3c7';",
      'const mark = new THREE.Color(GLYPH);',
      'const label = <div style={{ color: GLYPH }} />;',
    ].join('\n');
    expect([...sceneBoundNames(both)]).toEqual([]);
    expect(hexSites(both).map((site) => site.dialect)).toEqual(['ink']);

    // …and a name with no consumer at all is not promoted by having nothing to
    // fail: a dead constant is a literal like any other.
    expect([...sceneBoundNames("const DEAD = '#123456';")]).toEqual([]);
  });

  it('sorts the mixed directory, and finds the material it was drawn for', () => {
    const sites = MIXED_SOURCES.flatMap((source) => hexSites(source.text)
      .map((site) => ({ ...site, file: source.name })));
    const material = sites.filter((site) => site.dialect === 'material');

    expect(material.length).toBeGreaterThan(0);

    // Named members, in the files that made the case for this rule.
    // `CellIdentityBindingGlyph` was the whole argument in one file: the same
    // value four times as a scene parameter, and two others written the DOM's
    // way one table above them.
    const named = (dialect: Dialect): string[] => sites
      .filter((site) => site.dialect === dialect)
      .map((site) => `${site.file}: ${site.hex}`);

    expect(named('material')).toContain('components/CellSemanticOrbit.tsx: #020712');
    // (`CellGalaxy`'s own scene hex used to stand here. B5 promoted it into
    // `SCENE_ACCENT_PALETTE` — it was a fifth pale white — and the file now
    // carries no colour literal at all, which is the outcome this rule wants
    // rather than an example it can keep.)
    expect(named('material')).toContain('components/CellBirthAnchorMarker.tsx: #050914');
    expect(named('material')).toContain('components/CellBirthAnchorMarker.tsx: #050914');

    // The ink half of the sorting is NOT asked of these files, and that is the
    // point rather than a gap: the two DOM literals this directory had are
    // `IDENTITY_PROOF_COLORS` now, so a "finds ink here too" clause would be
    // asking a real component to keep a defect so the oracle can find it. The
    // classifier's ink side is pinned on the probe below, where nobody can
    // edit it away.
    expect(named('ink')).toEqual([]);
  });

  it('a colour the scene keeps to itself still clears the reserve', () => {
    // The other half of the bargain, and the reason "material" is not simply a
    // pass. A material parameter may keep a private VALUE — it is a surface
    // under a camera, not ink on a panel — but it may not keep a private
    // MEANING: a hue the semantics own, or the frame's own orange, or either
    // mesh identity, says something about the whole HUD wherever it is drawn.
    // A material that genuinely wants one of these says the token's name, and
    // then it is not a literal and this rule never sees it.
    //
    // Scoped to the mixed directory, and it STAYS there — which is a finding
    // rather than an oversight, because widening it was tried when the ink
    // rule started masking materials everywhere and it does not survive
    // contact with the palette. The reserve is a rule about DOM ink. Run over
    // the scene it condemns the stage: `CELL_GALAXY_PALETTE.tissueRose` lands
    // 29.0 from `cellRose`, which is not drift but a REQUIREMENT this file
    // pins two sections up — the panel that counts Cells and the Cells
    // themselves are the same colour on purpose — and `synapseAmber` lands
    // 15.6 from chrome orange because additive light on a near-black stage is
    // not ink on a lit panel. A rule that fails the scene's own palette is not
    // a rule the scene can be held to.
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
// ⭐⭐⭐ THE EXEMPTION WAS KEYED ON THE WRONG THING, AND IT WAS THE FILE.
//
// It read: a file that imports from `three` or `@react-three/*` is drawing
// inside the canvas, as additive material with `toneMapped` off on the
// near-black stage ground — light that accumulates rather than ink composited
// onto a lit panel — so 6.4px there is a marker rather than a caption.
//
// Every clause of that is true of a MESH and false of the thing it exempted.
// A file's imports say where its module lives, not what its numbers are handed
// to, and the numbers in question were handed to drei `Html` — which mounts a
// plain `<div>` in a DOM layer over the canvas and positions it from a
// projected point. Those labels are ink. They composite onto whatever is
// behind them, they resolve their counters in the browser's own rasteriser,
// and they were sitting at 5.4–8px on a `stageGround` wash: the HUD's own
// medium, as much as two rungs under the HUD's own floor, with 7px Han among
// them against a stated 9px mincho floor (report B, B-11; report F, F-11).
//
// So the exemption is keyed on the CONSTRUCT the size is given to. A troika
// `<Text fontSize={0.12}>` is glyph GEOMETRY — its number is a distance in
// world units, it has no relationship to a pixel ladder, and checking it
// against one would be a category error. That is the exemption, and today it
// has NO OCCUPANT: this package draws no material text at all, so every type
// size it writes is a DOM type size and the ladder is total. The pin below
// says so, and it is what turns the exemption back on the day a mesh label is
// written.
//
// The old reason said "under a camera and a BLOOM PASS", in three places
// across two files, and there is no bloom pass in this application: no
// `EffectComposer`, no `postprocessing` dependency, no tone-mapped path. That
// half of the correction landed on 2026-09-04 and the assertion for it stays —
// an exemption's reason is what the next person reasons from, and this one has
// now been wrong twice in two different ways.

/** Files that import `three` or `@react-three/*` — the jurisdiction the COLOUR,
 *  motion and alpha chapters carve out, where a value may be a material's
 *  rather than an element's. It is NOT the type ladder's exemption any more:
 *  see the chapter above. */
const SCENE_DIALECT = /from '(three|@react-three\/[a-z-]+)'/;

/** The one construct whose `fontSize` is not a DOM type size: troika text,
 *  drawn as geometry, measured in world units. */
const MATERIAL_TYPE_SITE = /<Text[\s/>]/;

/** One style object that puts the mincho face on, allowing a `${…}` inside it.
 *  ⚠️ The `[^{}]*` version of this — which two older companion oracles still
 *  use — cannot see `WarningBar`'s 警告, because its `textShadow` interpolates.
 *  A regex that silently skips a wearer is the same defect as an allowlist. */
const CJK_STYLE_OBJECT = /\{(?:[^{}]|\$\{[^{}]*\})*HUD_FONTS\.cjk(?:[^{}]|\$\{[^{}]*\})*\}/g;

/** The React style prop — the way most of the HUD writes a size down, in the
 *  three forms it gets written in: a bare number, a quoted length, and a named
 *  token on a visual-tokens object (`codeFontSizePx: 7.4`). The last two both
 *  hid sizes from this oracle for as long as it only read the first: a scene
 *  label's `'8px'` and a proof tag's three `…FontSizePx` constants. */
const FONT_SIZE_PROP = /\b\w*[Ff]ontSize(?:Px)?:\s*'?(\d+(?:\.\d+)?)(?:px)?'?/g;

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

/** The HUD directory minus the files that draw GL — the jurisdiction of every
 *  chapter that asks about a COLOUR, a duration or an alpha, where a value in
 *  a scene file may legitimately be a material's. The type ladder does not use
 *  it: a type size is checked by what it is handed to, not by where it lives. */
function domDialect(): HudSource[] {
  return SOURCES.filter((source) => !SCENE_DIALECT.test(source.text));
}

/** Everywhere in this package that writes a DOM type size — which, the
 *  exemption being empty, is everywhere it writes one at all. `hudTheme.ts` is
 *  out because it DECLARES the ladder; a rung is not a use of a rung. */
function typeLadderSources(): HudSource[] {
  // ⚠️ Read as CODE. The first version of this tested the raw text and
  // excluded `ConsensusMemoryMarkers.tsx` from its own rule, because the
  // comment in that file ARGUING the narrowing quotes `<Text>`. That is the
  // self-reference trap this suite has been bitten by before, in the other
  // direction: a source oracle that reads prose is reading the wrong document.
  return PACKAGE_SOURCES.filter(
    (source) => !source.name.endsWith(PALETTE_SOURCE)
      && !MATERIAL_TYPE_SITE.test(code(source.text)),
  );
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
  it('sorts the package into dialects, and finds both of them', () => {
    // The pin again: if the scene filter ever matched everything, the colour
    // chapters below would be checking an empty list.
    const dom = domDialect();
    const scene = SOURCES.filter((source) => SCENE_DIALECT.test(source.text));
    expect(dom.length).toBeGreaterThan(30);
    expect(scene.length).toBeGreaterThan(0);
    expect(scene.map((source) => source.name)).toContain('ConsensusMemory.tsx');

    // …and the TYPE jurisdiction, which is the whole package, REACHES the
    // three kinds of file the old import-keyed exemption hid: scene labels
    // under `nerve/`, a marker under `components/`, and a visual-tokens object
    // that is not a component at all.
    const reach = typeLadderSources().map((source) => source.name);
    expect(reach.length).toBeGreaterThan(200);
    expect(reach).toEqual(expect.arrayContaining([
      'nerve/ConsensusMemoryMarkers.tsx',
      'nerve/ConsensusRouteHopMarker.tsx',
      'components/CellIdentityProofLabel.tsx',
      'components/cellIdentityProofLabel.presentation.ts',
      'components/CellGalaxy.tsx',
      'components/hud/ConsensusMemory.tsx',
    ]));
  });

  it('the exemption is a construct, and it has no occupant', () => {
    // A comment cannot be tested and a PREMISE can. The exemption is for a size
    // handed to a MESH — troika's `<Text>`, whose number is a world-unit
    // distance. Nothing in this package draws one, which is why the ladder is
    // total; the day something does, this goes red and the exemption starts
    // meaning something again instead of being asserted into existence.
    const meshes = [...PACKAGE_SOURCES, ...APP_SOURCES]
      .filter((source) => MATERIAL_TYPE_SITE.test(code(source.text)))
      .map((source) => `${source.name} draws material text — the exemption now has an occupant, check its sizes are world units`);
    expect(meshes).toEqual([]);

    // Every scene label in this package is drei `Html`, and drei `Html` is a
    // `<div>` in a DOM layer over the canvas. That is the finding the
    // narrowing rests on, and it is read off the files rather than asserted.
    for (const name of [
      'nerve/ConsensusMemoryMarkers.tsx',
      'nerve/ConsensusRouteHopMarker.tsx',
      'components/CellIdentityProofLabel.tsx',
      'components/hud/ConsensusMemory.tsx',
    ]) {
      const scene = PACKAGE_SOURCES.find((source) => source.name === name);
      expect(scene, `${name} moved — this oracle reads files off disk`).toBeDefined();
      expect(code(scene?.text ?? ''), `${name} no longer draws its labels as DOM`)
        .toMatch(/import \{[^}]*\bHtml\b[^}]*\} from '@react-three\/drei'/);
    }

    // The other half of the reason, which was fiction until 2026-09-04 and is
    // still worth checking: there is no post pass, so nothing handed to the
    // scene is brightened on the way out. Read as CODE, because two comments
    // now say the word `bloom` in the course of saying it is not there.
    const composed = [...PACKAGE_SOURCES, ...APP_SOURCES]
      .filter((source) => /EffectComposer|from '(?:@react-three\/)?postprocessing'/
        .test(code(source.text)))
      .map((source) => `${source.name} composes a post pass — the exemption's reason needs rewriting`);
    expect(composed).toEqual([]);
  });

  it('the scale is a ladder — every rung distinct, micro at the floor', () => {
    const rungs = Object.values(HUD_TYPE);
    expect(new Set(rungs).size).toBe(rungs.length);
    expect(Math.min(...rungs)).toBe(HUD_TYPE.micro);
    expect(HUD_TYPE.micro).toBe(7.5);
  });

  it('every DOM size in the package is a declared rung', () => {
    const offenders: string[] = [];
    let sizes = 0;
    for (const source of typeLadderSources()) {
      for (const size of sizesIn(code(source.text))) {
        sizes += 1;
        if (DECLARED_SIZES.has(size)) continue;
        offenders.push(`${source.name}: ${size}px is not a rung of HUD_TYPE`);
      }
    }

    expect(offenders).toEqual([]);

    // ⚠️ THE PIN CANNOT BE A COUNT HERE, and it is worth saying why: after the
    // sweep almost every size in the package is written `HUD_TYPE.x`, which
    // yields NO literal to check — that is the point of writing it that way,
    // and a healthy package therefore reads close to zero literals. So the pin
    // is on the MATCHER instead, against the three forms a size gets written
    // in. Two of the three were invisible to this oracle until F1: a scene
    // label's quoted `'8px'` and a proof tag's `…FontSizePx` constants.
    expect(sizes).toBeGreaterThanOrEqual(1);
    expect(sizesIn("fontSize: 6.4, font: `400 8.5px/20px x`, fontSize: '8px', codeFontSizePx: 7.4"))
      .toEqual([6.4, 8, 7.4, 8.5]);
  });

  it('nothing anywhere in this package is written below the legibility floor', () => {
    // Stated separately from membership because it is a different promise. A
    // future rung could be added below 7.5 and pass the test above; this one
    // says that would itself be the mistake.
    const belowFloor = typeLadderSources().flatMap((source) => sizesIn(code(source.text))
      .filter((size) => size < HUD_TYPE.micro)
      .map((size) => `${source.name}: ${size}px`));

    expect(belowFloor).toEqual([]);
  });

  // ——— And the floor Han is held to, which is a rung higher ————————————
  //
  // `micro` is the LATIN floor: Chakra and Share Tech stop resolving their
  // counters below 7.5. A mincho glyph carries several times their stroke
  // count in the same em, so `CellByteBudget` states 9 (`label`) for it and
  // `StatusStrip`'s 状态 has always sat there. That was a paragraph in one
  // file and a habit in eight others, and the three scene companions two
  // directories away were at SEVEN.
  //
  // The rule is the one D5b arrived at for the same face one axis over: a
  // companion DECLARES. Saying nothing is not "inherit something reasonable",
  // it is "take whatever an ancestor happens to say", and what an ancestor
  // happens to say has changed under this face once already.
  it('a companion states its own size, and it is at or above the mincho floor', () => {
    const offenders: string[] = [];
    let companions = 0;
    for (const source of PACKAGE_SOURCES) {
      for (const object of code(source.text).matchAll(CJK_STYLE_OBJECT)) {
        companions += 1;
        const size = /fontSize:\s*HUD_TYPE\.(\w+)/.exec(object[0]);
        if (size === null) {
          offenders.push(`${source.name}: a companion that does not state its own fontSize`);
          continue;
        }
        const px = HUD_TYPE[size[1] as keyof typeof HUD_TYPE];
        if (px >= HUD_TYPE.label) continue;
        offenders.push(`${source.name}: Han at ${px}px — the mincho floor is ${HUD_TYPE.label}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(companions, 'no companion found — did HUD_FONTS.cjk move?')
      .toBeGreaterThanOrEqual(10);
  });
});

// ——— One tracking ladder ————————————————————————————————————————————————
//
// `hudTheme.ts` declares an eight-rung letter-spacing table with three argued
// exceptions, and until this section existed it was the only declared ladder in
// the system with NO TEST. Its own comment says what that costs: tracking had
// drifted to 45 distinct values, "0.28 and 0.3 and 0.32 and 0.34 and 0.35 all
// living in the same card, none of them telling a reader anything the others
// did not". A table that nothing checks goes back there one edit at a time.
//
// The membership half is the type scale's rule one axis over, and it has the
// type scale's lesson built in from the start. That oracle missed four sizes
// because the top bar wrote them in the CSS `font:` shorthand rather than as a
// `fontSize` prop; tracking has no shorthand — CSS `font:` does not carry
// letter-spacing — but it has two other spellings, and one of them was hiding a
// value. The link probe's compass is an SVG, so it writes `letterSpacing={1.1}`
// as an ATTRIBUTE, and a sweep for `letterSpacing:` reads straight past it.
// That is exactly how 1.1 sat twelve lines above a sibling caption correctly
// set at 0.9. So this reads all three notations: the style prop, the JSX/SVG
// attribute, and `letter-spacing` in a CSS string (of which there are none
// today — the point is that the next one is caught the day it is written).
//
// The rungs are held here AND in the comment over there, which is two copies of
// one table, so the first assertion is a toll: the oracle parses `hudTheme.ts`'s
// own prose and fails if the two ever disagree. The comment is the design
// system's record and this is its enforcement; neither may drift from the
// other, and the exceptions are read out of the comment too — including which
// FILE each one belongs to, which the comment states in backticks and nothing
// checked.
//
// And then the half membership cannot reach. Every rung is legal, so a sweep
// for membership passes a HUD where one ROLE is set four different ways, and
// that was the state of the cell card: the dim word that names a reading ran
// 1.4 → 0.9 → nothing at all → 0.6 down one column, with `COMPOSITION` and
// `CKBYTE` — the same object one zone apart — at 1.4 and 0.9. Two roles
// are checked below. One is recognised by CONSTRUCT and needs no list; the
// other cannot be, and says so rather than implying a promise it does not keep.

/** The eight rungs, held here so the sweep has something to check against and
 *  tolled against `hudTheme.ts` immediately below. */
const TRACK_RUNGS: readonly number[] = [0.35, 0.6, 0.9, 1.2, 1.4, 1.6, 2, 3];

/** The declared exceptions, each keyed by the ONE file allowed to write it.
 *  Keying by file is the point: 4 is the 警告 siren's air between two mincho
 *  glyphs, and it stops being a declared exception the moment a second surface
 *  helps itself to it. */
const TRACK_EXCEPTIONS: Readonly<Record<string, readonly number[]>> = {
  'StatusStrip.tsx': [4.2, 2.6],
  'WarningBar.tsx': [4],
  'DaoStateReadout.tsx': [-0.25],
};

/** The tracking table's own text in `hudTheme.ts`, from its rule to the line
 *  that ends it. Read RAW: the whole table is a comment. */
function trackingComment(): string {
  const theme = SOURCES.find((source) => source.name === 'hudTheme.ts');
  expect(theme, 'hudTheme.ts moved — this oracle reads files off disk').toBeDefined();
  const text = theme?.text ?? '';
  const start = text.indexOf('// ——— Tracking');
  const end = text.indexOf('/** A `#RRGGBB` palette color', start);
  expect(start, 'no Tracking section to read').toBeGreaterThan(-1);
  expect(end, 'no end to the Tracking section').toBeGreaterThan(start);
  return text.slice(start, end);
}

/** A comment slice between two of its own sentences. */
function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  expect(start, `no "${from}" in the tracking comment`).toBeGreaterThan(-1);
  expect(end, `no "${to}" after it`).toBeGreaterThan(start);
  return text.slice(start, end);
}

/** The HUD writes a negative tracking with a real MINUS SIGN in prose and a
 *  hyphen in code, and they are different characters. */
function signed(literal: string): number {
  return Number(literal.replace('−', '-'));
}

/** A rung line: three spaces, the number, then the gutter before its
 *  description. The exception lines below the table are shaped the same way and
 *  are read separately, which is why this is given the table's own slice. */
const RUNG_LINE = /^\/\/ {3}(-?[\d.]+) {2,}\S/gm;

/** An exception line: the values it declares, and the file in backticks that is
 *  the first thing said about it. `4.2 / 2.6` is one exception with two forms. */
const EXCEPTION_LINE = /^\/\/ {3}([−\-\d.]+(?:\s*\/\s*[\d.]+)*) {2,}`([A-Za-z]+)`/gm;

/** Every place a tracking is written down, in all three notations, with the
 *  numbers pulled out of whatever expression it was given. A ternary is two
 *  values and both of them render, so both are checked. */
function trackingsIn(text: string): number[] {
  const found: number[] = [];
  const take = (expression: string): void => {
    for (const number of expression.match(/-?\d+(?:\.\d+)?/g) ?? []) {
      found.push(Number(number));
    }
  };

  // The style prop, which is how most of the HUD writes one.
  const prop = /(?<![\w$])letterSpacing:\s*([^,}\n]+)/g;
  let match = prop.exec(text);
  while (match !== null) {
    take(match[1]);
    match = prop.exec(text);
  }

  // The JSX/SVG attribute — the notation the compass's 1.1 hid in.
  const attribute = /(?<![\w$])letterSpacing=\{([^}]*)\}/g;
  match = attribute.exec(text);
  while (match !== null) {
    take(match[1]);
    match = attribute.exec(text);
  }

  // And the CSS spelling, for the stylesheet strings this package ships.
  const css = /letter-spacing:\s*([^;`'"}\n]+)/g;
  match = css.exec(text);
  while (match !== null) {
    take(match[1]);
    match = css.exec(text);
  }

  return found;
}

describe('one tracking ladder', () => {
  it('the table in hudTheme and the rungs here are one ladder', () => {
    // The toll. Two copies of one table is the failure this whole file exists
    // to catch, and this section would otherwise be the newest instance of it.
    const comment = trackingComment();
    const table = between(comment, 'cannot make a line wrap:', 'An explicit `0`');

    const declared: number[] = [];
    RUNG_LINE.lastIndex = 0;
    let rung = RUNG_LINE.exec(table);
    while (rung !== null) {
      declared.push(signed(rung[1]));
      rung = RUNG_LINE.exec(table);
    }
    expect(declared).toEqual([...TRACK_RUNGS]);

    const exceptions = between(comment, 'Declared exceptions', 'about SIZE rather than tracking');
    const claimed: Record<string, number[]> = {};
    EXCEPTION_LINE.lastIndex = 0;
    let line = EXCEPTION_LINE.exec(exceptions);
    while (line !== null) {
      claimed[`${line[2]}.tsx`] = line[1].split('/').map((part) => signed(part.trim()));
      line = EXCEPTION_LINE.exec(exceptions);
    }
    expect(claimed).toEqual(TRACK_EXCEPTIONS);
  });

  it('the ladder is a ladder — every rung distinct, and it only ever loosens', () => {
    expect(new Set(TRACK_RUNGS).size).toBe(TRACK_RUNGS.length);
    expect([...TRACK_RUNGS].sort((a, b) => a - b)).toEqual([...TRACK_RUNGS]);
    // Nothing on the ladder is negative or zero: `0` is the ABSENCE of tracking
    // and the one negative in the HUD is a declared exception, so a rung that
    // went to or below zero would mean one of those two had been mistaken for a
    // step of the scale.
    expect(Math.min(...TRACK_RUNGS)).toBeGreaterThan(0);
  });

  it('reads tracking in every notation it is written in', () => {
    // The pin. A sweep that only knew the style prop would have read the whole
    // HUD as clean while an SVG attribute sat off the ladder, so the assertion
    // under this one has to be shown a population in each spelling it claims to
    // cover before it is worth anything.
    const overlay = domDialect();
    const props = overlay.filter((source) => /letterSpacing:/.test(code(source.text)));
    const attributes = overlay.filter((source) => /letterSpacing=\{/.test(code(source.text)));
    expect(props.length).toBeGreaterThan(20);
    expect(attributes.map((source) => source.name)).toContain('PeerLinkCard.tsx');

    // …and that the reader itself pulls both values out of a ternary, which is
    // how the status strip writes its wordmark and the backfill bar its label.
    expect(trackingsIn('letterSpacing: dense ? 2.6 : 4.2,')).toEqual([2.6, 4.2]);
    expect(trackingsIn('letterSpacing={1.1}')).toEqual([1.1]);
    expect(trackingsIn('letter-spacing:0.6px')).toEqual([0.6]);
  });

  it('every tracking is a rung, an explicit zero, or that file\'s declared exception', () => {
    const offenders: string[] = [];
    for (const source of domDialect()) {
      const allowed = TRACK_EXCEPTIONS[source.name] ?? [];
      for (const value of trackingsIn(code(source.text))) {
        if (value === 0) continue;
        if (TRACK_RUNGS.includes(value)) continue;
        if (allowed.includes(value)) continue;
        offenders.push(`${source.name}: ${value} is not a rung of the tracking table`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the two rungs the table describes in words are the rungs shipped', () => {
    // Membership cannot catch a wrong DESCRIPTION. The table said "1.6
    // stat-row labels, plate titles" and the plate-title primitive has always
    // been at 1.4, so every rung in the HUD passed while the record said
    // something that was not true of any of them — and a design system's own
    // record being wrong is worse than a value being wrong, because the record
    // is what the next edit is measured against.
    //
    // Two roles are named in that table AND owned by a primitive, so both can
    // be read out of the prose and checked against the code rather than
    // against a number copied over here. A floating card has two kinds of
    // title and they are two rungs apart on purpose: the masthead is the
    // card's own name, a `SpatialPlateHeader` is a section header inside it.
    const table = between(trackingComment(), 'cannot make a line wrap:', 'An explicit `0`');

    /** Every rung with the whole of its description — a rung's entry runs to
     *  the next rung, because several of them wrap onto continuation lines and
     *  a reader that stopped at the newline would be reading a third of the
     *  table. */
    const entries: Array<{ rung: number; at: number; text: string }> = [];
    RUNG_LINE.lastIndex = 0;
    let rung = RUNG_LINE.exec(table);
    while (rung !== null) {
      entries.push({ rung: signed(rung[1]), at: rung.index, text: '' });
      rung = RUNG_LINE.exec(table);
    }
    for (let index = 0; index < entries.length; index += 1) {
      const end = index + 1 < entries.length ? entries[index + 1].at : table.length;
      entries[index].text = table.slice(entries[index].at, end);
    }

    /** The rung whose description names `phrase`, and only one may. */
    const rungFor = (phrase: string): number => {
      const naming = entries.filter((entry) => entry.text.includes(phrase));
      expect(naming.map((entry) => entry.rung), `the tracking table no longer describes ${phrase} on exactly one rung`)
        .toHaveLength(1);
      return naming[0].rung;
    };

    const primitives = SOURCES.find((source) => source.name === SHAPE_SOURCE);
    expect(primitives, 'primitives.tsx moved — this oracle reads files off disk')
      .toBeDefined();
    const text = code(primitives?.text ?? '');

    const statRow = /export function StatRow\([\s\S]*?letterSpacing: ([\d.]+)/.exec(text);
    expect(statRow, 'StatRow no longer sets a tracking').not.toBeNull();
    expect(Number(statRow?.[1])).toBe(rungFor('stat-row labels'));

    const plateHeader = /export function SpatialPlateHeader\([\s\S]*?letterSpacing: ([\d.]+)/.exec(text);
    expect(plateHeader, 'SpatialPlateHeader no longer sets a tracking').not.toBeNull();
    expect(Number(plateHeader?.[1])).toBe(rungFor('SECTION header'));

    // …and that the two are actually different rungs, which is the whole of
    // what the old wording lost.
    expect(rungFor('stat-row labels')).not.toBe(rungFor('SECTION header'));
  });

  it('a declared exception is not a rung anybody else may borrow', () => {
    // Stated separately because it is a different promise. The membership rule
    // above would pass if `WarningBar`'s 4 turned up on a third panel; this says
    // that would itself be the mistake, since the argument for every one of them
    // is about ONE surface.
    const strays: string[] = [];
    for (const source of domDialect()) {
      const mine = TRACK_EXCEPTIONS[source.name] ?? [];
      for (const value of trackingsIn(code(source.text))) {
        for (const [owner, values] of Object.entries(TRACK_EXCEPTIONS)) {
          if (owner === source.name) continue;
          if (values.includes(value) && !mine.includes(value)) {
            strays.push(`${source.name}: ${value} is ${owner}'s declared exception`);
          }
        }
      }
    }

    expect(strays).toEqual([]);
  });
});

// ——— One role, one rung ————————————————————————————————————————————————
//
// The condition box, recognised by what it IS rather than by where it is. A box
// that spans its card, declares its own type — the `tech` voice at `label`,
// bold — and sits on a wash of its own colour is saying what condition
// something is in, and `hudTheme.ts` gives condition words a rung. Three of
// them shipped on three different rungs: `LINK LOST` at 2, the sync ladder's
// state word at 1.6, `WE LAG · n BLOCKS BEHIND THE FURTHEST PEER` at 1.4 — so
// the most severe of the three was the one set tightest, which is the opposite
// of what the ladder means.
//
// The four properties together are the whole classifier and they sort the HUD
// cleanly: the outline chips and the severity block are NOT caught, because a
// chip leaves its type to the caller and a condition box declares its own —
// that difference is real and is what `severityChip`'s doc comment already
// says. Nothing is listed, so a fourth box is governed the day it is written.

const CONDITION_RUNG = 2;

/** A style object that declares the condition box's type over a wash. */
function conditionBoxes(text: string): string[] {
  const boxes: string[] = [];
  const bold = /fontWeight:\s*700/g;
  let match = bold.exec(text);
  while (match !== null) {
    const object = enclosingObject(text, match.index);
    if (
      object
      && /fontFamily:\s*HUD_FONTS\.tech/.test(object)
      && /fontSize:\s*HUD_TYPE\.label/.test(object)
      && /(?:^|[\s{,])background:/.test(object)
    ) {
      boxes.push(object);
    }
    match = bold.exec(text);
  }
  return boxes;
}

describe('a condition is a condition wherever it is raised', () => {
  it('finds the boxes it is supposed to be checking', () => {
    // The pin. This classifier is four properties and no list, which is what
    // makes it worth having and also what makes it silently checkable against
    // nothing — a renamed prop would empty it and the rule below would pass.
    // A floor and two names, not a roster: the whole claim above is that a
    // fourth box is governed the day it is written, and a pin that spelled the
    // population out would make writing one a test edit.
    const found = domDialect()
      .flatMap((source) => conditionBoxes(code(source.text)).map(() => source.name))
      .sort();
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found).toContain('NodeSelfCard.tsx');
    expect(found).toContain('PeerLinkCard.tsx');
  });

  it('every condition box is set at the condition rung', () => {
    // The rung is read out of `hudTheme.ts`, not held here: the record and the
    // rule have to be one thing, the way the ladder above is.
    const rung = /\/\/   condition box   ([\d.]+),/.exec(trackingComment());
    expect(rung, 'the record no longer states the condition rung').not.toBeNull();
    expect(Number(rung?.[1])).toBe(CONDITION_RUNG);

    const offenders: string[] = [];
    for (const source of domDialect()) {
      for (const box of conditionBoxes(code(source.text))) {
        const tracking = /letterSpacing:\s*(-?[\d.]+)/.exec(box);
        const value = tracking ? Number(tracking[1]) : null;
        if (value === CONDITION_RUNG) continue;
        offenders.push(
          `${source.name}: a condition box is tracked at ${value ?? 'nothing'}, not ${CONDITION_RUNG}`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it('a chip is not a condition box', () => {
    // The other side of the classifier, said out loud. `severityChip` fills
    // solid and `plateStateChip` outlines, and both sit at the chip rung; if
    // either started declaring the condition box's type this rule would begin
    // demanding a rung neither of them wants.
    const primitives = SOURCES.find((source) => source.name === 'primitives.tsx');
    const text = code(primitives?.text ?? '');
    expect(conditionBoxes(text)).toEqual([]);
    expect(text).toMatch(/export function severityChip[\s\S]*?letterSpacing: 1\.4/);
    expect(text).toMatch(/export function plateStateChip[\s\S]*?letterSpacing: 1\.4/);
  });
});

// ——— …and one role that has to be named ————————————————————————————————
//
// The dim `micro` word that names a reading in the floating-card dialect:
// `PlateReadoutRow`'s label, the dossier's `COMPOSITION`, the sync ladder's
// `LOCAL` and `PEER`, `CKBYTE`, `FREE`, the evidence register's `OWNER`
// and `AMOUNT`, the content window's `VALUE`. One role, and it shipped on four
// settings — 1.4, 0.9, 0.6 and no tracking at all — inside one card.
//
// THIS RULE IS PARTIAL AND THAT IS THE HONEST FORM OF IT. The classifier above
// works because a condition box declares four properties nothing else declares
// together. This role declares nothing of the kind: a label, a caption and a
// right-aligned meta stamp are the same two properties in source — `color:
// HUD_COLORS.dim` and `fontSize: HUD_TYPE.micro` — and differ only by where
// they sit in the row, which is not written in the style object at all. Thirty-
// nine style objects in the DOM overlay are dim and `micro`; they wear eight
// different trackings and most of them are right. A rule derived from the pair
// would have to fail nearly all of them to catch these.
//
// So the surfaces are NAMED, the way the cell card's identity surfaces are
// named further down this file, and a new one has to be added by hand. What
// that buys is that the eight that exist cannot drift apart again; what it
// costs is stated rather than implied, which is the ruling this file has taken
// everywhere else it could not derive something.

const READOUT_LABEL_RUNG = 1.4;

/** Where the floating-card dialect names a reading. `within` scopes the read to
 *  one component where the file writes other labels elsewhere, and `renders` is
 *  the text node itself — the span is found by walking back from what a reader
 *  actually sees to the style object that sets it. */
const READOUT_LABEL_SITES: ReadonlyArray<{
  surface: string;
  file: string;
  within?: readonly [string, string];
  renders: string;
}> = [
  {
    surface: "the dialect's own row primitive",
    file: 'primitives.tsx',
    within: ['export function PlateReadoutRow(', '{badge}'],
    renders: '{label}',
  },
  {
    surface: 'the dossier composition block',
    file: 'CellDetailPanel.tsx',
    within: ['function CompositionBlock(', 'compositionIssuesChip(issues)'],
    renders: 'COMPOSITION',
  },
  { surface: 'the byte budget header', file: 'CellByteBudget.tsx', renders: 'CKBYTE' },
  { surface: 'the unspent reading', file: 'CellByteBudget.tsx', renders: 'FREE' },
  {
    surface: 'the evidence register',
    file: 'CellSemanticsReadout.tsx',
    within: ['export function EvidenceFact(', 'function facetTitle('],
    renders: '{label}',
  },

  {
    surface: "the sync ladder's own rung",
    file: 'PeerLinkCard.tsx',
    within: ['en="SYNC LADDER"', 'data-peer-probe-sync-state'],
    renders: 'LOCAL',
  },
  {
    surface: "the sync ladder's peer rung",
    file: 'PeerLinkCard.tsx',
    within: ['en="SYNC LADDER"', 'data-peer-probe-sync-state'],
    renders: 'PEER',
  },
];

/** The style object of the span that renders `word` — found by walking back
 *  from the text node to the `style={{` before it, which is the one direction
 *  that does not need to know what the object contains. */
function styleRendering(region: string, word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const node = new RegExp(`>\\s*${escaped}\\s*</`).exec(region);
  expect(node, `nothing renders ${word} here`).not.toBeNull();
  const at = region.lastIndexOf('style={{', node?.index ?? 0);
  expect(at, `${word} is not inside a style object`).toBeGreaterThan(-1);
  const open = at + 'style={'.length;
  let depth = 0;
  for (let index = open; index < region.length; index += 1) {
    if (region[index] === '{') depth += 1;
    else if (region[index] === '}') {
      depth -= 1;
      if (depth === 0) return region.slice(open, index + 1);
    }
  }
  return '';
}

describe('the card dialect names a reading one way', () => {
  it.each(READOUT_LABEL_SITES)('$surface is tracked at the label rung', ({ file, within, renders }) => {
    const source = SOURCES.find((entry) => entry.name === file);
    expect(source, `${file} moved — this oracle reads files off disk`).toBeDefined();
    const region = surfaceText(code(source?.text ?? ''), within);
    const style = styleRendering(region, renders);
    expect(style, `${renders} has no style object`).not.toBe('');
    expect(style).toMatch(/fontSize:\s*HUD_TYPE\.micro/);
    const tracking = /letterSpacing:\s*(-?[\d.]+)/.exec(style);
    expect(
      tracking ? Number(tracking[1]) : null,
      `${file} sets ${renders} off the readout-label rung`,
    ).toBe(READOUT_LABEL_RUNG);
  });

  it('the record says the rung, and says the rule is partial', () => {
    // A partial rule that reads like a general one is worse than no rule, so
    // the admission is checked rather than merely written. It is checked in
    // `hudTheme.ts` and not here: this file asserting that this file contains a
    // sentence is not an assertion, because the expected string would be in the
    // file as part of the expectation. The design system's own record is the
    // only place the claim can be falsified from.
    const comment = trackingComment();
    expect(comment).toContain('readout label');
    expect(comment).toContain('This rule is PARTIAL');
    const rung = /\/\/   readout label\s+([\d.]+)\./.exec(comment);
    expect(rung, 'the record no longer states the readout label rung').not.toBeNull();
    expect(Number(rung?.[1])).toBe(READOUT_LABEL_RUNG);

    // …and the surfaces it governs are a list, held at a length, so that adding
    // an eighth is a deliberate edit rather than something that happens to a
    // rule nobody reread. It was eight; the content window's VALUE line went in
    // round 3 (the register two columns over already printed it), and a site
    // that no longer exists may not stay on the list.
    expect(READOUT_LABEL_SITES).toHaveLength(7);
  });
});

// ——— One alpha for a rule ———————————————————————————————————————————————
//
// Alpha was the dimension of this system nobody ever declared, and the sweep
// that found that out is in `hudTheme.ts` beside the tracking table: one idea —
// the line between two blocks of the cell dossier — drawn at 0.09, 0.13, 0.15,
// 0.18, 0.24 and 0.32. The 0.09 was not merely inconsistent; it sat BELOW the
// number the same file had already written down as invisible, in a comment
// arguing that two other rules had to be raised because "under this background
// that is no rule at all".
//
// What this governs is a RULE and nothing else, and the jurisdiction is a
// CONSTRUCT rather than a filename: a `1px solid` horizontal border in a style
// object that sets no vertical border and no `background` of its own. Both
// halves of that do real work. A style object with a ground is a SURFACE — a
// banner, a condition box, a control — and its border is that surface's own
// outline, not a line between two things; that is what keeps the banners' 0.45
// bottom edges and the LINK LOST box's 0.5 out of a rule's business. And an
// object that sets a left or right border is drawing an EDGE: `spatialPlate`
// wears 0.46 / 0.15 / 0.09 on its three sides because it is a LIT edge, and
// collapsing those onto a rule's rung would flatten the one thing they are for.
//
// The three rungs and the reasoning behind each are in `hudTheme.ts` — this
// tolls itself against that table rather than keeping a second copy of it. Two
// of them are about what a line separates, a section or a rank. The third
// belongs to the status strip alone, and is declared rather than derived
// because a rule is read as its alpha TIMES the brightness of its ink: the
// strip draws in `cyanWire`, a panel in its accent, and cyan at 0.07 and orange
// at 0.16 land within 1.4× of each other on the ground both sit on. So the
// strip's rung is keyed to its file the way the tracking table's exceptions
// are, and nobody else may borrow it.
//
// WHAT IS NOT HERE is argued at length in `hudTheme.ts` and worth naming again
// in one line: material alpha under a camera, canvas `globalAlpha`, a wash, a
// glow, a surface's edge, a rail and a track are each a different question, and
// a rule that reached for them would be wrong about most of them.

/** The rungs, held here for the sweep and tolled against `hudTheme.ts`. */
const ALPHA_RUNGS = { rule: 0.16, zoneBreak: 0.32, strip: 0.07 } as const;

/** The one surface the strip rung belongs to — same arrangement as a declared
 *  tracking exception, and for the same reason: the argument is about ONE
 *  surface, so it stops being an argument the moment a second one helps itself. */
const STRIP_RULE_SOURCE = 'StatusStrip.tsx';

/** The RAIL rungs — a rule stood upright, and the same three questions asked
 *  of it. Held here, tolled against `hudTheme.ts`, and every value read from
 *  the constant that ships it rather than typed a second time. */
const RAIL_RUNGS = {
  row: PLATE_ROW_RAIL_ALPHA,
  plateEdge: PLATE_EDGE_ALPHA.rail,
  lit: PLATE_ROW_RAIL_LIT_ALPHA,
  hot: PLATE_ROW_RAIL_HOT_ALPHA,
} as const;

/** …and the strip's, which is declared exactly the way its RULE rung is: the
 *  argument is cyan on the instrument's own chrome, it is measured against one
 *  surface, and it does not travel. Typed here rather than imported from
 *  `StatusStrip.tsx` on purpose — an oracle that reads a file's own number and
 *  then checks that file against it asserts nothing. */
const STRIP_RAIL_RUNG = 0.14;

/** The alpha table's own text in `hudTheme.ts`. Read RAW: it is a comment. */
function alphaComment(): string {
  const theme = SOURCES.find((source) => source.name === 'hudTheme.ts');
  expect(theme, 'hudTheme.ts moved — this oracle reads files off disk').toBeDefined();
  const text = theme?.text ?? '';
  const start = text.indexOf('// ——— Alpha');
  const end = text.indexOf('/** A `#RRGGBB` palette color', start);
  expect(start, 'no Alpha section to read').toBeGreaterThan(-1);
  expect(end, 'no end to the Alpha section').toBeGreaterThan(start);
  return text.slice(start, end);
}

/** THE RUNG A BORDER MAY NAME, and why the sweep resolves names at all.
 *
 *  The rails and the plate edges are stated as constants in `primitives.tsx`,
 *  not as literals at their call sites, so a sweep that only read numbers would
 *  fail the very sites that do the right thing. It resolves the name to its
 *  value instead — which also means a rung cannot be renumbered behind this
 *  file's back: change `PLATE_ROW_RAIL_ALPHA` and every reader moves with it.
 *
 *  `railAlpha` is `PlateReadoutRow`'s prop, defaulted to the row rung; a caller
 *  passing something else is a call-site question the row's own tests ask. */
const NAMED_ALPHAS: Readonly<Record<string, number>> = {
  PLATE_ROW_RAIL_ALPHA,
  PLATE_ROW_RAIL_HOT_ALPHA,
  PLATE_ROW_RAIL_LIT_ALPHA,
  railAlpha: PLATE_ROW_RAIL_ALPHA,
  'PLATE_EDGE_ALPHA.rail': PLATE_EDGE_ALPHA.rail,
  'PLATE_EDGE_ALPHA.top': PLATE_EDGE_ALPHA.top,
  'PLATE_EDGE_ALPHA.bottom': PLATE_EDGE_ALPHA.bottom,
  STRIP_RAIL_ALPHA: STRIP_RAIL_RUNG,
};

/** A `1px solid …` / `2px solid …` border template, whatever is inside it. The
 *  sweep used to be anchored on `${rgba(ink, α)}` and that was the hole report
 *  F measured: nineteen borders in `ConsensusIdentityPlate` and
 *  `CellCausalLensReadout` were written `${ink}HH` — the same pixel, in a
 *  notation this file could not read, at seven alphas the ladder has never
 *  heard of. Three notations reach the same border and all three are read here:
 *  `${rgba(ink, α)}`, `${ink}HH`, and a bare `${ink}` at full strength. */
const BORDER_TEMPLATE = /`(\d)px (?:solid|dashed) ([^`]*)`/g;

/** The property a border template belongs to. Walking back to the nearest
 *  `border*:` is not enough — an `outline:` two lines below a `borderBottom:`
 *  would be read as more of the border — so it walks back to the nearest
 *  property of ANY kind and then asks whether that one is a border. A property
 *  is an identifier at the head of a line or just after a `{` or a `,`, which
 *  is what keeps a ternary's `: active` from looking like one. */
function borderPropertyAt(text: string, at: number): string | null {
  const before = text.slice(Math.max(0, at - 400), at);
  const properties = [...before.matchAll(/(?:^|[{,])[ \t]*([A-Za-z][A-Za-z0-9]*)\s*:/gm)];
  const last = properties[properties.length - 1];
  return last ? last[1] : null;
}

/** Every alpha a border template asks for. A ternary asks for more than one —
 *  a hop chip's underline is its own colour when locked and a rail at rest
 *  otherwise — and every branch is a border somebody sees. An alpha that is
 *  neither a number nor a named rung comes back as its own text, so the
 *  offender message says what was written rather than `NaN`. */
function borderAlphas(value: string): Array<number | string> {
  const found: Array<number | string> = [];
  let rest = value;

  const resolve = (expression: string) => {
    // A ternary's CONDITION is not an alpha — `lit ? HOT : railAlpha` asks for
    // two — so each `?` and everything left of it inside its branch is dropped
    // before the branches are read.
    let branches = expression;
    while (branches.includes('?')) {
      const next = branches.replace(/[^?:]*\?/, '');
      if (next === branches) break;
      branches = next;
    }
    for (const raw of branches.split(':')) {
      const term = raw.trim();
      if (term === '') continue;
      if (/^\d*\.?\d+$/.test(term)) { found.push(Number(term)); continue; }
      if (term in NAMED_ALPHAS) { found.push(NAMED_ALPHAS[term]); continue; }
      found.push(term);
    }
  };

  for (const match of rest.matchAll(/rgba\(\s*[^,()]+,\s*([^()]+?)\)/g)) resolve(match[1]);
  rest = rest.replace(/rgba\(\s*[^,()]+,\s*[^()]+?\)/g, '');

  for (const match of rest.matchAll(/\$\{[^{}]*\}([0-9a-fA-F]{2})(?![0-9a-fA-F])/g)) {
    found.push(Number((parseInt(match[1], 16) / 255).toFixed(3)));
  }
  rest = rest.replace(/\$\{[^{}]*\}[0-9a-fA-F]{2}(?![0-9a-fA-F])/g, '');

  // Whatever colour is left is drawn at its own strength — a corner bracket, a
  // locked hop, a bar at full alarm. That is a rung too, and the loudest one.
  for (const _ of rest.matchAll(/\$\{[^{}]+\}/g)) found.push(1);

  return found;
}

/** Every border of one orientation a source draws, with the ink it is drawn in
 *  and every alpha it can take. */
function bordersIn(
  text: string,
  properties: readonly string[],
): Array<{ property: string; ink: string; alphas: Array<number | string>; at: number }> {
  const borders: Array<{ property: string; ink: string; alphas: Array<number | string>; at: number }> = [];
  BORDER_TEMPLATE.lastIndex = 0;
  let match = BORDER_TEMPLATE.exec(text);
  while (match !== null) {
    const property = borderPropertyAt(text, match.index);
    if (property !== null && properties.includes(property)) {
      borders.push({
        property,
        ink: (match[2].match(/\$\{(?:rgba\(\s*)?([^,{}()]+)/)?.[1] ?? match[2]).trim(),
        alphas: borderAlphas(match[2]),
        at: match.index,
      });
    }
    match = BORDER_TEMPLATE.exec(text);
  }
  return borders;
}

/** Every rule a source draws, with the ink it is drawn in. */
function rulesIn(text: string): Array<{ ink: string; alpha: number | string }> {
  const rules: Array<{ ink: string; alpha: number | string }> = [];
  for (const border of bordersIn(text, ['borderTop', 'borderBottom'])) {
    const object = enclosingObject(text, border.at) ?? '';
    const surface = /(?:^|[\s{,])background:/.test(object);
    const edge = /border(?:Left|Right):/.test(object);
    if (surface || edge) continue;
    for (const alpha of border.alphas) rules.push({ ink: border.ink, alpha });
  }
  return rules;
}

/** Every vertical rail, which is the same question turned on its side. No
 *  surface/edge exclusion here and there must not be one: a rail on a plate
 *  with a ground is still a rail — `PlateReadoutRow`'s pressable row and
 *  `spatialPlate` both have one — and excluding grounds would empty the sweep
 *  of the two constructs it exists for. */
function railsIn(text: string): Array<{ ink: string; alpha: number | string }> {
  const rails: Array<{ ink: string; alpha: number | string }> = [];
  for (const border of bordersIn(text, ['borderLeft'])) {
    for (const alpha of border.alphas) rails.push({ ink: border.ink, alpha });
  }
  return rails;
}

/** Every opacity written as a number, in the notation React takes it. */
function opacitiesIn(text: string): number[] {
  const found: number[] = [];
  const opacity = /(?<![\w$-])opacity:\s*([^,;}\n]+)/g;
  let match = opacity.exec(text);
  while (match !== null) {
    for (const number of match[1].match(/\d+\.?\d*|\.\d+/g) ?? []) found.push(Number(number));
    match = opacity.exec(text);
  }
  return found;
}

describe('one alpha for a rule', () => {
  it('the table in hudTheme and the rungs here are one ladder', () => {
    // The toll, as the tracking table has one. A rung table written in two
    // places is the failure this whole file is about.
    const comment = alphaComment();
    const declared: number[] = [];
    const line = /^\/\/   (0\.\d+)   [A-Z]/gm;
    let rung = line.exec(comment);
    while (rung !== null) {
      declared.push(Number(rung[1]));
      rung = line.exec(comment);
    }
    expect(declared.sort((a, b) => a - b))
      .toEqual([...Object.values(ALPHA_RUNGS)].sort((a, b) => a - b));

    // …and the strip's rung is attributed to the strip in the record, not just
    // in this file.
    expect(comment).toContain('STATUS STRIP');
    expect(comment).toContain('`REVEAL_GHOST_OPACITY` in `primitives.tsx`');
  });

  it('the rail table is one ladder with the constants that ship it', () => {
    // The same toll, for the dimension the ladder used to wave through with
    // "a rail: already one number in one place" — which was true of one rail
    // and false of the thirteen others (report F, F-7).
    const comment = alphaComment();
    const declared: number[] = [];
    const rung = /^\/\/   RAIL (0\.\d+|1)\s{2,}[A-Z]/gm;
    let line = rung.exec(comment);
    while (line !== null) {
      declared.push(Number(line[1]));
      line = rung.exec(comment);
    }
    expect(declared.sort((a, b) => a - b))
      .toEqual([...Object.values(RAIL_RUNGS), STRIP_RAIL_RUNG].sort((a, b) => a - b));

    // The rungs are ordered, and the order is the argument: a row hangs on
    // less than the plate that holds it, a block on more, a pointer on all.
    expect(RAIL_RUNGS.row).toBeLessThan(RAIL_RUNGS.plateEdge);
    expect(RAIL_RUNGS.plateEdge).toBeLessThan(RAIL_RUNGS.lit);
    expect(RAIL_RUNGS.lit).toBeLessThan(RAIL_RUNGS.hot);
    expect(STRIP_RAIL_RUNG).toBeLessThan(RAIL_RUNGS.row);
  });

  it('dimming is two roles, and the theme says which two', () => {
    const comment = alphaComment();
    expect(comment).toContain(`STALE      ${STALE_OPACITY}`);
    expect(comment).toContain(`COMPANION  ${COMPANION_OPACITY}`);

    // Two ROLES, and they used to be told apart by their numbers: 0.68 against
    // 0.88, "a reading you cannot trust yet" against "a name's second name".
    // Ruling 17 took that job off the weight, because weight cannot say either
    // sentence — it can only say LESS LIGHT, and less light on a reading you
    // are being told to go and check is the opposite instruction. Both weights
    // are the legibility floor now (the oracle below derives each), so they
    // coincide, and what carries the difference is the WORD: `· STALE` and its
    // family beside a stale reading, a second NAME beside a first.
    //
    // So the toll is on the two names still existing and still meaning two
    // things, not on their being two numbers. If a companion is ever set in an
    // ink no stale reading wears, its floor moves and this equality goes away
    // on its own — which is the difference between two derived numbers that
    // agree and one number with two names.
    expect(STALE_OPACITY).toBe(COMPANION_OPACITY);
    for (const [name, sites] of [
      ['STALE_OPACITY', /(?<![\w$-])opacity:[^,;}\n]*\bSTALE_OPACITY\b/],
      ['COMPANION_OPACITY', /(?<![\w$-])opacity:[^,;}\n]*\bCOMPANION_OPACITY\b/],
    ] as const) {
      const worn = domDialect()
        .filter((source) => sites.test(code(source.text)))
        .map((source) => source.name);
      expect(worn.length, `${name} has no wearers — a role with nothing in it`)
        .toBeGreaterThan(3);
    }
  });

  it('a zone break is louder than a rule, which is the whole distinction', () => {
    expect(ALPHA_RUNGS.zoneBreak).toBeGreaterThan(ALPHA_RUNGS.rule);
    expect(ALPHA_RUNGS.rule).toBeGreaterThan(ALPHA_RUNGS.strip);
  });

  it('finds rules, and does not mistake a surface or an edge for one', () => {
    // The pin, and it has two halves because this classifier can fail in two
    // directions. Too narrow and the membership rule below checks nothing; too
    // broad and it starts demanding a rule's alpha from a banner's own edge.
    const overlay = domDialect();
    const rules = overlay.flatMap((source) => rulesIn(code(source.text)));
    expect(rules.length).toBeGreaterThan(10);

    // `primitives.tsx` draws exactly one pair of horizontal borders and they
    // are `spatialPlate`'s lit edge — three sides, three alphas, on purpose,
    // and now named rather than typed so the hand-drawn plates can read them.
    const primitives = SOURCES.find((source) => source.name === 'primitives.tsx');
    expect(code(primitives?.text ?? ''))
      .toContain('borderTop: `1px solid ${rgba(accent, PLATE_EDGE_ALPHA.top)}`');
    expect(rulesIn(code(primitives?.text ?? ''))).toEqual([]);

    // …and a band's bottom edge is the band, not a rule between blocks. It is
    // drawn once now, in the shape all three tenants of the top slot wear.
    const band = SOURCES.find((source) => source.name === 'TopBand.tsx');
    expect(code(band?.text ?? '')).toContain('borderBottom: `1px solid ${rgba(accent, 0.45)}`');
    expect(rulesIn(code(band?.text ?? ''))).toEqual([]);
  });

  it('every rule in the overlay is a declared rung', () => {
    const offenders: string[] = [];
    for (const source of domDialect()) {
      for (const rule of rulesIn(code(source.text))) {
        if (Object.values(ALPHA_RUNGS).includes(rule.alpha as never)) continue;
        offenders.push(`${source.name}: a rule at ${rule.alpha} is not a rung of the alpha table`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the strip rung belongs to the strip', () => {
    // Stated separately because it is a different promise. Membership would
    // pass if a panel drew its section rule at the strip's 0.07; the argument
    // for that number is about cyan on the instrument's own chrome, and it does
    // not travel.
    const strays: string[] = [];
    for (const source of domDialect()) {
      if (source.name === STRIP_RULE_SOURCE) continue;
      for (const rule of rulesIn(code(source.text))) {
        if (rule.alpha !== ALPHA_RUNGS.strip) continue;
        strays.push(`${source.name}: ${rule.alpha} is ${STRIP_RULE_SOURCE}'s rung`);
      }
    }
    expect(strays).toEqual([]);

    // And the strip really is where it is worn — otherwise the rung is a rule
    // about nothing.
    //
    // ⚠️ THE CHROME, NOT THE FILE. The strip's file also holds the PANELS
    // dropdown, and the argument for 0.07 does not reach it: the rung is cyan
    // on the instrument's own TRANSLUCENT chrome, and the menu stands on
    // `stageGround` at 0.96, where a 0.07 hairline is not a faint line but no
    // line. So the file is split at the menu's own component and the two
    // halves are asked different questions — the chrome wears the strip's
    // rung, the menu wears the ordinary section rule every other readout wears
    // (and the membership rule above still holds it to a declared rung).
    const strip = code(SOURCES.find((source) => source.name === STRIP_RULE_SOURCE)?.text ?? '');
    const menuAt = strip.indexOf('function PanelVisibilityControl');
    const menuEnd = strip.indexOf('\nconst ENRICHMENT_COLOR');
    expect(menuAt, 'the PANELS menu moved out of the strip').toBeGreaterThan(-1);
    expect(menuEnd).toBeGreaterThan(menuAt);
    const chrome = strip.slice(0, menuAt) + strip.slice(menuEnd);
    const menu = strip.slice(menuAt, menuEnd);

    const worn = rulesIn(chrome).map((rule) => rule.alpha);
    expect(worn.length).toBeGreaterThan(1);
    expect(new Set(worn)).toEqual(new Set([ALPHA_RUNGS.strip]));

    // The menu's own, and it is the section rule: the key legend is a second
    // section of one readout, which is that rung's whole definition.
    expect(new Set(rulesIn(menu).map((rule) => rule.alpha)))
      .toEqual(new Set([ALPHA_RUNGS.rule]));
  });

  it('the ghost is one number, and no file writes it down', () => {
    // `REVEAL_GHOST_OPACITY`'s own doc comment says "One number so no two
    // stages can disagree about what dark means" — and two files were typing
    // the literal instead, one of them without importing the module at all,
    // which is exactly the shape the palette's inverted rule was written for.
    const offenders: string[] = [];
    for (const source of domDialect()) {
      for (const value of opacitiesIn(code(source.text))) {
        if (value !== REVEAL_GHOST_OPACITY) continue;
        offenders.push(`${source.name}: ${value} is REVEAL_GHOST_OPACITY, spelled instead of read`);
      }
    }
    expect(offenders).toEqual([]);

    // …and it has readers, so the ban above is not guarding an orphan.
    const readers = SOURCES
      .filter((source) => code(source.text).includes('REVEAL_GHOST_OPACITY'))
      .map((source) => source.name)
      .sort();
    expect(readers).toContain('primitives.tsx');
    expect(readers.length).toBeGreaterThan(2);
  });

  it('finds a rule however its alpha was spelled', () => {
    // The pin under the widened sweep, and it is the whole finding: three
    // notations, one border. Written as literals here so this reads as a
    // specification rather than as a paraphrase of the regex above it.
    expect(rulesIn('  borderTop: `1px solid ${rgba(accent, 0.16)}`,'))
      .toEqual([{ ink: 'accent', alpha: 0.16 }]);
    expect(rulesIn('  borderTop: `1px solid ${CYAN}22`,'))
      .toEqual([{ ink: 'CYAN', alpha: 0.133 }]);
    expect(rulesIn('  borderBottom: `1px solid ${color}`,'))
      .toEqual([{ ink: 'color', alpha: 1 }]);
    // …a named rung resolves to its number, and a ternary is every branch.
    expect(railsIn('  borderLeft: `1px solid ${rgba(a, PLATE_EDGE_ALPHA.rail)}`,'))
      .toEqual([{ ink: 'a', alpha: PLATE_EDGE_ALPHA.rail }]);
    expect(railsIn('  borderLeft: `1px solid ${lit ? c : rgba(c, PLATE_ROW_RAIL_ALPHA)}`,').map((r) => r.alpha))
      .toEqual([PLATE_ROW_RAIL_ALPHA, 1]);
    // …and an alpha nobody named comes back as itself, not as NaN.
    expect(rulesIn('  borderTop: `1px solid ${rgba(accent, someWidth)}`,'))
      .toEqual([{ ink: 'accent', alpha: 'someWidth' }]);
    // The property is read from the nearest property of ANY kind, so an
    // outline under a border is an outline.
    expect(rulesIn('  borderBottom: `1px solid ${a}`,\n  outline: `1px solid ${b}88`,'))
      .toEqual([{ ink: 'a', alpha: 1 }]);
  });

  it('every rail in the overlay is a declared rung', () => {
    // The dimension the ladder claimed was already settled. Fourteen rails at
    // twelve alphas, from 0.14 to 0.561, and the claim in `hudTheme.ts` was
    // "already one number in one place" (report F, F-7).
    const offenders: string[] = [];
    for (const source of domDialect()) {
      const rungs: number[] = source.name === STRIP_RULE_SOURCE
        ? [STRIP_RAIL_RUNG, ...Object.values(RAIL_RUNGS)]
        : [...Object.values(RAIL_RUNGS)];
      for (const rail of railsIn(code(source.text))) {
        if (typeof rail.alpha === 'number' && rungs.includes(rail.alpha)) continue;
        offenders.push(`${source.name}: a rail at ${rail.alpha} is not a rung of the rail table`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the rails are worn, and by the files that own the construct', () => {
    // A membership rule over an empty set passes, so the set is named. These
    // five are the rail's constructs: the row primitive, the two card
    // dialects that draw facts, and the two hand-built plates that were the
    // whole of report F-1.
    const wearers = domDialect()
      .filter((source) => railsIn(code(source.text)).length > 0)
      .map((source) => source.name)
      .sort();
    for (const name of [
      'CellCausalLensReadout.tsx',
      'CellDetailPanel.tsx',
      'ConsensusIdentityPlate.tsx',
      'PeerLinkCard.tsx',
      'primitives.tsx',
    ]) {
      expect(wearers, `${name} draws no rail — did the construct move?`).toContain(name);
    }

    // …and the strip's rung belongs to the strip, exactly as its rule rung
    // does. A panel borrowing 0.14 would draw a rail nobody can see.
    const strays: string[] = [];
    for (const source of domDialect()) {
      if (source.name === STRIP_RULE_SOURCE) continue;
      for (const rail of railsIn(code(source.text))) {
        if (rail.alpha !== STRIP_RAIL_RUNG) continue;
        strays.push(`${source.name}: ${rail.alpha} is ${STRIP_RULE_SOURCE}'s rail rung`);
      }
    }
    expect(strays).toEqual([]);

    // …and the strip states it once, as a named number with the argument on
    // it, rather than twice as a literal.
    const strip = SOURCES.find((source) => source.name === STRIP_RULE_SOURCE);
    expect(code(strip?.text ?? '')).toContain(`const STRIP_RAIL_ALPHA = ${STRIP_RAIL_RUNG};`);
  });

  it('the plate edge is one edge, and the hand-drawn plates read it', () => {
    // `spatialPlate` was exempted from the alpha ladder on the grounds that a
    // single-sourced edge cannot drift. It cannot; the exemption was read as
    // covering every edge, and two files built plates of the same shape by
    // hand at seven alphas of their own between 0.102 and 0.478 (report F).
    const readers = domDialect()
      .filter((source) => code(source.text).includes('PLATE_EDGE_ALPHA'))
      .map((source) => source.name)
      .sort();
    expect(readers).toEqual([
      'CellCausalLensReadout.tsx',
      'ConsensusIdentityPlate.tsx',
      'primitives.tsx',
    ]);

    // And the light comes from the left on every one of them — two of the
    // seven had the top edge brighter than the rail, which is the plate lit
    // from the wrong side.
    expect(PLATE_EDGE_ALPHA.rail).toBeGreaterThan(PLATE_EDGE_ALPHA.top);
    expect(PLATE_EDGE_ALPHA.top).toBeGreaterThan(PLATE_EDGE_ALPHA.bottom);
  });

  it('a hairline is never written as a hex suffix', () => {
    // The notation itself, banned outright on the properties the two ladders
    // govern. `${ink}HH` is unreadable at a glance — nobody knows 0x8f is
    // 0.561 — and it is what let one file draw ten alphas on one dimension.
    const offenders: string[] = [];
    for (const source of domDialect()) {
      const text = code(source.text);
      const suffix = /border(?:Top|Bottom|Left|Right)(?:Color)?:[^\n]*\$\{[^{}]*\}[0-9a-fA-F]{2}(?![0-9a-fA-F])/g;
      for (const match of text.matchAll(suffix)) {
        offenders.push(`${source.name}: ${match[0].trim().slice(0, 72)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('dimming is one weight per role, and the roles are two', () => {
    // Eight numbers said two things (report F, F-8). The sweep is by ROLE and
    // derived: a ternary keyed on staleness must dim to `STALE_OPACITY`, and
    // a CJK companion must dim to `COMPANION_OPACITY`.
    const stale: string[] = [];
    let staleSites = 0;
    for (const source of domDialect()) {
      const text = code(source.text);
      const dim = /opacity:\s*([A-Za-z][\w.]*)\s*\?\s*([^:]+):\s*([^,;}\n]+)/g;
      for (const match of text.matchAll(dim)) {
        if (!/stale|dimmed|partial/i.test(match[1])) continue;
        staleSites += 1;
        const dimmed = /stale|dimmed|partial/i.test(match[1]) ? match[2] : match[3];
        if (dimmed.trim() === 'STALE_OPACITY') continue;
        stale.push(`${source.name}: dims to ${dimmed.trim()} rather than STALE_OPACITY`);
      }
    }
    expect(stale).toEqual([]);
    // …and the matcher finds staleness ternaries at all, so an empty offender
    // list is a reading rather than a silence.
    expect(staleSites).toBeGreaterThan(6);

    const companions: string[] = [];
    let companionSites = 0;
    for (const source of domDialect()) {
      const text = code(source.text);
      for (const match of text.matchAll(/\{[^{}]*HUD_FONTS\.cjk[^{}]*\}/g)) {
        const opacity = /opacity:\s*([^,;}\n]+)/.exec(match[0]);
        if (opacity === null) continue;
        companionSites += 1;
        if (opacity[1].trim() === 'COMPANION_OPACITY') continue;
        companions.push(`${source.name}: a companion at ${opacity[1].trim()}`);
      }
    }
    expect(companions).toEqual([]);
    expect(companionSites).toBeGreaterThan(4);

    // The scope tag is the same role in Latin — a qualifier beside a count —
    // and it wore 0.8 in the two files that drew one. It is written once now,
    // `SCOPE_TAG` in `primitives.tsx`, and every surface that draws one reads
    // it from there: a third copy typed by hand is how the 0.8 got in.
    const primitives = code(SOURCES.find((item) => item.name === 'primitives.tsx')?.text ?? '');
    const scopeTag = /export const SCOPE_TAG: CSSProperties = \{[^}]*\}/.exec(primitives)?.[0] ?? '';
    expect(scopeTag, 'primitives.tsx lost SCOPE_TAG').toContain("textTransform: 'uppercase'");
    expect(scopeTag, 'a scope tag is a companion').toContain('opacity: COMPANION_OPACITY');
    for (const name of ['CellCensusReadout.tsx', 'StageCapacityPanel.tsx', 'TaxonomyBar.tsx']) {
      const source = code(SOURCES.find((item) => item.name === name)?.text ?? '');
      expect(source, `${name} draws a scope tag of its own`).not.toMatch(/const SCOPE_TAG/);
      expect(source, `${name} lost its scope tag`).toMatch(/\bSCOPE_TAG\b/);
    }
  });

  it('reads an opacity however it was written', () => {
    // The pin under the ban. A leading-zero-less decimal is how CSS strings
    // spell one, and a sweep that only knew `0.18` would read `.18` as nothing.
    expect(opacitiesIn('opacity: 0.18,')).toEqual([0.18]);
    expect(opacitiesIn('opacity: revealed ? 1 : 0.18,')).toEqual([1, 0.18]);
    expect(opacitiesIn('opacity:.18}')).toEqual([0.18]);
    expect(opacitiesIn('backgroundOpacity: 0.18,')).toEqual([]);
  });
});

// ——— Time is a ladder, and three easings are reserved ————————————————————
//
// The fourth dimension of this design system, and the last one to get a table.
// Colour had a palette, type eleven rungs, tracking eight, alpha three — and
// time had TWENTY-SEVEN distinct durations under four seconds and SEVEN
// easings, every one of them a literal typed where it was needed (report E,
// E-1). 140 and 160 and 180 are not three speeds; they are one speed spelled
// three times, below the threshold at which anybody can tell two transitions
// apart, and the cost of that is not untidiness — it is that nothing could be
// RESERVED. `steps(2)` means ALARM and `linear` means INSTRUMENT only while
// no other surface may reach for them.
//
// So this chapter is two sweeps and a toll. The sweeps: no `transition:` or
// `animation:` in the application types a duration or an easing, and no HUD
// timer types a delay — every one of them names a rung of `HUD_MOTION`. The
// toll: the rungs written in the theme's own prose are the rungs the object
// exports, and the instruments the prose EXEMPTS are read out of the files
// they live in, so an exemption cannot outlive the number it was granted for.
//
// The ladder's horizon is FOUR SECONDS, which is report E's own frame. Above
// it a number is a policy window rather than a motion — a staleness threshold,
// the composition's settle and quiet, a track position in the Jukebox — and a
// ladder that reached for those would be wrong about most of them.

/** Every file whose time this ladder governs: the HUD directory, the card
 *  chassis and the peer epilogue beside it, and the three app files that own
 *  a duration of their own. Deliberately NOT the scene — `cellPositions`,
 *  `fabricEdgeRender` and the trace clocks are a lifecycle a camera watches,
 *  not a HUD reading a person reads, and they already cluster (1.2 / 1.5 /
 *  1.8 s) around a rung this table took FROM them. */
const MOTION_JURISDICTION: readonly string[] = [
  'components/sceneInspection.tsx',
  'hooks/usePeerInspectionRetention.ts',
  // The alarm's dwell and the timer that ends it. A dwell is a duration a
  // reader experiences — the sole reason `HUD_MOTION.hold` exists — so it
  // answers to the ladder like any transition.
  'derives/alertLevel.ts',
  'hooks/useHeldAlert.ts',
  // The quality crossfade: a tier change is a change with a shape to watch,
  // and its length is a rung like any transition's.
  'tweaks/adaptiveQuality.ts',
];
const MOTION_APP_FILES: readonly string[] = [
  'Jukebox.tsx',
  'inspection-exit.ts',
  'orbit-gesture-state.ts',
];

function motionSources(): HudSource[] {
  return [
    ...SOURCES.map((source) => ({ ...source, name: `hud/${source.name}` })),
    ...PACKAGE_SOURCES.filter((source) => MOTION_JURISDICTION.includes(source.name)),
    ...APP_SOURCES.filter((source) => MOTION_APP_FILES.includes(source.name)),
  ];
}

/** The theme's own Time chapter, read as prose. The rungs and the instrument
 *  exemptions are both written there for a person; this is the toll that keeps
 *  the prose and the code one statement. */
function motionComment(): string {
  const theme = SOURCES.find((source) => source.name === 'hudTheme.ts');
  expect(theme, 'hudTheme.ts moved — this oracle reads files off disk').toBeDefined();
  const text = theme?.text ?? '';
  const start = text.indexOf('// ——— Time ———');
  const end = text.indexOf('export const HUD_MOTION', start);
  expect(start, 'no Time section to read').toBeGreaterThan(-1);
  expect(end, 'no end to the Time section').toBeGreaterThan(start);
  return text.slice(start, end);
}

/** Every `transition:` / `animation:` value in a source, however it is
 *  written: a React style prop, a CSS rule inside a template string, a
 *  ternary with the reduced-motion arm on the other side. The value ends at
 *  the property's own terminator — a comma outside braces, a backtick, a
 *  closing brace — which is what keeps `transition: a, b` one value and two
 *  adjacent properties two. */
function motionValues(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?<![\w$-])(?:transition|animation):\s*/g)) {
    const from = (match.index ?? 0) + match[0].length;
    let depth = 0;
    let end = text.length;
    for (let index = from; index < text.length; index += 1) {
      const ch = text[index];
      if (ch === '{' || ch === '(') depth += 1;
      else if (ch === '}' || ch === ')') {
        if (depth === 0) { end = index; break; }
        depth -= 1;
      } else if (ch === '\n' && depth === 0 && /[,;`']\s*$/.test(text.slice(from, index))) {
        end = index;
        break;
      }
    }
    found.push(text.slice(from, end));
  }
  return found;
}

describe('one ladder for time', () => {
  it('the table in hudTheme and the rungs here are one ladder', () => {
    // The toll the tracking and alpha tables already carry. A rung table
    // written in two places is the failure this whole file is about.
    const declared = new Map<string, number>();
    for (const rung of motionComment().matchAll(/^\/\/   (\w+)\s+([\d,]+)   [A-Z]/gm)) {
      declared.set(rung[1], Number(rung[2].replace(/,/g, '')));
    }
    const table = Object.fromEntries(
      Object.entries(HUD_MOTION).filter(([, value]) => typeof value === 'number'),
    );
    expect(Object.fromEntries(declared)).toEqual(table);
    expect(declared.size).toBe(6);

    // The rungs are ordered and none of them collides: six names for six
    // speeds, which is the whole point of stopping at six.
    const values = [...declared.values()];
    expect(new Set(values).size).toBe(values.length);
    expect([...values].sort((a, b) => a - b)).toEqual(values);

    // And the five easings each have a name and a job. `ease-out` and the
    // second bezier — 0.02 from the first — are gone.
    expect(Object.entries(HUD_MOTION).filter(([key]) => key.endsWith('Ease')))
      .toEqual([
        ['enterEase', 'cubic-bezier(.2,.82,.2,1)'],
        ['fadeEase', 'ease'],
        ['loopEase', 'ease-in-out'],
        ['instrumentEase', 'linear'],
        ['alarmEase', 'steps(2)'],
      ]);
  });

  it('nothing that moves types a duration or an easing', () => {
    // The sweep. Every value is read whole, so a two-property transition is
    // caught in both halves and a ternary is caught in the arm that animates.
    const offenders: string[] = [];
    for (const source of motionSources()) {
      for (const value of motionValues(code(source.text))) {
        for (const literal of value.matchAll(/(?<![\w$.])(\d+(?:\.\d+)?)\s*m?s(?![\w-])/g)) {
          offenders.push(`${source.name}: ${literal[0]} — a duration is a rung of HUD_MOTION`);
        }
        for (const easing of value.matchAll(
          /(?<![\w$-])(ease-in-out|ease-out|ease-in|ease|linear|steps\([^)]*\)|cubic-bezier\([^)]*\))(?![\w-])/g,
        )) {
          offenders.push(`${source.name}: ${easing[1]} — an easing is a name in HUD_MOTION`);
        }
      }
    }
    expect(offenders).toEqual([]);

    // …and the sweep reads the surfaces it claims to: the five card dialects
    // and the theme's own stylesheet all move.
    const moving = motionSources()
      .filter((source) => motionValues(code(source.text)).length > 0)
      .map((source) => source.name);
    expect(moving.length).toBeGreaterThan(8);
    expect(moving).toContain('hud/hudTheme.ts');
    expect(moving).toContain('components/sceneInspection.tsx');
    expect(moving).toContain('Jukebox.tsx');
  });

  it('the two reserved easings have the wearers they were reserved for', () => {
    // A reservation nobody checks is a preference. `steps(2)` is a hard
    // two-state flash — what a siren looks like — and `linear` is a machine's
    // own time, which is the reading an instrument gets for free ONLY while
    // nothing decorative borrows it.
    const wearers = (key: 'alarmEase' | 'instrumentEase') => motionSources()
      .filter((source) => code(source.text).includes(`HUD_MOTION.${key}`))
      .map((source) => source.name)
      .sort();
    expect(wearers('alarmEase')).toEqual(['hud/WarningBar.tsx']);
    expect(wearers('instrumentEase')).toEqual(['hud/CellDetailPanel.tsx']);

    // The instrument's two: the scan beam, which interpolates between two
    // samples of the scan clock, and the specimen sweep it runs alongside
    // (both retire once the walk classifies — D-6).
    const dossier = code(SOURCES.find((source) => source.name === 'CellDetailPanel.tsx')?.text ?? '');
    expect(dossier).toContain('transform ${SCAN_TICK_MS}ms ${HUD_MOTION.instrumentEase}');
    expect(dossier).toContain('cknerv-cell-specimen-sweep ${HUD_MOTION.hold}ms ${HUD_MOTION.instrumentEase}');
  });

  it('there is one breathe in the whole application', () => {
    // Two keyframes said one thing: the overlay's `cknerv-hud-breathe`
    // (.82 → 1) and the Jukebox chip's `cknerv-jukebox-breathe` (.72 → 1),
    // four hundred milliseconds and one tenth of an alpha apart, in two
    // stylesheets (report E, E-1). The chip wears the HUD's now.
    const breathes: string[] = [];
    for (const source of motionSources()) {
      for (const frames of code(source.text).matchAll(/@keyframes ([\w-]*breathe[\w-]*)/g)) {
        breathes.push(`${source.name}: ${frames[1]}`);
      }
    }
    expect(breathes).toEqual(['hud/hudTheme.ts: cknerv-hud-breathe']);

    const chip = code(APP_SOURCES.find((source) => source.name === 'Jukebox.tsx')?.text ?? '');
    expect(chip, 'the chip stopped breathing').toContain('animation:cknerv-hud-breathe');
  });

  it('a HUD timer names a rung, or is an instrument the table declares', () => {
    // The other half of the sweep, and the one the CSS parser cannot see: a
    // `setTimeout` that drives a visual is a duration a reader experiences
    // however it is spelled. `BOOT_SLOT_MS` was 130 — ten off the flip rung,
    // and a number nothing else in the HUD wore.
    //
    // The exemptions are read out of the theme's prose, per FILE, so a number
    // is exempt where its instrument lives and nowhere else.
    const instruments = new Map<string, number[]>();
    for (const entry of motionComment().matchAll(/^\/\/   `([\w.-]+\.tsx?)`\s+([\d ·]+?)\s{2}/gm)) {
      instruments.set(entry[1], entry[2].split('·').map((value) => Number(value.trim())));
    }
    expect(instruments.size).toBe(7);

    const rungs = new Set<number>(
      Object.values(HUD_MOTION).filter((value) => typeof value === 'number') as number[],
    );
    const offenders: string[] = [];
    let swept = 0;
    for (const source of motionSources()) {
      const file = source.name.split('/').pop() ?? source.name;
      const allowed = instruments.get(file) ?? [];
      const text = code(source.text);
      const sites: Array<[string, number]> = [];
      for (const decl of text.matchAll(/const\s+([A-Z][A-Z0-9_]*_(?:MS|S|SECONDS))\s*=\s*([\d_.]+)\s*[;*]/g)) {
        const raw = Number(decl[2].replace(/_/g, ''));
        sites.push([decl[1], decl[1].endsWith('_MS') ? raw : raw * 1_000]);
      }
      for (const timer of text.matchAll(/set(?:Timeout|Interval)\([\s\S]{0,240}?,\s*([^),]+)\)/g)) {
        for (const number of timer[1].match(/\d[\d_]*/g) ?? []) {
          sites.push(['a timer', Number(number.replace(/_/g, ''))]);
        }
      }
      for (const [what, ms] of sites) {
        if (ms >= 4_000) continue;   // a policy window, not a motion
        swept += 1;
        if (rungs.has(ms) || allowed.includes(ms)) continue;
        offenders.push(`${source.name}: ${what} at ${ms}ms is neither a rung nor a declared instrument`);
      }
    }
    expect(offenders).toEqual([]);
    expect(swept).toBeGreaterThan(6);

    // …and every instrument the prose exempts is REAL, at the value it was
    // exempted for. An exemption that outlives its number is how a table
    // starts lying.
    for (const [file, values] of instruments) {
      const source = motionSources().find((entry) => (entry.name.split('/').pop() ?? '') === file);
      expect(source, `${file} is exempt from the motion ladder and does not exist`).toBeDefined();
      const text = code(source?.text ?? '');
      for (const ms of values) {
        const spelled = [String(ms), String(ms).replace(/(\d)(\d{3})$/, '$1_$2'), (ms / 1_000).toFixed(2)];
        expect(
          spelled.some((form) => text.includes(form)),
          `${file} no longer types ${ms}ms — the exemption outlived its number`,
        ).toBe(true);
      }
    }
  });
});

// ——— Two names, one colour, and the floor under an alarm ————————————————
//
// The palette has a separation floor and it was enforced on NAMED PAIRS: the
// pairs somebody had already suspected. Two pairs nobody had suspected sat
// under it for the life of the file (report F, F-4) — `memory`/`rebuild` at
// 4.5 and `lockedGold`/`goldInk` at 8.6, both of them a tenth of the floor,
// both with a comment beside one of them claiming the two were distinct.
//
// So the sweep is PAIRWISE, over everything the palette holds, and what it
// admits are three declared FAMILIES rather than a list of pairs. The
// difference matters: a family says what the closeness is FOR, and a member
// added to one has to fit that argument rather than be added to a list.
//
// The ink ramp is the family that needs the most saying. Its rungs are one
// grey at five heights and several neighbouring pairs are inside the floor by
// construction — `ink`/`heroInk` are 39.8 apart and always were. Distance is
// the wrong question for them; ORDER is the right one, and the rank oracle
// below is what the floor is replaced with. A rung that drifted out of order
// would break it whatever its distance said.
//
// The floor under an alarm is the same argument at the other end. `rgba(ink,
// α)` in a `color:` spends legibility on tone, and the two places it was spent
// hardest were the two gravest banners in the HUD: DATA FROZEN at 2.2 : 1 over
// a lit scene, the REORG bar's readings at 3.1 (report F, F-10). Softening
// belongs in the glow.
//
// AND THE THIRD NOTATION, which is where the same spending hid from the sweep
// that banned it: `opacity` on the element. `rgba(ink, α)` and `opacity: α`
// composite to the same pixels, and the first was banned in a `color:` while
// the second went on dimming every CJK companion in the HUD to 3.35 : 1 at
// 9px — `dim` under `COMPANION_OPACITY`, which had been chosen as a look and
// never priced (report F, F-9). The measurement below reads BOTH notations,
// and the companion's weight is now derived from the floor rather than picked.
//
// Its jurisdiction is the COMPANION and the STALE reading, and stops there on
// purpose. The other dimming roles are saying something a floor would
// contradict — a REVEAL GHOST is a fact not yet reached, a disabled control is
// one that does not work, and neither is asking to be read — while a companion
// is a qualifier you may skip and a stale reading is one you are being told to
// go and check, neither of which is the same as one you cannot read. The two
// readings this sweep found and the companion ruling left open — a stale
// unread proof in `dim` at `STALE_OPACITY` (3.08 : 1) and the memory ledger's
// SPENT INPUTS value at a bare `opacity: 0.86` in `dim` (4.40 : 1) — are
// ruling 17's, and they are held by the second floor below.

/** WCAG relative luminance, and the contrast ratio built on it. Neither was
 *  here before, because everything this file measured until now was "can a
 *  reader tell these two apart" — a distance. A floor is a different question:
 *  can a reader READ this one, on the thing it is printed on. */
function relativeLuminance(hex: string | readonly number[]): number {
  const rgb = typeof hex === 'string'
    ? [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16))
    : [...hex];
  const linear = rgb.map((channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a: string | readonly number[], b: string | readonly number[]): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** `over` composited under `alpha` of `ink`. Kept in float — the panel is
 *  0.55 of the stage and rounding it to whole channels moves the answer in the
 *  third decimal, which is exactly where `moduleSlate` sits. */
function over(ink: string, alpha: number, surface: readonly number[]): number[] {
  const rgb = [0, 2, 4].map((i) => parseInt(ink.replace('#', '').slice(i, i + 2), 16));
  return rgb.map((channel, index) => channel * alpha + surface[index] * (1 - alpha));
}

/** The two surfaces a reading is printed on. `panel` is `rgba(ground, 0.45)`
 *  over the stage, which is what `HUD_COLORS.panel` composites to. */
const STAGE_SURFACE = [0x02, 0x03, 0x0a];
const PANEL_SURFACE = STAGE_SURFACE.map((channel) => channel * 0.55);

/** The legibility floor. WCAG AA for body text, and this HUD's smallest rungs
 *  are 7.5–9 px, so it is the floor with the least room to argue. */
const CONTRAST_FLOOR = 4.5;

describe('two names are never one colour', () => {
  /** Three families whose members sit inside the floor ON PURPOSE, each with
   *  the reason it does. Any pair drawn from one set is admitted; a pair
   *  spanning two sets is not. */
  const FAMILIES: ReadonlyArray<{ why: string; members: readonly string[] }> = [
    {
      why: 'the near-blacks: a knockout, a stage and a channel, and no reader'
        + ' ever sees two of them beside each other',
      members: ['ground', 'stageGround', 'trackGround'],
    },
    {
      why: 'the ink ramp: one grey at five heights, held by the rank oracle'
        + ' below rather than by distance',
      members: ['moduleSlate', 'dim', 'legendInk', 'ink', 'heroInk'],
    },
    {
      why: 'the two wires: one cyan naming two planes, declared when the peer'
        + ' plane took its own scaffold hue',
      members: ['cyanWire', 'peerWire'],
    },
  ];

  const hexTokens = Object.entries(HUD_COLORS)
    .filter((entry): entry is [string, string] => /^#[0-9a-fA-F]{6}$/.test(String(entry[1])));

  it('every pair of names in the palette is two colours', () => {
    const sameFamily = (a: string, b: string) =>
      FAMILIES.some((family) => family.members.includes(a) && family.members.includes(b));

    const offenders: string[] = [];
    for (let i = 0; i < hexTokens.length; i += 1) {
      for (let j = i + 1; j < hexTokens.length; j += 1) {
        const [a, aHex] = hexTokens[i];
        const [b, bHex] = hexTokens[j];
        if (sameFamily(a, b)) continue;
        const gap = rgbDistance(aHex, bHex);
        if (gap > SEPARATION_FLOOR) continue;
        offenders.push(`${a} and ${b} are ${gap.toFixed(1)} apart — one colour with two names`);
      }
    }

    expect(offenders).toEqual([]);

    // …and the sweep really is pairwise over a palette with something in it,
    // so an empty offender list is a reading rather than an empty loop.
    expect(hexTokens.length).toBeGreaterThan(18);

    // Every declared family is a family — a set of one is a pair admitted by
    // being written down, which is the thing this rule replaced.
    for (const family of FAMILIES) {
      expect(family.members.length).toBeGreaterThan(1);
      for (const member of family.members) {
        expect(HUD_COLORS, `${member} is declared close to something and is not a token`)
          .toHaveProperty(member);
      }
    }
  });

  it('the two merged names are gone, and their readers moved', () => {
    // `rebuild` and `lockedGold`. Named here because a pairwise sweep cannot
    // notice a name that no longer exists, and the merge is the finding.
    for (const retired of ['rebuild', 'lockedGold']) {
      expect(HUD_COLORS, `${retired} is back`).not.toHaveProperty(retired);
    }
    const readers = PACKAGE_SOURCES
      .filter((source) => /HUD_COLORS\.(rebuild|lockedGold)\b/.test(code(source.text)))
      .map((source) => source.name);
    expect(readers).toEqual([]);

    // …and the surviving names are read, so the merge did not delete a job.
    for (const [token, count] of [['memory', 2], ['goldInk', 2]] as const) {
      const wearing = PACKAGE_SOURCES
        .filter((source) => code(source.text).includes(`HUD_COLORS.${token}`));
      expect(wearing.length, `${token} lost its readers`).toBeGreaterThanOrEqual(count);
    }
  });

  it('the ink ramp is ordered, and its bottom rung clears the floor', () => {
    // The rank the module tag's comment states — "below `dim` on purpose: a
    // tag is an address, not a reading" — measured rather than asserted in
    // prose, because it is what stands in for the separation floor inside the
    // one family whose members are meant to be close.
    const ramp = ['moduleSlate', 'dim', 'legendInk', 'ink', 'heroInk'] as const;
    for (let i = 1; i < ramp.length; i += 1) {
      expect(
        relativeLuminance(HUD_COLORS[ramp[i]]),
        `${ramp[i]} is not above ${ramp[i - 1]} — the ramp is out of order`,
      ).toBeGreaterThan(relativeLuminance(HUD_COLORS[ramp[i - 1]]));
    }

    // …and the bottom of it is still readable. `moduleSlate` was 3.4 : 1 at
    // `micro` and `tech`, the two smallest rungs in the HUD (report F, F-9);
    // the user's D-15 raised it to the floor exactly — and "exactly" was the
    // problem. D-15's own #6B7684 cleared by 0.0002, which means the answer
    // depended on whether the panel was composited in float or rounded to the
    // whole channels a browser actually paints. So the floor is asserted BOTH
    // WAYS: a token that only passes one of them has not cleared anything, it
    // has landed on the line.
    for (const surface of [PANEL_SURFACE, PANEL_SURFACE.map(Math.round)]) {
      expect(contrastRatio(HUD_COLORS.moduleSlate, surface))
        .toBeGreaterThanOrEqual(CONTRAST_FLOOR);
    }
  });

  it('a reading is never printed at an alpha that puts it under the floor', () => {
    // ANY alpha, not only one this file can price. The ink is often a
    // variable — `visual.color` is whichever severity the banner is in — and a
    // sweep that could only read `rgba(HUD_COLORS.x, α)` would have missed
    // both of the sites the finding is about. What is banned is spending
    // legibility on tone at all: the letters are the reading.
    const offenders: string[] = [];
    for (const source of domDialect()) {
      const text = code(source.text);
      for (const site of text.matchAll(/(?<![\w$])color:\s*rgba\(([^()]*(?:\([^()]*\))?[^()]*),\s*([\d.]+)\s*\)/g)) {
        if (Number(site[2]) >= 1) continue;
        const ink = HUD_COLORS[site[1].replace('HUD_COLORS.', '') as keyof typeof HUD_COLORS];
        const priced = typeof ink === 'string' && ink.startsWith('#')
          ? ` — ${contrastRatio(over(ink, Number(site[2]), PANEL_SURFACE), PANEL_SURFACE).toFixed(1)} : 1 on the panel`
          : '';
        offenders.push(`${source.name}: a reading at ${site[2]}${priced} — soften the glow, not the ink`);
      }
    }
    expect(offenders).toEqual([]);

    // The half a green sweep cannot show: the measurement works, and it agrees
    // with report F's numbers for the two states that used to fail it.
    expect(contrastRatio(over(HUD_COLORS.danger, 0.82, PANEL_SURFACE), PANEL_SURFACE))
      .toBeLessThan(CONTRAST_FLOOR);
    expect(contrastRatio(over(HUD_COLORS.memory, 0.7, PANEL_SURFACE), PANEL_SURFACE))
      .toBeLessThan(CONTRAST_FLOOR);
    expect(contrastRatio(HUD_COLORS.danger, PANEL_SURFACE))
      .toBeGreaterThan(CONTRAST_FLOOR);

    // …and the two banners that were spending it print at full now, with the
    // softening where softening belongs.
    for (const name of ['StreamHealthBanner.tsx', 'BackfillBar.tsx']) {
      const banner = code(SOURCES.find((source) => source.name === name)?.text ?? '');
      expect(banner, `${name} moved — this oracle reads files off disk`).not.toEqual('');
      expect(banner, `${name} still prints a reading at an alpha`)
        .not.toMatch(/color: rgba\(visual\.color/);
      expect(banner, `${name} dropped the glow that carries the softening`)
        .toContain('textShadow: `0 0 7px ${rgba(visual.color, 0.42)}`');
    }
  });

  it('a percentage in this HUD closes up', () => {
    // The user's ruling, 2026-09-05. `< 0.001 %` was the one spaced percentage
    // in the overlay; every other one — `2.00%`, `+1.4%`, `TOP 100%` — sets
    // solid, and the inequality is part of the number rather than a sentence
    // about it.
    const offenders: string[] = [];
    for (const source of domDialect()) {
      for (const spaced of code(source.text).matchAll(/[\d.]\s+%/g)) {
        offenders.push(`${source.name}: ${spaced[0].trim()} — a percentage sets solid`);
      }
    }
    expect(offenders).toEqual([]);

    const dao = code(SOURCES.find((source) => source.name === 'DaoStateReadout.tsx')?.text ?? '');
    expect(dao).toContain("'<0.001%'");
  });

  it('a companion is dimmed, not hidden', () => {
    // The floor in the third notation. `opacity` on the element composites to
    // exactly what `rgba(ink, α)` in a `color:` composites to, and the ban on
    // the second had left the first untouched — which is where every CJK
    // companion in the HUD was sitting at 3.35 : 1 (report F, F-9).

    // The dimmest ink a companion is drawn in, found rather than assumed. A
    // companion names either a palette ink or the surface's own ACCENT: the
    // first is priced here, the second is priced by the pin below, because an
    // accent arrives as a prop and this is a source oracle.
    const priced: Array<{ site: string; ink: string; hex: string }> = [];
    const unpriceable: string[] = [];
    for (const source of domDialect()) {
      const text = code(source.text);
      for (const site of text.matchAll(/(?<![\w$-])opacity:\s*COMPANION_OPACITY/g)) {
        const object = enclosingObject(text, site.index ?? 0) ?? '';
        const ink = /(?<![\w$-])color:\s*([^,;}\n]+)/.exec(object)?.[1]?.trim() ?? '';
        const token = /HUD_COLORS\.(\w+)/.exec(ink)?.[1];
        const hex = token === undefined ? undefined : HUD_COLORS[token as keyof typeof HUD_COLORS];
        if (typeof hex === 'string' && hex.startsWith('#')) {
          priced.push({ site: source.name, ink: token as string, hex });
          continue;
        }
        // CELL_CARD_ACCENT is the cell dossier's, and it is a constant in the
        // theme rather than a prop, so it prices like a token.
        if (ink.includes('CELL_CARD_ACCENT')) {
          priced.push({ site: source.name, ink: 'CELL_CARD_ACCENT', hex: CELL_CARD_ACCENT });
          continue;
        }
        if (/\baccent\b/.test(ink)) continue;
        unpriceable.push(`${source.name}: a companion in \`${ink}\` — an ink this floor cannot read`);
      }
    }
    expect(unpriceable).toEqual([]);

    // The sweep found companions at all, and found the ink the weight is set
    // for. An empty list would make every assertion below a silence.
    expect(priced.length).toBeGreaterThan(3);
    expect(priced.map((entry) => entry.ink)).toContain('dim');

    for (const entry of priced) {
      const ratio = contrastRatio(over(entry.hex, COMPANION_OPACITY, PANEL_SURFACE), PANEL_SURFACE);
      expect(
        ratio,
        `${entry.site}: a companion in ${entry.ink} reads ${ratio.toFixed(2)} : 1 on the panel`,
      ).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
    }

    // …and the weight is DERIVED from that floor rather than chosen: the least
    // hundredth that clears it for the dimmest companion ink. A number picked
    // for the look is what 0.72 was, and it read 3.35 : 1.
    const dimmest = priced.reduce((low, entry) =>
      relativeLuminance(entry.hex) < relativeLuminance(low.hex) ? entry : low);
    expect(dimmest.ink).toBe('dim');
    const cleared = (weight: number) =>
      contrastRatio(over(dimmest.hex, weight, PANEL_SURFACE), PANEL_SURFACE) >= CONTRAST_FLOOR;
    expect(cleared(COMPANION_OPACITY), `a companion in ${dimmest.ink} is under the floor`).toBe(true);
    expect(
      cleared(Math.round((COMPANION_OPACITY - 0.01) * 100) / 100),
      'COMPANION_OPACITY is dimmer than the floor needs — it is derived, not chosen',
    ).toBe(false);

    // The accents, which the sweep above steps over because they arrive as a
    // prop. Four constants and one derived table reach a card masthead's
    // companion; every one of them is above `dim`, which is why the weight the
    // floor sets for `dim` covers them all.
    const accents: ReadonlyArray<readonly [string, string]> = [
      ['CELL_CARD_ACCENT', CELL_CARD_ACCENT],
      ['CELL_PANEL_ACCENT', CELL_PANEL_ACCENT],
      ['NODE_SELF_ACCENT', CHAIN_ANCHOR_HEX.edge],
      ['SIGHTED_NODE_ACCENT', PEER_NETWORK_HEX.scaffold],
      ['PEER_LINK_ACCENT_HEX.outbound', PEER_NETWORK_HEX.outbound],
      ['PEER_LINK_ACCENT_HEX.inbound', PEER_NETWORK_HEX.inbound],
      ['PEER_LINK_ACCENT_HEX.version', PEER_NETWORK_HEX.version],
      ['peerWire', HUD_COLORS.peerWire],
      ['caution', HUD_COLORS.caution],
    ];
    for (const [name, hex] of accents) {
      expect(
        relativeLuminance(hex),
        `${name} is below \`dim\`, and a companion wearing it would be under the floor`,
      ).toBeGreaterThan(relativeLuminance(HUD_COLORS.dim));
    }

    // …and those really are the accents a masthead companion is handed: each
    // card binds one before it draws the CJK beside its title.
    for (const [name, binding] of [
      ['NodeSelfCard.tsx', 'const accent = NODE_SELF_ACCENT;'],
      ['SightedNodeCard.tsx', 'const accent = SIGHTED_NODE_ACCENT;'],
      ['PeerLinkCard.tsx', 'const accent = linkLost ? HUD_COLORS.caution : instrument.accent;'],
    ] as const) {
      const card = code(SOURCES.find((source) => source.name === name)?.text ?? '');
      expect(card, `${name}: the masthead's accent moved — this oracle reads files off disk`)
        .toContain(binding);
    }
  });

  it('a stale reading is still a reading', () => {
    // The user's ruling 17, and it is the companion's argument one role along.
    // A companion is a qualifier you MAY skip; a stale reading is one you are
    // being told to go and look at — "not trusted yet, find out why" — so of
    // the two it is the one that can least afford to be dimmed out of reach.
    // At 0.68 the unread identity proof read 3.08 : 1 (report F, F-9's other
    // half), which is the instruction inverted.

    // Every site the weight reaches, and the ink each one dims. A stale site
    // is one of two shapes: a MARK or a value with its own `color:`, which
    // prices here; or a WRAPPER over a whole readout, whose ink is whatever
    // the subtree prints. For the wrapper the floor is set by the dimmest ink
    // a READING is ever set in — `dim`, the ramp's bottom reading rung — and
    // the assertion under this loop is what makes that claim honest.
    const priced: Array<{ site: string; ink: string; hex: string }> = [];
    const wrappers: string[] = [];
    const unpriceable: string[] = [];
    for (const source of domDialect()) {
      const text = code(source.text);
      for (const site of text.matchAll(/(?<![\w$-])opacity:[^,;}\n]*\bSTALE_OPACITY\b/g)) {
        const object = enclosingObject(text, site.index ?? 0) ?? '';
        const ink = /(?<![\w$-])color:\s*([^,;}\n]+)/.exec(object)?.[1]?.trim() ?? '';
        if (ink === '') { wrappers.push(source.name); continue; }
        // A ternary paints two inks and the DIMMER of the two is the one the
        // floor has to hold, so both halves are read.
        const tokens = [...ink.matchAll(/HUD_COLORS\.(\w+)/g)]
          .map((match) => match[1])
          .filter((token) => /^#[0-9a-fA-F]{6}$/.test(String(HUD_COLORS[token as keyof typeof HUD_COLORS])));
        if (tokens.length === 0) {
          // An accent, a segment colour or a card constant: brighter than
          // `dim` by the pin the companion oracle already holds, and not
          // resolvable from source. Named so the list is a reading.
          if (/\baccent\b|SEGMENT_COLORS|\bcolor\b|ORANGE|CYAN|VIOLET|memoryInk/.test(ink)) continue;
          unpriceable.push(`${source.name}: a stale reading in \`${ink}\` — an ink this floor cannot read`);
          continue;
        }
        for (const token of tokens) {
          priced.push({ site: source.name, ink: token, hex: HUD_COLORS[token as keyof typeof HUD_COLORS] as string });
        }
      }
    }
    expect(unpriceable).toEqual([]);

    // The sweep found both shapes, so neither branch below is an empty loop.
    expect(priced.length).toBeGreaterThan(0);
    expect(wrappers.length).toBeGreaterThan(3);

    for (const entry of priced) {
      const ratio = contrastRatio(over(entry.hex, STALE_OPACITY, PANEL_SURFACE), PANEL_SURFACE);
      expect(
        ratio,
        `${entry.site}: a stale reading in ${entry.ink} reads ${ratio.toFixed(2)} : 1 on the panel`,
      ).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
    }

    // The wrappers' claim, made honest: the one ink in the ramp that CANNOT
    // survive any dimming at all is `moduleSlate` (4.57 : 1 at full weight, so
    // its least clearing weight is 1), and it is never inside a dimmed
    // readout — it is worn by the module code in a panel HEADER and by the
    // scene's own marker caption, both outside every stale wrapper. So `dim`
    // really is the dimmest ink a stale wrapper can be covering.
    expect(
      contrastRatio(over(HUD_COLORS.moduleSlate, STALE_OPACITY, PANEL_SURFACE), PANEL_SURFACE),
    ).toBeLessThan(CONTRAST_FLOOR);
    const tagWearers = PACKAGE_SOURCES
      .filter((source) => code(source.text).includes('HUD_COLORS.moduleSlate'))
      .map((source) => source.name)
      .sort();
    expect(tagWearers).toEqual([
      'components/hud/primitives.tsx',
      'nerve/ConsensusMemoryMarkers.tsx',
    ]);
    for (const wrapper of new Set(wrappers)) {
      expect(wrapper, 'a stale wrapper in a file that also writes the module tag')
        .not.toBe('primitives.tsx');
    }
    const ratio = contrastRatio(over(HUD_COLORS.dim, STALE_OPACITY, PANEL_SURFACE), PANEL_SURFACE);
    expect(ratio, `a stale readout in \`dim\` reads ${ratio.toFixed(2)} : 1`)
      .toBeGreaterThanOrEqual(CONTRAST_FLOOR);

    // …and DERIVED, the same way the companion's is: the least hundredth that
    // clears the floor for that ink. One hundredth down and it fails, so the
    // constant cannot drift toward the old look without this going red.
    const cleared = (weight: number) =>
      contrastRatio(over(HUD_COLORS.dim, weight, PANEL_SURFACE), PANEL_SURFACE) >= CONTRAST_FLOOR;
    expect(cleared(STALE_OPACITY)).toBe(true);
    expect(
      cleared(Math.round((STALE_OPACITY - 0.01) * 100) / 100),
      'STALE_OPACITY is dimmer than the floor needs — it is derived, not chosen',
    ).toBe(false);

    // And the half the floor cannot do: with the weight off the job, the WORD
    // has to carry it. Every file that dims for staleness also says so in
    // language or in a mark — this is the sweep that makes the constant's
    // rise safe rather than merely legible.
    const SAYS_SO: Record<string, string> = {
      'ActivityFeedReadout.tsx': 'stale={stale}',
      'CellByteBudget.tsx': 'OBSERVED',
      'CellDetailPanel.tsx': "proof.read ? '◆' : '◇'",
      'CellCensusReadout.tsx': 'stale={stale}',
      'ConsensusIdentityPlate.tsx': 'SPENT INPUTS',
      'DaoStateReadout.tsx': '· STALE',
      'NetworkAtlasReadout.tsx': 'ATLAS STALE',
      'PeerLinkCard.tsx': "'Peer latency unmeasured'",
      'ProtocolEraBadge.tsx': 'aria-label',
      'TransactionHorizonReadout.tsx': 'stale={stale}',
    };
    const silent: string[] = [];
    const dimming = domDialect()
      .filter((source) => /(?<![\w$-])opacity:[^,;}\n]*\bSTALE_OPACITY\b/.test(code(source.text)));
    for (const source of dimming) {
      const says = SAYS_SO[source.name];
      if (says === undefined) {
        silent.push(`${source.name}: dims for staleness and this table does not say what it prints`);
        continue;
      }
      if (source.text.includes(says)) continue;
      silent.push(`${source.name}: dims for staleness and no longer prints \`${says}\``);
    }
    expect(silent).toEqual([]);
    // The table and the sweep are one list. A file that stopped dimming for
    // staleness — or that dims for it by a bare number instead of the
    // constant, which is what `ConsensusIdentityPlate` did at 0.86 — drops out
    // of the sweep, and this is what notices.
    expect(dimming.map((source) => source.name).sort())
      .toEqual(Object.keys(SAYS_SO).sort());

    // The `· STALE` token itself, which four of those ten reach through one
    // component rather than printing. If it left `ReadoutHeader` the four
    // rows above would go on passing while nothing said the word.
    expect(code(SOURCES.find((source) => source.name === 'primitives.tsx')?.text ?? ''))
      .toContain('<span data-readout-stale>· STALE</span>');
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
// So this is the oracle. The inventory is written out here rather than
// imported, on purpose —
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
 *  this string and the README's.
 *
 *  ⚠️ AND `FACE_COVERAGE` FURTHER DOWN THIS FILE, which spells the same
 *  inventory a fourth time as codepoints. It is checked by SHA rather than
 *  against this string, so a re-subset that updates the ring below and leaves
 *  that row alone goes red there instead of here, naming the file. */
const CJK_SUBSET = '共识基元胞汤脉搏节点场字对端状态警告道样本细记录交易输入谱系见证';

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

/** The one prop whose primitive puts the face on for the writer — the `cjk` of
 *  `PanelHeader` / `SpatialPlateHeader`. A file that spells its Chinese as this
 *  prop has named the face by naming the primitive; anything else has to say
 *  `HUD_FONTS.cjk` itself. */
const CJK_PROP = /cjk="([^"]*)"/g;

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
    expect(literals.filter((literal) => literal.text === '元胞汤').length)
      .toBeGreaterThanOrEqual(1);

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
});


// ——— The other side of the same subset ——————————————————————————————————
//
// The section above has been guarding the Chinese face since the day 样本
// shipped a release ahead of the inventory. It is the same class of bug on the
// Latin side, and for the whole life of that section nobody asked the question
// there — because a face called `Saira` obviously has letters in it, and the
// asking stops.
//
// The Latin faces are subsets too. They are Google Fonts' pre-built
// `latin`-range woff2, dropped in as downloaded, and `latin` is a published
// fixed range that stops before the Arrows and Geometric Shapes blocks almost
// entirely. `→` is not in it. `← ↔ ◆ ◇ ● ▲ ▼ ▦` are not in it. Every one of
// those was being rendered by the shipped HUD out of whatever face the
// reader's machine happened to offer — nondeterministic across machines, ours
// on none of them, and silent, exactly as the section above says a missing
// glyph is silent.
//
// So this is the Latin equivalent, and it is asked one notch harder than
// "carried by some face". A glyph carried by the wrong face is the same defect
// wearing a different costume: `◇` lives only in `JetBrains Mono Local`, which
// made it correct on the consensus-memory markers that name that face and
// broken on the nine DOM sites that did not. The question is per SITE, and a
// site is a STACK — CSS resolves a family list per character, so the honest
// unit of coverage is the union of the shipped faces in the list, not one face.
//
// WHAT THIS CANNOT DO, stated rather than implied. A text oracle cannot tie a
// literal to the element that wraps it — the section above says so about
// Chinese and it is no less true here. So the claim is per FILE, in two tiers:
//
//   IN-SCENE — a file naming a `* Local` family has said which face draws it,
//     and is judged against exactly the stacks it names. Those labels render
//     under a camera in a face with no `…` and no `‹ ›` in it, and requiring
//     the DOM vocabulary of them would be a rule about the wrong medium.
//
//   DOM — everything else is judged against ALL THREE of the HUD's voices, not
//     merely the ones it happens to mention. That is deliberately stronger
//     than per-site truth: a formatter's `…` lands wherever its caller renders
//     it, a shared row can be restyled from `mono` to `tech` in one line, and
//     a symbol vocabulary only one of three voices can pronounce is a trap set
//     for the next person. `−`, `‹ ›` and `…` clear it on the Latin faces' own
//     coverage; `→ ← ↓ ◆ ◇ ↗ ✓` clear it because `HUD_FONTS` puts the hand-cut
//     symbol face behind all three.
//
// Two more gaps, named so the rule does not imply a promise it is not keeping.
// It stops at the package boundary for the same reason the Chinese sweep does:
// `packages/ui` ships the woff2 and registers every `@font-face`, and a
// guarantee about coverage is that package's to make. `ui-app/src/Jukebox.tsx`
// renders `∞` and `♥`, which no face here carries, in a family string it
// re-typed rather than imported — the same defect, out of this file's
// jurisdiction, and unfixed. And `ui-app/index.html`'s pre-boot shell draws a
// `◇` in `ui-monospace` deliberately: it paints before any `@font-face`
// exists, so there is no face for it to be wrong about.
//
// Han is not swept here. It has its own section, its own face, and its own
// three-way ring above.

/** Every face in `src/fonts`, and what each one carries above ASCII, as
 *  codepoint ranges.
 *
 *  Recorded rather than read, because a woff2 cannot be decoded here — the
 *  section above discovered that and answered it by WEIGHING the file instead.
 *  Same answer, same ring: these ranges are a claim about seven binaries, and
 *  each binary's SHA-256 is recorded in `src/fonts/README.md` and checked
 *  against the bytes below. Re-cut or re-download a face without re-reading
 *  its cmap and the hash goes red naming the file, which is the only moment
 *  this table could be wrong with nobody noticing. */
const FACE_COVERAGE: ReadonlyArray<{ family: string; file: string; nonAscii: string }> = [
  {
    family: 'Saira',
    file: 'Saira-latin.woff2',
    nonAscii:
      '00A0-00FF 0102 0131 0152-0153 02BC 02C6 02DA 02DC 0300-0301'
      + ' 0303-0304 0308-0309 0323 2002 2013-2014 2018-201A 201C-201E'
      + ' 2022 2026 2032-2033 2039-203A 2044 20AC 2122 2191 2193 2212'
      + ' 2215',
  },
  {
    family: 'Chakra Petch',
    file: 'ChakraPetch-500-latin.woff2',
    nonAscii:
      '00A0-00B4 00B6-00FF 0131 0152-0153 02BB-02BC 02C6 02DA 02DC'
      + ' 0300-0301 0303-0304 0308-0309 0323 2013-2014 2018-201A'
      + ' 201C-201E 2022 2026 2032-2033 2039-203A 2044 20AC 2122 2191'
      + ' 2193 2212 2215',
  },
  {
    family: 'Chakra Petch',
    file: 'ChakraPetch-700-latin.woff2',
    nonAscii:
      '00A0-00B4 00B6-00FF 0131 0152-0153 02BB-02BC 02C6 02DA 02DC'
      + ' 0300-0301 0303-0304 0308-0309 0323 2013-2014 2018-201A'
      + ' 201C-201E 2022 2026 2032-2033 2039-203A 2044 20AC 2122 2191'
      + ' 2193 2212 2215',
  },
  {
    family: 'Share Tech Mono',
    file: 'ShareTechMono-latin.woff2',
    nonAscii:
      '00A0-00FF 0131 0152-0153 02C6 02DA 02DC 2013-2014 2018-201A'
      + ' 201C-201E 2022 2026 2039-203A 2044 20AC 2122 2212 2215',
  },
  {
    family: 'JetBrains Mono Local',
    file: 'JetBrainsMono-400-subset.woff2',
    nonAscii:
      '00B7 00D7 2013-2014 2022 2190 2192-2193 2197 2248 2264-2265'
      + ' 25C6-25C7 2713',
  },
  {
    family: 'Orbitron Local',
    file: 'Orbitron-500-subset.woff2',
    nonAscii: '00D7 2013-2014 2022',
  },
  {
    family: 'Huiwen-mincho',
    file: CJK_FACE,
    nonAscii:
      '4EA4 5143 5165 5171 544A 573A 57FA 5B57 5BF9 5F55 6001 640F'
      + ' 6613 672C 6837 6C64 70B9 72B6 7AEF 7CFB 7EC6 80DE 8109 8282'
      + ' 89C1 8B66 8BB0 8BC1 8BC6 8C31 8F93 9053',
  },
];

function codepoints(spec: string): ReadonlySet<number> {
  const set = new Set<number>();
  for (const token of spec.split(' ')) {
    const [from, to] = token.split('-');
    const start = Number.parseInt(from, 16);
    const end = to === undefined ? start : Number.parseInt(to, 16);
    for (let cp = start; cp <= end; cp += 1) set.add(cp);
  }
  return set;
}

/** What a FAMILY promises, which is the INTERSECTION of the faces registered
 *  under its name. `Chakra Petch` ships as two weights and a heading may wear
 *  either; a glyph in one file and not the other is not something the family
 *  can be asked for. */
function familyCoverage(family: string): ReadonlySet<number> {
  const sets = FACE_COVERAGE
    .filter((face) => face.family === family)
    .map((face) => codepoints(face.nonAscii));
  if (sets.length === 0) return new Set();
  return new Set([...sets[0]].filter((cp) => sets.every((set) => set.has(cp))));
}

type FontStack = { name: string; families: readonly string[]; carries: ReadonlySet<number> };

/** A family list, resolved the way a browser resolves one: per character, down
 *  the list, first family that has it. Names we do not ship (`system-ui`,
 *  `ui-monospace`, the CJK system serifs) contribute nothing, which is the
 *  whole point — they are where the silent fallback used to happen. */
function fontStack(name: string, value: string): FontStack {
  const families = value.split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''));
  const carries = new Set<number>();
  for (const family of families) {
    for (const cp of familyCoverage(family)) carries.add(cp);
  }
  return { name, families, carries };
}

const HUD_STACKS = Object.fromEntries(
  Object.entries(HUD_FONTS).map(([key, value]) => [key, fontStack(`HUD_FONTS.${key}`, value)]),
) as Record<keyof typeof HUD_FONTS, FontStack>;

/** The three voices the DOM overlay is written in. `cjk` is not one of them:
 *  it carries no Latin at all, it is the section above's business, and asking
 *  it to spell an interpunct would be the wrong question to the wrong face. */
const DOM_VOICES: readonly FontStack[] = [
  HUD_STACKS.display, HUD_STACKS.tech, HUD_STACKS.mono,
];

/** A stack written straight into a `fontFamily`, which is how the in-scene
 *  labels name their faces (and how three components re-type a HUD voice by
 *  hand). Multi-line, because `CellGalaxy` wraps its list onto its own line. */
const INLINE_FONT_STACK = /fontFamily:\s*(['"])((?:(?!\1)[\s\S])*)\1/g;

function stacksIn(text: string): FontStack[] {
  const stacks: FontStack[] = [];
  for (const [key, stack] of Object.entries(HUD_STACKS)) {
    if (key !== 'cjk' && text.includes(`HUD_FONTS.${key}`)) stacks.push(stack);
  }
  INLINE_FONT_STACK.lastIndex = 0;
  let match = INLINE_FONT_STACK.exec(text);
  while (match !== null) {
    stacks.push(fontStack(`fontFamily: ${match[2]}`, match[2]));
    match = INLINE_FONT_STACK.exec(text);
  }
  return stacks;
}

/** Which stacks a file's marks have to clear. A `* Local` family is the tell
 *  that a file draws in the scene and has said which face does it; everything
 *  else is DOM and answers to all three voices whether it named them or not. */
function applicableStacks(text: string): FontStack[] {
  const named = stacksIn(text);
  const inScene = named.some((stack) => stack.families.some((family) => family.endsWith(' Local')));
  if (inScene) return named;
  const unnamed = DOM_VOICES.filter((voice) => !named.some((stack) => stack.name === voice.name));
  return [...named, ...unnamed];
}

/** Every character a file renders that is neither ASCII nor Han. */
function marksIn(text: string): string[] {
  return [...new Set(text)]
    .filter((mark) => {
      const cp = mark.codePointAt(0) ?? 0;
      return cp > 0x7e && !(cp >= 0x4e00 && cp <= 0x9fff);
    })
    .sort();
}

function renderedMarks(): Array<{ source: string; mark: string }> {
  return PACKAGE_SOURCES.flatMap((source) => marksIn(code(source.text))
    .map((mark) => ({ source: source.name, mark })));
}

describe('every mark the HUD writes', () => {
  it('the coverage table and the bytes on disk are one inventory', () => {
    // Same ring the Chinese face closes, one axis wider: the ranges above are
    // a claim about seven files, the README records each file's SHA-256, and
    // the files answer for themselves. A face swapped for a different build of
    // the same name is the one way this table could go quietly wrong, and it
    // is the way that would ship a re-download with no arrows left in it.
    const recorded = new Map<string, string>();
    // The two tables are shaped differently on purpose — the hand-cut faces
    // record the SOURCE hash beside the subset's, the downloaded ones have no
    // source to record — so the row is read for its LAST hash either way.
    for (const [, file, rest] of FONT_README.matchAll(/\| `([A-Za-z0-9-]+\.woff2)` \|([^\n]*)/g)) {
      const hashes = rest.match(/[0-9a-f]{64}/g) ?? [];
      if (hashes.length > 0) recorded.set(file, hashes[hashes.length - 1]);
    }
    // …plus the Chinese face, which the README states in prose rather than in
    // a table, and which the section above already checks. Read here too so
    // the claim covers `src/fonts` WHOLE — a face with no recorded hash is a
    // face this table could describe wrongly for free.
    const cjkSha = /checked-in subset is\n`([0-9a-f]{64})`/.exec(FONT_README);
    expect(cjkSha, 'no subset SHA-256 in src/fonts/README.md').not.toBeNull();
    recorded.set(CJK_FACE, cjkSha?.[1] ?? '');

    const onDisk = readdirSync(FONT_DIR).filter((name) => name.endsWith('.woff2')).sort();
    expect(FACE_COVERAGE.map((face) => face.file).sort()).toEqual(onDisk);

    const drifted = FACE_COVERAGE
      .map((face) => {
        const actual = createHash('sha256')
          .update(readFileSync(join(FONT_DIR, face.file)))
          .digest('hex');
        return recorded.get(face.file) === actual
          ? null
          : `${face.file}: the bytes and src/fonts/README.md disagree`
            + ' — re-read the cmap, and this table with it';
      })
      .filter((entry) => entry !== null);

    expect(drifted).toEqual([]);
  });

  it('finds the marks it is supposed to be checking', () => {
    // The pin. Every rule below is a text sweep, and a text sweep that stops
    // matching passes everything in silence — which is the failure it exists
    // to catch, one level up.
    const marks = renderedMarks();
    expect(new Set(marks.map((entry) => entry.mark)).size).toBeGreaterThanOrEqual(10);

    // The three forms the defect took, each asked at a file that still writes
    // one. Arrows in DOM prose (carried by no Latin face, only by the symbol
    // fallback behind them), a diamond in a scene label (carried by that one
    // face), and the interpunct the whole HUD is punctuated with.
    const at = (name: string) => marks
      .filter((entry) => entry.source === name)
      .map((entry) => entry.mark);
    expect(at('components/hud/ConsensusIdentityPlate.tsx')).toContain('→');
    expect(at('components/hud/ConsensusIdentityPlate.tsx')).toContain('←');
    expect(at('components/hud/ConsensusMemory.tsx')).toContain('◇');
    expect(at('components/hud/BlockchainReadout.tsx')).toContain('·');

    // And the resolution every ruling below turns on: `→` is in exactly one
    // shipped face, and the three DOM voices reach it only because
    // `HUD_FONTS` lists that face behind each of them. Drop the fallback and
    // this says so in one line, before the sweep has to say it in thirty.
    expect(familyCoverage('Saira').has(0x2192)).toBe(false);
    expect(familyCoverage('Chakra Petch').has(0x2192)).toBe(false);
    expect(familyCoverage('Share Tech Mono').has(0x2192)).toBe(false);
    expect(familyCoverage('JetBrains Mono Local').has(0x2192)).toBe(true);
    for (const voice of DOM_VOICES) expect(voice.carries.has(0x2192)).toBe(true);
  });

  it('every mark is carried by every face its site could be set in', () => {
    const strays = PACKAGE_SOURCES.flatMap((source) => {
      const text = code(source.text);
      const marks = marksIn(text);
      if (marks.length === 0) return [];
      const stacks = applicableStacks(text);
      return marks.flatMap((mark) => {
        const cp = mark.codePointAt(0) ?? 0;
        const hex = cp.toString(16).toUpperCase().padStart(4, '0');
        return stacks
          .filter((stack) => !stack.carries.has(cp))
          .map((stack) => `${source.name}: ${mark} (U+${hex}) is in no face of ${stack.name}`
            + ' — draw it as a mark in primitives.tsx, or put a face that has'
            + ' it in the stack (src/fonts/README.md)');
      });
    });

    expect(strays).toEqual([]);
  });

  // ——— The weight nobody ships, and the voice nobody named ————————————————
  //
  // Two ways a face gets away from the file that asked for it, and the scan
  // (report F, F-2 and F-3) found both wearing the same disguise: a run of
  // text that LOOKS like the HUD's, because the thing it fell back to was
  // also a monospace, or also a bold.
  //
  //   A WEIGHT THE FACE HAS NOT GOT. Share Tech Mono ships 400 and nothing
  //   else; Huiwen-mincho registers no weight at all. Ask either for 700 and
  //   the browser SYNTHESIZES one — it smears the glyph sideways — and the
  //   PULSE hero, the largest numeral in the overlay, was drawn that way.
  //   Chakra ships 500 and 700 and the strip asked it for 600, which is not a
  //   synthesis but is not the weight it says either.
  //
  //   A FACE NOBODY NAMED. `index.html` sets the body to `ui-monospace`, so a
  //   HUD leaf that names no family and hangs under no element that names one
  //   draws in the OS monospace, which carries no `◇`. Two did.
  //
  // The second is why `applicableStacks` above can say what it says. It
  // assumes every DOM file answers to all three voices whether it named one or
  // not — and that assumption is only true because the two ROOTS declare one.
  // It was an assumption for the life of this file; it is a test now.

  /** What each `@font-face` in the theme actually registers, read from the
   *  theme's own text. A range (`100 900`) is every hundred it spans; a face
   *  that states no weight registers 400, which is what the CSS cascade takes
   *  `normal` to mean. */
  function registeredWeights(): Map<string, Set<number>> {
    const theme = SOURCES.find((source) => source.name === 'hudTheme.ts');
    const text = theme?.text ?? '';
    const faces = new Map<string, Set<number>>();
    for (const face of text.matchAll(/@font-face\{font-family:'([^']+)'(;font-weight:([\d ]+))?/g)) {
      // Two `@font-face` blocks may name one family — Chakra ships 500 and
      // 700 as separate files — so the weights UNION rather than replace.
      const weights = faces.get(face[1]) ?? new Set<number>();
      const declared = (face[3] ?? '400').trim().split(/\s+/).map(Number);
      if (declared.length === 2) {
        for (let w = 100; w <= 900; w += 100) {
          if (w >= declared[0] && w <= declared[1]) weights.add(w);
        }
      } else for (const w of declared) weights.add(w);
      faces.set(face[1], weights);
    }
    return faces;
  }

  it('no object asks a face for a weight it does not ship', () => {
    const faces = registeredWeights();
    expect(faces.size, 'no @font-face table to read').toBeGreaterThan(4);
    // The face each voice ASKS FOR first — the rest of the stack is the
    // fallback chain, and a weight is matched against the family that answers.
    const primary = Object.fromEntries(
      Object.entries(HUD_FONTS).map(([key, value]) => [
        key,
        value.split(',')[0].trim().replace(/^['"]|['"]$/g, ''),
      ]),
    ) as Record<keyof typeof HUD_FONTS, string>;

    const offenders: string[] = [];
    for (const source of domDialect()) {
      const text = code(source.text);
      for (const site of text.matchAll(/fontWeight:\s*([^,;}\n]+)/g)) {
        const asked = (site[1].match(/\d+/g) ?? []).map(Number);
        if (asked.length === 0) continue;
        // The whole style object, braces balanced — a one-line `style={{…}}`
        // and a forty-line one are the same question, and a regex that stops
        // at the first `}` reads a nested interpolation as the end of it.
        const object = enclosingObject(text, site.index ?? 0) ?? '';
        const voice = /fontFamily:\s*HUD_FONTS\.(\w+)/.exec(object);
        if (voice === null) {
          // 400 with no face is a RESET — the pattern the companions above
          // are made of — and is always safe. Anything above it lands on
          // whatever the element inherits, which is the 状态 defect one level
          // up: a weight aimed at a face nobody in the object named.
          if (asked.every((weight) => weight <= 400)) continue;
          offenders.push(`${source.name}: fontWeight ${asked.join('/')} with no face beside it`);
          continue;
        }
        const family = primary[voice[1] as keyof typeof HUD_FONTS];
        const shipped = faces.get(family) ?? new Set<number>();
        for (const weight of asked) {
          if (shipped.has(weight)) continue;
          offenders.push(
            `${source.name}: ${family} ships ${[...shipped].join('/')} — ${weight} is drawn by the browser`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('a companion declares its weight rather than inheriting one', () => {
    // Huiwen registers NO weight, so it is the one face in the HUD that can
    // only be synthesized. Saying nothing was the same instruction as saying
    // 400 only while no ancestor said otherwise — and one did, for the life of
    // the file. So every companion states it, and the ban above then has
    // something to read.
    const offenders: string[] = [];
    let companions = 0;
    for (const source of domDialect()) {
      for (const object of code(source.text).matchAll(/\{[^{}]*HUD_FONTS\.cjk[^{}]*\}/g)) {
        companions += 1;
        if (/fontWeight:\s*400\b/.test(object[0])) continue;
        offenders.push(`${source.name}: a companion that does not state fontWeight: 400`);
      }
    }
    expect(offenders).toEqual([]);
    expect(companions, 'no companion found — did HUD_FONTS.cjk move?').toBeGreaterThan(6);
  });

  it('the two roots declare a voice, so no leaf falls back to the body', () => {
    // What `applicableStacks` assumes, stated. The overlay and the card layer
    // are the only two elements every HUD leaf hangs under, and neither named
    // a face until 2026-09-05.
    const overlay = SOURCES.find((source) => source.name === 'HudOverlay.tsx');
    expect(code(overlay?.text ?? ''), 'the HUD root names no face')
      .toMatch(/ROOT_STYLE[^\n]*fontFamily: HUD_FONTS\.mono/);

    const inspection = readFileSync(
      resolve(HUD_DIR, '../sceneInspection.tsx'),
      'utf8',
    );
    expect(inspection, 'the card layer names no face')
      .toMatch(/INSPECTION_LAYER_STYLE[\s\S]{0,900}?fontFamily: HUD_FONTS\.mono/);

    // …and what it is protecting against, so the reason survives the fix: the
    // body is the OS monospace, which carries none of the HUD's marks.
    const shell = readFileSync(resolve(HUD_DIR, '../../../../../ui-app/index.html'), 'utf8');
    expect(shell).toContain('ui-monospace');
    expect(HUD_STACKS.mono.carries.has(0x25c7)).toBe(true);
  });

  it('an inline stack that names a HUD face keeps the symbol face behind it', () => {
    // The three hand-typed voices report F found (F-16). They rendered only
    // `·` and `…` — carried by the face they named — so nothing was broken
    // yet; an arrow or a diamond added to any of them would have fallen back
    // silently, which is the same bug one edit away.
    const HUD_FACES = ['Saira', 'Chakra Petch', 'Share Tech Mono', 'Huiwen-mincho'];
    const offenders: string[] = [];
    for (const source of PACKAGE_SOURCES) {
      INLINE_FONT_STACK.lastIndex = 0;
      let match = INLINE_FONT_STACK.exec(code(source.text));
      while (match !== null) {
        const stack = fontStack('inline', match[2]);
        const named = stack.families.filter((family) => HUD_FACES.includes(family));
        const carried = stack.families.includes('JetBrains Mono Local');
        if (named.length > 0 && !carried) {
          offenders.push(`${source.name}: ${named.join('/')} without JetBrains Mono Local — say HUD_FONTS`);
        }
        match = INLINE_FONT_STACK.exec(code(source.text));
      }
    }
    expect(offenders).toEqual([]);

    // …and the sweep can see an offender, which is the half a green result
    // cannot show on its own.
    expect(fontStack('x', "'Share Tech Mono', ui-monospace").families)
      .toEqual(['Share Tech Mono', 'ui-monospace']);
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
  // The user's D-8 ruling of 2026-09-05. These two plates were framed in their
  // CONTENT's colour — the reader in the braid's cyan, the trace in the memory
  // violet — and a card with four frame colours reads as three windows that
  // happen to touch (the 08-21 complaint, 割裂). Their titles keep the content
  // ink, which is the half of `hudTheme.ts`'s rule that was always right.
  {
    surface: "the CKBYTES reader's plate",
    file: 'components/hud/CellDetailPanel.tsx',
    within: ['function CellScanReaderPlate', '/** ORIGIN:'],
    wears: ['...spatialPlate(CELL_CARD_ACCENT),'],
    never: ['CYAN', 'cyanWire', 'peerWire', 'HUD_COLORS.memory'],
  },
  {
    surface: "the MEMORY TRACE plate",
    file: 'components/hud/CellDetailPanel.tsx',
    within: ['data-cell-inspection-satellite="trace"', '<SpatialPlateHeader'],
    wears: ['...spatialPlate(CELL_CARD_ACCENT),'],
    never: ['CYAN', 'cyanWire', 'HUD_COLORS.memory', 'VIOLET'],
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

  it('every plate of the cell card is framed in the card\'s own colour', () => {
    // The table above pins the surfaces that exist; this pins the SHAPE, so a
    // fourth plate cannot arrive in a fifth colour. `spatialPlate` is the only
    // way a plate of this card gets an edge, and the card has three of them:
    // the analysis plate, the reader, and the trace that appears when a write
    // is armed. The viewfinder square is not on this list and is not a plate —
    // it is a hole with corner marks, and chrome orange is what an instrument's
    // own frame is written in.
    const panel = PACKAGE_SOURCES.find(
      (entry) => entry.name === 'components/hud/CellDetailPanel.tsx',
    );
    const framed = [...code(panel?.text ?? '').matchAll(/spatialPlate\(([^)]*)\)/g)]
      .map((match) => match[1]);

    expect(framed).toEqual([
      'CELL_CARD_ACCENT',
      'CELL_CARD_ACCENT',
      'CELL_CARD_ACCENT',
    ]);
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

// ——— One cursor for a pressable ——————————————————————————————————————————
//
// Two grammars said "click me" across the HUD: `pointer` on fourteen controls
// and `crosshair` on the register facts and the route hops. `pointer` says
// PRESS; `crosshair` says AIM — and it was worn by the surfaces a reader is
// LEAST likely to know are controls at all (report E, E-12). `ew-resize` and
// `text` stay: those name a different act honestly.
describe('one cursor for a pressable', () => {
  it('no HUD surface aims where it means to press', () => {
    // ⚠️ The LITERAL, not `cursor: 'crosshair'`. Every one of the three sites
    // wrote it through a ternary (`interactive ? 'crosshair' : 'default'`), so
    // a rule keyed on the property name would have passed all three — which is
    // exactly what it did on the first falsification.
    const offenders = SOURCES
      .filter((source) => /'crosshair'/.test(code(source.text)))
      .map((source) => source.name);

    expect(offenders).toEqual([]);
  });

  it('and the affordance is a rail, in both fact dialects, at one rung', () => {
    // Two cards state the same sentence — a rail, a label, a value, pressable
    // — and the second rung of that rail is one idea, so both read it from
    // `primitives` rather than typing an alpha of their own. A dialect that
    // lit its rail without the wash would say something different from the
    // card beside it.
    const wearing = SOURCES
      .filter((source) => /data-hud-fact-rail=/.test(source.text))
      .map((source) => source.name)
      .sort();

    // ⚠️ `PeerLinkCard` is not on this list any more and that is the point of
    // C-7: its facts are the HOUSE row now (`PlateReadoutRow`), so the rung
    // reaches them through the primitive instead of being typed a second time
    // beside it. The two dialects are the card that has its own fact button
    // and the primitive every other readout row in the HUD is drawn with.
    expect(wearing).toEqual(['CellDetailPanel.tsx', 'primitives.tsx']);
    for (const name of wearing) {
      const text = code(SOURCES.find((candidate) => candidate.name === name)?.text ?? '');
      expect(text, `${name} has no label for the treatment to lift`)
        .toContain('data-hud-fact-label');
      expect(text, `${name} does not answer a pointer`)
        .toContain('onPointerEnter');
      expect(text, `${name} does not answer a keyboard`).toContain('onFocus');
      for (const rung of [
        'PLATE_ROW_RAIL_ALPHA',
        'PLATE_ROW_RAIL_HOT_ALPHA',
        'PLATE_ROW_SELECTED_WASH_ALPHA',
        'PLATE_ROW_HOT_WASH_ALPHA',
      ]) {
        expect(text, `${name} does not read ${rung}`).toContain(rung);
      }
    }
    // The peer card takes the whole treatment by USING the row, and may not
    // re-state an alpha the TREATMENT owns.
    //
    // ⚠️ `PLATE_ROW_RAIL_ALPHA` came off this list on 2026-09-05. It was on it
    // when the row was the only thing in the overlay that drew a rail; D5a
    // made it the ladder's row rung and four files read it now — the peer
    // card's SYNC LADDER among them, which is a structural rail and not a
    // fact. What may not be restated is the HOVER treatment: a card that
    // re-derived the hot rail or either wash would be answering a pointer in
    // its own dialect, which is the thing this chapter exists to stop.
    const peer = code(SOURCES.find((source) => source.name === 'PeerLinkCard.tsx')?.text ?? '');
    expect(peer, 'the peer facts left the house row').toContain('<PlateReadoutRow');
    expect(peer, 'the peer facts stopped being controls').toContain('onActivate={onActivate}');
    for (const rung of [
      'PLATE_ROW_RAIL_HOT_ALPHA',
      'PLATE_ROW_SELECTED_WASH_ALPHA',
      'PLATE_ROW_HOT_WASH_ALPHA',
    ]) {
      expect(peer, `PeerLinkCard restates ${rung}, which the house row owns`)
        .not.toContain(rung);
    }
    // …and the half-weight wash is derived from the selected one, not typed.
    expect(PLATE_ROW_HOT_WASH_ALPHA).toBe(PLATE_ROW_SELECTED_WASH_ALPHA / 2);
    expect(PLATE_ROW_RAIL_HOT_ALPHA).toBeGreaterThan(PLATE_ROW_RAIL_ALPHA);
  });
});

// ——— One entrance for five dialects ——————————————————————————————————————
//
// The inspection chassis is what the five card dialects share, and the one
// thing they did not share was arriving (report E, E-5): the cell card faded
// its frame over 120 ms, slid its body over 280 and popped its tether dot over
// 360 — three simultaneous enters on two elements — while the four network
// dialects declared no body animation at all and arrived with the pop alone.
// None of the five could leave: card, leader and dot were unmounted in one
// frame, the only transition in this app that is a cut.
//
// So the entrance belongs to the chassis, once, and this is the fence around
// it: no dialect may grow a second one. Stated over the keyframe REGISTRY as
// well as over the dialects, because a keyframe nobody can name is a keyframe
// nobody can revive.
describe('one entrance for five dialects', () => {
  const DIALECTS = [
    'components/CellInspectionOverlay.tsx',
    'components/PeerInspectionOverlay.tsx',
    'components/NodeInspectionOverlay.tsx',
    'components/MinerInspectionOverlay.tsx',
    'components/SightedInspectionOverlay.tsx',
    'components/hud/CellDetailPanel.tsx',
    'components/hud/PeerLinkCard.tsx',
    'components/hud/NodeSelfCard.tsx',
    'components/hud/MinerNodeCard.tsx',
    'components/hud/SightedNodeCard.tsx',
  ] as const;

  it('no card dialect declares an enter of its own', () => {
    const offenders: string[] = [];
    for (const name of DIALECTS) {
      const source = PACKAGE_SOURCES.find((entry) => entry.name === name);
      expect(source, `${name} moved — this oracle reads files off disk`).toBeDefined();
      for (const line of code(source?.text ?? '').split('\n')) {
        if (/[\w-]+-enter\b/.test(line)) offenders.push(`${name}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('and the theme registers no card-enter keyframe to reach for', () => {
    // The sweep the dialect rule cannot make: a keyframe that exists is one a
    // dialect can name tomorrow. Every `*-enter` keyframe in the injected
    // stylesheet went with the two this replaced.
    const document_ = document.implementation.createHTMLDocument('t');
    injectHudTheme(document_);
    const css = document_.getElementById(HUD_THEME_STYLE_ID)?.textContent ?? '';
    expect(css.length).toBeGreaterThan(0);
    expect(css.match(/@keyframes [\w-]*-enter/g)).toBeNull();
  });

  it('and the chassis states its two rungs once, from the motion table', () => {
    const chassis = PACKAGE_SOURCES.find(
      (entry) => entry.name === 'components/sceneInspection.tsx',
    );
    const text = code(chassis?.text ?? '');
    expect(text).toContain('opacity ${HUD_MOTION.reveal}ms ${HUD_MOTION.enterEase}');
    expect(text).toContain('opacity ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}');
    // Two rungs of the ladder, not two numbers of the chassis's own. E1
    // settled which two: a card appears IN PLACE, so its entrance is the
    // reveal, and its exit is the flip every other state change wears.
    expect(HUD_MOTION.reveal).toBe(260);
    expect(HUD_MOTION.flip).toBe(120);
  });

  it('and every card root carries a single drop-shadow, not the second accent glow', () => {
    // D-6: the card root ran TWO Gaussian blurs per composited frame —
    // `drop-shadow(silhouette) drop-shadow(0 0 14px accent@.06)`. The second,
    // a 6 %-alpha glow over near-black, sat at the edge of perceptibility and
    // was half the per-frame blur work on a surface the canvas and the specimen
    // sweep already damage every frame. Only the silhouette shadow remains.
    const CARD_ROOTS = [
      'components/hud/CellDetailPanel.tsx',
      'components/hud/PeerLinkCard.tsx',
      'components/hud/NodeSelfCard.tsx',
      'components/hud/MinerNodeCard.tsx',
      'components/hud/SightedNodeCard.tsx',
    ] as const;
    for (const name of CARD_ROOTS) {
      const source = PACKAGE_SOURCES.find((entry) => entry.name === name);
      expect(source, `${name} moved — this oracle reads files off disk`).toBeDefined();
      const text = code(source?.text ?? '');
      const shadows = text.match(/drop-shadow\(/g) ?? [];
      expect(shadows.length, `${name}: one card-root drop-shadow`).toBe(1);
      expect(text, `${name}: the α.06 accent glow is gone`).not.toMatch(/drop-shadow\(0 0 14px/);
    }
  });
});

// ——— Freshness speaks only when it is wrong ——————————————————————————————
//
// Five records on this HUD carry an anchor and an age, and four of them say
// nothing at all until they go stale — the atlas states the rule in its own
// file ("staleness speaks only when it is true") and `ReadoutHeader` is the
// form: an anchor in the header line, a `· STALE` token when it is earned, and
// silence otherwise.
//
// DAO·05 was the fifth, and it opened with `● LIVE · UPDATED 1M 33S AGO` — a
// lit `nominal` lamp above the hero, on every frame, on a column that already
// carries a green ECG lamp, a green trace, a green BORN bar and a green hero.
// A fourth LIVE there says the record is HEALTHY when it only means RECENT
// (report A, A-8).
//
// So: a freshness ternary may make a stale record LOUDER — a colour, a token,
// a dimmed body — and may not give the fresh case a word of its own. A word
// for the good case is a lamp that is always on.
describe('freshness speaks only when it is wrong', () => {
  it('no surface prints a word for a record that is merely fresh', () => {
    const offenders: string[] = [];
    let ternaries = 0;
    for (const source of domDialect()) {
      const text = code(source.text);
      for (const hit of text.matchAll(/\bstale \?\s*('[^']*'|`[^`]*`)\s*:\s*('[^']*'|`[^`]*`)/g)) {
        ternaries += 1;
        const fresh = hit[2].slice(1, -1).trim();
        if (fresh.length > 0) {
          offenders.push(`${source.name}: prints ${hit[2]} for a fresh record`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // …and the matcher does find freshness ternaries — the era badge's
    // `', stale' : ''` is one — so an empty offender list means the ones it
    // finds say nothing on a good day, not that it read nothing at all.
    expect(ternaries).toBeGreaterThan(0);
  });

  it('and the record that lost its lamp still says when it is stale', () => {
    // The other half of the same rule: silence on a good day is only a rule if
    // the bad day still speaks. DAO·05's `· STALE` is the rail's own token.
    const dao = PACKAGE_SOURCES.find(
      (entry) => entry.name === 'components/hud/DaoStateReadout.tsx',
    );
    const text = code(dao?.text ?? '');
    expect(text).toContain('data-dao-stale');
    expect(text).toContain('· STALE');
    expect(text).not.toContain("'LIVE'");
    // …and no lamp of its own: the hand-drawn 5px disc went with the word.
    expect(text).not.toContain("borderRadius: '50%'");
  });
});

// ——— A bar and the legend that names it ——————————————————————————————————
//
// Every segmented bar in this HUD has a legend under it, and the legend is a
// promise: what it names is in the bar, and what it prints adds up to the
// caption. Two things broke that promise.
//
// A segment drawn from a share can round to nothing. The chain section (CHAIN
// CAPACITY then, split by capacity; CELL CENSUS now, the stage's two taxonomies
// by Cell count) named `TOKENS 0.08% · OBJECTS 0.03%` and drew them 0.27 px
// and 0.10 px wide, so
// two of its four names were simply not there (report A, A-9). Every
// proportional segment now has a floor — and the floor is for a segment that
// has something in it, because a sliver standing for a zero is a worse lie
// than a missing one.
//
// And a legend whose words are all one grey cannot be read back against a bar
// whose colours are the only mapping it has. PEER·02's COUNTRIES draws twenty
// slivers from a six-slot ramp handed out by hash; nothing tells a reader
// which sliver is HK. So: a QUALITATIVE legend tints the NAME in its
// segment's own hue and leaves the count in `legendInk`; an ORDINAL legend —
// one hue stepping in brightness, where the ORDER is the mapping — stays grey
// and says so. Every legend line in the overlay declares which it is.
describe('a bar and the legend that names it', () => {
  it('every proportional segment keeps a floor, and a zero keeps none', () => {
    const offenders: string[] = [];
    const drawers = new Set<string>();
    for (const source of domDialect()) {
      const text = code(source.text);
      for (const hit of text.matchAll(/width: (?:`\$\{[^`]*\}%`|seg\()/g)) {
        const object = enclosingObject(text, hit.index);
        if (object === null) continue;
        // A GAUGE's fill is the reading itself and takes no floor: at zero it
        // is zero, and that is what it is for. A SEGMENT is one of several
        // parts of a whole laid side by side, so it lives in a FLEX row — the
        // gauges all fill a track from the left instead, absolutely or as a
        // block, and none of them opens a flex context to do it.
        if (!/background:/.test(object)) continue;
        // …and a segment is a flex ITEM: it is placed by the row, never by
        // itself. A fill that positions itself inside a track is the other
        // form, whatever the row above it happens to be doing.
        if (/position: '(absolute|fixed)'/.test(object)) continue;
        const before = text.slice(Math.max(0, hit.index - 900), hit.index);
        if (!/display: 'flex'/.test(before)) continue;
        drawers.add(source.name);
        if (!/minWidth:/.test(object)) {
          offenders.push(`${source.name}: a proportional segment with no floor`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect([...drawers].sort()).toEqual([
      'ActivityFeedReadout.tsx',
      'CellByteBudget.tsx',
      'NetworkAtlasReadout.tsx',
      'NetworkPanel.tsx',
      'StageCapacityPanel.tsx',
      'TaxonomyBar.tsx',
    ]);
  });

  it('a qualitative legend is tinted, and an ordinal one declares that it is not', () => {
    const offenders: string[] = [];
    const declared: string[] = [];
    for (const source of domDialect()) {
      const text = code(source.text);
      const greys = [...text.matchAll(/color: HUD_COLORS\.legendInk/g)].length;
      const marks = [...text.matchAll(
        /data-[\w-]*legend=(\{[^}]*(?:qualitative|ordinal)[^}]*\}|"(?:qualitative|ordinal)")/g,
      )];
      if (greys !== marks.length) {
        offenders.push(`${source.name}: ${greys} legend lines, ${marks.length} declared`);
      }
      for (const mark of marks) {
        const qualitative = /qualitative/.test(mark[1]);
        declared.push(`${source.name} ${qualitative ? 'qualitative' : 'ordinal'}`);
        if (!qualitative) continue;
        // …and a tint is a colour taken from the datum the segment is painted
        // from, never a second table beside it.
        const after = text.slice(mark.index, mark.index + 900);
        if (!/color: [^,}\n]*\.color/.test(after)) {
          offenders.push(`${source.name}: a qualitative legend paints no name from its segment`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(declared.sort()).toEqual([
      'ActivityFeedReadout.tsx qualitative',
      'NetworkAtlasReadout.tsx qualitative',
      // One legend for both scopes: the taxonomy bar draws the stage's
      // families and the chain's, so it declares once for the two panels
      // that mount it.
      'TaxonomyBar.tsx qualitative',
    ]);
  });
});

// ——— One severity per fact ————————————————————————————————————————————————
//
// "A peer is ahead of us" is printed on three surfaces — the PEER·02 rail, the
// PEER card's sync ladder and the NODE card's lag line — and it is the one
// reading in this app that indicts the local node: a peer past our head means
// WE are behind. It wore `danger` on the two cards and `caution` on the rail,
// so the same fact changed how much it mattered depending on which surface a
// reader met it on (report C, C-4). The user's D-18 ruling: danger on all
// three, the cards' argument being the one that was already written down.
//
// The rule is stated as a sweep rather than as three pins: any line of these
// three files that renders the word AHEAD may name `danger` and may not name
// `caution`. A fourth surface printing the same fact in the third colour is
// caught the day it is written.
describe('one severity per fact', () => {
  const AHEAD_SURFACES = [
    'components/hud/NetworkPanel.tsx',
    'components/hud/NodeSelfCard.tsx',
    'derives/peerLinkInstrument.derive.ts',
  ] as const;

  it('a peer past our head is danger on every surface that says so', () => {
    const offenders: string[] = [];
    let sites = 0;
    for (const name of AHEAD_SURFACES) {
      const source = PACKAGE_SOURCES.find((entry) => entry.name === name);
      expect(source, `${name} moved — this oracle reads files off disk`).toBeDefined();
      for (const line of code(source?.text ?? '').split('\n')) {
        if (!/AHEAD/.test(line)) continue;
        sites += 1;
        if (/HUD_COLORS\.caution/.test(line)) {
          offenders.push(`${name}: ${line.trim()}`);
        }
      }
    }

    // The three sites the ruling is about, so a rule that stopped finding them
    // fails instead of passing over an empty set.
    expect(sites).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });

  it('and each of the three surfaces names danger where it says it', () => {
    const says = (file: string, fragment: string) => {
      const source = PACKAGE_SOURCES.find((entry) => entry.name === file);
      expect(code(source?.text ?? ''), `${file} lost its AHEAD severity`)
        .toContain(fragment);
    };
    says('components/hud/NetworkPanel.tsx', 'segFloor(consensus.ahead), background: HUD_COLORS.danger');
    says('components/hud/NetworkPanel.tsx', 'style={{ color: HUD_COLORS.danger }}>{consensus.ahead} AHEAD');
    says('components/hud/NodeSelfCard.tsx', 'AHEAD · WE LAG');
    says('derives/peerLinkInstrument.derive.ts', 'AHEAD`, color: HUD_COLORS.danger');
  });
});

// ——— Every degraded state is a colour, a form and a word ————————————————
//
// The HUD has thirteen ways of saying something is wrong, and until this chapter
// nothing checked that a reader could tell them apart. Report E laid them out
// side by side and found the failure was not "too many": it was two hues doing
// four jobs — violet for MY CONNECTION RE-SYNCING and for THE SERVER REBUILDING
// ITS MEMORY, cyan for CONNECTING and for CATCHING UP — while the states that
// most needed telling apart were the ones nobody had drawn at all (E-7).
//
// The rule is that a state is a TRIPLE — colour, form, word — and no two
// states may share all three. Not "no two share a colour": a palette with a
// severity ramp in it is going to reuse the ramp, and it SHOULD. What a
// reader needs is one axis of difference, and the two the HUD already has are
// the strongest kind: FORM (an edge-bound band across the top is the frame
// raising its voice; a floating plate is a thing that happened to the chain)
// and WORD. So catch-up and rebuild are told apart by being a plate that says
// RESTORING CKB CONTINUITY and a plate that says REBUILDING CONSENSUS MEMORY,
// in colours they are welcome to share with the two bands above them.
//
// Every value below is READ from the surface that draws it — `replayPresentation`
// is called, the banner's table is parsed out of its source, the boot band's
// accent function is called — so this is a sweep and not a transcription. The
// FORM is the one thing stated here, because a form is a rendering fact; each
// claim carries a source toll beside it.

describe('every degraded state is a colour, a form and a word', () => {
  type StateRow = { state: string; color: string; form: string; word: string };

  /** The banner's table, parsed rather than imported: `PRESENTATION` is
   *  private to the file that draws it, and an oracle that made it public to
   *  read it would have changed the thing it measures. */
  function bannerStates(): StateRow[] {
    const text = code(SOURCES.find((source) => source.name === 'StreamHealthBanner.tsx')?.text ?? '');
    const rows: StateRow[] = [];
    for (const entry of text.matchAll(
      /(\w+): \{ title: '([^']+)', color: HUD_COLORS\.(\w+) \}/g,
    )) {
      const [, phase, word, token] = entry;
      rows.push({
        state: `stream:${phase}`,
        color: HUD_COLORS[token as keyof typeof HUD_COLORS] as string,
        // The frozen register is the one that also fills the viewport's edge.
        form: phase === 'stale' ? 'band+frame' : 'band',
        word,
      });
    }
    // The node's two words ride the frozen register rather than phases of
    // their own, and they are not a table: one of them is BUILT, out of a
    // constant and a name a server authored. So they are read by CALLING the
    // one function that decides them — the same way the replay plate's four
    // are — with a fault the channel could really hand over.
    for (const fault of [
      { kind: 'unreachable' } as const,
      // Lower case on purpose: the case oracle two tests down is the one that
      // holds the server's own string to the HUD's one case, and it can only
      // do that if the fixture hands it a string that is not already upper.
      { kind: 'quarantined', projections: ['cells'] } as const,
    ]) {
      const visual = streamHealthPresentation({
        phase: 'stale',
        affectedChannels: ['node'],
        lastMessageAgeMs: 4_000,
        attempt: 0,
        nodeFault: fault,
      });
      expect(visual, `the node channel lost its ${fault.kind} word`).not.toBeNull();
      rows.push({
        state: `stream:node-${fault.kind}`,
        color: visual?.color ?? '',
        form: 'band+frame',
        word: visual?.title ?? '',
      });
    }
    return rows;
  }

  function replayStates(): StateRow[] {
    return (['boot', 'catchup', 'reorg', 'rebuild'] as const).map((phase) => {
      const visual = replayPresentation(phase);
      return {
        state: `replay:${phase}`,
        color: visual.color,
        form: 'plate',
        word: visual.title,
      };
    });
  }

  function bootStates(): StateRow[] {
    // No `detail` on the failed line: the reason a boot died is a MESSAGE, not
    // part of the state's word, and it is the one string in this whole matrix
    // that a server gets to author.
    const failed: BootSequenceSnapshot = {
      active: true,
      complete: false,
      phases: [{ id: 'snapshot', state: 'failed' }],
    };
    const running: BootSequenceSnapshot = {
      active: true,
      complete: false,
      phases: [{ id: 'snapshot', state: 'active' }],
    };
    return [
      {
        state: 'boot:running',
        color: bootSequenceAccent(running),
        form: 'band',
        word: BOOT_SEQUENCE_TITLE,
      },
      {
        // The band keeps its own title and turns red; the FAULT word is on the
        // line under it, which is the phase trail's, so the state's word is the
        // pair. `bootPhaseLine` is what prints it.
        state: 'boot:fault',
        color: bootSequenceAccent(failed),
        form: 'band',
        word: `${BOOT_SEQUENCE_TITLE} · ${bootPhaseLine(failed.phases[0]).text}`,
      },
      {
        state: 'stage:composing',
        color: HUD_COLORS.cyanWire,
        form: 'band',
        word: STAGE_COMPOSING_TITLE,
      },
    ];
  }

  const rows = (): StateRow[] => [...bannerStates(), ...replayStates(), ...bootStates()];

  it('reads every state off the surface that draws it', () => {
    // Thirteen, and the sweep has to FIND them: a parser that quietly stopped
    // matching would make every assertion below vacuous.
    const found = rows();
    expect(found.length).toBe(13);
    expect(found.map((row) => row.state)).toEqual([
      'stream:connecting', 'stream:retrying', 'stream:resyncing', 'stream:stale',
      'stream:node-unreachable', 'stream:node-quarantined',
      'replay:boot', 'replay:catchup', 'replay:reorg', 'replay:rebuild',
      'boot:running', 'boot:fault', 'stage:composing',
    ]);
    for (const row of found) {
      expect(row.word, `${row.state} has no word`).not.toBe('');
      expect(row.color, `${row.state} has no colour`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('never says two states the same way', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const row of rows()) {
      const key = `${row.color}|${row.form}|${row.word}`;
      const first = seen.get(key);
      if (first !== undefined) {
        collisions.push(`${row.state} and ${first} are one colour, one form and one word`);
        continue;
      }
      seen.set(key, row.state);
    }
    expect(collisions).toEqual([]);

    // And the sentence alone, because form is the weakest of the three axes:
    // two states in one hue saying one sentence are told apart only by whether
    // the thing is bolted to the top edge or floating under it, which is a
    // distinction a reader makes AFTER reading. Thirteen states, thirteen
    // sentences.
    const said = new Map<string, string>();
    const echoes: string[] = [];
    for (const row of rows()) {
      const first = said.get(row.word);
      if (first !== undefined) {
        echoes.push(`${row.state} says what ${first} says: ${row.word}`);
        continue;
      }
      said.set(row.word, row.state);
    }
    expect(echoes).toEqual([]);

    // …and the pairs that DO share a hue share nothing else, which is the
    // finding this rule is the answer to. Read off the table rather than
    // asserted about named states, so a hue moved onto a third state is
    // measured the same way.
    const byColor = new Map<string, StateRow[]>();
    for (const row of rows()) {
      byColor.set(row.color, [...(byColor.get(row.color) ?? []), row]);
    }
    const sharing = [...byColor.values()].filter((group) => group.length > 1);
    expect(sharing.length, 'no two states share a hue — this half of the rule is asleep')
      .toBeGreaterThan(0);
    for (const group of sharing) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          expect(
            group[i].form !== group[j].form || group[i].word !== group[j].word,
            `${group[i].state} and ${group[j].state} share a hue and say the same thing the same way`,
          ).toBe(true);
        }
      }
    }
  });

  it('speaks in the HUD\'s one case', () => {
    for (const row of rows()) {
      expect(row.word, `${row.state} says ${row.word} in mixed case`)
        .toBe(row.word.toUpperCase());
    }
  });

  it('the two forms are what the two files actually draw', () => {
    // The FORM column is the one thing this chapter states rather than reads,
    // so each claim pays a toll against the file that renders it.
    const banner = code(SOURCES.find((source) => source.name === 'StreamHealthBanner.tsx')?.text ?? '');
    expect(banner, 'the health banner stopped renting the top band').toMatch(/<TopBand\b/);
    expect(banner, 'the frozen frame is no longer the frozen state\'s alone')
      .toContain("summary.phase === 'stale' ? (");
    expect(banner).toContain('data-stream-stale-frame');

    const plate = code(SOURCES.find((source) => source.name === 'BackfillBar.tsx')?.text ?? '');
    expect(plate, 'the replay plate stopped being a floating plate')
      .toContain('clipPath: PLATE_CUT_CLIP');
    expect(plate, 'the replay plate grew a band').not.toMatch(/<TopBand\b/);
    // …and it prints the title the matrix read out of `replayPresentation`.
    expect(plate).toContain('{visual.title}');
  });
});
