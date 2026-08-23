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
  installBootShellReadout,
  BOOT_SHELL_DETAIL_ID,
  BOOT_SHELL_PHASE_ID,
} from '../src/boot-shell';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

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
