import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/CellNucleusPortrait.tsx'),
  'utf8',
);
const MEMORY_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/ConsensusMemory.tsx'),
  'utf8',
);

describe('CellNucleusPortrait production language', () => {
  it('renders the selected core directly without the retired anatomy overlay', () => {
    expect(SOURCE).toContain('<CellCoreArtwork');
    expect(SOURCE).toContain('focusField={focusField}');
    expect(SOURCE).toContain('traceReadout={traceReadout}');
    expect(SOURCE).toContain('traceResponseRef={traceResponseRef}');
    expect(SOURCE).toContain('traceEvidenceFocusSourceId={traceEvidenceFocusSourceId}');
    expect(SOURCE).toContain('data-memory-portrait-state');
    expect(SOURCE).not.toContain('specimenMorphology(');
    expect(SOURCE).not.toContain('makeOrganelleMaterial');
    expect(SOURCE).not.toContain('<SpecimenProbe');
  });

  it('mirrors only the selected target response on canonical agreements', () => {
    expect(MEMORY_SOURCE).toContain('frameTarget?.targetCellId === cell.id');
    expect(MEMORY_SOURCE).toContain('consensusBraidAgreementResolution(');
    expect(MEMORY_SOURCE).toContain('readHeadsRef');
    expect(MEMORY_SOURCE).toContain('CONSENSUS_BRAID_PALETTE.paleGold');
    expect(MEMORY_SOURCE).toContain('consensusMemoryEvidenceBindings(');
    expect(MEMORY_SOURCE).toContain('data-memory-knot-evidence');
    expect(MEMORY_SOURCE).toContain('data-memory-knot-focus');
    expect(MEMORY_SOURCE).toContain('consensusMemoryEvidenceFocusScale(');
    expect(MEMORY_SOURCE).toContain('focusedEvidenceBinding');
    expect(MEMORY_SOURCE).toContain('<ringGeometry args={[0.025, 0.032, 4]} />');
  });
});
