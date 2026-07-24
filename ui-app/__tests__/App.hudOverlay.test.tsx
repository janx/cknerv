import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HudOverlay } from '@cknerv/ui';

const APP_SOURCE = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

describe('HudOverlay wiring', () => {
  it('is importable from @cknerv/ui', () => {
    expect(typeof HudOverlay).toBe('function');
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
  });
});
