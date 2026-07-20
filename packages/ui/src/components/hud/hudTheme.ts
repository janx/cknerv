import sairaUrl from '../../fonts/Saira-latin.woff2';
import chakra500Url from '../../fonts/ChakraPetch-500-latin.woff2';
import chakra700Url from '../../fonts/ChakraPetch-700-latin.woff2';
import shareTechUrl from '../../fonts/ShareTechMono-latin.woff2';
import huiwenUrl from '../../fonts/HuiwenMincho-subset.woff2';

export const HUD_COLORS = {
  ground: '#000000',
  panel: 'rgba(0,0,0,0.45)',
  orange: '#FF9830',
  orangeDeep: '#EC7420',
  cyanWire: '#20F0FF',
  peerWire: '#8FB7FF',
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
  cjk: "'Huiwen-mincho', 'Noto Serif SC', serif",
} as const;

/** A `#RRGGBB` palette color as an `rgba(r,g,b,a)` string — single source for
 *  canvas/border tints that need an alpha the hex form can't carry. */
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Self-hosted, subset webfonts — no third-party CDN at runtime. Latin faces are
// Google's latin-range woff2; the CJK face is Huiwen-mincho (public domain)
// subset to the 21 glyphs the HUD uses (共识记忆细胞状态脉搏警告节点对端播种网络全).
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
    + `\n.cknerv-mesh-rail::-webkit-scrollbar{width:5px}`
    + `\n.cknerv-mesh-rail::-webkit-scrollbar-thumb{background:rgba(255,152,48,.35);border-radius:3px}`
    + `\n.cknerv-mesh-rail::-webkit-scrollbar-track{background:transparent}`
    + `\n.cknerv-memory-route-ledger{position:absolute;right:calc(100% + 30px);top:-1px;width:230px}`
    + `\n.cknerv-memory-route-ledger-lens{width:268px}`
    + `\n.cknerv-memory-route-cells::-webkit-scrollbar{width:3px}`
    + `\n.cknerv-memory-route-cells::-webkit-scrollbar-thumb{background:rgba(32,240,255,.28)}`
    + `\n.cknerv-memory-route-cells::-webkit-scrollbar-track{background:transparent}`
    + `\n.cknerv-memory-route-connector-tail{display:none}`
    + `\n@media (min-width:1101px) and (max-width:1373px){.cknerv-memory-route-ledger{top:-106px}.cknerv-memory-route-connector-tail{display:block;height:106px}}`
    + `\n@media (max-width:1100px){.cknerv-memory-route-ledger{position:static;width:auto;margin:4px 4px 2px 0}.cknerv-memory-route-connector,.cknerv-memory-route-connector-tail{display:none}}`;
  doc.head.appendChild(style);
}
