import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const identity = JSON.parse(await readFile(resolve(root, 'packages/ui/src/brandIdentity.json'), 'utf8'));
const { colors, compact, favicon, full, name, slogan } = identity;

const bootMark = `        <svg class="cknerv-startup-mark" viewBox="0 0 148 148" role="img" aria-label="CKNERV startup: Cell and Chain snapshot progress, waiting for the first frame.">
          <g transform="translate(74 74)">
            <g data-boot-mesh="cells" data-state="pending" data-indeterminate="false" class="boot-cells boot-geometry">
              <path class="boot-base" d="${full.cellOuter}"/><path class="boot-progress" pathLength="1" d="${full.cellOuter}"/>
              <path class="boot-fabric" d="${full.cellInner}"/><g class="boot-nodes" fill="${colors.cell}" stroke="none"><circle cx="-35" cy="-23" r="1.6"/><circle cx="-47" r="1.6"/><circle cx="-35" cy="23" r="1.6"/></g>
            </g>
            <g data-boot-mesh="chain" data-state="pending" data-indeterminate="false" class="boot-chain boot-geometry">
              <path class="boot-base" d="${full.peerOuter}"/><path class="boot-progress" pathLength="1" d="${full.peerOuter}"/>
              <path class="boot-fabric" d="${full.peerInner}"/><g class="boot-nodes" fill="${colors.peer}" stroke="none"><circle cx="35" cy="-23" r="1.6"/><circle cx="47" r="1.6"/><circle cx="35" cy="23" r="1.6"/></g>
            </g>
            <g fill="${colors.ink}" opacity=".7"><circle cy="-47" r="1.6"/><circle cy="47" r="1.6"/></g>
            <circle class="cknerv-startup-center-halo" r="8"/><circle r="3.6" fill="${colors.ground.toLowerCase()}"/><circle class="cknerv-startup-center" r="1.9"/>
          </g>
        </svg>`;

let html = await readFile(resolve(root, 'ui-app/index.html'), 'utf8');
function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Missing generated ${label} marker`);
  return source.replace(pattern, replacement);
}
html = replaceRequired(html, /(?<=<!-- brand-mark:start -->\n)[\s\S]*?(?=\n\s*<!-- brand-mark:end -->)/, bootMark, 'boot mark');
html = html.replace(/(<p class="cknerv-startup-tagline">)[\s\S]*?(<\/p>)/, `$1<span>${slogan.replace(', ', ',</span> <span>')}</span>$2`);
const alt = `${name} dual mesh mark with the words ${slogan}`;
html = html.replace(/(<meta (?:property="og:image:alt"|name="twitter:image:alt") content=")[^"]*(" \/>)/g, `$1${alt}$2`);
html = replaceRequired(
  html,
  /(<div id="cknerv-startup"[^>]*style=")[^"]*(")/,
  `$1--brand-ground:${colors.ground};--brand-cell:${colors.cell};--brand-peer:${colors.peer};--brand-ink:${colors.ink};--brand-legend:${colors.legendInk}$2`,
  'boot color properties',
);
await writeFile(resolve(root, 'ui-app/index.html'), html);

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none">
  <title>${name}</title><rect width="32" height="32" fill="${colors.ground}"/>
  <g stroke-linecap="round" stroke-linejoin="round" stroke-width="1.85"><path stroke="${colors.cell}" d="${favicon.cell}"/><path stroke="${colors.peer}" opacity=".76" d="${favicon.peer}"/><path stroke="${colors.legendInk}" stroke-width="1.3" d="${favicon.spine}"/></g>
  <circle cx="16" cy="16" r="2.5" fill="${colors.ground}"/><circle cx="16" cy="16" r="1.65" fill="${colors.ink}"/>
</svg>\n`;
await writeFile(resolve(root, 'ui-app/public/favicon.svg'), faviconSvg);

const saira = (await readFile(resolve(root, 'packages/ui/src/fonts/Saira-latin.woff2'))).toString('base64');
const socialSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <style>@font-face{font-family:Saira;src:url(data:font/woff2;base64,${saira}) format('woff2')}text{font-family:Saira,sans-serif}</style>
  <rect width="1200" height="630" fill="${colors.ground}"/>
  <g transform="translate(600 216) scale(1.107142857)" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.05">
    <g stroke="${colors.cell}" opacity=".92"><path d="${full.cellOuter}"/><path opacity=".68" d="${full.cellInner}"/></g>
    <g stroke="${colors.peer}" opacity=".65"><path d="${full.peerOuter}"/><path opacity=".68" d="${full.peerInner}"/></g>
    <g fill="${colors.cell}" opacity=".94" stroke="none"><circle cx="-35" cy="-23" r="1.6"/><circle cx="-47" r="1.6"/><circle cx="-35" cy="23" r="1.6"/></g>
    <g fill="${colors.peer}" opacity=".72" stroke="none"><circle cx="35" cy="-23" r="1.6"/><circle cx="47" r="1.6"/><circle cx="35" cy="23" r="1.6"/></g>
    <g fill="${colors.ink}" opacity=".7" stroke="none"><circle cy="-47" r="1.6"/><circle cy="47" r="1.6"/></g>
    <circle r="3.6" fill="${colors.ground}" stroke="none"/><circle r="1.9" fill="${colors.ink}" stroke="none"/>
  </g>
  <text x="606" y="369" text-anchor="middle" fill="${colors.ink}" font-size="50" font-weight="500" letter-spacing="12">${name}</text>
  <text x="600" y="412" text-anchor="middle" fill="${colors.legendInk}" font-size="25" font-weight="400" letter-spacing="1">${slogan}</text>
</svg>\n`;
await writeFile(resolve(root, 'ui-app/social-preview.svg'), socialSvg);

// The home-screen mark. iOS accepts no SVG for `apple-touch-icon`, so this is
// the editable source and `docs/development.md` carries the raster step, the
// way the share card already does. It is the favicon's geometry on the same
// ground with room to breathe — a home screen sets icons much larger than a
// tab, and the 32-unit mark's strokes go thin and its rounded square gets
// clipped by the platform's own mask without the inset.
const appIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180" fill="none">
  <title>${name}</title><rect width="180" height="180" fill="${colors.ground}"/>
  <g transform="translate(90 90) scale(0.83)" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6">
    <g stroke="${colors.cell}" opacity=".92"><path d="${full.cellOuter}"/><path opacity=".62" stroke-width="1.9" d="${full.cellInner}"/></g>
    <g stroke="${colors.peer}" opacity=".68"><path d="${full.peerOuter}"/><path opacity=".62" stroke-width="1.9" d="${full.peerInner}"/></g>
    <g fill="${colors.cell}" opacity=".94" stroke="none"><circle cx="-35" cy="-23" r="3.1"/><circle cx="-47" r="3.1"/><circle cx="-35" cy="23" r="3.1"/></g>
    <g fill="${colors.peer}" opacity=".74" stroke="none"><circle cx="35" cy="-23" r="3.1"/><circle cx="47" r="3.1"/><circle cx="35" cy="23" r="3.1"/></g>
    <g fill="${colors.ink}" opacity=".7" stroke="none"><circle cy="-47" r="3.1"/><circle cy="47" r="3.1"/></g>
    <circle r="7" fill="${colors.ground}" stroke="none"/><circle r="3.7" fill="${colors.ink}" stroke="none"/>
  </g>
</svg>\n`;
await writeFile(resolve(root, 'ui-app/app-icon.svg'), appIconSvg);

// The install manifest. `display: standalone` is the whole point of it on a
// tablet: the instrument then owns the screen outright and the floating
// browser chrome that covers the top bar is simply not there.
const manifest = {
  name,
  short_name: name,
  description: slogan,
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  background_color: colors.ground,
  theme_color: colors.ground,
  icons: [
    { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    { src: '/app-icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
};
await writeFile(
  resolve(root, 'ui-app/public/manifest.webmanifest'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

// Keep the compact source exercised by this generator even though React reads
// it directly; malformed identity manifests fail here before reaching a build.
for (const path of Object.values(compact)) if (!path.startsWith('M')) throw new Error('Invalid compact mark path');
