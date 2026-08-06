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
});
