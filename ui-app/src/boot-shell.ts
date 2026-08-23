// The pre-React face of the boot record.
//
// `index.html` ships the readout band as static markup because the longest
// wait of the whole boot happens before any bundle has run; this module is the
// only thing that writes into it, from module load until React replaces
// `#root` and the HUD banner takes the slot. One phase at a time is enough
// here — the full phase trail belongs to the banner, and nothing before React
// runs more than one phase at once.
//
// It lives apart from `main.tsx` (which boots the app as a side effect of
// being imported) so that the presentation below can be tested directly.

import {
  formatBootSnapshotDetail,
  getBootSequence,
  subscribeBootSequence,
  type BootPhaseId,
  type BootPhaseSnapshot,
  type BootSequenceSnapshot,
} from '@cknerv/ui';

/** The pact with `index.html`: these ids must exist in that file, which
 *  `boot-shell.contract.test.ts` checks against the markup itself. */
export const BOOT_SHELL_PHASE_ID = 'cknerv-boot-shell-phase';
export const BOOT_SHELL_DETAIL_ID = 'cknerv-boot-shell-detail';

/** HUD_COLORS.danger. The shell owns its own colours (see index.html); this
 *  is the one thing JS repaints, because a fault may not read as chrome. */
const FAULT_COLOR = '#FF3030';

const PHASE_LABELS: Record<BootPhaseId, string> = {
  instrument: 'INSTRUMENT',
  snapshot: 'SNAPSHOT',
  decode: 'DECODE',
  gl: 'GL',
  first_light: 'FIRST LIGHT',
  fabric: 'FABRIC',
  data_plane: 'DATA PLANE',
  seeding: 'SEEDING',
};

export interface BootShellReadout {
  label: string;
  detail: string;
  failed: boolean;
}

/**
 * The one line the shell has room for.
 *
 * A fault outranks everything: the record keeps the failed phase terminal and
 * the sequence permanently incomplete, and carrying that is the readout's
 * whole job. Otherwise the running phase, and between two phases the last one
 * that finished — a gap of a few milliseconds is not worth going blank for.
 */
export function activeBootShellPhase(
  sequence: BootSequenceSnapshot,
): BootPhaseSnapshot | null {
  const failed = sequence.phases.find((phase) => phase.state === 'failed');
  if (failed) return failed;
  const active = sequence.phases.find((phase) => phase.state === 'active');
  if (active) return active;
  let last: BootPhaseSnapshot | null = null;
  for (const phase of sequence.phases) if (phase.state === 'done') last = phase;
  return last;
}

export function bootShellReadout(
  sequence: BootSequenceSnapshot,
): BootShellReadout {
  const phase = activeBootShellPhase(sequence);
  if (!phase) return { label: '', detail: '', failed: false };
  const label = PHASE_LABELS[phase.id];
  if (phase.state === 'failed') {
    return { label: `${label} FAULT`, detail: phase.detail ?? '', failed: true };
  }
  return {
    label,
    // Streamed bytes, formatted by the same function the HUD banner uses: the
    // shell hands this band over to that banner mid-download on a slow
    // connection, and the number may not change shape as it crosses.
    detail: phase.id === 'snapshot'
      ? formatBootSnapshotDetail(phase.receivedBytes, phase.totalBytes)
      : '',
    failed: false,
  };
}

/**
 * Point the static shell at the boot record until React takes `#root`.
 *
 * The shell vanishing IS the handover signal — `root.render` replaces the
 * children of `#root` in one go — so the subscription ends the first time the
 * nodes are gone rather than being cancelled by whoever mounted the tree.
 * Returns the disposer for tests; the entry point has nothing to dispose.
 */
export function installBootShellReadout(): () => void {
  if (typeof document === 'undefined') return () => {};
  let unsubscribe: (() => void) | null = null;
  const stop = (): void => {
    unsubscribe?.();
    unsubscribe = null;
  };
  const paint = (): void => {
    const phaseNode = document.getElementById(BOOT_SHELL_PHASE_ID);
    const detailNode = document.getElementById(BOOT_SHELL_DETAIL_ID);
    if (!phaseNode || !detailNode) {
      stop();
      return;
    }
    const readout = bootShellReadout(getBootSequence());
    phaseNode.textContent = readout.label;
    detailNode.textContent = readout.detail;
    if (readout.failed) phaseNode.style.color = FAULT_COLOR;
  };
  unsubscribe = subscribeBootSequence(paint);
  paint();
  return stop;
}
