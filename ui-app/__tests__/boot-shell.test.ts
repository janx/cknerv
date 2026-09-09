import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginBootPhase,
  beginBootRequest,
  completeBootPhase,
  completeBootRequest,
  failBootPhase,
  getBootSequence,
  markBootViewPreparing,
  markBootViewPresented,
  reportBootRequestProgress,
  reportBootRequestResponse,
  resetBootSequenceForTest,
} from '@cknerv/ui';
import { bootPresentation } from '../src/boot-presentation';
import {
  BOOT_SHELL_DETAIL_ID,
  BOOT_SHELL_ID,
  BOOT_SHELL_PHASE_ID,
  BOOT_SHELL_RELOAD_ID,
  chargeBootFault,
  installBootShellReadout,
  showBootShellFault,
} from '../src/boot-shell';
import { BOOT_FACES, bootFaceTags } from '../vite-boot-faces';
import identity from '../../packages/ui/src/brandIdentity.json';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const HUD_THEME = readFileSync(
  resolve(process.cwd(), '../packages/ui/src/components/hud/hudTheme.ts'),
  'utf8',
);
const token = (name: string) => new RegExp(`${name}: '(#[0-9A-Fa-f]{6})'`)
  .exec(HUD_THEME)?.[1];

function installMarkup(): void {
  document.body.innerHTML = `
    <div id="root" inert><button id="app-action">APP</button></div>
    <div id="${BOOT_SHELL_ID}" data-state="preparing">
      <span id="${BOOT_SHELL_PHASE_ID}"></span>
      <span id="${BOOT_SHELL_DETAIL_ID}"></span>
      <div><i id="cknerv-startup-progress"></i></div>
      <div id="cknerv-startup-error" hidden></div>
      <button id="${BOOT_SHELL_RELOAD_ID}" hidden>RELOAD</button>
      <span id="cknerv-startup-diagnostics"></span>
    </div>`;
}

beforeEach(() => {
  resetBootSequenceForTest();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.__cknervBootTakeover;
  delete window.__cknervBootFault;
  delete window.__cknervBootCleanup;
});

describe('static startup document', () => {
  const shipped = new DOMParser().parseFromString(INDEX_HTML, 'text/html');

  it('ships a complete shell beside the inert React root', () => {
    const root = shipped.getElementById('root')!;
    const shell = shipped.getElementById(BOOT_SHELL_ID)!;
    expect(root.contains(shell)).toBe(false);
    expect(root.hasAttribute('inert')).toBe(true);
    expect(shell.textContent).toContain('CKNERV');
    expect(shell.textContent).toContain('In the cells we share, the world’s mind unfolds.');
    expect(shipped.getElementById(BOOT_SHELL_PHASE_ID)?.textContent).toBe('PREPARING CKNERV');
    expect(shipped.querySelector('noscript')?.textContent).toContain('REQUIRES JAVASCRIPT');
  });

  it('preserves viewport, chrome, favicon, title, and share metadata', () => {
    const meta = (selector: string) => shipped.querySelector(selector)?.getAttribute('content');
    expect(meta('meta[name="viewport"]')).toBe('width=device-width, initial-scale=1, viewport-fit=cover');
    expect(meta('meta[name="theme-color"]')?.toLowerCase()).toBe(token('stageGround')?.toLowerCase());
    expect(shipped.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/favicon.svg');
    expect(shipped.querySelector('link[rel="icon"]')?.getAttribute('type')).toBe('image/svg+xml');
    expect(shipped.title).toBe('CKNERV');
    expect(shipped.title).toBe(shipped.title.toUpperCase());
    expect(meta('meta[name="description"]')).toContain('local-first');
    expect(meta('meta[property="og:image"]')).toBe('https://cknerv.web5.info/social-preview.png');
    expect(meta('meta[name="twitter:card"]')).toBe('summary_large_image');
  });

  it('uses the existing HUD palette and bundled font families', () => {
    for (const name of ['stageGround', 'cellRose', 'ink', 'legendInk', 'dim', 'danger']) {
      expect(INDEX_HTML.toLowerCase()).toContain(String(token(name)).toLowerCase());
    }
    expect(INDEX_HTML).toContain('#1AD1FF');
    expect(INDEX_HTML).toContain("font-family:'Saira'");
    expect(INDEX_HTML).toContain("font-family:'Share Tech Mono'");
    expect(INDEX_HTML).not.toContain('#d9fbff');
    expect(INDEX_HTML).not.toContain('#ff5b5b');
  });

  it('owns pre-bundle slow/error/reload paths and preserves the current URL', () => {
    expect(INDEX_HTML).toContain('setTimeout(waiting,8000)');
    expect(INDEX_HTML).toContain('setTimeout(reloadable,30000)');
    expect(INDEX_HTML).toContain("location.reload()");
    expect(INDEX_HTML).toContain('__cknervBootFault');
    expect(INDEX_HTML).toContain("tagName==='SCRIPT'");
  });

  it('has reduced-motion and narrow/landscape layouts', () => {
    expect(INDEX_HTML).toContain('prefers-reduced-motion:reduce');
    expect(INDEX_HTML).toContain('max-width:480px');
    expect(INDEX_HTML).toContain('orientation:landscape');
    expect(INDEX_HTML).toContain('[data-state="failed"] .boot-progress');
  });

  it('keeps waiting and failure recovery readable and scrollable in short landscape viewports', () => {
    expect(INDEX_HTML).toContain('#cknerv-startup:is([data-state="waiting"],[data-state="failed"]) .cknerv-startup-readout');
    expect(INDEX_HTML).toContain('max-height:calc(100vh - 148px)');
    expect(INDEX_HTML).toContain('overflow-y:auto');
    expect(INDEX_HTML).toContain('.cknerv-startup-diagnostics summary { cursor:pointer; color:#7C8794; font-size:11px;');
    expect(INDEX_HTML).toContain('@media (pointer:coarse) { #cknerv-startup-reload { min-width:64px; min-height:44px;');
  });

  it('preloads exactly the faces used by the shell', () => {
    const tags = bootFaceTags(BOOT_FACES.map((face) => `/assets/${face.file}`));
    const preloads = tags.filter((tag) => tag.tag === 'link');
    expect(preloads).toHaveLength(BOOT_FACES.length);
    for (const preload of preloads) {
      expect(preload.attrs).toMatchObject({ rel: 'preload', as: 'font', type: 'font/woff2' });
      expect(preload.attrs).toHaveProperty('crossorigin');
      expect(preload.injectTo).toBe('head');
    }
    const css = String(tags.find((tag) => tag.tag === 'style')?.children);
    expect(css.match(/font-display:optional/g)).toHaveLength(BOOT_FACES.length);
    for (const face of BOOT_FACES) {
      expect(css).toContain(`font-family:'${face.family}'`);
      expect(css).toContain(`url("/assets/${face.file}")`);
      expect(HUD_THEME).toContain(face.file.replace('.woff2', ''));
    }
  });

  it('keeps the favicon in the HUD palette and the mobile safe-area contract', () => {
    const favicon = readFileSync(resolve(process.cwd(), 'public/favicon.svg'), 'utf8');
    expect(favicon.toLowerCase()).toContain(String(token('stageGround')).toLowerCase());
    expect(favicon.toLowerCase()).toContain('#1ad1ff');
    expect(favicon).not.toMatch(/<text\b/);
    for (const path of Object.values(identity.favicon)) expect(favicon).toContain(path);
    expect(readFileSync(resolve(process.cwd(), 'src/Jukebox.tsx'), 'utf8'))
      .toContain('env(safe-area-inset-');
  });

  it('keeps the inline first-paint mark and copy synced with the browser identity source', () => {
    expect(INDEX_HTML).toContain(identity.slogan);
    expect(INDEX_HTML).toContain(identity.colors.cell);
    expect(INDEX_HTML).toContain(identity.colors.peer);
    for (const path of Object.values(identity.full)) expect(INDEX_HTML).toContain(path);
  });

  it('reserves one readout footprint for waiting, details, and reload', () => {
    expect(INDEX_HTML).toContain('.cknerv-startup-readout { flex:none; height:142px;');
    expect(INDEX_HTML).toContain('#cknerv-startup-detail { min-height:18px;');
  });
});

describe('observed presentation', () => {
  it('tracks each cells attempt instead of retaining the failed binary count', () => {
    const binary = beginBootRequest('cells', 'cells-binary', 0);
    reportBootRequestResponse('cells', binary, 2, 1_000);
    reportBootRequestProgress('cells', binary, 3, 1_000);
    // A JSON fallback is a fresh request, so its zero is the honest display.
    const json = beginBootRequest('cells', 'cells-json', 4);
    reportBootRequestResponse('cells', json, 5, null);
    const state = bootPresentation(getBootSequence(), 5);
    expect(state.heading).toBe('WAITING FOR CELLS');
    expect(state.detail).toBe('');
    expect(state.cells.progress).toBeNull();
    expect(state.cells.indeterminate).toBe(true);
    expect(state.chain.state).toBe('pending');
  });

  it('uses activity time for waiting and withdraws the warning on progress', () => {
    const chain = beginBootRequest('chain', 'chain-json', 100);
    reportBootRequestResponse('chain', chain, 200, null);
    expect(bootPresentation(getBootSequence(), 8_199).state).toBe('receiving');
    expect(bootPresentation(getBootSequence(), 8_200).state).toBe('waiting');
    expect(bootPresentation(getBootSequence(), 30_200).showReload).toBe(true);
    reportBootRequestProgress('chain', chain, 30_201, 1);
    expect(bootPresentation(getBootSequence(), 30_202).state).toBe('receiving');
  });

  it('names chain-only waiting after cells complete', () => {
    const chain = beginBootRequest('chain', 'chain-json', 0);
    const cells = beginBootRequest('cells', 'cells-binary', 0);
    reportBootRequestResponse('cells', cells, 1, 4);
    reportBootRequestProgress('cells', cells, 2, 4);
    completeBootRequest('cells', cells, 3);
    expect(bootPresentation(getBootSequence(), 4).heading).toContain('WAITING FOR NETWORK');
    completeBootRequest('chain', chain, 5);
    markBootViewPreparing(6);
    expect(bootPresentation(getBootSequence(), 6).heading).toBe('PREPARING THE VIEW');
  });

  it('keeps the two request meshes independent and leaves the center open until presentation', () => {
    const chain = beginBootRequest('chain', 'chain-json', 0);
    const cells = beginBootRequest('cells', 'cells-binary', 0);
    reportBootRequestResponse('chain', chain, 1, 200);
    reportBootRequestProgress('chain', chain, 2, 50);
    reportBootRequestResponse('cells', cells, 1, 100);
    reportBootRequestProgress('cells', cells, 2, 100);
    completeBootRequest('cells', cells, 3);
    const state = bootPresentation(getBootSequence(), 3);
    expect(state.cells).toMatchObject({ state: 'done', progress: 1, indeterminate: false });
    expect(state.chain).toMatchObject({ state: 'active', progress: 0.25, indeterminate: false });

  });
});

describe('startup shell lifecycle', () => {
  it('survives React mounting and is removed once after an actual presentation signal', () => {
    vi.useFakeTimers();
    installMarkup();
    const cleanup = vi.fn();
    window.__cknervBootCleanup = cleanup;
    const stop = installBootShellReadout(() => 0);
    const shell = document.getElementById(BOOT_SHELL_ID)!;
    shell.insertAdjacentHTML('beforeend', '<svg><g data-boot-mesh="cells"></g><g data-boot-mesh="chain"></g></svg>');
    document.getElementById('root')!.replaceChildren(document.createElement('canvas'));
    expect(document.getElementById(BOOT_SHELL_ID)).not.toBeNull();
    expect(shell.dataset.center).toBe('open');
    markBootViewPresented('populated');
    expect(shell.dataset.center).toBe('lit');
    expect(document.getElementById(BOOT_SHELL_ID)?.dataset.state).toBe('leaving');
    markBootViewPresented('populated');
    vi.advanceTimersByTime(600);
    expect(document.getElementById(BOOT_SHELL_ID)).toBeNull();
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
    stop();
  });

  it('does not rewrite the live region on timer-only paints', () => {
    vi.useFakeTimers();
    installMarkup();
    installBootShellReadout(() => 0);
    const heading = document.getElementById(BOOT_SHELL_PHASE_ID)!;
    const observer = new MutationObserver(() => undefined);
    observer.observe(heading, { childList: true, characterData: true, subtree: true });
    vi.advanceTimersByTime(1_500);
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });

  it('keeps attempt diagnostics out of the changing live status', () => {
    installMarkup();
    installBootShellReadout(() => 1);
    beginBootRequest('cells', 'cells-json', 1);
    expect(document.getElementById(BOOT_SHELL_PHASE_ID)?.textContent).toBe('WAITING FOR CELLS');
    expect(document.getElementById('cknerv-startup-diagnostics')?.textContent)
      .toContain('CELLS #1 CELLS-JSON REQUESTING');
  });

  it('removes immediately with reduced motion', () => {
    vi.mocked(matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    installMarkup();
    installBootShellReadout(() => 0);
    markBootViewPresented('empty');
    expect(document.getElementById(BOOT_SHELL_ID)).toBeNull();
  });

  it('charges the first unfinished diagnostic phase without overwriting an earlier fault', () => {
    completeBootPhase('instrument');
    beginBootPhase('snapshot');
    expect(chargeBootFault('cells snapshot: 503')).toBe('snapshot');
    expect(getBootSequence().phases.find((phase) => phase.id === 'snapshot'))
      .toMatchObject({ state: 'failed', detail: 'cells snapshot: 503' });
    failBootPhase('snapshot', 'second description');
    expect(getBootSequence().phases.find((phase) => phase.id === 'snapshot')?.detail)
      .toBe('cells snapshot: 503');
  });

  it('passes fault text to the static shell and reports when it is unavailable', () => {
    expect(showBootShellFault('anything')).toBe(false);
    const fault = vi.fn(() => true);
    window.__cknervBootFault = fault;
    expect(showBootShellFault('cells snapshot: 503')).toBe(true);
    expect(fault).toHaveBeenCalledWith('cells snapshot: 503');
  });

  it('uses text-only inline failure UI and removes every early global on cleanup', () => {
    vi.useFakeTimers();
    const parsed = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
    document.body.innerHTML = parsed.body.innerHTML;
    const script = /<script>([\s\S]*?)<\/script>/.exec(INDEX_HTML)?.[1] ?? '';
    // eslint-disable-next-line no-new-func
    new Function(script)();
    expect(showBootShellFault('<b>broken</b>')).toBe(true);
    expect(document.getElementById(BOOT_SHELL_PHASE_ID)?.getAttribute('role')).toBe('alert');
    expect(document.getElementById(BOOT_SHELL_DETAIL_ID)?.textContent).toBe('<b>broken</b>');
    expect(document.querySelector('#cknerv-startup-detail b')).toBeNull();
    window.__cknervBootCleanup?.();
    expect(window.__cknervBootTakeover).toBeUndefined();
    expect(window.__cknervBootFault).toBeUndefined();
    expect(window.__cknervBootCleanup).toBeUndefined();
  });
});
