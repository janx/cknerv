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
const CORE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/CellCoreArtwork.tsx'),
  'utf8',
);
const ADDRESS_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/CellContentAddressHalo.tsx'),
  'utf8',
);
const PROOF_READER_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/CellIdentityProofReader.tsx'),
  'utf8',
);

describe('CellNucleusPortrait production language', () => {
  it('renders the selected core directly without the retired anatomy overlay', () => {
    expect(SOURCE).toContain('<CellCoreArtwork');
    expect(SOURCE).toContain('deriveCellContentAddressEncoding(');
    expect(SOURCE).toContain('data-memory-portrait-address-fingerprint');
    expect(SOURCE).toContain('data-memory-portrait-address-lanes');
    expect(SOURCE).toContain('data-memory-portrait-address-focus');
    expect(SOURCE).toContain('data-memory-portrait-proof-focus');
    expect(SOURCE).toContain('data-memory-portrait-outpoint-index-bytes');
    expect(SOURCE).toContain('data-memory-portrait-anchor-hex');
    expect(CORE_SOURCE).toContain('<CellContentAddressHalo');
    expect(CORE_SOURCE).toContain('<CellIdentityProofReader');
    expect(CORE_SOURCE).toContain("contentFocused={focusField === 'data'}");
    expect(CORE_SOURCE).toContain("focusField === 'state'");
    expect(CORE_SOURCE).toContain("focusField === 'born'");
    expect(ADDRESS_SOURCE).toContain('deriveCellContentAddressSegments(');
    expect(ADDRESS_SOURCE).toContain('cellContentAddressReadFrame(');
    expect(ADDRESS_SOURCE).toContain('onReadResolvedRef.current?.()');
    expect(ADDRESS_SOURCE).toContain('memoryPortraitAddressActiveLane');
    expect(ADDRESS_SOURCE).toContain('new LineSegments2(');
    expect(ADDRESS_SOURCE).toContain('THREE.AdditiveBlending');
    expect(ADDRESS_SOURCE).toContain('invalidate();');
    expect(SOURCE).toContain('focusField={focusField}');
    expect(SOURCE).toContain('traceReadout={traceReadout}');
    expect(SOURCE).toContain('traceResponseRef={traceResponseRef}');
    expect(SOURCE).toContain('traceEvidenceFocusSourceId={traceEvidenceFocusSourceId}');
    expect(PROOF_READER_SOURCE).toContain('deriveCellOutpointLocatorSegments(');
    expect(PROOF_READER_SOURCE).toContain('deriveCellBirthAnchorSegments(');
    expect(PROOF_READER_SOURCE).toContain("onReadResolvedRef.current?.('address')");
    expect(PROOF_READER_SOURCE).toContain("onReadResolvedRef.current?.('anchor')");
    expect(PROOF_READER_SOURCE).toContain('settledRef.current = true');
    expect(SOURCE).toContain('onIdentityProofRead={onIdentityProofRead}');
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
