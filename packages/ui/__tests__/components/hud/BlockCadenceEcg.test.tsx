import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import type { EcgCondition } from '../../../src/derives/ecgCondition';
import BlockCadenceEcg from '../../../src/components/hud/BlockCadenceEcg';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';

afterEach(cleanup);

const base = {
  intervalsMs: [8000, 8000, 8000],
  sizes: [400, 900, 1500],
  txCounts: [2, 8, 20],
  lastBlockTsMs: 1_000_000,
  targetMs: 8000,
  avgMs: 8000,
  gapMs: 1200,
  reducedMotion: true as const,
};

describe('BlockCadenceEcg', () => {
  it('renders the canvas, title, condition word and live readouts', () => {
    const { container } = render(<BlockCadenceEcg {...base} condition="FINE" />);
    expect(container.querySelector('canvas')).toBeTruthy();
    const t = container.textContent ?? '';
    expect(t).toContain('PULSE');
    expect(t).toContain('脉搏');
    expect(t).toContain('FINE');
    expect(t).toContain('SINCE LAST');
    expect(t).toContain('TGT');
    expect(t).toContain('AVG');
    expect(t).toContain('RATE');
  });
  it('reflects a flatline condition', () => {
    const { container } = render(<BlockCadenceEcg {...base} condition="FLATLINE" gapMs={80000} />);
    expect(container.textContent).toContain('FLATLINE');
  });
  it('renders with an empty interval buffer (no last block) without throwing', () => {
    const { container } = render(
      <BlockCadenceEcg intervalsMs={[]} sizes={[]} txCounts={[]} lastBlockTsMs={null} targetMs={8000} avgMs={null} gapMs={0} condition="FINE" reducedMotion />,
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });
});

// ——— Phosphor vs status lamp ————————————————————————————————————————————
//
// The panel wears two colours for one condition, and only while the chain is
// healthy: the canvas is an instrument and strokes CRT phosphor, the `● FINE`
// word beside it is a status light and stays `nominal`. Every other condition
// paints both in one colour, because from CAUTION on the trace changing colour
// IS the status — that is the mechanic this panel exists for, and splitting a
// degraded trace off its own alarm would be the regression.

/** The component refuses to draw unless the 2D context answers like a real
 *  browser's (jsdom's stub does not), so the trace colour is only observable
 *  through a stand-in. Records what each stroke was painted in — same fake-ctx
 *  idiom as `ecgTrace.test.ts`, one level up. */
function stubCanvas() {
  const strokes: { style: string; shadowColor: string; shadowBlur: number }[] = [];
  const ctx = {
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    fillRect() {}, setLineDash() {}, createLinearGradient: () => ({ addColorStop() {} }),
    stroke() {
      strokes.push({ style: String(ctx.strokeStyle), shadowColor: String(ctx.shadowColor), shadowBlur: ctx.shadowBlur });
    },
    lineWidth: 0, strokeStyle: '', fillStyle: '', lineJoin: '', shadowBlur: 0, shadowColor: '',
  };
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof original;
  return { strokes, restore: () => { HTMLCanvasElement.prototype.getContext = original; } };
}

/** The trace is the one stroke `drawStripChart` puts a glow behind; the grid,
 *  the baseline and the target ticks are all drawn flat. */
function traceStroke(strokes: ReturnType<typeof stubCanvas>['strokes']) {
  return strokes.find((s) => s.shadowBlur > 0);
}

/** The `● FINE` word — the status light, and the only other place on the panel
 *  a condition names its own colour. */
function lampColor(container: HTMLElement): string | undefined {
  const lamp = Array.from(container.querySelectorAll('span'))
    .find((span) => (span.textContent ?? '').trim().startsWith('●'));
  return lamp?.style.color;
}

/** jsdom rewrites `#27FF5A` into `rgb(39, 255, 90)` on the way into a style
 *  attribute, so a token has to make the same trip before it can be compared
 *  to one. */
function asStyleColor(hex: string): string {
  const probe = document.createElement('span');
  probe.style.color = hex;
  return probe.style.color;
}

describe('BlockCadenceEcg — instrument ink vs status lamp', () => {
  let canvas: ReturnType<typeof stubCanvas>;
  afterEach(() => canvas?.restore());

  it('strokes phosphor while FINE, with the lamp beside it still nominal', () => {
    canvas = stubCanvas();
    const { container } = render(<BlockCadenceEcg {...base} condition="FINE" />);

    expect(traceStroke(canvas.strokes)?.style).toBe(HUD_COLORS.termGreen);
    expect(traceStroke(canvas.strokes)?.shadowColor).toBe(HUD_COLORS.termGreen); // the glow is the trace's own
    expect(lampColor(container)).toBe(asStyleColor(HUD_COLORS.nominal));
    // The claim in one line: two greens, and they are not the same green.
    expect(HUD_COLORS.termGreen).not.toBe(HUD_COLORS.nominal);
  });

  it.each<[EcgCondition, string]>([
    ['CAUTION', HUD_COLORS.caution],
    ['DANGER', HUD_COLORS.danger],
    ['FLATLINE', HUD_COLORS.danger],
    ['SYNCING', HUD_COLORS.cyanWire],
  ])('a %s trace IS the status — one colour, no split', (condition, expected) => {
    canvas = stubCanvas();
    const { container } = render(<BlockCadenceEcg {...base} condition={condition} />);

    expect(traceStroke(canvas.strokes)?.style).toBe(expected);
    expect(lampColor(container)).toBe(asStyleColor(expected));
  });
});
