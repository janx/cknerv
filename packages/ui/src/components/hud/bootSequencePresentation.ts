import type {
  BootPhaseId,
  BootPhaseSnapshot,
  BootPhaseState,
  BootSequenceSnapshot,
} from '../../boot/bootSequence';
import { HUD_COLORS } from './hudTheme';

/**
 * One visual vocabulary for the boot readout, in both of the places it is
 * drawn: this package's banner, and the static shell `ui-app/index.html` ships
 * so the pre-React window is not three seconds of black.
 *
 * The phases come from observation — `bootSequence.ts` records states, reads no
 * clock and knows no colours — and this helper only assigns presentation
 * semantics, exactly the way `replayPresentation` sits beside the replay HUDs.
 */

/** Adjudicated copy. `FIRST LIGHT` names the moment the galaxy is actually on
 *  screen, which is the thing a visitor is waiting for and had no word for. */
export const BOOT_SEQUENCE_TITLE = 'STAGE POWER-ON';

/** The house mark for a banner reporting on something still in progress: the
 *  static shell opens with it and so does `BackfillBar`. */
export const BOOT_SEQUENCE_GLYPH = '◇';

export const BOOT_PHASE_LABELS: Record<BootPhaseId, string> = {
  instrument: 'INSTRUMENT',
  snapshot: 'SNAPSHOT',
  decode: 'DECODE',
  gl: 'GL',
  first_light: 'FIRST LIGHT',
  fabric: 'FABRIC',
  data_plane: 'DATA PLANE',
  seeding: 'SEEDING',
};

/** Four states, four colours, and the ramp is the whole readout: a line still
 *  waiting is grey furniture, the one running takes the instrument's own cyan,
 *  a finished one ticks over to the nominal green every other panel uses for
 *  "well", and a fault is the only red the band can ever show. */
const PHASE_COLORS: Record<BootPhaseState, string> = {
  pending: HUD_COLORS.dim,
  active: HUD_COLORS.cyanWire,
  done: HUD_COLORS.nominal,
  failed: HUD_COLORS.danger,
};

export function bootPhaseColor(state: BootPhaseState): string {
  return PHASE_COLORS[state];
}

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * Streamed snapshot bytes, and only ever what was measured: a percentage when
 * the response declared a length, the raw size when it did not, and nothing at
 * all before the first chunk — never a synthesized denominator.
 *
 * FLOOR rather than round, on purpose: a download may not read 100% until the
 * last byte is in.
 *
 * Exported because the pre-React shell (`ui-app/src/boot-shell.ts`) prints the
 * same number into the same band a few hundred milliseconds earlier. Two copies
 * of this arithmetic would eventually disagree, and they would disagree exactly
 * across the handover, where a reader is watching one number the whole time.
 */
export function formatBootSnapshotDetail(
  receivedBytes: number | undefined,
  totalBytes: number | null | undefined,
): string {
  const received = receivedBytes ?? 0;
  const total = totalBytes ?? null;
  if (total !== null && total > 0) {
    const percent = Math.floor((received / total) * 100);
    return `${Math.min(100, Math.max(0, percent))}%`;
  }
  if (received <= 0) return '';
  return `${(received / 1_000_000).toFixed(1)} MB`;
}

/**
 * The number a line carries, when it carries one. Only two phases are measured
 * — the streamed snapshot and the server's replay — everything else is a tick,
 * because a tick is all that was observed. A failed line drops its measurement
 * for the reason it failed: at that point the reason is the reading.
 */
export function bootPhaseDetail(phase: BootPhaseSnapshot): string {
  if (phase.state === 'failed') return phase.detail ?? '';
  if (phase.state !== 'active') return '';
  if (phase.id === 'snapshot') {
    return formatBootSnapshotDetail(phase.receivedBytes, phase.totalBytes);
  }
  if (phase.id === 'seeding') {
    return `${fmt(phase.seedingDone ?? 0)} / ${fmt(phase.seedingTotal ?? 0)}`;
  }
  return '';
}

export interface BootPhaseLine {
  id: BootPhaseId;
  state: BootPhaseState;
  color: string;
  /** The line as one string: `DECODE`, `SNAPSHOT 62%`, `GL FAULT — no context`.
   *  A fault says the word out loud rather than relying on the red alone —
   *  the band is 30px of small mono type and colour is not a caption. */
  text: string;
}

export function bootPhaseLine(phase: BootPhaseSnapshot): BootPhaseLine {
  const label = BOOT_PHASE_LABELS[phase.id];
  const detail = bootPhaseDetail(phase);
  const head = phase.state === 'failed' ? `${label} FAULT` : label;
  const separator = phase.state === 'failed' ? ' — ' : ' ';
  return {
    id: phase.id,
    state: phase.state,
    color: bootPhaseColor(phase.state),
    text: detail ? `${head}${separator}${detail}` : head,
  };
}

/**
 * The band's own accent. Chrome cyan while the instrument comes up, and the
 * fault red the moment ANY line reports one — the band has to change colour as
 * a whole, because on a narrow viewport the failed line may be the only one
 * shown, and on a wide one it is one word in eight.
 */
export function bootSequenceAccent(sequence: BootSequenceSnapshot): string {
  return sequence.phases.some((phase) => phase.state === 'failed')
    ? HUD_COLORS.danger
    : HUD_COLORS.cyanWire;
}

/**
 * The one line a narrow top bar has room for: the fault if there is one,
 * otherwise the leftmost line that has not finished. The trail does not fit on
 * a phone and half a trail is worse than none — it reads as the whole sequence
 * and quietly omits the part that is still working.
 */
export function denseBootPhase(
  sequence: BootSequenceSnapshot,
): BootPhaseSnapshot | null {
  const failed = sequence.phases.find((phase) => phase.state === 'failed');
  if (failed) return failed;
  return sequence.phases.find((phase) => phase.state !== 'done') ?? null;
}
