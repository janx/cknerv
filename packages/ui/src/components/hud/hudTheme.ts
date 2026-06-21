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

// v1: CDN imports (verified working in the brainstorm mockup). A later task swaps these
// for self-hosted, subset woff2.
const FONT_IMPORTS = [
  'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Saira:wght@300;400;500;600;700&family=Share+Tech+Mono&display=swap',
  'https://fontsapi.zeoseven.com/256/main/result.css',
];

export const HUD_THEME_STYLE_ID = 'cknerv-hud-theme';

export function injectHudTheme(doc: Document = document): void {
  if (doc.getElementById(HUD_THEME_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = HUD_THEME_STYLE_ID;
  const vars = Object.entries(HUD_COLORS).map(([k, v]) => `--hud-${k}:${v};`).join('');
  style.textContent =
    FONT_IMPORTS.map((u) => `@import url("${u}");`).join('\n') + `\n:root{${vars}}`;
  doc.head.appendChild(style);
}
