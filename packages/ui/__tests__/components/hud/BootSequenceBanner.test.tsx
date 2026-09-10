import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  BootPhaseSnapshot,
  BootRequestSnapshot,
  BootSequenceSnapshot,
} from '../../../src/boot/bootSequence';
import BootSequenceBanner from '../../../src/components/hud/BootSequenceBanner';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';

afterEach(cleanup);

function sequence(
  phases: BootPhaseSnapshot[],
  requests: BootRequestSnapshot[] = [],
): BootSequenceSnapshot {
  const complete = phases.every((phase) => phase.state === 'done');
  return { active: !complete, complete, phases, requests };
}

/** A palette hex as jsdom serializes it back out of a style declaration. */
function cssColor(hex: string): string {
  const h = hex.replace('#', '');
  const channel = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

/** A boot mid-download: the shape the band spends most of a slow load in. */
const DOWNLOADING = sequence([
  { id: 'instrument', state: 'done' },
  { id: 'snapshot', state: 'active' },
  { id: 'decode', state: 'pending' },
  { id: 'gl', state: 'pending' },
  { id: 'first_light', state: 'pending' },
  { id: 'fabric', state: 'pending' },
  { id: 'data_plane', state: 'pending' },
], [{
  kind: 'cells',
  transport: 'cells-binary',
  attempt: 1,
  state: 'reading',
  startedAtMs: 0,
  lastActivityAtMs: 1,
  receivedBytes: 2_852_000,
  totalBytes: 4_600_000,
}]);

const band = (root: HTMLElement) => root.querySelector('[data-boot-banner]') as HTMLElement;
const line = (root: HTMLElement, id: string) => root.querySelector(`[data-boot-phase="${id}"]`) as HTMLElement;

describe('BootSequenceBanner', () => {
  it('draws one line per phase, each in the colour of its own state', () => {
    const { container } = render(<BootSequenceBanner boot={DOWNLOADING} top={36} />);
    const lines = Array.from(
      container.querySelectorAll('[data-boot-phase]'),
    ) as HTMLElement[];

    expect(lines.map((node) => node.dataset.bootPhase)).toEqual([
      'instrument', 'snapshot', 'decode', 'gl',
      'first_light', 'fabric', 'data_plane',
    ]);
    expect(line(container, 'instrument').dataset.state).toBe('done');
    expect(line(container, 'instrument').style.color).toBe(cssColor(HUD_COLORS.nominal));
    expect(line(container, 'snapshot').dataset.state).toBe('active');
    expect(line(container, 'snapshot').style.color).toBe(cssColor(HUD_COLORS.cyanWire));
    expect(line(container, 'decode').dataset.state).toBe('pending');
    expect(line(container, 'decode').style.color).toBe(cssColor(HUD_COLORS.dim));
  });

  it('takes the edge-bound band at the offset it is given', () => {
    const { container } = render(<BootSequenceBanner boot={DOWNLOADING} top={64} />);
    const root = band(container);

    expect(root.style.position).toBe('absolute');
    expect(root.style.top).toBe('64px');
    expect(root.style.left).toBe('0px');
    expect(root.style.right).toBe('0px');
    expect(root.style.height).toBe('30px');
    expect(root.style.color).toBe(cssColor(HUD_COLORS.cyanWire));
    // Stillness is the contract the static shell set; nothing here breathes.
    expect(root.style.animation).toBe('');
  });

  it('stands its title on the centre line, whatever the trail is doing', () => {
    // The trail beside the title changes length constantly — the record grows a
    // phase at a time, the composing chapter rewrites its whole line twice — and
    // a centred flex ROW put the title at `centre − rowWidth / 2`, so the one
    // word a reader is holding on to slid sideways on every one of those.
    //
    // jsdom lays nothing out, so the oracle is the mechanism rather than a
    // measured box: three columns with equal shoulders and an `auto` middle put
    // the title on the centre whatever flanks it. The measured version is live
    // — the title's midpoint read 999 of 1000 at 1,999px and 512 of 512 at
    // 1,024, with the trail a different length at each.
    const { container } = render(<BootSequenceBanner boot={DOWNLOADING} top={36} />);
    const row = container.querySelector('[data-top-band-row]') as HTMLElement;

    expect(row.style.display).toBe('grid');
    expect(row.style.gridTemplateColumns).toBe('minmax(0,1fr) auto minmax(0,1fr)');
    // …and that the middle column really is the title: the shoulders may
    // overflow, and whichever of the three is `auto` is the one that cannot.
    expect(Array.from(row.children).map((child) => (child as HTMLElement).dataset.topBandGlyph !== undefined
      ? 'glyph'
      : (child as HTMLElement).dataset.topBandTitle !== undefined ? 'title' : 'trail'))
      .toEqual(['glyph', 'title', 'trail']);
    expect((row.children[1] as HTMLElement).textContent).toBe('STAGE POWER-ON');
  });

  it('speaks the streamed percentage while the download is the wait', () => {
    const { container } = render(<BootSequenceBanner boot={DOWNLOADING} top={36} />);
    expect(container.textContent).toContain('STAGE POWER-ON');
    expect(container.textContent).toContain('SNAPSHOT 62%');
    // Every other line is a tick, because a tick is all that was observed.
    expect(container.textContent).toContain('DECODE');
    expect(container.textContent).toContain('FIRST LIGHT');
    expect(line(container, 'decode').textContent).toBe('DECODE');
  });

  it('reports measured size when the response carried no length', () => {
    const { container } = render(
      <BootSequenceBanner
        boot={sequence([
          { id: 'instrument', state: 'done' },
          { id: 'snapshot', state: 'active' },
        ], [{
          kind: 'cells', transport: 'cells-json', attempt: 1, state: 'reading',
          startedAtMs: 0, lastActivityAtMs: 1, receivedBytes: 3_240_000, totalBytes: null,
        }])}
        top={36}
      />,
    );
    expect(line(container, 'snapshot').textContent).toBe('SNAPSHOT 3.2 MB');
    expect(container.textContent).not.toContain('%');
  });

  it('shows the seeding line only once the server reported a replay', () => {
    const { container } = render(<BootSequenceBanner boot={DOWNLOADING} top={36} />);
    expect(container.querySelector('[data-boot-phase="seeding"]')).toBeNull();
    expect(container.textContent).not.toContain('SEEDING');
    cleanup();

    const { container: seeding } = render(
      <BootSequenceBanner
        boot={sequence([
          { id: 'instrument', state: 'done' },
          { id: 'data_plane', state: 'active' },
          { id: 'seeding', state: 'active', seedingDone: 1234, seedingTotal: 65_829 },
        ])}
        top={36}
      />,
    );
    expect(line(seeding, 'seeding').textContent).toBe('SEEDING 1,234 / 65,829');
  });

  it('collapses to the one line a narrow bar has room for', () => {
    const { container } = render(
      <BootSequenceBanner boot={DOWNLOADING} top={36} dense />,
    );
    const lines = container.querySelectorAll('[data-boot-phase]');

    expect(lines).toHaveLength(1);
    expect((lines[0] as HTMLElement).dataset.bootPhase).toBe('snapshot');
    expect(container.textContent).toContain('STAGE POWER-ON');
    expect(container.textContent).toContain('SNAPSHOT 62%');
    // Half a trail reads as the whole sequence, so it shows none of it.
    expect(container.textContent).not.toContain('DECODE');
    expect(band(container).dataset.bootDense).toBe('true');
  });

  it('hands the whole band to a fault, and says the word', () => {
    const failed = sequence([
      { id: 'instrument', state: 'done' },
      { id: 'snapshot', state: 'done' },
      { id: 'decode', state: 'done' },
      { id: 'gl', state: 'failed', detail: 'context lost' },
      { id: 'first_light', state: 'pending' },
    ]);
    const { container } = render(<BootSequenceBanner boot={failed} top={36} />);
    const root = band(container);

    expect(line(container, 'gl').textContent).toBe('GL FAULT — context lost');
    expect(line(container, 'gl').dataset.state).toBe('failed');
    expect(line(container, 'gl').style.color).toBe(cssColor(HUD_COLORS.danger));
    // The band itself turns over, not just the one word on it: the type, the
    // tint it sits on, and the edge under it. (Both are boxes of their own on
    // the band's track rather than the band's own background and border — it is
    // an overlay now and neither may cross a rail; the band's own ground layer
    // is not asked, because it carries no accent at all by design.
    // `TopBand.tsx` and the `edge-bound stack` oracles carry the why.)
    const tint = root.querySelector('[data-top-band-tint]') as HTMLElement;
    const rule = root.querySelector('[data-top-band-rule]') as HTMLElement;
    expect(root.style.color).toBe(cssColor(HUD_COLORS.danger));
    for (const surface of [tint, rule]) {
      expect(surface.style.background).toContain('255,48,48');
      expect(surface.style.background).not.toContain('32,240,255');
    }
    cleanup();

    // …and a narrow bar shows the fault rather than the leftmost unfinished
    // line, because the fault is the news.
    const { container: dense } = render(
      <BootSequenceBanner boot={failed} top={36} dense />,
    );
    expect(dense.querySelectorAll('[data-boot-phase]')).toHaveLength(1);
    expect(line(dense, 'gl').textContent).toBe('GL FAULT — context lost');
  });

  it('is a status surface, announced without interrupting', () => {
    const { container } = render(<BootSequenceBanner boot={DOWNLOADING} top={36} />);
    const root = band(container);

    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-live')).toBe('polite');
  });
});
