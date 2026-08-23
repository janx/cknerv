import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveStandalonePortraitDpr,
} from '../../../src/components/hud/CellNucleusPortrait';
import {
  CELL_PORTRAIT_INSET,
  cellPortraitScissorRect,
  clearCellPortraitCardOrigin,
  registerCellPortraitElement,
  setCellPortraitCardOrigin,
  setCellPortraitOffset,
  type CellPortraitScissorRect,
} from '../../../src/components/hud/cellPortraitInsetChannel';
import {
  portraitPlateSize,
} from '../../../src/components/hud/CellPortraitInset';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/CellNucleusPortrait.tsx'),
  'utf8',
);
const INSET_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/CellPortraitInset.tsx'),
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
const SEMANTIC_OVERLAY_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/CellSemanticMorphologyOverlay.tsx'),
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
    expect(ADDRESS_SOURCE).toContain(
      "if (frame.state === 'reading') invalidate();",
    );
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
    expect(PROOF_READER_SOURCE.match(
      /if \(frame\.state === 'reading'\) invalidate\(\);/g,
    )).toHaveLength(2);
    expect(SOURCE).toContain('onIdentityProofRead={onIdentityProofRead}');
    expect(SOURCE).toContain('identityProofBinding={selectedBinding}');
    expect(SOURCE).toContain('data-memory-portrait-state');
  });

  it('mirrors only the selected target response on canonical agreements', () => {
    expect(MEMORY_SOURCE).toContain('frameTarget?.targetCellId === cell.id');
    expect(MEMORY_SOURCE).toContain('consensusBraidAgreementResolution(');
    expect(MEMORY_SOURCE).not.toContain('readHeadsRef');
    expect(MEMORY_SOURCE).not.toContain('READ_HEAD_TRAIL');
    expect(MEMORY_SOURCE).toContain('streamFlowGlow.computeLineDistances()');
    expect(MEMORY_SOURCE).toContain(
      'const topology = useMemo(() => deriveConsensusBraidTopology(cell, { collection }), [',
    );
    expect(MEMORY_SOURCE).toContain('const curves = topology.strands.map(');
    expect(MEMORY_SOURCE).toContain('for (const mark of topology.dataMarks)');
    expect(MEMORY_SOURCE).toContain('}, [topology]);');
    expect(MEMORY_SOURCE).not.toContain('ConsensusBraidVisual');
    expect(MEMORY_SOURCE).not.toContain('consensusBraidPoint');
    expect(SOURCE).toContain('semanticRecord={semanticRecord}');
    expect(CORE_SOURCE).toContain('semanticRecord={semanticRecord}');
    expect(MEMORY_SOURCE).toContain(
      'deriveCellSemanticMorphologyOverlay(cell, semanticRecord)',
    );
    expect(MEMORY_SOURCE).toContain('<CellSemanticMorphologyOverlay');
    expect(SEMANTIC_OVERLAY_SOURCE).toContain('topology: CellMorphologyTopology');
    expect(SEMANTIC_OVERLAY_SOURCE).toContain('built.lineGeometry.dispose()');
    expect(SEMANTIC_OVERLAY_SOURCE).not.toContain('deriveConsensusBraidTopology');
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

  it('draws the braid with the main renderer through a scissored inset', () => {
    // One WebGL context: the inset takes over the loop, renders the Galaxy,
    // then scissors the portrait square for the braid scene. No second
    // Canvas, no heartbeat, no per-selection context churn.
    expect(SOURCE).toContain('registerCellPortraitElement(');
    expect(SOURCE).toContain('setCellPortraitOffset(');
    expect(SOURCE).toContain('setCellPortraitContent(');
    expect(SOURCE).toContain("host.closest<HTMLElement>('[data-cell-inspection-overlay]')");
    expect(SOURCE).toContain('export default memo(CellNucleusPortrait)');
    expect(SOURCE).not.toContain('PortraitHeartbeat');
    expect(SOURCE).not.toContain('frameloop');
    expect(SOURCE).not.toContain('requestAnimationFrame');
    expect(INSET_SOURCE).toContain('renderer.render(state.scene, state.camera)');
    expect(INSET_SOURCE).toContain('renderer.setScissorTest(true)');
    expect(INSET_SOURCE).toContain('renderer.clearDepth()');
    expect(INSET_SOURCE).toContain('renderer.render(braidScene, braidCamera)');
    expect(INSET_SOURCE).toContain('}, 1);');
    expect(INSET_SOURCE).not.toContain('new THREE.WebGLRenderer');
    // RenderStatsSampler owns gl.info accounting; the inset must not fight
    // its autoReset mode or wipe its sampling window.
    expect(INSET_SOURCE).not.toContain('info.autoReset');
    expect(INSET_SOURCE).not.toContain('info.reset()');
  });

  it('lets the selected Cell portrait rotate without racing the Galaxy camera', () => {
    // Orbit binds three's OrbitControls to the DOM square while the braid
    // camera lives in the main R3F tree.
    expect(INSET_SOURCE).toContain(
      "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'",
    );
    expect(INSET_SOURCE).toContain('new OrbitControls(braidCamera, element)');
    expect(INSET_SOURCE).toContain('controls.enablePan = false');
    expect(INSET_SOURCE).toContain('controls.enableZoom = false');
    expect(INSET_SOURCE).toContain('controls.enableDamping = !reduced');
    expect(INSET_SOURCE).toContain('controls.dispose()');
    expect(INSET_SOURCE).toContain("addEventListener('start'");
    expect(INSET_SOURCE).toContain('onInteractionChange?.(active)');
    expect(SOURCE).toContain('data-cell-portrait-interactive="true"');
    expect(SOURCE).toContain('Interactive Cell scan. Drag to orbit around the Cell.');
    expect(SOURCE).toContain("pointerEvents: 'auto'");
    expect(SOURCE).toContain("touchAction: 'none'");
  });

  it('composes the scissor rect without frame-loop layout reads', () => {
    const out: CellPortraitScissorRect = { x: 0, y: 0, width: 0, height: 0 };
    const offset = { dx: 30, dy: 40, width: 260, height: 260 };
    expect(cellPortraitScissorRect(offset, true, 100, 200, 900, out)).toBe(true);
    expect(out).toEqual({ x: 130, y: 900 - 240 - 260, width: 260, height: 260 });
    // Hidden card or unmeasured square draws nothing.
    expect(cellPortraitScissorRect(offset, false, 100, 200, 900, out)).toBe(false);
    expect(cellPortraitScissorRect(null, true, 100, 200, 900, out)).toBe(false);
    expect(cellPortraitScissorRect(
      { dx: 0, dy: 0, width: 1, height: 1 },
      true,
      0,
      0,
      900,
      out,
    )).toBe(false);
    // The channel wiring mirrors the pure composition.
    setCellPortraitOffset(offset);
    setCellPortraitCardOrigin(100, 200);
    expect(CELL_PORTRAIT_INSET.cardOriginValid).toBe(true);
    clearCellPortraitCardOrigin();
    expect(CELL_PORTRAIT_INSET.cardOriginValid).toBe(false);
    setCellPortraitOffset(null);
    registerCellPortraitElement(null);
  });

  it('keeps the standalone lab path self-contained', () => {
    expect(SOURCE).toContain('standalone = false');
    expect(SOURCE).toContain('{standalone ? (');
    expect(SOURCE).toContain('<OrbitControls');
    expect(SOURCE).toContain('enableDamping={!reducedMotion}');
    expect(resolveStandalonePortraitDpr(3)).toBe(2);
    expect(resolveStandalonePortraitDpr(1.5)).toBe(1.5);
    expect(resolveStandalonePortraitDpr(0.5)).toBe(1);
    expect(resolveStandalonePortraitDpr(Number.NaN)).toBe(1);
  });

  it('keeps braid identity rebuilds Cell-keyed with a screen-fixed plate', () => {
    // Switching Cells rebuilds geometry (Cell-keyed core) but never the GL
    // context; the backing plate rides the braid camera so it stays
    // screen-fixed under orbit, replacing the card's DOM plate.
    expect(CORE_SOURCE).toContain('key={cell.id}');
    expect(INSET_SOURCE).toContain('<primitive object={braidCamera}>');
    expect(INSET_SOURCE).toContain('drawPortraitPlateGradient');
    expect(INSET_SOURCE).toContain('spatialPlateTail(accent)');
    expect(portraitPlateSize(40, 11)).toBeGreaterThan(8);
    expect(portraitPlateSize(40, 11)).toBeLessThan(9);
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
    // Labels ride the portrait square so their coordinates stay
    // square-relative on the shared canvas.
    expect(MEMORY_SOURCE).toContain('portal={CELL_PORTRAIT_LABEL_PORTAL');
  });
});
