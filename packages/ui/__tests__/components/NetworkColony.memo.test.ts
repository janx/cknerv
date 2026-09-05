// The publish half of `memo(NetworkColony)`. The colony root is memo-wrapped
// with no comparator (see sceneRootsMemoized), but it read the calm-catch-up
// flag through `useCellGalaxyOptional()` — a `useContext` subscription that
// re-renders a component regardless of its memo, so the WHOLE colony subtree
// re-ran on EVERY cells publish, not just on a block (A2-4). The fix drops the
// subscription: the flag is handed down as a scalar prop the app recomputes in
// the same render that advances `blockPulseAtMs`, so shallow-compare is once
// again the honest gate the roots are designed around. The R3F scene does not
// render under jsdom (the Canvas gates at 0×0), so the contract is pinned at the
// source, in this suite's idiom; re-adding the subscription flips exactly the
// line the matching assertion names.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const COLONY_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/NetworkColony.tsx'),
  'utf8',
);
const APP_SOURCE = readFileSync(
  resolve(process.cwd(), '../../ui-app/src/App.tsx'),
  'utf8',
);

// Strip comments so a historical mention of the old hook in prose never trips
// the checks below — they must bind the actual code, not the documentation.
const COLONY_CODE = COLONY_SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('NetworkColony holds its memo across a cells publish', () => {
  it('subscribes to no cells-cache context — the shallow compare is honest', () => {
    // The subscription that bypassed the memo on every publish.
    expect(COLONY_CODE).not.toContain('useCellGalaxyOptional');
    expect(COLONY_CODE).not.toContain('useCellGalaxy(');
    // …and it no longer touches the cache object at all.
    expect(COLONY_CODE).not.toContain('cellsCache');
  });

  it('takes the calm catch-up gate as a scalar prop, defaulting off', () => {
    expect(COLONY_SOURCE).toContain('backfillActive?: boolean;');
    expect(COLONY_SOURCE).toContain('backfillActive = false,');
    // The gate still reaches the pulse effect and the child layers unchanged.
    expect(COLONY_SOURCE).toContain('if (backfillActive) return;');
    expect(COLONY_SOURCE).toContain('backfillActive={backfillActive}');
  });
});

describe('App feeds the colony the gate it used to subscribe for', () => {
  it('passes backfillActive from the cache, recomputed with blockPulseAtMs', () => {
    const at = APP_SOURCE.indexOf('<NetworkColony\n');
    expect(at).toBeGreaterThan(-1);
    const mount = APP_SOURCE.slice(at, APP_SOURCE.indexOf('/>', at));
    expect(mount).toContain('backfillActive={!!cellsCache.backfill}');
    // The block key and the gate are recomputed in the same render, so the
    // colony re-renders on a block or a backfill transition — never per publish.
    expect(mount).toContain('blockPulseAtMs={cellsCache.lastPulseAtMs}');
  });
});
