import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginBootPhase,
  completeBootPhase,
  failBootPhase,
  getBootSequence,
  reportBootSnapshotProgress,
  resetBootSequenceForTest,
  type BootSequenceSnapshot,
} from '@cknerv/ui';
import {
  activeBootShellPhase,
  bootShellReadout,
  chargeBootFault,
  installBootShellReadout,
  showBootShellFault,
  BOOT_SHELL_DETAIL_ID,
  BOOT_SHELL_PHASE_ID,
} from '../src/boot-shell';

import { BOOT_FACES, bootFaceTags } from '../vite-boot-faces';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
/** The two files index.html restates a value from. It cannot import, so the
 *  pact is a test that reads both sides off disk — the same bargain the stage
 *  ground already makes in `App.sceneRoots.test.tsx`. */
const HUD_THEME = readFileSync(
  resolve(process.cwd(), '../packages/ui/src/components/hud/hudTheme.ts'), 'utf8',
);
const STATUS_STRIP = readFileSync(
  resolve(process.cwd(), '../packages/ui/src/components/hud/StatusStrip.tsx'), 'utf8',
);
const HUD_OVERLAY = readFileSync(
  resolve(process.cwd(), '../packages/ui/src/components/hud/HudOverlay.tsx'), 'utf8',
);
/** A font stack normalised for comparison: `index.html` writes them without
 *  spaces after the commas, `hudTheme.ts` writes them with, and the DOM hands
 *  back whichever quote it prefers. */
const stack = (value: string) => value.replace(/\s+/g, '').replace(/"/g, "'");

function sequence(
  phases: BootSequenceSnapshot['phases'],
): BootSequenceSnapshot {
  return { active: true, complete: false, phases };
}

describe('boot shell / index.html pact', () => {
  // The shell is markup in one file and writes in another; nothing else keeps
  // the pair honest, so the ids are asserted against the real document.
  const shipped = new DOMParser().parseFromString(INDEX_HTML, 'text/html');

  it('ships every node the updater writes into', () => {
    expect(shipped.getElementById(BOOT_SHELL_PHASE_ID)).not.toBeNull();
    expect(shipped.getElementById(BOOT_SHELL_DETAIL_ID)).not.toBeNull();
  });

  it('keeps the shell inside #root so root.render disposes of it', () => {
    const root = shipped.getElementById('root');
    expect(root?.contains(shipped.getElementById(BOOT_SHELL_PHASE_ID))).toBe(true);
  });

  it('reads correctly with no script at all', () => {
    // A visitor whose bundle never arrives is looking at the truth: the page
    // got as far as the instrument and no further.
    expect(shipped.getElementById(BOOT_SHELL_PHASE_ID)?.textContent).toBe('INSTRUMENT');
    expect(shipped.getElementById(BOOT_SHELL_DETAIL_ID)?.textContent).toBe('');
    expect(shipped.getElementById('cknerv-boot-shell')?.textContent).toContain(
      'STAGE POWER-ON',
    );
  });
});

describe('the shell is the band, one second early', () => {
  // The page's first second set ONE WORD in three typefaces (report E, E-2):
  // this markup in the OS monospace, the first HUD commit in `system-ui`
  // because `injectHudTheme` runs in an effect, and the third frame in Saira
  // once seven hashed woff2 had been fetched — with nothing preloading them,
  // so the fetch could not even start during the one to five seconds the
  // snapshot takes. The shell says the band's faces now, and the build puts
  // them in the head.
  const shipped = new DOMParser().parseFromString(INDEX_HTML, 'text/html');

  it('sets the band\'s words in the band\'s faces', () => {
    const shell = shipped.getElementById('cknerv-boot-shell') as HTMLElement;
    const title = shell.querySelector('span[style*="font-weight:700"]') as HTMLElement;
    const diamond = shell.querySelector('span[aria-hidden="true"]') as HTMLElement;

    const mono = /mono: "([^"]+)"/.exec(HUD_THEME)?.[1] ?? '';
    const display = /display: "([^"]+)"/.exec(HUD_THEME)?.[1] ?? '';
    expect(mono, 'HUD_FONTS.mono moved').toContain('Share Tech Mono');
    expect(display, 'HUD_FONTS.display moved').toContain('Saira');

    // The trail and the phase lines inherit the band's own stack; the title
    // and the ◇ name theirs.
    expect(stack(shell.style.fontFamily)).toBe(stack(mono));
    expect(stack(title.style.fontFamily)).toBe(stack(display));
    expect(stack(diamond.style.fontFamily)).toContain(stack("'JetBrains Mono Local'"));
  });

  it('stands where the strip will, at every width the strip has', () => {
    // 36 / 64 / 59 and the two breakpoints all live in packages/ui. The shell
    // hard-coded 36, so every viewport at or under 1,280 px watched the band
    // drop 28 px at the handover.
    const heights = /STATUS_STRIP_HEIGHTS = \{([\s\S]*?)\}/.exec(STATUS_STRIP)?.[1] ?? '';
    const rung = (name: string) => Number(new RegExp(`${name}: (\\d+)`).exec(heights)?.[1]);
    expect([rung('wide'), rung('compact'), rung('mobile')]).toEqual([36, 64, 59]);

    const shell = shipped.getElementById('cknerv-boot-shell') as HTMLElement;
    expect(shell.style.top).toBe(`${rung('wide')}px`);
    const script = /<script>([\s\S]*?)<\/script>/.exec(INDEX_HTML)?.[1] ?? '';
    expect(script, 'the shell no longer sizes itself').toContain('cknerv-boot-shell');
    expect(script).toContain(`'${rung('compact')}px'`);
    expect(script).toContain(`'${rung('mobile')}px'`);

    // …and at the widths the HUD itself changes at.
    expect(HUD_OVERLAY).toContain("useMediaQuery('(max-width: 1280px)')");
    expect(HUD_OVERLAY).toContain("useMediaQuery('(max-width: 560px)')");
    expect(script).toContain("matchMedia('(max-width: 1280px)')");
    expect(script).toContain("matchMedia('(max-width: 560px)')");
  });

  it('puts the boot faces in the head, preloaded, and nothing else', () => {
    // Three faces and three preloads. A preload for a face the first paint
    // does not use is a request competing with the snapshot for the same
    // connection, which is the opposite of the fix.
    const tags = bootFaceTags(BOOT_FACES.map((face) => `/assets/${face.file}`));
    const preloads = tags.filter((tag) => tag.tag === 'link');
    expect(preloads).toHaveLength(BOOT_FACES.length);
    for (const preload of preloads) {
      expect(preload.attrs).toMatchObject({ rel: 'preload', as: 'font', type: 'font/woff2' });
      expect(preload.attrs).toHaveProperty('crossorigin');
      // Appended, so `<meta charset>` keeps the first 1,024 bytes.
      expect(preload.injectTo).toBe('head');
    }

    const style = tags.find((tag) => tag.tag === 'style');
    const css = String(style?.children ?? '');
    for (const face of BOOT_FACES) {
      expect(css).toContain(`font-family:'${face.family}'`);
      expect(css).toContain(`url("/assets/${face.file}")`);
      // The theme registers the same family at the same weight. Two faces for
      // one family under two weight descriptors is a face the browser has to
      // choose between.
      expect(HUD_THEME, `${face.family} is not the theme's face any more`)
        .toContain(`@font-face{font-family:'${face.family}';font-weight:${face.weight};`);
    }
    // …and the shell's own display value, which is the whole argument: a face
    // arriving after a one-second line has been read is a flicker, not a fix.
    expect(css.match(/font-display:optional/g)).toHaveLength(BOOT_FACES.length);
    expect(HUD_THEME, 'the HUD stopped swapping').toContain('font-display:swap');
  });

  it('names only faces the theme actually ships', () => {
    for (const face of BOOT_FACES) {
      expect(HUD_THEME, `${face.file} is no longer imported by the theme`)
        .toContain(face.file.replace('.woff2', ''));
    }
  });
});

describe('bootShellReadout', () => {
  it('shows the running phase', () => {
    const readout = bootShellReadout(sequence([
      { id: 'instrument', state: 'done' },
      { id: 'snapshot', state: 'active' },
      { id: 'decode', state: 'pending' },
    ]));
    expect(readout).toEqual({ label: 'SNAPSHOT', detail: '', failed: false });
  });

  it('holds the last finished phase across a gap', () => {
    const readout = bootShellReadout(sequence([
      { id: 'instrument', state: 'done' },
      { id: 'snapshot', state: 'done' },
      { id: 'decode', state: 'pending' },
    ]));
    expect(readout.label).toBe('SNAPSHOT');
  });

  it('carries a fault ahead of anything else on the line', () => {
    const readout = bootShellReadout(sequence([
      { id: 'instrument', state: 'done' },
      { id: 'snapshot', state: 'failed', detail: 'cells snapshot: 503' },
      { id: 'decode', state: 'pending' },
    ]));
    expect(readout).toEqual({
      label: 'SNAPSHOT FAULT',
      detail: 'cells snapshot: 503',
      failed: true,
    });
  });

  it('names every phase the record can hold', () => {
    const labels = (['gl', 'first_light', 'fabric', 'data_plane', 'seeding'] as const)
      .map((id) => bootShellReadout(sequence([{ id, state: 'active' }])).label);
    expect(labels).toEqual(['GL', 'FIRST LIGHT', 'FABRIC', 'DATA PLANE', 'SEEDING']);
  });

  it('is blank before anything has happened', () => {
    expect(bootShellReadout(sequence([{ id: 'snapshot', state: 'pending' }])))
      .toEqual({ label: '', detail: '', failed: false });
    expect(activeBootShellPhase(sequence([]))).toBeNull();
  });
});

describe('bootShellReadout snapshot detail', () => {
  function detailFor(receivedBytes: number, totalBytes: number | null): string {
    return bootShellReadout(sequence([
      { id: 'snapshot', state: 'active', receivedBytes, totalBytes },
    ])).detail;
  }

  it('is a percentage when the response declared its length', () => {
    expect(detailFor(0, 1000)).toBe('0%');
    expect(detailFor(620, 1000)).toBe('62%');
    // Never over 100: a body longer than its header still reads as arrived.
    expect(detailFor(1200, 1000)).toBe('100%');
  });

  it('falls back to measured size when the length is unknown', () => {
    expect(detailFor(3_240_000, null)).toBe('3.2 MB');
    // No denominator and no bytes yet is nothing to say — not "0 %".
    expect(detailFor(0, null)).toBe('');
    // A zero length is not a denominator either.
    expect(detailFor(512, 0)).toBe('0.0 MB');
  });

  it('belongs to the download alone', () => {
    expect(bootShellReadout(sequence([
      { id: 'decode', state: 'active', receivedBytes: 500, totalBytes: 1000 },
    ])).detail).toBe('');
  });
});

describe('installBootShellReadout', () => {
  beforeEach(() => {
    resetBootSequenceForTest();
    document.body.innerHTML = `
      <div id="root">
        <div id="cknerv-boot-shell">
          <span id="${BOOT_SHELL_PHASE_ID}">INSTRUMENT</span>
          <span id="${BOOT_SHELL_DETAIL_ID}"></span>
        </div>
      </div>`;
  });

  const phaseNode = () => document.getElementById(BOOT_SHELL_PHASE_ID)!;
  const detailNode = () => document.getElementById(BOOT_SHELL_DETAIL_ID)!;

  it('follows the record until React takes #root', () => {
    const stop = installBootShellReadout();
    completeBootPhase('instrument');
    reportBootSnapshotProgress(500, 1000);
    expect(phaseNode().textContent).toBe('SNAPSHOT');
    expect(detailNode().textContent).toBe('50%');

    completeBootPhase('snapshot');
    beginBootPhase('decode');
    expect(phaseNode().textContent).toBe('DECODE');
    expect(detailNode().textContent).toBe('');

    // React mounting replaces the children of #root in one go; the shell
    // disappearing is the whole handover protocol.
    document.getElementById('root')!.replaceChildren();
    completeBootPhase('decode');
    expect(document.getElementById(BOOT_SHELL_PHASE_ID)).toBeNull();
    stop();
  });

  it('stops writing once the shell is gone', () => {
    installBootShellReadout();
    document.getElementById('root')!.replaceChildren();
    // The first notify after the handover unsubscribes; a later one must not
    // resurrect anything into a document React now owns.
    completeBootPhase('instrument');
    document.body.innerHTML = `<span id="${BOOT_SHELL_PHASE_ID}">BANNER</span>`;
    reportBootSnapshotProgress(1, 2);
    expect(phaseNode().textContent).toBe('BANNER');
  });

  it('paints a fault in danger', () => {
    const stop = installBootShellReadout();
    failBootPhase('snapshot', 'cells snapshot: 503');
    expect(phaseNode().textContent).toBe('SNAPSHOT FAULT');
    expect(detailNode().textContent).toBe('cells snapshot: 503');
    expect(phaseNode().style.color).toBe('rgb(255, 48, 48)');
    expect(getBootSequence().complete).toBe(false);
    stop();
  });
});

// ——— A bootstrap failure keeps the shell and the band ————————————————————
//
// The `<pre>` in `#f88` that used to replace `#root` was the whole error UI
// (report E, E-7): a colour outside the palette, the browser's own monospace,
// and it deleted the designed band in the same tick the record had told that
// band which phase died. Two halves replace it — the record is charged, so the
// band says `SNAPSHOT FAULT — …`, and the shell's own script draws the full
// message under it.

describe('a bootstrap failure keeps the shell standing', () => {
  /** With its comments taken out: this file argues its decisions in prose, and
   *  the prose names the `<pre>` in `#f88` it replaced. A source oracle that
   *  read the argument as if it were the code would forbid the argument. */
  const MAIN = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  beforeEach(() => {
    resetBootSequenceForTest();
    delete (window as { __cknervBootFault?: unknown }).__cknervBootFault;
  });

  it('draws no error UI of its own', () => {
    // The three the ruling names, each as it was written. A revert that kept
    // one of them is a revert.
    for (const relic of ['<pre', "createElement('pre')", '#f88', 'replaceChildren']) {
      expect(MAIN, `the entry point still builds its own error UI: ${relic}`)
        .not.toContain(relic);
    }
    expect(MAIN).toContain('chargeBootFault(message)');
    expect(MAIN).toContain('showBootShellFault(message)');
  });

  it('charges the fault to the line the boot got to', () => {
    completeBootPhase('instrument');
    beginBootPhase('snapshot');
    expect(chargeBootFault('cells snapshot: 503')).toBe('snapshot');
    const failed = getBootSequence().phases.find((phase) => phase.state === 'failed');
    expect(failed?.id).toBe('snapshot');
    expect(failed?.detail).toBe('cells snapshot: 503');
    // …and the band the shell paints says so, which is the point of charging it.
    expect(bootShellReadout(getBootSequence())).toEqual({
      label: 'SNAPSHOT FAULT',
      detail: 'cells snapshot: 503',
      failed: true,
    });
  });

  it('charges a fault between phases to the next line, not the last done one', () => {
    // The chain snapshot and the lazy Lab import both throw with nothing
    // active; blaming the phase that SUCCEEDED would be the record lying.
    completeBootPhase('instrument');
    expect(chargeBootFault('Failed to fetch')).toBe('snapshot');
  });

  it('never re-describes a fault its own writer already reported', () => {
    completeBootPhase('instrument');
    beginBootPhase('snapshot');
    failBootPhase('snapshot', 'cells snapshot: 503');
    chargeBootFault('Error: cells snapshot: 503');
    const failed = getBootSequence().phases.find((phase) => phase.state === 'failed');
    expect(failed?.detail).toBe('cells snapshot: 503');
  });

  it('hands the whole message to the shell, and says when the shell has gone', () => {
    expect(showBootShellFault('anything'), 'a fault line with no shell to draw on')
      .toBe(false);
    const seen: string[] = [];
    window.__cknervBootFault = (text: string) => { seen.push(text); return true; };
    expect(showBootShellFault('cells snapshot: 503')).toBe(true);
    expect(seen).toEqual(['cells snapshot: 503']);
  });

  it('is the shell\'s own script that draws the line, in the shell\'s faces', () => {
    // The presentation lives in `index.html` for the same reason the markup
    // does: the shell's colours and stacks cannot be imported.
    const script = /<script>([\s\S]*?)<\/script>/.exec(INDEX_HTML)?.[1] ?? '';
    expect(script, 'the shell no longer draws a fault').toContain('__cknervBootFault');
    expect(script, 'the fault line is not in the palette\'s danger')
      .toContain(`color:#${/danger: '#(\w{6})'/.exec(HUD_THEME)?.[1]}`);
    expect(stack(script), 'the fault line is not in the band\'s face')
      .toContain(stack("'Share Tech Mono'"));
    // `textContent`, so a fault message cannot smuggle markup into the one
    // surface a broken page still renders.
    expect(script).toContain('line.textContent = text');
    expect(script, 'the fault line would draw over a HUD that already mounted')
      .toContain('shell.isConnected');
  });

  it('really draws it, on the document the shell ships', () => {
    document.documentElement.innerHTML = new DOMParser()
      .parseFromString(INDEX_HTML, 'text/html').documentElement.innerHTML;
    const script = /<script>([\s\S]*?)<\/script>/.exec(INDEX_HTML)?.[1] ?? '';
    // eslint-disable-next-line no-new-func
    new Function(script)();

    expect(showBootShellFault('cells snapshot: 503')).toBe(true);
    const line = document.getElementById('cknerv-boot-shell-fault');
    expect(line?.textContent).toBe('cells snapshot: 503');
    expect(line?.getAttribute('role')).toBe('alert');
    // The band it belongs to is still there — the whole ruling in one line.
    expect(document.getElementById('cknerv-boot-shell')).not.toBeNull();
    expect(document.getElementById(BOOT_SHELL_PHASE_ID)?.textContent).toBe('INSTRUMENT');

    // A second fault replaces the text rather than stacking a second line.
    showBootShellFault('and then this');
    expect(document.querySelectorAll('#cknerv-boot-shell-fault')).toHaveLength(1);
    expect(document.getElementById('cknerv-boot-shell-fault')?.textContent)
      .toBe('and then this');
  });
});
