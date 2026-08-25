import { describe, expect, it } from 'vitest';
import type {
  BootPhaseId,
  BootPhaseSnapshot,
  BootPhaseState,
  BootSequenceSnapshot,
} from '../../../src/boot/bootSequence';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';
import { TOP_BAND_GLYPH } from '../../../src/components/hud/TopBand';
import {
  BOOT_PHASE_LABELS,
  BOOT_SEQUENCE_TITLE,
  bootPhaseColor,
  bootPhaseDetail,
  bootPhaseLine,
  bootSequenceAccent,
  denseBootPhase,
  formatBootSnapshotDetail,
} from '../../../src/components/hud/bootSequencePresentation';

const ALL_PHASES: BootPhaseId[] = [
  'instrument',
  'snapshot',
  'decode',
  'gl',
  'first_light',
  'fabric',
  'data_plane',
  'seeding',
];

function sequence(phases: BootPhaseSnapshot[]): BootSequenceSnapshot {
  const complete = phases.every((phase) => phase.state === 'done');
  return { active: !complete, complete, phases };
}

function snapshotPhase(
  receivedBytes: number,
  totalBytes: number | null,
): BootPhaseSnapshot {
  return { id: 'snapshot', state: 'active', receivedBytes, totalBytes };
}

describe('boot phase labels', () => {
  it('names every phase the record can publish', () => {
    // The record's own ids are the inventory: a phase added to the store with
    // no label here renders as `undefined` on the band, silently.
    expect(Object.keys(BOOT_PHASE_LABELS).sort()).toEqual([...ALL_PHASES].sort());
    for (const id of ALL_PHASES) {
      expect(BOOT_PHASE_LABELS[id]).toMatch(/^[A-Z][A-Z ]*$/);
    }
    expect(BOOT_PHASE_LABELS.first_light).toBe('FIRST LIGHT');
    expect(BOOT_PHASE_LABELS.data_plane).toBe('DATA PLANE');
  });

  it('keeps the title and mark the static shell already ships', () => {
    // `ui-app/index.html` writes these two literally, because markup cannot
    // import. The handover is only seamless while they agree.
    expect(BOOT_SEQUENCE_TITLE).toBe('STAGE POWER-ON');
    // The mark belongs to the band all three tenants wear, not to this
    // chapter of it — the shell's literal has to match THAT.
    expect(TOP_BAND_GLYPH).toBe('◇');
  });
});

describe('boot phase colour', () => {
  it.each<[BootPhaseState, string]>([
    ['pending', HUD_COLORS.dim],
    ['active', HUD_COLORS.cyanWire],
    ['done', HUD_COLORS.nominal],
    ['failed', HUD_COLORS.danger],
  ])('paints a %s line in its own token', (state, color) => {
    expect(bootPhaseColor(state)).toBe(color);
  });

  it('spends four distinct tokens on four distinct states', () => {
    const states: BootPhaseState[] = ['pending', 'active', 'done', 'failed'];
    expect(new Set(states.map(bootPhaseColor)).size).toBe(4);
  });
});

describe('streamed snapshot detail', () => {
  it('is a percentage when the response declared its length', () => {
    expect(formatBootSnapshotDetail(0, 1000)).toBe('0%');
    expect(formatBootSnapshotDetail(620, 1000)).toBe('62%');
    // Floored, not rounded: 99.6% of a download is not a download that arrived.
    expect(formatBootSnapshotDetail(996, 1000)).toBe('99%');
    // …and clamped both ways, because a body longer than its own header still
    // reads as arrived rather than as 120%.
    expect(formatBootSnapshotDetail(1200, 1000)).toBe('100%');
    expect(formatBootSnapshotDetail(-40, 1000)).toBe('0%');
  });

  it('falls back to measured size when there is no denominator', () => {
    expect(formatBootSnapshotDetail(3_240_000, null)).toBe('3.2 MB');
    expect(formatBootSnapshotDetail(512, 0)).toBe('0.0 MB');
    expect(formatBootSnapshotDetail(4_600_000, undefined)).toBe('4.6 MB');
    // Nothing measured yet is nothing to say — never a synthesized "0%".
    expect(formatBootSnapshotDetail(0, null)).toBe('');
    expect(formatBootSnapshotDetail(undefined, undefined)).toBe('');
  });
});

describe('boot phase detail', () => {
  it('measures only the two phases that were measured', () => {
    expect(bootPhaseDetail(snapshotPhase(620, 1000))).toBe('62%');
    expect(bootPhaseDetail({
      id: 'seeding',
      state: 'active',
      seedingDone: 1234,
      seedingTotal: 65_829,
    })).toBe('1,234 / 65,829');
    expect(bootPhaseDetail({ id: 'decode', state: 'active' })).toBe('');
    expect(bootPhaseDetail({ id: 'gl', state: 'done' })).toBe('');
  });

  it('drops the numbers once a phase finishes — the tick is the reading', () => {
    expect(bootPhaseDetail({
      id: 'snapshot',
      state: 'done',
      receivedBytes: 1000,
      totalBytes: 1000,
    })).toBe('');
  });

  it('hands a failed phase its reason instead', () => {
    expect(bootPhaseDetail({
      id: 'gl',
      state: 'failed',
      detail: 'no webgl context',
    })).toBe('no webgl context');
    // A fault with no reason attached still fails; it just says less.
    expect(bootPhaseDetail({ id: 'gl', state: 'failed' })).toBe('');
  });
});

describe('boot phase line', () => {
  it('reads label then measurement', () => {
    expect(bootPhaseLine(snapshotPhase(620, 1000))).toEqual({
      id: 'snapshot',
      state: 'active',
      color: HUD_COLORS.cyanWire,
      text: 'SNAPSHOT 62%',
    });
    expect(bootPhaseLine({ id: 'decode', state: 'pending' }).text).toBe('DECODE');
  });

  it('spells a fault out in words, not only in red', () => {
    const line = bootPhaseLine({
      id: 'gl',
      state: 'failed',
      detail: 'context lost',
    });
    expect(line.text).toBe('GL FAULT — context lost');
    expect(line.color).toBe(HUD_COLORS.danger);
    expect(bootPhaseLine({ id: 'gl', state: 'failed' }).text).toBe('GL FAULT');
  });
});

describe('the band accent', () => {
  it('is chrome cyan while the instrument comes up', () => {
    expect(bootSequenceAccent(sequence([
      { id: 'instrument', state: 'done' },
      { id: 'snapshot', state: 'active' },
    ]))).toBe(HUD_COLORS.cyanWire);
  });

  it('turns the whole band over to the fault, wherever the fault is', () => {
    expect(bootSequenceAccent(sequence([
      { id: 'instrument', state: 'done' },
      { id: 'snapshot', state: 'done' },
      { id: 'gl', state: 'failed', detail: 'context lost' },
      { id: 'fabric', state: 'pending' },
    ]))).toBe(HUD_COLORS.danger);
  });
});

describe('the dense line', () => {
  it('is the leftmost line still to finish', () => {
    expect(denseBootPhase(sequence([
      { id: 'instrument', state: 'done' },
      { id: 'snapshot', state: 'done' },
      { id: 'decode', state: 'active' },
      { id: 'gl', state: 'pending' },
    ]))?.id).toBe('decode');
  });

  it('is the fault as soon as there is one, even out of order', () => {
    // `snapshot` is running and `gl` already died — the phases are independent
    // observers and real boots overlap, so "leftmost" must not outrank a fault.
    expect(denseBootPhase(sequence([
      { id: 'instrument', state: 'done' },
      { id: 'snapshot', state: 'active' },
      { id: 'gl', state: 'failed', detail: 'context lost' },
    ]))?.id).toBe('gl');
  });

  it('names the line the run ended on once every line is done', () => {
    // The linger, at narrow widths. `HudOverlay` holds the CLOSED sequence in
    // the slot for 700ms because the whole trail lit is the only frame in which
    // a visitor can read what happened while they waited — and this selector
    // used to answer "nothing" for exactly that frame, so every viewport at or
    // under 1280px was handed a band with no lines in it. The last line is what
    // the wide trail is saying too, in the only words a dense band has room for.
    expect(denseBootPhase(sequence([
      { id: 'instrument', state: 'done' },
      { id: 'snapshot', state: 'done' },
      { id: 'data_plane', state: 'done' },
    ]))?.id).toBe('data_plane');
  });

  it('still lets a fault outrank the line the run ended on', () => {
    // A record carrying a fault never completes, so this is not the linger —
    // it is a dead boot holding the slot for the session, and the fault is the
    // whole reason the band is still there. Ordering matters: the fault is not
    // last, and must win anyway.
    expect(denseBootPhase(sequence([
      { id: 'instrument', state: 'done' },
      { id: 'gl', state: 'failed', detail: 'context lost' },
      { id: 'data_plane', state: 'done' },
    ]))?.id).toBe('gl');
  });

  it('has nothing to name when the record carries no lines at all', () => {
    expect(denseBootPhase(sequence([]))).toBeNull();
  });
});
