import sairaUrl from '../../fonts/Saira-latin.woff2';
import chakra500Url from '../../fonts/ChakraPetch-500-latin.woff2';
import chakra700Url from '../../fonts/ChakraPetch-700-latin.woff2';
import shareTechUrl from '../../fonts/ShareTechMono-latin.woff2';
import huiwenUrl from '../../fonts/HuiwenMincho-subset.woff2';
import jbmUrl from '../../fonts/JetBrainsMono-400-subset.woff2';
import orbitronUrl from '../../fonts/Orbitron-500-subset.woff2';
import { PEER_NETWORK_HEX } from '../../visualPalette';

// Three color layers, and one rule about how a surface is allowed to wear them.
// Chrome (orange / cyanWire) is the instrument's own frame. Identity colors name
// a thing — a mesh, a peer, a cell. Semantics name a state, and only a state.
// Severity may FILL: at warning and above the level word inverts into a solid
// block of its own color with `ground` punched through the letters. Chrome and
// identity only ever outline. So a filled block anywhere in the HUD means
// something is wrong — never "this panel matters more than its neighbours".
export const HUD_COLORS = {
  // Absolute black, and never a surface: `ground` is what gets KNOCKED OUT of
  // something coloured. `severityChip` reads it back through the letters of a
  // filled severity block, and the status strip's three scrubber markers read
  // it through the middle of a 4–6px bordered dot so the marker sits on its
  // track as a hole rather than a bead. The fifth reader borrows that second
  // form for the same reason one step further out: the link probe's compass
  // draws US as a hole and the peer as a bead, because the two marks resolve
  // to the same hex and had to be told apart by shape rather than by hue. Five
  // readers, and a knockout with a hue is just a fill — which is why this one
  // may not drift the way the two near-blacks around it are free to.
  //
  // It does not name the ground the stage is painted on. That is `stageGround`,
  // and the token being called `ground` is exactly why nobody found it there.
  ground: '#000000',
  // The colour the stage itself is painted, and the only near-black here a
  // person actually looks at: the scene's clear colour, the CSS under the
  // canvas that holds it until a first frame exists, and the body behind both.
  // All three have to spell one value or the page shifts at first light.
  //
  // Ten units off `ground` and ten off `trackGround`, and that is not the drift
  // this palette hunts — those two are a knockout and a channel, jobs no reader
  // ever sees beside this one. What it ends is a mismatch that had run the life
  // of the file: the token named `ground` was not naming the ground, so every
  // surface that wanted the stage's black typed it out, and the value lived in
  // three files and belonged to none.
  //
  // `index.html` still spells it, because the shell paints before a module has
  // evaluated and a stylesheet cannot import. Its copy is held against this one
  // by `ui-app/__tests__/App.sceneRoots.test.tsx`.
  stageGround: '#02030A',
  panel: 'rgba(0,0,0,0.45)',
  // The empty half of every gauge, meter and segmented bar. Deliberately one
  // step off `ground`: a track has to read as a channel carved into the panel's
  // translucent black, and pure black just dissolves into the stage behind it.
  trackGround: '#0A0A0A',
  orange: '#FF9830',
  orangeDeep: '#EC7420',
  cyanWire: '#20F0FF',
  peerWire: PEER_NETWORK_HEX.scaffold,
  // The Cell organism's own blood. `CELL_GALAXY_PALETTE.tissueRose` is
  // [1.0, 0.40, 0.44] — #FF666F — and the whole galaxy on stage is painted out
  // of that rose/crimson/amber family, while the CELL MESH panel and the cell
  // card wore a cyan eight degrees off the PEER plane's `peerWire`. Two things
  // went wrong at once: the twin-mesh pair stopped reading as a warm/cold pair,
  // and the cell surfaces pointed at the wrong creature. This is the raw tissue
  // hue opened toward white until it survives being 8.5px of module tag on
  // black — the scene value itself is body-lit and goes muddy at type sizes.
  //
  // Hard requirement, checked in `hudDiscipline.test.ts`: it must stay in the
  // tissue's own neighbourhood AND read apart from `danger #FF3030` at 8.5px.
  // A rose that drifts red stops naming the organism and starts looking like a
  // small alarm, which is the one failure mode this token cannot have.
  cellRose: '#FF7A85',
  // What a Cell turns into while it burns down. The stage already has this
  // colour: `CELL_GALAXY_PALETTE.ember` is what `cellHybridMaterial`'s wither
  // ramp drains a consumed body toward — chroma cooled to ash, then tinted
  // back 0.6 of the way to ember — so the panel that counts deaths and the
  // corpses out there finally name the same event. It is that hue taken
  // darker and redder than the scene's raw [1.0, 0.52, 0.28], because at full
  // brightness the ember IS chrome orange, and a reading may never be painted
  // in the instrument's own frame colour. The gate found the whole corridor:
  // this sits at hue 11°, between `danger` at 0° and `orangeDeep` at 25°, and
  // is cooled and dimmed off both — which is what a coal that has burned down
  // actually looks like beside a flame.
  //
  // Which layer it belongs to: DATA, not identity. `cellRose` says "this
  // surface is about Cells"; `ember` says "this number is cells being spent".
  // It is never a panel accent, never a border, only ever a reading — and
  // `hudDiscipline.test.ts` walks it through the same reserve matrix as the
  // lock and asset families for exactly that reason.
  //
  // What it replaced matters more than what it is. BORN/DIED used to be
  // nominal green over danger red, which said that a Cell being consumed is a
  // FAULT. In this organism it is not: cells dying IS metabolism, and a chain
  // that stopped spending its outputs would be the emergency. Red stays
  // reserved for pathology — reorg, stall, decode error, crit — so ember has
  // to read as "consumed" from across the room and never as a small alarm.
  ember: '#D25234',
  rebuild: '#AE86FF',
  // Consensus-memory family (the inspection surface's violet) — deliberately
  // distinct from `rebuild`, which is the scene's replay/rebuild semantic.
  memory: '#AA88FF',
  memoryInk: '#C9BAFF',
  // Bright text tiers of the wire families; chrome stays cyanWire / orange.
  cyanInk: '#C9F8FF',
  lockedGold: '#FFD7A1',
  goldInk: '#FFD29A',
  ink: '#E8E8E8',
  // One tier above `ink`, and the only thing allowed up there: the single hero
  // numeral a panel exists to show. `ink` stays the body text — if everything
  // were white, the hero would be nothing.
  heroInk: '#FFFFFF',
  // The line of segment names under a bucket bar — `CKB 41 · TOKEN 12 · DAO 3`
  // — ranked here on purpose, between the label tier and the reading tier. Four
  // panels had been typing it out because it had nowhere to come from, and it
  // is a real rung rather than a drift between two: 68 off `dim` and 102 off
  // `ink`, both clear of the separation floor.
  //
  // Why a legend earns a tier of its own. It is not a label — a label names the
  // instrument and then gets out of the way, which is what `dim` is for, and
  // every one of those bars titles itself in `dim` on the line above. And it is
  // not a reading — the eye is meant to land on the BAR, so a legend set in
  // `ink` competes with the picture it annotates. It is a caption on a graphic:
  // read second, read in full, never mistaken for the thing it captions.
  //
  // `StageCapacityPanel` argues the rank inside one sentence: the named
  // families print in this, and the `+N <1%` tail that follows them in the same
  // line drops to `dim`.
  legendInk: '#9FB0BD',
  dim: '#7C8794',
  // The module registry's own grey, for the CKB·01 / MESH·02 count-off tags.
  // Below `dim` on purpose: a tag is an address, not a reading. A panel that
  // owns an identity accent overrides it with that accent instead.
  moduleSlate: '#5A6470',
  nominal: '#27FF5A',
  caution: '#F6E201',
  // Amber, and deliberately decoupled from chrome. `warning` used to be the
  // exact `#FF9830` the whole frame is painted in, so the middle severity was
  // chromatically invisible — a warning read as more furniture. Pulled off the
  // chrome hue the ramp nominal → caution → warning → danger → crit has four
  // real steps. Any retune stays inside the amber band and stays legibly apart
  // from BOTH `orange` and `caution` at a 6px dot; hue alone is thin work here,
  // which is why severity also changes treatment (see the fill rule above).
  warning: '#FFB000',
  danger: '#FF3030',
  // The deepest red, and not a fourth alarm hue: by the time `crit` arrives the
  // bar is already painted `danger` and there is no louder colour left, so the
  // last step of the ramp escalates in SHAPE instead — hazard banding along the
  // band's own edges — and this darkens the ground underneath it at .35 so the
  // banding has something to be laid on.
  //
  // `WarningBar` is that one reader, and for the life of the file it was not
  // even that: the bar typed `rgba(139,0,0,.35)` — this value, expanded — in a
  // file whose third line imports this palette. An orphan token and a token
  // retyped at its only call site read identically from here; both mean the
  // name is not where the value lives. `hudDiscipline.test.ts` holds it to the
  // single reader, the same bargain `termGreen` makes below.
  crit: '#8B0000',
  // CRT phosphor. Not a fourth semantic green — the light a cathode tube
  // glows, which is why it is harder and more saturated than any state token.
  // It has exactly one reader: `BlockCadenceEcg`'s `COND_COLOR_TRACE`, which
  // strokes the ECG canvas in this while the chain's cadence is FINE, with the
  // `● FINE` lamp beside it still lit in `nominal`. Two greens on one panel is
  // deliberate and `hudDiscipline.test.ts` holds them apart: one is an
  // instrument's ink, the other is a status lamp, and they look like different
  // things because they are different things.
  //
  // The escape hatch, because the phosphor is a judgement a person makes at
  // the running panel and not one this file can make: if it reads as a
  // mistake, this token and `COND_COLOR_TRACE` are deleted together. There is
  // no second use — the token shipped as an orphan for months, and a palette
  // carrying hexes nobody reads is exactly how this one drifted.
  termGreen: '#00F700',
} as const;

// ——— Slots that mean nothing ————————————————————————————————————————————
//
// The one ramp in the HUD where a colour is only a POSITION. Two bars read it,
// and both hand a slot out by something that carries no meaning of its own: the
// peer atlas hashes a country code or a client version string, and the STAGE
// script-family bar goes by RANK — its own comment says the ranking is used
// precisely because it "guarantees neighbouring segments differ", which is a
// statement about legibility and not about what a family IS. Slot 0 is not
// consensus content; it is just first.
//
// So mapping either bar onto `CONTENT_BANDS` would be a lie in a direction no
// reader can check: it would say a country, or a position in a sorted list,
// belongs to a family of things it has nothing to do with. What a slot owes is
// only that it can be told apart, and that it never impersonates a layer that
// does mean something. Six hues of their own, checked against every reserved
// tone, every content band and every text tier rather than borrowed from any of
// them. Closest pair inside the ramp is 90.2, and the nearest any member comes
// to anything outside it is 47.2 — both clear of the separation floor.
//
// The green sector is excluded on purpose and that is the load-bearing part of
// this comment. Green is spoken for by `nominal`, and a country must never read
// as health: a bar where Germany is green and Singapore is amber is a bar that
// appears to be grading nations. The sixth slot was nearly a moss green, for
// want of an unspent hue — and it would have built exactly that bar beside slot
// 1's gold, while sitting 44.9 from `moduleSlate`, tighter than any member of
// the five it was joining. The violet between slot 0's indigo and slot 2's
// orchid was the untenanted gap, and taking it cost nothing: the ramp's margin
// against everything outside it is the same 47.2 at six slots as at five.
//
// One ramp for all of it, not three. The atlas used to keep two arrays that
// agreed on three of their five values anyway, and the first slot of its
// version ramp was `#ff9d52` — 34.4 from chrome orange, the same near-frame
// colour the byte orbit and the activity feed had each arrived at separately.
// The script bar kept a third list: two chrome tokens, one SEMANTIC token
// (`caution` — a health tone naming a script family) and three literals, one of
// them a character-for-character copy of `CONTENT_BANDS.script`.
export const QUALITATIVE_BUCKET_COLORS: readonly string[] = [
  '#465EB8',
  '#D0B846',
  '#CA94D0',
  '#B24670',
  '#5ED0D0',
  '#983BC6',
];

// ——— Cell identity ———————————————————————————————————————————————————————
//
// VERDICT, adjudicated at the running stage on 2026-08-23: the cell mesh wears
// the galaxy's rose on BOTH surfaces — the CELL MESH panel and the cell card's
// frame — and cyan goes back to belonging to the peer plane. The gate shipped
// this behind a one-line switch with two alternatives beside it (rose on the
// panel only, and the pre-rebind all-cyan HUD); they were looked at side by
// side and lost. A settled decision is documented, not kept as a pair of dead
// branches waiting for a question nobody is asking any more.
//
// The two constants below are what every surface reads, so no file downstream
// ever re-asks the question. The rule they encode: the FRAME carries identity —
// a panel header's module tag, a card's plate border, the tether that ties the
// card to the thing it is about. The CONTENT keeps its own vocabulary — the
// braid's cyan, the memory violet, the value golds, the fact accents that name
// a lock or an asset. So a rose card frame around a cyan register is not a
// clash; it is the card saying "this is a Cell" in its border and "here is what
// the Cell holds" in its body.

/** The CELL MESH panel's own colour — its module tag, and any chrome that
 *  exists to say which organism the panel is counting. */
export const CELL_PANEL_ACCENT = HUD_COLORS.cellRose;

/** The cell dossier's frame colour: plate border, card glow, scan beam, and the
 *  tether back to the Cell on stage while no fact is selected. A fact IS
 *  selected → that fact's own colour wins, as it always did. */
export const CELL_CARD_ACCENT = HUD_COLORS.cellRose;

/** The four voices of the overlay, each one a STACK rather than a face.
 *
 *  `JetBrains Mono Local` sits behind all three Latin voices and is not a
 *  fallback in the usual sense — nothing here is expected to fail to load. It
 *  is a SYMBOL fallback, and CSS resolves a family list per CHARACTER: a span
 *  set in `display` takes its letters from Saira and, for a character Saira
 *  does not have, the next family that does.
 *
 *  It is here because the three Latin faces are Google Fonts' pre-built
 *  `latin`-range woff2, and that range is a published, fixed list that stops
 *  before the Geometric Shapes and Arrows blocks almost entirely. `→` is not
 *  in it. Neither is `←`, `↔`, `◇`, `◆`, `●`, `▲`, `▼`, `▦`. So every symbol
 *  the HUD writes into a sentence — the route arrows on the identity plate,
 *  the read-marks on a proof, the lag arrow on an enrichment chip — was
 *  resolving out of whatever the reader's machine happened to have installed,
 *  which is not the same font twice across two machines and is not our font on
 *  either. Nothing errored; the HUD just looked slightly wrong to somebody who
 *  was not looking for it, which is the exact failure `src/fonts/README.md`
 *  documents for the hand-cut Chinese face and nobody had asked of this side.
 *
 *  The arrangement is not new either — `CellGalaxy` has always listed this
 *  face behind `Orbitron Local` for the same reason, and the README says so.
 *  This is that ruling applied to the surface that never got it. It costs no
 *  bytes: the face is already registered and already shipped.
 *
 *  What the symbol face does NOT carry, the HUD may not write: `▦`, `↔`, `∅`
 *  and the rest are in no face this repo ships and none it could — they are
 *  drawn as marks in `primitives.tsx` instead. `hudDiscipline.test.ts` holds
 *  every face's inventory and fails on a character no stack at a site covers. */
export const HUD_FONTS = {
  display: "'Saira', 'JetBrains Mono Local', system-ui, sans-serif",
  tech: "'Chakra Petch', 'JetBrains Mono Local', system-ui, sans-serif",
  mono: "'Share Tech Mono', 'JetBrains Mono Local', ui-monospace, monospace",
  cjk: "'Huiwen-mincho', 'Noto Serif CJK SC', 'Noto Serif SC', 'Songti SC', SimSun, serif",
} as const;

/** The type scale for the WHOLE DOM HUD — top bar, rails, banners, floating
 *  cards, every panel. It used to describe only the detail/inspection surfaces
 *  while the panels ran a freelance dialect beside it, which is how the HUD
 *  ended up with five hero sizes nobody had ranked and a 6.8px caption. Every
 *  rendered fontSize out here must be one of these rungs; depth is expressed by
 *  stepping down the scale, never by inventing a size between its steps.
 *
 *  `micro` (7.5) is the legibility floor, full stop. Below it the Chakra/Share
 *  Tech faces stop resolving their counters on a normal display, so "make it
 *  smaller" stops being a design decision and becomes a thing you cannot read.
 *  Anything that will not fit at 7.5 needs fewer words, not smaller ones.
 *
 *  Hero tiers are named so a panel can only have one: `hero` is the single
 *  numeral a panel exists to show, `heroSub` is a second reading standing
 *  beside it (DAO's APC next to its deposit total, the alarm's 警告), and
 *  `emphasis` is a value lifted out of a stat row without leaving the row.
 *
 *  EXEMPT: the in-scene label dialect — the files that draw INSIDE the three.js
 *  canvas rather than in DOM overlay (`ConsensusMemory`,
 *  `CellSemanticMorphologyOverlay`, the portrait/artwork components). Those
 *  render at 6–6.4px under a camera, as ADDITIVE material with `toneMapped`
 *  off, laid on the near-black stage ground: light that accumulates, not ink
 *  composited onto a lit panel. A 6px mark there is a mark that is present
 *  rather than a word that is read, which is a different medium with a
 *  different legibility floor, and `hudDiscipline.test.ts` recognises them by
 *  their imports rather than by a hand-kept list.
 *
 *  This paragraph said "under a camera and a BLOOM PASS" for most of its life
 *  and there has never been a bloom pass in this application — no
 *  `EffectComposer`, no `postprocessing` dependency, no tone-mapped path. The
 *  exemption was right and the reason was invented, which is the worse of the
 *  two mistakes: this file is the design system's own record, and people have
 *  reasoned downstream from that sentence. The oracle checks the reason now. */
export const HUD_TYPE = {
  hero: 22,
  heroSub: 19,
  emphasis: 14,
  title: 13,
  panelTitle: 12,
  value: 11.5,
  section: 10.5,
  label: 9,
  tech: 8.5,
  nav: 8,
  micro: 7.5,
} as const;

// ——— Tracking ————————————————————————————————————————————————————————————
//
// Letter-spacing had drifted to 45 distinct values across the HUD — 0.28 and
// 0.3 and 0.32 and 0.34 and 0.35 all living in the same card, none of them
// telling a reader anything the others did not. They are now snapped to one
// eight-rung table, nearest wins, ties going to the TIGHTER rung because that
// is the direction that cannot make a line wrap:
//
//   0.35  running text and hex strings (mono, no shouting)
//   0.6   dense chrome readouts, menu rows
//   0.9   captions and small state words
//   1.2   the standard uppercase label
//   1.4   chips — both the outline kind and the inverted severity block
//   1.6   stat-row labels, plate titles
//   2     banner titles, condition words
//   3     panel titles
//
// An explicit `0` is not a rung — it is the absence of tracking, which a run of
// mono digits sometimes genuinely wants.
//
// Declared exceptions, each one a place where the rung would be wrong rather
// than merely different:
//
//   4.2 / 2.6   `StatusStrip` CKNERV wordmark, wide and dense. The brand is not
//               a label; the spacing IS the logotype, and the dense variant is
//               the same logotype fitted to a narrow bar.
//   4           `WarningBar` 警告. Two mincho glyphs at 19px need air between
//               them or they read as one dense block instead of a siren.
//   −0.25       `DaoStateReadout` deposit hero. The only NEGATIVE tracking in
//               the HUD, and it is there to keep a long CKB figure inside its
//               column at the `hero` rung — tightening a hero is how you avoid
//               demoting it.
//
// And one exception that is about SIZE rather than tracking, recorded here
// because it is the same kind of declared divergence — the dense register:
//
//   dense register  `PeerLinkCard`'s `PeerScanFact` sizes a fact one rung below
//               `CellDetailPanel`'s `CellScanFact` (micro/label vs
//               label/value). Not drift: the peer card is 340px wide and lays
//               its facts out two to a row, so cell-card type would ellipsis
//               away the ends of the values that matter most. The two files
//               name each other in a comment so neither gets "fixed" into the
//               other.

/** A `#RRGGBB` palette color as an `rgba(r,g,b,a)` string — single source for
 *  canvas/border tints that need an alpha the hex form can't carry. */
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Self-hosted, subset webfonts — no third-party CDN at runtime. Latin faces are
// Google's latin-range woff2. Huiwen-mincho (public domain) carries the 32 HUD
// glyphs 共识基神经元脉搏节点场对端状态警告道样本细胞记录交易输入谱系见证 — exactly what
// the panels, the inspector-card companions and the consensus-memory endpoint
// markers render, so any new Chinese needs a re-subset (see fonts/README.md) or
// it silently falls back to a system serif. The last ten arrived with the
// markers, which had been asking a Latin face for Chinese: the string and the
// face are one fix, and `hudDiscipline.test.ts` now checks both.
//
// The two `* Local` families back the in-scene labels (cell-galaxy label,
// consensus-memory markers, route-hop callouts) that name them directly in
// inline `fontFamily` stacks — and JetBrains Mono now backs the three DOM
// voices too, as the symbol fallback `HUD_FONTS` argues for above. Both are
// hand-subset to ASCII printable plus the symbols the HUD renders
// (· × – — • ← → ↓ ↗ ≈ ≤ ≥ ◆ ◇ ✓) with all optional layout features dropped —
// JetBrains Mono's programming ligatures must never fire on a hex id.
// Regenerate with:
//   pyftsubset <face>.ttf --layout-features="" --no-hinting --desubroutinize \
//     --flavor=woff2 --unicodes=U+0020-007E,U+00B7,U+00D7,U+2013,U+2014,\
//     U+2022,U+2190,U+2192,U+2193,U+2197,U+2248,U+2264,U+2713,U+25C6,U+25C7
// Orbitron ships Medium only and the galaxy label asks for 400/500, so the one
// face declares the whole span rather than letting the browser synthesize.
const FONT_FACES = [
  `@font-face{font-family:'Saira';font-weight:100 900;font-display:swap;src:url("${sairaUrl}") format("woff2")}`,
  `@font-face{font-family:'Chakra Petch';font-weight:500;font-display:swap;src:url("${chakra500Url}") format("woff2")}`,
  `@font-face{font-family:'Chakra Petch';font-weight:700;font-display:swap;src:url("${chakra700Url}") format("woff2")}`,
  `@font-face{font-family:'Share Tech Mono';font-weight:400;font-display:swap;src:url("${shareTechUrl}") format("woff2")}`,
  `@font-face{font-family:'Huiwen-mincho';font-display:swap;src:url("${huiwenUrl}") format("woff2")}`,
  `@font-face{font-family:'JetBrains Mono Local';font-weight:400;font-display:swap;src:url("${jbmUrl}") format("woff2")}`,
  `@font-face{font-family:'Orbitron Local';font-weight:400 500;font-display:swap;src:url("${orbitronUrl}") format("woff2")}`,
];

export const HUD_THEME_STYLE_ID = 'cknerv-hud-theme';

export function injectHudTheme(doc: Document = document): void {
  if (doc.getElementById(HUD_THEME_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = HUD_THEME_STYLE_ID;
  const vars = Object.entries(HUD_COLORS).map(([k, v]) => `--hud-${k}:${v};`).join('');
  style.textContent =
    FONT_FACES.join('') + `\n:root{${vars}}` +
    `\n@keyframes cknerv-hud-flash{50%{opacity:.45}}`
    + `\n@keyframes cknerv-hud-breathe{0%,100%{opacity:.82}50%{opacity:1}}`
    + `\n@keyframes cknerv-cell-consensus-enter{0%{opacity:0;transform:translate3d(12px,-2px,0) scale(.985)}55%{opacity:1}100%{opacity:1;transform:translate3d(0,0,0) scale(1)}}`
    + `\n@keyframes cknerv-cell-detail-anchor-enter{0%{opacity:0;transform:scale(.35)}65%{opacity:1;transform:scale(1.18)}100%{opacity:1;transform:scale(1)}}`
    + `\n@keyframes cknerv-cell-specimen-sweep{0%{transform:translate3d(0,0,0);opacity:0}12%{opacity:.82}88%{opacity:.72}100%{transform:translate3d(0,100%,0);opacity:0}}`
    + `\n@keyframes cknerv-route-hop-lock-pulse{0%{filter:brightness(1) drop-shadow(0 0 0 transparent)}18%{filter:brightness(1.58) drop-shadow(0 0 7px var(--route-hop-pulse-color,rgba(255,215,161,.76)))}52%{filter:brightness(1.16) drop-shadow(0 0 3px var(--route-hop-pulse-color,rgba(255,215,161,.42)))}100%{filter:brightness(1) drop-shadow(0 0 0 transparent)}}`
    + `\n.cknerv-hud-control-button:hover{filter:brightness(1.35)}`
    + `\n.cknerv-hud-control-button:focus-visible{outline:1px solid rgba(32,240,255,.55);outline-offset:1px}`
    + `\n.cknerv-cell-display-track:focus-within{filter:brightness(1.35)}`
    + `\n.cknerv-cell-display-track:focus-within::after{content:'';position:absolute;left:0;right:0;bottom:0;height:1px;background:rgba(32,240,255,.42);box-shadow:0 0 5px rgba(32,240,255,.3)}`
    + `\n.cknerv-mesh-rail::-webkit-scrollbar{width:5px}`
    + `\n.cknerv-mesh-rail::-webkit-scrollbar-thumb{background:rgba(255,152,48,.35);border-radius:3px}`
    + `\n.cknerv-mesh-rail::-webkit-scrollbar-track{background:transparent}`
    + `\n.cknerv-chain-cluster::-webkit-scrollbar{height:5px}`
    + `\n.cknerv-chain-cluster::-webkit-scrollbar-thumb{background:rgba(255,152,48,.35);border-radius:3px}`
    + `\n.cknerv-chain-cluster::-webkit-scrollbar-track{background:transparent}`
    + `\n.cknerv-chain-panel-scroll::-webkit-scrollbar{width:5px}`
    + `\n.cknerv-chain-panel-scroll::-webkit-scrollbar-thumb{background:rgba(255,152,48,.35);border-radius:3px}`
    + `\n.cknerv-chain-panel-scroll::-webkit-scrollbar-track{background:transparent}`
    + `\n.cknerv-status-controls::-webkit-scrollbar{display:none}`
    + `\n.cknerv-status-context::-webkit-scrollbar{display:none}`
    + `\n.cknerv-memory-route-ledger{position:absolute;right:calc(100% + 30px);top:-1px;width:272px}`
    + `\n.cknerv-memory-route-ledger-lens{width:312px}`
    + `\n.cknerv-memory-route-ledger-viewport{position:relative;display:flex;flex:1 1 auto;min-height:0}`
    + `\n.cknerv-memory-route-ledger-scroll{position:relative;flex:1 1 auto;min-width:0;min-height:0;box-sizing:border-box}`
    + `\n.cknerv-memory-route-scroll-edge{position:absolute;left:0;right:9px;z-index:2;height:14px;pointer-events:none;opacity:0}`
    + `\n.cknerv-memory-route-scroll-edge-before{top:0;background:linear-gradient(180deg,rgba(1,5,14,.98),rgba(1,5,14,0));box-shadow:inset 0 1px 0 rgba(32,240,255,.14)}`
    + `\n.cknerv-memory-route-scroll-edge-after{bottom:0;background:linear-gradient(0deg,rgba(1,5,14,.98),rgba(1,5,14,0));box-shadow:inset 0 -1px 0 rgba(32,240,255,.14)}`
    + `\n.cknerv-memory-route-scroll-position{position:absolute;top:3px;right:4px;bottom:3px;z-index:3;width:4px;border-right:1px solid rgba(32,240,255,.18);pointer-events:none;opacity:0}`
    + `\n.cknerv-memory-route-scroll-position-marker{position:absolute;left:100%;top:var(--route-ledger-scroll-progress,0%);width:4px;height:4px;border:1px solid rgba(201,248,255,.88);background:#06111B;box-shadow:0 0 6px rgba(32,240,255,.72);transform:translate(-50%,-50%) rotate(45deg)}`
    + `\n.cknerv-memory-route-ledger-lens .cknerv-memory-route-scroll-position-marker{border-color:rgba(255,215,161,.9);box-shadow:0 0 7px rgba(255,215,161,.66)}`
    + `\n.cknerv-memory-route-ledger-scroll::-webkit-scrollbar{width:3px}`
    + `\n.cknerv-memory-route-ledger-scroll::-webkit-scrollbar-thumb{background:rgba(32,240,255,.28)}`
    + `\n.cknerv-memory-route-ledger-scroll::-webkit-scrollbar-track{background:transparent}`
    + `\n.cknerv-memory-route-cells::-webkit-scrollbar{width:3px}`
    + `\n.cknerv-memory-route-cells::-webkit-scrollbar-thumb{background:rgba(32,240,255,.28)}`
    + `\n.cknerv-memory-route-cells::-webkit-scrollbar-track{background:transparent}`
    + `\n.cknerv-memory-route-connector-tail{display:none}`
    + `\n@media (min-width:1101px) and (max-width:1373px),(min-width:1374px) and (max-height:860px){.cknerv-memory-route-ledger{top:-106px}.cknerv-memory-route-connector-tail{display:block;height:106px}}`
    + `\n@media (max-width:1100px){.cknerv-top-bar-action-label{display:none}}`
    + `\n@media (max-width:560px){.cknerv-build-label{display:none}}`
    + `\n@media (max-width:380px){.cknerv-cell-display-label,.cknerv-quality-label,.cknerv-panel-toggle-label{display:none}}`
    + `\n@media (max-width:1100px){.cknerv-memory-route-ledger{position:static;width:auto;max-height:100px;margin:4px 4px 2px 0;overflow:hidden}.cknerv-memory-route-ledger-scroll{overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(32,240,255,.28) transparent;padding-right:8px}.cknerv-memory-route-ledger-viewport[data-memory-evidence-route-scrollable="true"] .cknerv-memory-route-scroll-position{opacity:1}.cknerv-memory-route-ledger-viewport[data-memory-evidence-route-scroll-before="true"] .cknerv-memory-route-scroll-edge-before{opacity:1}.cknerv-memory-route-ledger-viewport[data-memory-evidence-route-scroll-after="true"] .cknerv-memory-route-scroll-edge-after{opacity:1}.cknerv-memory-route-connector,.cknerv-memory-route-connector-tail{display:none}}`;
  doc.head.appendChild(style);
}
