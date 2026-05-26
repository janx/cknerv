import { describe, expect, it } from 'vitest';
import { computeRightColumnLayout } from '../../src/ui/hudLayout';

describe('computeRightColumnLayout', () => {
  it('anchors OpenTx at h/2 - margin', () => {
    const layout = computeRightColumnLayout({
      h: 1080,
      margin: 14,
      gap: 12,
      openTxH: 290,
      detailH: 150,
    });
    expect(layout.openTxY).toBe(1080 / 2 - 14);
    expect(layout.showOpenTx).toBe(true);
  });

  it('shows OpenTx on a typical laptop Canvas (h=800)', () => {
    // openTxY=386, openTxBottom=386-290=96; floor=(-400+14+150)+12=-224.
    // 96 > -224 → fits comfortably.
    const layout = computeRightColumnLayout({
      h: 800,
      margin: 14,
      gap: 12,
      openTxH: 290,
      detailH: 150,
    });
    expect(layout.showOpenTx).toBe(true);
  });

  it('hides OpenTx when it would overlap DetailHud on a very short viewport', () => {
    // h=300: openTxY=136; openTxBottom=-154; floor=(-150+14+150)+12=26.
    // -154 > 26? NO → hidden.
    const layout = computeRightColumnLayout({
      h: 300,
      margin: 14,
      gap: 12,
      openTxH: 290,
      detailH: 150,
    });
    expect(layout.showOpenTx).toBe(false);
  });
});
