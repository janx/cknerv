import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HudOverlay } from '@cknerv/ui';

const APP_SOURCE = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

describe('HudOverlay wiring', () => {
  it('is importable from @cknerv/ui', () => {
    expect(typeof HudOverlay).toBe('function');
  });

  it('owns the SoundCloud Jukebox as a floating app control', () => {
    expect(APP_SOURCE).toContain("import Jukebox from './Jukebox'");
    expect(APP_SOURCE).toContain('      <Jukebox />');
    expect(APP_SOURCE).not.toContain('topBarActions={<Jukebox />}');
  });

  it('routes each resolved identity proof back to the matching galaxy Cell', () => {
    expect(APP_SOURCE).toContain('onCellIdentityProofRead={confirmCellIdentityProof}');
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
    expect(APP_SOURCE).toContain(
      'cellIdentityProofBinding={cellIdentityProofBinding}',
    );
    expect(APP_SOURCE).toContain(
      'identityProofBinding={cellIdentityProofBinding}',
    );
    expect(APP_SOURCE).toContain(
      'inspectionCellId={selectedCell?.id ?? null}',
    );
    expect(APP_SOURCE).toContain('onStart={beginOrbitInteraction}');
    expect(APP_SOURCE).toContain('onChange={changeOrbitInteraction}');
    expect(APP_SOURCE).toContain('onEnd={endOrbitInteraction}');
    expect(APP_SOURCE).toContain(
      'orbitGestureSuppressesPointerMiss(',
    );
  });

  it('shares one selected-Cell topology field between bodies and fibres', () => {
    expect(APP_SOURCE).toContain(
      'useRef<CellInspectionField | null>(null)',
    );
    expect(APP_SOURCE.match(
      /inspectionFieldRef=\{cellInspectionFieldRef\}/g,
    )).toHaveLength(2);
    expect(APP_SOURCE).toContain(
      'cellInspectionActive={selectedCell !== null}',
    );
  });

  it('shares one real causal-lens model between the HUD and scene', () => {
    expect(APP_SOURCE).toContain('deriveCellCausalLens(');
    expect(APP_SOURCE).toContain(
      'cellCausalLens={selectedCausalLens}',
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
      'cellCausalNavigation={selectedCausalNavigation}',
    );
    expect(APP_SOURCE).toContain('causalLens={selectedCausalLens}');
    expect(APP_SOURCE).toContain('onBack: navigateCausalBack');
    expect(APP_SOURCE).toContain('onForward: navigateCausalForward');
  });
});
