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

// Self-hosted, subset webfonts — no third-party CDN at runtime. Latin faces are
// Google's latin-range woff2; the CJK face is Huiwen-mincho (public domain)
// subset to the ~12 glyphs the HUD uses (主链细胞网络状态脉搏警告).
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
    `\n@keyframes cknerv-hud-flash{50%{opacity:.45}}`;
  doc.head.appendChild(style);
}
