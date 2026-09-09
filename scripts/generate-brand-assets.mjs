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

// Keep the compact source exercised by this generator even though React reads
// it directly; malformed identity manifests fail here before reaching a build.
for (const path of Object.values(compact)) if (!path.startsWith('M')) throw new Error('Invalid compact mark path');
