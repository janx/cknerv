import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(resolve(
  process.cwd(),
  'src/components/CellCausalLensLayer.tsx',
), 'utf8');

describe('CellCausalLensLayer presentation', () => {
  it('keeps causal evidence and navigation without square scene glyphs', () => {
    expect(SOURCE).toContain('<primitive object={built.glow}');
    expect(SOURCE).toContain('<primitive object={built.core}');
    expect(SOURCE).toContain('<CellCausalEndpointPicker');
    expect(SOURCE).toContain('<CellCausalNavigationLabel');
    expect(SOURCE).not.toContain('<Billboard');
    expect(SOURCE).not.toContain('<ringGeometry');
    expect(SOURCE).not.toContain('data-cell-causal-lens-label');
    expect(SOURCE).not.toContain('TX IDENTITY');
  });

  it('keeps the label frame loop free of per-frame layout reads', () => {
    // The canvas rect comes from the ResizeObserver-backed cache, never from
    // a per-frame getBoundingClientRect that forces synchronous layout.
    expect(SOURCE).toContain('useCanvasClientRect(canvas)');
    expect(SOURCE).not.toContain('canvas.getBoundingClientRect');
    // Occlusion rects and the label's own box refresh behind the shared
    // 250ms hud measure window (ConsensusMemoryMarkers precedent); the
    // placement derive consumes only the cached values.
    expect(SOURCE).toContain('hudMeasure.atMs >= 250');
    expect(SOURCE).toContain('label: labelSizeRef.current');
    expect(SOURCE).toContain('occlusions: hudRectsRef.current');
    expect(SOURCE).not.toContain('occlusions: visibleCanvasOcclusions');
  });
});
