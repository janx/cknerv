import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/CellNucleusPortrait.tsx'),
  'utf8',
);

describe('CellNucleusPortrait production language', () => {
  it('renders the selected core directly without the retired anatomy overlay', () => {
    expect(SOURCE).toContain('<CellCoreArtwork');
    expect(SOURCE).toContain('focusField={focusField}');
    expect(SOURCE).not.toContain('specimenMorphology(');
    expect(SOURCE).not.toContain('makeOrganelleMaterial');
    expect(SOURCE).not.toContain('<SpecimenProbe');
  });
});
