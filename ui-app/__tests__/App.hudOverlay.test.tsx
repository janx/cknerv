import { describe, it, expect } from 'vitest';
import { HudOverlay } from '@cknerv/ui';

describe('HudOverlay wiring', () => {
  it('is importable from @cknerv/ui', () => {
    expect(typeof HudOverlay).toBe('function');
  });
});
