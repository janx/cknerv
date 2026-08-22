// What a selected Cell keeps paying for after its proofs are over.
//
// A proof marker is a bounded event, but nothing about it used to end: the
// echo settles, `visible` retires the draws, and the screen-space label and
// the terminal billboard go on re-projecting themselves for the rest of the
// selection because the galaxy never stops turning. The identity knot has the
// same shape of problem in its terminal `retained` phase.
//
// These components are Canvas-bound only through `useFrame` / `useThree` (the
// ConsensusRouteCamera precedent), so a mocked r3f holds them. React DOM
// renders `<group>` and `<meshBasicMaterial>` as unknown elements without the
// three properties the frame loop writes, so the test hands each host stand-in
// the fields it is about to be asked for — and counts every write that lands
// on them, which is the whole measurement.
import { type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  CELL_IDENTITY_PROOF_KINDS,
  type CellIdentityProofBinding,
  type CellIdentityProofEvent,
  type CellIdentityProofKind,
} from '../../src/derives/cellIdentityProof.derive';
import CellIdentityBindingGlyph
  from '../../src/components/CellIdentityBindingGlyph';
import CellIdentityProofMarker
  from '../../src/components/CellIdentityProofMarker';

const frames = vi.hoisted(() => ({
  callback: null as null | ((state: unknown) => void),
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown) => void) => {
    frames.callback = callback;
  },
  useThree: (selector?: (state: unknown) => unknown) => {
    const state = { size: { width: 1280, height: 720 } };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@react-three/drei', async () => {
  const { forwardRef } = await import('react');
  return {
    Html: ({ children }: { children?: ReactNode }) => (
      <div data-drei-html="true">{children}</div>
    ),
    Billboard: forwardRef<HTMLDivElement, { children?: ReactNode }>(
      function Billboard({ children }, ref) {
        return <div data-drei-billboard="true" ref={ref}>{children}</div>;
      },
    ),
  };
});

const FRAME_STATE = {
  size: { width: 1280, height: 720 },
  clock: { elapsedTime: 0 },
};

/** Long past every echo duration, so each marker reads its settled frame. */
const AFTER_THE_ECHO_S = 4;

function cell(id: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 8_421_504,
    tag: null,
    pos_seed: [3, 12, -4],
    out_point: { tx_hash: `0x${'a'.repeat(64)}`, index: 2 },
    capacity: 0,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${'b'.repeat(64)}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

function proofEvent(
  kind: CellIdentityProofKind,
  sequence: number,
): CellIdentityProofEvent {
  return { kind, cellId: 7, sequence, emittedAtMs: 0, reducedMotion: false };
}

function bindingAt(
  overrides: Partial<CellIdentityProofBinding> = {},
): CellIdentityProofBinding {
  return {
    cellId: 7,
    resolvedKinds: CELL_IDENTITY_PROOF_KINDS,
    phase: 'retained',
    revision: 4,
    changedAtMs: 9_000,
    lastResolvedKind: 'anchor',
    reducedMotion: false,
    ...overrides,
  };
}

/** The audit bag every marker publishes its frame state into. */
function seedGroupUserData(container: HTMLElement): void {
  for (const node of Array.from(container.querySelectorAll('group'))) {
    const host = node as unknown as { userData?: Record<string, unknown> };
    if (!host.userData) host.userData = {};
  }
}

/** Every three field the glyph's frame writes, counted. */
function seedGlyphHosts(container: HTMLElement): { count: number } {
  const probe = { count: 0 };
  const root = container.querySelector('group') as unknown as {
    userData: Record<string, unknown>;
    rotation: { z: number };
    scale: { setScalar: (value: number) => void };
  };
  root.userData = new Proxy({} as Record<string, unknown>, {
    set(store, key, value) {
      probe.count += 1;
      store[key as string] = value;
      return true;
    },
  });
  const rotation = {} as { z: number };
  let rotationZ = 0;
  Object.defineProperty(rotation, 'z', {
    configurable: true,
    get: () => rotationZ,
    set: (value: number) => {
      probe.count += 1;
      rotationZ = value;
    },
  });
  root.rotation = rotation;
  root.scale = { setScalar: () => { probe.count += 1; } };
  const materials = Array.from(
    container.querySelectorAll('meshBasicMaterial'),
  );
  for (const node of materials) {
    const material = node as unknown as {
      color: THREE.Color;
      opacity: number;
    };
    material.color = new THREE.Color();
    let opacity = 0;
    Object.defineProperty(material, 'opacity', {
      configurable: true,
      get: () => opacity,
      set: (value: number) => {
        probe.count += 1;
        opacity = value;
      },
    });
  }
  return probe;
}

describe('settled identity proofs', () => {
  afterEach(() => {
    cleanup();
    frames.callback = null;
    vi.restoreAllMocks();
  });

  for (const kind of CELL_IDENTITY_PROOF_KINDS) {
    it(`retires the ${kind} proof's DOM once its echo settles`, () => {
      const view = render(
        <CellIdentityProofMarker
          cell={cell(7)}
          event={proofEvent(kind, 1)}
          sampleElapsedSeconds={AFTER_THE_ECHO_S}
        />,
      );
      const { container } = view;
      expect(container.querySelector('[data-drei-html]')).not.toBeNull();
      seedGroupUserData(container);

      act(() => frames.callback?.(FRAME_STATE));

      // Hiding the group would only retire the draws; the label and the
      // terminal billboard stop costing frames by leaving.
      expect(container.querySelector('[data-drei-html]')).toBeNull();
      expect(container.querySelector('[data-drei-billboard]')).toBeNull();

      // Reading the same facet again re-arms the proof: the label is back in
      // the very render that carries the new sequence, still saying what the
      // markup says, and the frame loop is publishing to it again.
      view.rerender(
        <CellIdentityProofMarker
          cell={cell(7)}
          event={proofEvent(kind, 2)}
          sampleElapsedSeconds={AFTER_THE_ECHO_S}
        />,
      );
      const rearmed = container.querySelector<HTMLElement>(
        '[data-memory-identity-proof-label]',
      );
      expect(rearmed).not.toBeNull();
      expect(rearmed?.dataset.memoryIdentityProofLabelState).toBe('idle');

      seedGroupUserData(container);
      act(() => frames.callback?.(FRAME_STATE));
      expect(rearmed?.dataset.memoryIdentityProofLabelState).toBe('settled');
      expect(container.querySelector('[data-drei-html]')).toBeNull();
    });
  }
});

describe('the identity binding knot at rest', () => {
  afterEach(() => {
    cleanup();
    frames.callback = null;
    vi.restoreAllMocks();
  });

  it('stops writing once a retained knot has finished arriving', () => {
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
    const view = render(
      <CellIdentityBindingGlyph binding={bindingAt()} mode="scene" />,
    );
    const probe = seedGlyphHosts(view.container);
    // Watched from here, so the stand-in colours the seeding built do not
    // count as frame work.
    const colorSet = vi.spyOn(THREE.Color.prototype, 'set');
    const colorCopy = vi.spyOn(THREE.Color.prototype, 'copy');

    act(() => frames.callback?.(FRAME_STATE));
    expect(probe.count).toBeGreaterThan(0);
    // The centre palette is parsed at module load and copied from there; a
    // hex string never reaches the frame path.
    expect(colorCopy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(colorSet).not.toHaveBeenCalled();

    probe.count = 0;
    for (let frame = 1; frame <= 5; frame += 1) {
      act(() => frames.callback?.({
        ...FRAME_STATE,
        clock: { elapsedTime: frame },
      }));
    }
    expect(probe.count).toBe(0);
  });

  it('lets a retained arrival finish easing before it signs off', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000);
    const view = render(
      <CellIdentityBindingGlyph
        binding={bindingAt({ changedAtMs: 9_900 })}
        mode="scene"
      />,
    );
    const probe = seedGlyphHosts(view.container);

    // A tenth of a second in, the knot is still growing into place.
    act(() => frames.callback?.(FRAME_STATE));
    expect(probe.count).toBeGreaterThan(0);
    probe.count = 0;
    act(() => frames.callback?.(FRAME_STATE));
    expect(probe.count).toBeGreaterThan(0);

    // Past the 0.52 s transition the frame paints the resting figures once
    // and then has nothing left to say.
    now.mockReturnValue(10_600);
    probe.count = 0;
    act(() => frames.callback?.(FRAME_STATE));
    expect(probe.count).toBeGreaterThan(0);
    probe.count = 0;
    act(() => frames.callback?.(FRAME_STATE));
    expect(probe.count).toBe(0);
  });

  it('re-paints the knot when the binding changes underneath it', () => {
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
    const view = render(
      <CellIdentityBindingGlyph binding={bindingAt()} mode="scene" />,
    );
    const probe = seedGlyphHosts(view.container);
    act(() => frames.callback?.(FRAME_STATE));
    probe.count = 0;
    act(() => frames.callback?.(FRAME_STATE));
    expect(probe.count).toBe(0);

    view.rerender(
      <CellIdentityBindingGlyph
        binding={bindingAt({ revision: 5 })}
        mode="scene"
      />,
    );
    act(() => frames.callback?.(FRAME_STATE));
    expect(probe.count).toBeGreaterThan(0);
  });

  it('never signs off on a phase that is still moving', () => {
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
    const view = render(
      <CellIdentityBindingGlyph
        binding={bindingAt({ phase: 'recalling', changedAtMs: 1_000 })}
        mode="scene"
      />,
    );
    const probe = seedGlyphHosts(view.container);

    for (let frame = 0; frame < 3; frame += 1) {
      probe.count = 0;
      act(() => frames.callback?.({
        ...FRAME_STATE,
        clock: { elapsedTime: frame },
      }));
      expect(probe.count).toBeGreaterThan(0);
    }
  });

  it('keeps the centre palette as reused colours, not hex in the loop', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/CellIdentityBindingGlyph.tsx'),
      'utf8',
    );
    expect(source).toContain('new THREE.Color(');
    expect(source).toContain('.color.copy(centreColor)');
    expect(source).not.toMatch(/\.set\('#/);
  });
});
