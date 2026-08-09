import sairaUrl from '../../fonts/Saira-latin.woff2';
import chakra500Url from '../../fonts/ChakraPetch-500-latin.woff2';
import chakra700Url from '../../fonts/ChakraPetch-700-latin.woff2';
import shareTechUrl from '../../fonts/ShareTechMono-latin.woff2';
import huiwenUrl from '../../fonts/HuiwenMincho-subset.woff2';
import { PEER_NETWORK_HEX } from '../../visualPalette';

export const HUD_COLORS = {
  ground: '#000000',
  panel: 'rgba(0,0,0,0.45)',
  orange: '#FF9830',
  orangeDeep: '#EC7420',
  cyanWire: '#20F0FF',
  peerWire: PEER_NETWORK_HEX.scaffold,
  rebuild: '#AE86FF',
  ink: '#E8E8E8',
  dim: '#7C8794',
  nominal: '#27FF5A',
  caution: '#F6E201',
  warning: '#FF9830',
  danger: '#FF3030',
  crit: '#8B0000',
  termGreen: '#00F700',
} as const;

export const HUD_FONTS = {
  display: "'Saira', system-ui, sans-serif",
  tech: "'Chakra Petch', system-ui, sans-serif",
  mono: "'Share Tech Mono', ui-monospace, monospace",
  cjk: "'Huiwen-mincho', 'Noto Serif CJK SC', 'Noto Serif SC', 'Songti SC', SimSun, serif",
} as const;

/** The five-step type scale for detail/inspection surfaces. Every rendered
 *  fontSize on those surfaces must be one of these steps — micro (7.5) is the
 *  legibility floor, full stop; depth is expressed by stepping down the scale,
 *  never by inventing sizes between its rungs. */
export const HUD_TYPE = {
  title: 13,
  value: 11.5,
  section: 10.5,
  label: 9,
  micro: 7.5,
} as const;

/** A `#RRGGBB` palette color as an `rgba(r,g,b,a)` string — single source for
 *  canvas/border tints that need an alpha the hex form can't carry. */
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Self-hosted, subset webfonts — no third-party CDN at runtime. Latin faces are
// Google's latin-range woff2. Huiwen-mincho (public domain) carries the 22 HUD
// glyphs 共识记忆细胞状态脉搏警告节点对端播种网络全道.
const FONT_FACES = [
  `@font-face{font-family:'Saira';font-weight:100 900;font-display:swap;src:url("${sairaUrl}") format("woff2")}`,
  `@font-face{font-family:'Chakra Petch';font-weight:500;font-display:swap;src:url("${chakra500Url}") format("woff2")}`,
  `@font-face{font-family:'Chakra Petch';font-weight:700;font-display:swap;src:url("${chakra700Url}") format("woff2")}`,
  `@font-face{font-family:'Share Tech Mono';font-weight:400;font-display:swap;src:url("${shareTechUrl}") format("woff2")}`,
  `@font-face{font-family:'Huiwen-mincho';font-display:swap;src:url("${huiwenUrl}") format("woff2")}`,
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
