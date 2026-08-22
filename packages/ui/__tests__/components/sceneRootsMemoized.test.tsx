// The three scene roots are the only components the dashboard mounts that run
// thousand-line hook bodies, and App holds every piece of dashboard state in
// one component — so an unmemoized root re-ran all of it for a chain poll, a
// stream-health flip or a note that the user had dragged the camera. These pins
// are runtime, not source-string: they read the exported value's React tag, so
// they survive a rename or a reformat and fail only if the wrapper is actually
// dropped.
import { describe, expect, it } from 'vitest';
import CellGalaxy from '../../src/components/CellGalaxy';
import NetworkColony from '../../src/components/NetworkColony';
import NeuralNetwork from '../../src/nerve/NeuralNetwork';

const MEMO = Symbol.for('react.memo');

interface MemoLike {
  $$typeof?: symbol;
  type?: { name?: string };
  compare?: unknown;
}

describe('scene roots are memoized', () => {
  it.each([
    ['CellGalaxy', CellGalaxy],
    ['NeuralNetwork', NeuralNetwork],
    ['NetworkColony', NetworkColony],
  ])('%s exports a memo wrapper around its own render function', (
    name,
    root,
  ) => {
    const exported = root as unknown as MemoLike;

    expect(exported.$$typeof).toBe(MEMO);
    expect(typeof exported.type).toBe('function');
    // The wrapper keeps the component's name, so React DevTools and every
    // error boundary still say which root threw.
    expect(exported.type?.name).toBe(name);
    // No custom comparator: these roots take refs, scalars and values their
    // consumer already memoizes, so React's shallow compare is the honest one.
    // A hand-written comparator that skipped a prop would freeze whatever that
    // prop drives — most dangerously the `overlay` slot, whose children are
    // real layers with props of their own.
    expect(exported.compare == null).toBe(true);
  });
});
