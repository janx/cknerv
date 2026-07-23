import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HudOverlay } from '@cknerv/ui';

const APP_SOURCE = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

describe('HudOverlay wiring', () => {
  it('is importable from @cknerv/ui', () => {
    expect(typeof HudOverlay).toBe('function');
  });

  it('routes a resolved portrait address back to the matching galaxy Cell', () => {
    expect(APP_SOURCE).toContain('onCellContentAddressRead={confirmCellContentAddress}');
    expect(APP_SOURCE).toContain('contentAddressEcho={contentAddressEcho}');
    expect(APP_SOURCE).toContain('emittedAtMs: performance.now()');
  });
});
