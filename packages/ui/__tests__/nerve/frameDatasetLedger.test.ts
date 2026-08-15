import { describe, expect, it } from 'vitest';
import {
  frameDatasetBind,
  frameDatasetDelete,
  frameDatasetWrite,
  frameDatasetWriteNumber,
  frameDatasetWriteVector,
  frameLedgerMarkNumber,
  frameStyleWrite,
  frameStyleWriteNumber,
  makeFrameDatasetLedger,
  type FrameDatasetSink,
} from '../../src/nerve/frameDatasetLedger';

/** Counts what actually reached the element. */
function countingSink(): { sink: FrameDatasetSink; writes: () => number } {
  let writes = 0;
  const store: Record<string, string | undefined> = {};
  const sink = new Proxy(store, {
    set(target, key: string, value: string) {
      writes += 1;
      target[key] = value;
      return true;
    },
    deleteProperty(target, key: string) {
      writes += 1;
      delete target[key];
      return true;
    },
  }) as FrameDatasetSink;
  return { sink, writes: () => writes };
}

describe('frameDatasetLedger', () => {
  it('writes a state value once and stays silent while it holds', () => {
    const ledger = makeFrameDatasetLedger();
    const { sink, writes } = countingSink();
    expect(frameDatasetWrite(ledger, sink, 'memoryRouteHopMotion', 'moving'))
      .toBe(true);
    for (let frame = 0; frame < 60; frame += 1) {
      frameDatasetWrite(ledger, sink, 'memoryRouteHopMotion', 'moving');
    }
    expect(writes()).toBe(1);
    expect(sink.memoryRouteHopMotion).toBe('moving');
    expect(frameDatasetWrite(ledger, sink, 'memoryRouteHopMotion', 'settled'))
      .toBe(true);
    expect(writes()).toBe(2);
    expect(sink.memoryRouteHopMotion).toBe('settled');
  });

  it('publishes a swept progress value per quantum, at full precision', () => {
    const ledger = makeFrameDatasetLedger();
    const { sink, writes } = countingSink();
    // 600 frames of a 0 → 1 sweep: one write per 1e-2 step, not per frame.
    for (let frame = 0; frame <= 600; frame += 1) {
      frameDatasetWriteNumber(
        ledger,
        sink,
        'memoryRouteHopPulseProgress',
        frame / 600,
        3,
        0.01,
      );
    }
    expect(writes()).toBeLessThanOrEqual(101);
    expect(writes()).toBeGreaterThan(90);
    // The sweep ended between two quanta, so the exact final value lands on
    // the first resting frame — a chip at rest never reads a stale figure.
    expect(sink.memoryRouteHopPulseProgress).not.toBe('1.000');
    frameDatasetWriteNumber(ledger, sink, 'memoryRouteHopPulseProgress', 1, 3, 0.01);
    expect(sink.memoryRouteHopPulseProgress).toBe('1.000');
    // A resting value costs nothing at all after that.
    const resting = writes();
    for (let frame = 0; frame < 60; frame += 1) {
      frameDatasetWriteNumber(ledger, sink, 'memoryRouteHopPulseProgress', 1, 3, 0.01);
    }
    expect(writes()).toBe(resting);
  });

  it('keeps a key honest when it alternates between a number and a literal', () => {
    const ledger = makeFrameDatasetLedger();
    const { sink } = countingSink();
    frameDatasetWriteNumber(ledger, sink, 'memoryRouteHopAngle', 0.5, 3, 0.01);
    expect(sink.memoryRouteHopAngle).toBe('0.500');
    frameDatasetWrite(ledger, sink, 'memoryRouteHopAngle', 'none');
    expect(sink.memoryRouteHopAngle).toBe('none');
    // Same number as before: the literal must not be mistaken for it.
    frameDatasetWriteNumber(ledger, sink, 'memoryRouteHopAngle', 0.5, 3, 0.01);
    expect(sink.memoryRouteHopAngle).toBe('0.500');
  });

  it('rebuilds a joined series only when one of its members moves', () => {
    const ledger = makeFrameDatasetLedger();
    const { sink, writes } = countingSink();
    const values = [0.2, 0.94];
    expect(frameDatasetWriteVector(ledger, sink, 'scales', values, 3, 0.01))
      .toBe(true);
    expect(sink.scales).toBe('0.200,0.940');
    expect(frameDatasetWriteVector(ledger, sink, 'scales', values, 3, 0.01))
      .toBe(false);
    // Below the quantum: same series as far as the reader is concerned.
    values[1] = 0.9401;
    expect(frameDatasetWriteVector(ledger, sink, 'scales', values, 3, 0.01))
      .toBe(false);
    values[1] = 0.95;
    expect(frameDatasetWriteVector(ledger, sink, 'scales', values, 3, 0.01))
      .toBe(true);
    expect(sink.scales).toBe('0.200,0.950');
    // A shorter series is a change even when its members are unchanged.
    expect(frameDatasetWriteVector(ledger, sink, 'scales', [0.2], 3, 0.01))
      .toBe(true);
    expect(sink.scales).toBe('0.200');
    expect(writes()).toBe(3);
  });

  it('deletes once and remembers the absence', () => {
    const ledger = makeFrameDatasetLedger();
    const { sink, writes } = countingSink();
    frameDatasetWrite(ledger, sink, 'handoffFrom', '9');
    expect(frameDatasetDelete(ledger, sink, 'handoffFrom')).toBe(true);
    expect(frameDatasetDelete(ledger, sink, 'handoffFrom')).toBe(false);
    expect('handoffFrom' in sink).toBe(false);
    expect(writes()).toBe(2);
    expect(frameDatasetWrite(ledger, sink, 'handoffFrom', '9')).toBe(true);
    expect(sink.handoffFrom).toBe('9');
  });

  it('forgets everything when the element it wrote to is replaced', () => {
    const ledger = makeFrameDatasetLedger();
    const first = countingSink();
    const owner = {};
    frameDatasetBind(ledger, owner);
    frameDatasetWrite(ledger, first.sink, 'memoryEndpoint', 'source');
    frameDatasetWriteNumber(ledger, first.sink, 'memoryCellPhase', 0.5, 3, 0.01);
    expect(frameDatasetBind(ledger, owner)).toBe(false);
    expect(frameDatasetWrite(ledger, first.sink, 'memoryEndpoint', 'source'))
      .toBe(false);

    // React remounted the chip: the new element carries the markup's values,
    // so every recorded value is void even though nothing else changed.
    const second = countingSink();
    expect(frameDatasetBind(ledger, {})).toBe(true);
    expect(frameDatasetWrite(ledger, second.sink, 'memoryEndpoint', 'source'))
      .toBe(true);
    expect(frameDatasetWriteNumber(ledger, second.sink, 'memoryCellPhase', 0.5, 3, 0.01))
      .toBe(true);
    expect(second.sink.memoryCellPhase).toBe('0.500');
  });

  it('forgets what it published when a render rewrote the same element', () => {
    const ledger = makeFrameDatasetLedger();
    const { sink, writes } = countingSink();
    const owner = {};
    frameDatasetBind(ledger, owner, 4);
    frameDatasetWrite(ledger, sink, 'memoryEvidenceFocus', 'departing');
    expect(frameDatasetBind(ledger, owner, 4)).toBe(false);
    expect(frameDatasetWrite(ledger, sink, 'memoryEvidenceFocus', 'departing'))
      .toBe(false);

    // The markup rewrote the attribute during a commit; what the ledger
    // published is no longer what the element carries.
    sink.memoryEvidenceFocus = 'passive';
    expect(frameDatasetBind(ledger, owner, 5)).toBe(true);
    expect(frameDatasetWrite(ledger, sink, 'memoryEvidenceFocus', 'departing'))
      .toBe(true);
    expect(sink.memoryEvidenceFocus).toBe('departing');
    expect(writes()).toBe(3);
  });

  it('marks a discriminant without publishing anything', () => {
    const ledger = makeFrameDatasetLedger();
    expect(frameLedgerMarkNumber(ledger, 'emphasis', 0)).toBe(true);
    expect(frameLedgerMarkNumber(ledger, 'emphasis', 0)).toBe(false);
    expect(frameLedgerMarkNumber(ledger, 'emphasis', 1)).toBe(true);
    expect(ledger.values.size).toBe(0);
  });

  it('holds style properties to the same discipline', () => {
    const ledger = makeFrameDatasetLedger();
    let writes = 0;
    const style = {
      setProperty(_property: string, _value: string) { writes += 1; },
    } as unknown as CSSStyleDeclaration;
    frameStyleWriteNumber(ledger, style, 'opacity', 0.5, 3, 0.001);
    frameStyleWriteNumber(ledger, style, 'opacity', 0.5, 3, 0.001);
    frameStyleWriteNumber(ledger, style, 'opacity', 0.5004, 3, 0.001);
    expect(writes).toBe(1);
    frameStyleWriteNumber(ledger, style, 'opacity', 0.502, 3, 0.001);
    expect(writes).toBe(2);
    // Style keys live in their own namespace, so they cannot collide with a
    // dataset key of the same name.
    frameStyleWrite(ledger, style, 'display', 'none');
    expect(writes).toBe(3);
    expect(ledger.values.has('style:display')).toBe(true);
    expect(ledger.values.has('display')).toBe(false);
  });
});
