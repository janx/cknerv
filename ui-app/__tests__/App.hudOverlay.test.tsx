import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HudOverlay } from '@cknerv/ui';

const APP_SOURCE = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

describe('HudOverlay wiring', () => {
  it('is importable from @cknerv/ui', () => {
    // Accept a plain function component or a React.memo wrapper (an exotic
    // component object whose `type` is the inner render function).
    const renderFn = typeof HudOverlay === 'function'
      ? HudOverlay
      : (HudOverlay as unknown as { type?: unknown }).type;
    expect(typeof renderFn).toBe('function');
  });

  it('hydrates the initial Cell cache once and shares it with the stream', () => {
    expect(APP_SOURCE.match(/fromCellsSnapshot\(/g)).toHaveLength(1);
    expect(APP_SOURCE).toContain('initialCellsCacheRef.current = initialCellsCache');
    expect(APP_SOURCE).toContain("'/api/projections/cells/stream',\n      initialCellsCache,");
  });

  it('owns the SoundCloud Jukebox as a floating app control', () => {
    expect(APP_SOURCE).toContain("import Jukebox from './Jukebox'");
    expect(APP_SOURCE).toContain(
      '      <Jukebox blockPulseAtMs={cellsCache.lastPulseAtMs} />',
    );
    expect(APP_SOURCE).not.toContain('topBarActions={<Jukebox');
  });

  it('routes each resolved identity proof from the scene inspector to the matching galaxy Cell', () => {
    expect(APP_SOURCE).toContain('onIdentityProofRead={confirmCellIdentityProof}');
    expect(APP_SOURCE).toContain('identityProof={cellIdentityProof}');
    expect(APP_SOURCE).toContain('kind,');
    expect(APP_SOURCE).toContain('const emittedAtMs = performance.now()');
    expect(APP_SOURCE).toContain('emittedAtMs,');
  });

  it('binds complete identity to the exact causal recall lifecycle', () => {
    expect(APP_SOURCE).toContain('cellIdentityJourneyReducer');
    expect(APP_SOURCE).toContain("type: 'resolve'");
    expect(APP_SOURCE).toContain('cellIdentityProofBindingComplete(');
    expect(APP_SOURCE).toContain("type: 'recall-start'");
    expect(APP_SOURCE).toContain("type: 'recall-retained'");
    expect(APP_SOURCE.match(
      /identityProofBinding=\{cellIdentityProofBinding\}/g,
    )).toHaveLength(2);
    expect(APP_SOURCE).toContain('onStart={beginOrbitInteraction}');
    expect(APP_SOURCE).toContain('onChange={changeOrbitInteraction}');
    expect(APP_SOURCE).toContain('onEnd={endOrbitInteraction}');
    expect(APP_SOURCE.match(
      /orbitGestureSuppressesPointerAction\(/g,
    )).toHaveLength(3);
  });

  it('threads no inspection field — the galaxy never dims for an open card', () => {
    expect(APP_SOURCE).not.toContain('CellInspectionField');
    expect(APP_SOURCE).not.toContain('inspectionFieldRef');
    expect(APP_SOURCE).not.toContain('inspectionCellId');
  });

  it('shares one camera-distance focus between Cell fabric and passive peers', () => {
    expect(APP_SOURCE).toContain(
      'const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, CELLS_Y, 0]',
    );
    expect(APP_SOURCE).toContain('function CellDetailViewTracker(');
    expect(APP_SOURCE).toContain('cellDetailViewFocus(Math.hypot(');
    expect(APP_SOURCE.match(
      /cellDetailViewFocusRef=\{cellDetailViewFocusRef\}/g,
    )).toHaveLength(2);
  });

  it('shares one real causal-lens model between the Cell-tethered inspector and scene', () => {
    expect(APP_SOURCE).toContain('deriveCellCausalLens(');
    expect(APP_SOURCE).toContain(
      'causalLens={selectedCausalLens}',
    );
    expect(APP_SOURCE).toContain('<CellCausalLensLayer');
    expect(APP_SOURCE).toContain('lens={selectedCausalLens}');
    expect(APP_SOURCE).toContain(
      'onNavigateCell={navigateCausalCell}',
    );
    expect(APP_SOURCE).toContain(
      "type: 'navigate',",
    );
    expect(APP_SOURCE).toContain('cellCausalNavigationReducer');
    expect(APP_SOURCE).toContain(
      'causalNavigation={selectedCausalNavigation}',
    );
    expect(APP_SOURCE).toContain('onBack: navigateCausalBack');
    expect(APP_SOURCE).toContain('onForward: navigateCausalForward');
  });

  it('keeps Cell detail out of the fixed HUD, tethered by an in-Galaxy anchor', () => {
    const hudWiring = APP_SOURCE.match(/<HudOverlay[\s\S]*?\/>/)?.[0];
    const anchorWiring = APP_SOURCE.match(
      /<CellInspectionAnchor[\s\S]*?\/>/,
    )?.[0];
    const inspectorWiring = APP_SOURCE.match(
      /<CellInspectionOverlay[\s\S]*?\/>/,
    )?.[0];

    expect(hudWiring).toBeDefined();
    expect(hudWiring).not.toContain('selectedCell=');
    expect(hudWiring).not.toContain('onClearCell=');
    // A Cell selection never reaches the HUD, not even as a dimmer flag.
    expect(hudWiring).not.toContain('cellInspectionActive');
    // The scene half projects from inside the Galaxy overlay. That overlay is
    // now hoisted into a memo — a fragment rebuilt at the call site would hand
    // the memoized CellGalaxy a fresh prop every App render — so the anchor
    // lives in `galaxyOverlay`, and `galaxyOverlay` is what the galaxy's
    // `overlay` slot receives, still inside the Canvas.
    expect(anchorWiring).toBeDefined();
    expect(anchorWiring).toContain('cell={selectedCell}');
    expect(anchorWiring).toContain('handles={cellInspectionHandles}');
    expect(APP_SOURCE.indexOf('<CellInspectionAnchor')).toBeGreaterThan(
      APP_SOURCE.indexOf('const galaxyOverlay = useMemo('),
    );
    expect(APP_SOURCE).toContain('overlay={galaxyOverlay}');
    expect(APP_SOURCE.indexOf('<CellInspectionAnchor')).toBeLessThan(
      APP_SOURCE.indexOf('</Canvas>'),
    );
    // …while the card DOM is a Canvas sibling, so its clicks can never fire
    // the R3F root's onPointerMissed.
    expect(inspectorWiring).toBeDefined();
    expect(inspectorWiring).toContain('cell={selectedCell}');
    expect(inspectorWiring).toContain('handles={cellInspectionHandles}');
    expect(inspectorWiring).toContain('onClose={clearCellSelection}');
    expect(inspectorWiring).toContain(
      'onScanInteractionChange={setCellScanInteractionActive}',
    );
    expect(APP_SOURCE.indexOf('<CellInspectionOverlay')).toBeGreaterThan(
      APP_SOURCE.indexOf('</Canvas>'),
    );
    expect(APP_SOURCE).not.toContain(
      "closest('[data-cell-inspection-overlay]')",
    );
    expect(APP_SOURCE).toContain('setCellScanInteractionActive(false);');
    expect(APP_SOURCE).toContain('enabled={!cellScanInteractionActive}');
    expect(APP_SOURCE).toContain('ref={cellGalaxyCanvasRef}');
    expect(APP_SOURCE).toContain(
      'restoreCellGalaxyFocus(cellGalaxyCanvasRef.current);',
    );
  });

  it('keeps one primary scene inspection target at a time', () => {
    expect(APP_SOURCE).toContain('setSelectedNetId(null);');
    expect(APP_SOURCE).toContain('clearCellSelection();\n      setSelectedNetId(id);');
  });

  it('adds validated optional semantics as one selected-Cell scene orbit', () => {
    expect(APP_SOURCE).toContain('<CellSemanticOrbit');
    expect(APP_SOURCE).toContain('record={selectedCellSemantics}');
    expect(APP_SOURCE).toContain('source={semanticsCache.source}');
    expect(APP_SOURCE).toContain('selectedCell && selectedCellSemantics');
  });

  it('routes the bounded optional ecosystem sample only through the HUD', () => {
    expect(APP_SOURCE).toContain('assetEcosystem={enrichmentConfig.enabled');
    expect(APP_SOURCE).toContain('? semanticsCache.assetEcosystem');
    expect(APP_SOURCE).not.toContain('<AssetEcosystemOrbit');
  });

  it('routes fixed-shape optional DAO state only through the HUD', () => {
    expect(APP_SOURCE).toContain('daoState={enrichmentConfig.enabled');
    expect(APP_SOURCE).toContain('? semanticsCache.daoState');
    expect(APP_SOURCE).not.toContain('<DaoStateOrbit');
  });

  it('routes fixed-shape optional protocol era only through the HUD', () => {
    expect(APP_SOURCE).toContain('protocolEra={enrichmentConfig.enabled');
    expect(APP_SOURCE).toContain('? semanticsCache.protocolEra');
    expect(APP_SOURCE).not.toContain('<ProtocolEraOrbit');
  });

  it('does not route optional fork watch into the default dashboard', () => {
    expect(APP_SOURCE).not.toContain('forkWatch=');
    expect(APP_SOURCE).not.toContain('semanticsCache.forkWatch');
    expect(APP_SOURCE).not.toContain('<ForkWatchOrbit');
  });

  it('routes the bounded optional activity feed only through the HUD', () => {
    expect(APP_SOURCE).toContain('activityFeed={enrichmentConfig.enabled');
    expect(APP_SOURCE).toContain('? semanticsCache.activityFeed');
    expect(APP_SOURCE).not.toContain('<ActivityFeedOrbit');
  });

  it('routes the bounded optional transaction horizon only through the HUD', () => {
    expect(APP_SOURCE).toContain('transactionHorizon={enrichmentConfig.enabled');
    expect(APP_SOURCE).toContain('? semanticsCache.transactionHorizon');
    expect(APP_SOURCE).not.toContain('<TransactionHorizonOrbit');
  });

  it('routes the bounded optional network atlas only through the HUD', () => {
    expect(APP_SOURCE).toContain('networkAtlas={enrichmentConfig.enabled');
    expect(APP_SOURCE).toContain('? semanticsCache.networkAtlas');
    expect(APP_SOURCE).not.toContain('<NetworkAtlasOrbit');
  });

  it('keeps Cell detail selection independent from camera automation', () => {
    const cameraWiring = APP_SOURCE.match(
      /<ConsensusRouteCamera[\s\S]*?\/>/,
    )?.[0];

    expect(cameraWiring).toBeDefined();
    expect(cameraWiring).not.toContain('inspectionCellId');
    expect(cameraWiring).not.toContain('causalLens');
    expect(cameraWiring).not.toContain('recordSwitchPending');
    expect(cameraWiring).not.toContain('selectedCell');
    expect(cameraWiring).toContain('recordTraceReadout={memoryTraceReadout}');
  });
});
