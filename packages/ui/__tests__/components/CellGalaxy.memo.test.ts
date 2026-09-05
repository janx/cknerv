// The wiring half of `memo(CellGalaxy)`. The two scalars that change value
// every block — the unresolved-population amount and the local receive delay —
// defeated the memo when passed as props (App re-rendered ~40 fibers incl. a
// drei Html portal every block). The fix carries both by ref, read in the
// frame loop, following the `cellDetailViewFocusRef` precedent. The R3F scene
// does not render under jsdom (the Canvas gates at 0×0), so — as the rest of
// this suite does for the canopy's frame-lane discipline — the contract is
// pinned at the source. Reverting either channel to a value prop re-defeats the
// memo and flips exactly the line the matching assertion names.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_SOURCE = readFileSync(
  resolve(process.cwd(), '../../ui-app/src/App.tsx'),
  'utf8',
);
const GALAXY_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/CellGalaxy.tsx'),
  'utf8',
);

describe('App hands CellGalaxy the two per-block scalars by ref', () => {
  it('mirrors the live amount and receive delay into caller-owned refs', () => {
    // Identity-stable refs App updates every render; the memoized child never
    // sees a changed prop because of them.
    expect(APP_SOURCE).toContain('populationGainRef.current = cellPopulation.gain;');
    expect(APP_SOURCE).toContain('localReceiveDelaySRef.current = cf.localReceiveDelayS;');
    // The placement gate stays reactive but stable across blocks.
    expect(APP_SOURCE).toContain('const populationActive = cellPopulation.gain > 0;');
  });

  it('passes populationGainRef + populationActive, never the raw amount', () => {
    expect(APP_SOURCE).toContain('populationGainRef={populationGainRef}');
    expect(APP_SOURCE).toContain('populationActive={populationActive}');
    // The pre-fix wiring that defeated the memo every block.
    expect(APP_SOURCE).not.toContain('populationGain={cellPopulation.gain}');
  });

  it('passes localReceiveDelaySRef, never the raw delay', () => {
    expect(APP_SOURCE).toContain('localReceiveDelaySRef={localReceiveDelaySRef}');
    expect(APP_SOURCE).not.toContain('localReceiveDelayS={cf.localReceiveDelayS}');
  });
});

describe('CellGalaxy reads the two scalars live, from refs', () => {
  it('takes them as refs and a stable gate, not as churning value props', () => {
    expect(GALAXY_SOURCE).toContain('populationGainRef?: { readonly current: number }');
    expect(GALAXY_SOURCE).toContain('populationActive?: boolean');
    expect(GALAXY_SOURCE).toContain('localReceiveDelaySRef?: { readonly current: number }');
    // The value props that used to defeat the memo are gone from the interface.
    expect(GALAXY_SOURCE).not.toContain('populationGain?: number');
    expect(GALAXY_SOURCE).not.toContain('localReceiveDelayS?: number');
  });

  it('reads the receive delay from the ref inside the frame loop', () => {
    expect(GALAXY_SOURCE).toContain(
      'const receiveDelayS = localReceiveDelaySRef?.current ?? 0;',
    );
  });

  it('hands the population field the ref and the gate', () => {
    expect(GALAXY_SOURCE).toContain('gainRef={populationGainRef}');
    expect(GALAXY_SOURCE).toContain('active={populationActive}');
  });
});
