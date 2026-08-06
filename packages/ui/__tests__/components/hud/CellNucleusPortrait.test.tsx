import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PORTRAIT_IDLE_FPS,
  PORTRAIT_INTERACTION_FPS,
  resolvePortraitCanvasDpr,
} from '../../../src/components/hud/CellNucleusPortrait';

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
const HUD_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/HudOverlay.tsx'),
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
    expect(SOURCE).toContain('data-memory-portrait-identity-phase');
    expect(SOURCE).toContain('data-memory-portrait-identity-count');
    expect(SOURCE).toContain('data-memory-portrait-outpoint-index-bytes');
    expect(SOURCE).toContain('data-memory-portrait-anchor-hex');
    expect(CORE_SOURCE).toContain('<CellContentAddressHalo');
    expect(CORE_SOURCE).toContain('<CellIdentityProofReader');
    expect(CORE_SOURCE).toContain('<CellIdentityBindingGlyph');
    expect(CORE_SOURCE).not.toContain(
      'identityProofBinding.resolvedKinds.length > 0',
    );
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
    expect(SOURCE).toContain('identityProofBinding={');
    expect(SOURCE).toContain('data-memory-portrait-state');
    expect(SOURCE).not.toContain('specimenMorphology(');
    expect(SOURCE).not.toContain('makeOrganelleMaterial');
    expect(SOURCE).not.toContain('<SpecimenProbe');
  });

  it('mirrors only the selected target response on canonical agreements', () => {
    expect(MEMORY_SOURCE).toContain('frameTarget?.targetCellId === cell.id');
    expect(MEMORY_SOURCE).toContain('consensusBraidAgreementResolution(');
    expect(MEMORY_SOURCE).not.toContain('readHeadsRef');
    expect(MEMORY_SOURCE).not.toContain('READ_HEAD_TRAIL');
    expect(MEMORY_SOURCE).toContain('streamFlowGlow.computeLineDistances()');
    expect(MEMORY_SOURCE).toContain(
      'const structureVisual = useMemo<ConsensusBraidVisual>',
    );
    expect(MEMORY_SOURCE).toContain('[cell.birth_block, structureVisual]');
    expect(MEMORY_SOURCE).not.toContain('[cell.birth_block, visual]');
    expect(MEMORY_SOURCE).toContain('streamFlowGlowMaterial.dashOffset');
    expect(MEMORY_SOURCE).toContain('streamFlowCoreMaterial.dashOffset');
    expect(MEMORY_SOURCE).toContain('streamTraceGlowMaterial.dashOffset');
    expect(MEMORY_SOURCE).toContain('streamTraceCoreMaterial.dashOffset');
    expect(MEMORY_SOURCE).not.toContain('ambientFlowHeadsRef');
    expect(MEMORY_SOURCE).not.toContain('ambientFlowHeadGeometry');
    expect(MEMORY_SOURCE).toContain('float flowEnvelope = smoothstep(');
    expect(MEMORY_SOURCE).toContain('alpha *= flowEnvelope');
    expect(MEMORY_SOURCE).toContain('const AMBIENT_FLOW_GLOW_DASH = 0.9');
    expect(MEMORY_SOURCE).toContain('streamGeometry.setColors(streamColors)');
    expect(MEMORY_SOURCE).toContain('color: 0xffffff');
    expect(MEMORY_SOURCE).toContain('material.vertexColors = true');
    expect(MEMORY_SOURCE).not.toContain('material.vertexColors = false');
    expect(MEMORY_SOURCE).not.toContain('new THREE.Color(1, 0.18, 0.02)');
    expect(MEMORY_SOURCE).toContain('ambientFlowOpacity * 4.8');
    expect(MEMORY_SOURCE).toContain('<primitive object={built.streamFlowGlow} />');
    expect(MEMORY_SOURCE).toContain('<primitive object={built.streamFlowCore} />');
    expect(MEMORY_SOURCE).toContain('<primitive object={built.streamTraceGlow} />');
    expect(MEMORY_SOURCE).toContain('<primitive object={built.streamTraceCore} />');
    expect(MEMORY_SOURCE).toContain('built.streamFlowGlowMaterial.dispose()');
    expect(MEMORY_SOURCE).toContain('built.streamFlowCoreMaterial.dispose()');
    expect(MEMORY_SOURCE).toContain('CONSENSUS_BRAID_PALETTE.paleGold');
    expect(MEMORY_SOURCE).toContain('consensusMemoryEvidenceBindings(');
    expect(MEMORY_SOURCE).toContain('data-memory-knot-evidence');
    expect(MEMORY_SOURCE).toContain('data-memory-knot-focus');
    expect(MEMORY_SOURCE).toContain('consensusMemoryEvidenceFocusScale(');
    expect(MEMORY_SOURCE).toContain('focusedEvidenceBinding');
    expect(MEMORY_SOURCE).toContain('<ringGeometry args={[0.025, 0.032, 4]} />');
  });

  it('lets the selected Cell portrait rotate without taking over panel scroll', () => {
    expect(SOURCE).toContain("import { OrbitControls } from '@react-three/drei'");
    expect(SOURCE).toContain('data-cell-portrait-interactive="true"');
    expect(SOURCE).toContain("data-cell-portrait-dragging={dragging ? 'true' : 'false'}");
    expect(SOURCE).toContain('Interactive Cell scan. Drag to orbit around the Cell.');
    expect(SOURCE).toContain("pointerEvents: 'auto'");
    expect(SOURCE).toContain("cursor: dragging ? 'grabbing' : 'grab'");
    expect(SOURCE).toContain('<OrbitControls');
    expect(SOURCE).toContain('enablePan={false}');
    expect(SOURCE).toContain('enableZoom={false}');
    expect(SOURCE).toContain('enableDamping={!reducedMotion}');
  });

  it('shares the adaptive DPR ceiling and renders idle animation at a bounded cadence', () => {
    expect(resolvePortraitCanvasDpr(3, 2)).toBe(2);
    expect(resolvePortraitCanvasDpr(3, 1.5)).toBe(1.5);
    expect(resolvePortraitCanvasDpr(0.5, 2)).toBe(1);
    expect(resolvePortraitCanvasDpr(Number.NaN, Number.NaN)).toBe(1);
    expect(PORTRAIT_IDLE_FPS).toBeLessThan(PORTRAIT_INTERACTION_FPS);
    expect(SOURCE).toContain('dpr={portraitDpr}');
    expect(SOURCE).toContain('frameloop="demand"');
    expect(SOURCE).toContain('<PortraitFrameDriver');
  });

  it('retains the portrait Canvas while switching selected Cells', () => {
    expect(HUD_SOURCE).not.toContain('key={selectedCell.id}');
    expect(CORE_SOURCE).toContain('key={cell.id}');
  });

  it('updates line resolution on viewport changes and settles color uploads', () => {
    expect(MEMORY_SOURCE).toContain(
      'material.resolution.set(viewportWidth, viewportHeight)',
    );
    expect(MEMORY_SOURCE).not.toContain(
      'material.resolution.set(state.size.width, state.size.height)',
    );
    expect(MEMORY_SOURCE).toContain('if (agreementColorsChanged)');
    expect(MEMORY_SOURCE).toContain('if (knotColorsChanged)');
  });
});
