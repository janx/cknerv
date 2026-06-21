import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { useReducedMotion } from '../../../src/components/hud/useReducedMotion';

function Probe() { return <span>{String(useReducedMotion())}</span>; }

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: true, media: q, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe('useReducedMotion', () => {
  it('reflects the prefers-reduced-motion media query', () => {
    const { container } = render(<Probe />);
    expect(container.textContent).toBe('true');
  });
});
