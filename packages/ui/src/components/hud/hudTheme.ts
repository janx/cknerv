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
  ground: '#000000',
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
  crit: '#8B0000',
  termGreen: '#00F700',
} as const;

// ——— Cell identity ———————————————————————————————————————————————————————
//
// Which colour the CELL surfaces wear, on one line, because this is a question
// only a person looking at the running stage can answer:
//
//   'rose-full'   panel AND card frame carry the organism's blood
//   'rose-panel'  only the CELL MESH panel turns; the card keeps its cyan chrome
//   'cyan'        nothing turns — the pre-rebind HUD, kept revertible
//
// The two derived constants below are what every surface reads, so no file
// downstream ever re-asks the question. The rule they encode: the FRAME carries
// identity — a panel header's module tag, a card's plate border, the tether
// that ties the card to the thing it is about. The CONTENT keeps its own
// vocabulary — the braid's cyan, the memory violet, the value golds, the fact
// accents that name a lock or an asset. So a rose card frame around a cyan
// register is not a clash; it is the card saying "this is a Cell" in its
// border and "here is what the Cell holds" in its body.
export type CellMeshIdentity = 'rose-full' | 'rose-panel' | 'cyan';

export const CELL_MESH_IDENTITY: CellMeshIdentity = 'rose-full';

/** The three variants spelled out, so flipping the line above is the whole
 *  edit and nobody has to re-derive what each one meant. */
const CELL_IDENTITY_SURFACES: Readonly<Record<CellMeshIdentity, {
  /** The CELL MESH panel's own colour — its module tag, and any chrome that
   *  exists to say which organism the panel is counting. */
  panel: string;
  /** The cell dossier's frame colour: plate border, card glow, scan beam, and
   *  the tether back to the Cell on stage while no fact is selected. A fact IS
   *  selected → that fact's own colour wins, as it always did. */
  card: string;
}>> = {
  'rose-full': { panel: HUD_COLORS.cellRose, card: HUD_COLORS.cellRose },
  'rose-panel': { panel: HUD_COLORS.cellRose, card: HUD_COLORS.cyanWire },
  cyan: { panel: HUD_COLORS.cyanWire, card: HUD_COLORS.cyanWire },
};

export const CELL_PANEL_ACCENT = CELL_IDENTITY_SURFACES[CELL_MESH_IDENTITY].panel;
export const CELL_CARD_ACCENT = CELL_IDENTITY_SURFACES[CELL_MESH_IDENTITY].card;

export const HUD_FONTS = {
  display: "'Saira', system-ui, sans-serif",
  tech: "'Chakra Petch', system-ui, sans-serif",
  mono: "'Share Tech Mono', ui-monospace, monospace",
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
 *  render at 6–6.4px under a camera and a bloom pass; they are a different
 *  medium with a different legibility floor, and `hudDiscipline.test.ts`
 *  recognises them by their imports rather than by a hand-kept list. */
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
// Google's latin-range woff2. Huiwen-mincho (public domain) carries the 22 HUD
// glyphs 共识基神经元脉搏节点场对端状态警告道样本细胞 — exactly what the panels and
// inspector-card companions render, so any new Chinese needs a re-subset (see
// fonts/README.md) or it silently falls back to a system serif.
//
// The two `* Local` families back the in-scene labels (cell-galaxy label,
// consensus-memory markers, route-hop callouts) that name them directly in
// inline `fontFamily` stacks. Both are hand-subset to ASCII printable plus the
// symbols those labels render (· × – — • → ↗ ≈ ≤ ✓ ◇) with all optional layout
// features dropped — JetBrains Mono's programming ligatures must never fire on
// a hex id. Regenerate with:
//   pyftsubset <face>.ttf --layout-features="" --no-hinting --desubroutinize \
//     --flavor=woff2 --unicodes=U+0020-007E,U+00B7,U+00D7,U+2013,U+2014,\
//     U+2022,U+2192,U+2197,U+2248,U+2264,U+2713,U+25C7
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
