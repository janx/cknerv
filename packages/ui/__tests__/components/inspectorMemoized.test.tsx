// The Cell inspector is the DOM half of a selection: a 2,200-line dossier
// rendered as a Canvas sibling. App renders several times a second for things
// no card reads — a mempool tick, a peer poll, a hover the scene answered —
// and an unmemoized inspector re-ran the whole dossier on each of them. These
// pins are runtime, not source-string: they read the exported value's React
// tag, so they survive a rename or a reformat and fail only if the wrapper is
// actually dropped.
import { describe, expect, it } from 'vitest';
import CellInspectionOverlay from '../../src/components/CellInspectionOverlay';
import CellDetailPanel from '../../src/components/hud/CellDetailPanel';

const MEMO = Symbol.for('react.memo');

interface MemoLike {
  $$typeof?: symbol;
  type?: { name?: string };
  compare?: unknown;
}

describe('the Cell inspector is memoized', () => {
  it.each([
    ['CellInspectionOverlay', CellInspectionOverlay],
    ['CellDetailPanel', CellDetailPanel],
  ])('%s exports a memo wrapper around its own render function', (name, component) => {
    const exported = component as unknown as MemoLike;

    expect(exported.$$typeof).toBe(MEMO);
    expect(typeof exported.type).toBe('function');
    // The wrapper keeps the component's name, so React DevTools and every
    // error boundary still say which one threw.
    expect(exported.type?.name).toBe(name);
    // No custom comparator: every prop is a value, a ref or a callback App
    // already holds by identity, so React's shallow compare is the honest one.
    expect(exported.compare == null).toBe(true);
  });
});
