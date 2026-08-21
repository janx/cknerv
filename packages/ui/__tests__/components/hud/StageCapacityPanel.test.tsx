import { emptyScriptCensus } from '@cknerv/cache';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import StageCapacityPanel from '../../../src/components/hud/StageCapacityPanel';
import {
  chainLiveRow,
  formatPopulationRatio,
  populationCompositionMixes,
  populationMediumRows,
  populationRows,
} from '../../../src/components/hud/cellPopulation.presentation';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';
import {
  populationReviewScenarios,
  type PopulationReviewScenario,
} from '../../fixtures/cellPopulationFieldReview';

afterEach(cleanup);

const stats: CellsStats = {
  born: 28_431,
  live: 19_204,
  dead: 9_227,
  byKind: { wallet: 0, dex: 0, cf: 0, ckbloom: 0, generic: 19_204 },
  capacityShannons: 121_000_000_000_000_000,
  inView: 4_983,
  dataBearing: 1_545,
  byLock: { sighash: 3_200, multisig: 1_100, acp: 450, omnilock: 0, other: 233 },
  byAsset: { native: 3_500, sudt: 900, xudt: 350, dao: 200, spore: 33, other: 0 },
  scripts: emptyScriptCensus(),
};

const scenarios = populationReviewScenarios();

function scenario(id: string): PopulationReviewScenario {
  const found = scenarios.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown review scenario: ${id}`);
  return found;
}

function renderScenario(id: string) {
  return render(
    <StageCapacityPanel stats={stats} model={scenario(id).model} />,
  );
}

function textOf(id: string): string {
  return renderScenario(id).container.textContent ?? '';
}

describe('formatPopulationRatio', () => {
  it('keeps the precision the magnitude deserves', () => {
    // 4.2 rounded to 4 loses the point; 1,574 gains nothing from a decimal.
    expect(formatPopulationRatio(4.17)).toBe('1 : 4.2');
    expect(formatPopulationRatio(122.6)).toBe('1 : 123');
    expect(formatPopulationRatio(1574.2)).toBe('1 : 1,574');
    expect(formatPopulationRatio(0)).toBe('—');
  });
});

describe('every count carries the scope it is true in', () => {
  it('never prints an unqualified population number', () => {
    for (const entry of scenarios) {
      for (const row of populationRows(entry.model)) {
        expect(row.scope, `${entry.id} / ${row.label}`).not.toBe('');
      }
    }
  });

  it('calls the observation window a replay window, not a chain total', () => {
    const rows = populationRows(scenario('retained-scope').model);
    const observed = rows.find((row) => row.label === 'Observed');

    expect(observed?.scope).toBe('REPLAY WINDOW');
  });

  it('refuses to call a fallback scan a complete retained window', () => {
    const full = populationRows(scenario('retained-scope').model)
      .find((row) => row.label === 'Retained');
    const partial = populationRows(scenario('partial-retained-stats').model)
      .find((row) => row.label === 'Retained');

    expect(full?.scope).toBe('LOCAL WINDOW');
    expect(partial?.scope).toBe('RECEIVED ROWS');
  });

  it('keeps chain truth out of the local funnel', () => {
    // The census renders in the chain block, under its own anchor. A chain
    // total between two local windows is the exact interleaving this layout
    // was rebuilt to remove.
    for (const entry of scenarios) {
      const labels = populationRows(entry.model).map((row) => row.label);
      expect(labels, entry.id).not.toContain('Chain live');
    }
  });
});

describe('chainLiveRow', () => {
  it('says UNAVAILABLE rather than substituting a number it cannot prove', () => {
    expect(chainLiveRow(null, false)).toEqual({
      value: 'UNAVAILABLE',
      tag: 'NO VALIDATED CENSUS',
      dim: true,
    });
  });

  it('leans on the block anchor only when it is exactly its own', () => {
    const census = scenario('chain-scope-mainnet').model.chainCensus!;
    expect(chainLiveRow(census, false, census.as_of.block).tag).toBeNull();
    expect(chainLiveRow(census, false, census.as_of.block + 2).tag)
      .toBe(`AS OF #${census.as_of.block.toLocaleString('en-US')}`);
  });

  it('keeps a stale census, labeled and dimmed', () => {
    const model = scenario('stale-census').model;
    const row = chainLiveRow(model.chainCensus, model.censusStale, model.chainCensus!.as_of.block);
    expect(row.tag).toContain('STALE');
    expect(row.tag).toContain('AS OF #');
    expect(row.dim).toBe(true);
  });
});

describe('the funnel', () => {
  it('lists the local windows in widening order', () => {
    const labels = populationRows(scenario('chain-scope-mainnet').model)
      .map((row) => row.label);
    expect(labels).toEqual(['Rendered', 'Retained', 'Observed']);
  });

  it('discloses both numbers under a manual clamp', () => {
    const rows = populationRows(scenario('manual-clamp').model);
    const labels = rows.map((row) => row.label);

    expect(labels).toContain('Rendered');
    expect(labels).toContain('Server stage');
    expect(rows.find((row) => row.label === 'Server stage')?.scope)
      .toBe('MEMBERS');
  });

  it('shows only one addressable row when the budget covers the stage', () => {
    const labels = populationRows(scenario('chain-scope-mainnet').model)
      .map((row) => row.label);

    expect(labels).not.toContain('Server stage');
  });

  it('draws every step on one shared scale', () => {
    const model = scenario('chain-scope-mainnet').model;
    const { container } = renderScenario('chain-scope-mainnet');
    const rows = populationRows(model);
    const max = Math.max(...rows.map((row) => row.count), 1);

    const widths = rows.map((row) => parseFloat(
      container.querySelector<HTMLElement>(
        `[data-funnel-fill="${row.label}"]`,
      )!.style.width,
    ));
    rows.forEach((row, index) => {
      expect(widths[index]).toBeCloseTo((row.count / max) * 100, 5);
    });
    // The widest local window fills the track; the staircase down from it is
    // the narrowing a reader is meant to see without computing digits.
    expect(Math.max(...widths)).toBe(100);
    expect(widths[0]).toBeLessThan(widths[widths.length - 1]);
  });
});

describe('composition disclosure', () => {
  it('shows the two mixes side by side, never one as the other', () => {
    const mixes = populationCompositionMixes(scenario('chain-scope-mainnet').model);

    expect(mixes.map((mix) => mix.label)).toEqual(['Stage mix', 'Chain mix']);
    // The curated stage is 30:40:30 by policy; mainnet is nothing like it.
    expect(mixes[0]).toMatchObject({ dao: '30%', typed: '40%', plain: '30%' });
    expect(mixes[1]).toMatchObject({ dao: '2%', typed: '32%', plain: '66%' });
    expect(mixes[0].scope).toBe('CURATED');
    expect(mixes[1].scope).toContain('AS OF #');
  });

  it('does not call an insertion-order prefix a curation choice', () => {
    const mixes = populationCompositionMixes(scenario('uncurated-stage').model);
    expect(mixes[0].scope).toBe('INSERTION ORDER');
  });

  it('discloses no composition at all without a proven partition', () => {
    expect(populationCompositionMixes(scenario('census-without-classes').model))
      .toEqual([]);
    expect(textOf('census-without-classes')).not.toContain('Chain mix');
  });

  it('never rounds a bin holding real Cells down to absence', () => {
    const mixes = populationCompositionMixes(scenario('chain-scope-testnet').model);
    // Testnet DAO is 0.04% of the chain. It exists, so it must not read 0%,
    // and its bar segment keeps a visible sliver instead of vanishing.
    expect(mixes[1].dao).toBe('<1%');

    const { container } = renderScenario('chain-scope-testnet');
    const chainMix = container.querySelector('[data-population-mix="Chain mix"]')!;
    const segment = chainMix.querySelector<HTMLElement>('[data-mix-segment="dao"]')!;
    expect(segment.style.minWidth).toBe('1px');
  });

  it('draws both mixes as bars a reader can compare at a glance', () => {
    const { container } = renderScenario('chain-scope-mainnet');
    const stage = container.querySelector('[data-population-mix="Stage mix"]')!;
    const chain = container.querySelector('[data-population-mix="Chain mix"]')!;

    for (const mix of [stage, chain]) {
      expect(mix.querySelectorAll('[data-mix-segment]').length).toBe(3);
    }
    const stageDao = parseFloat(
      stage.querySelector<HTMLElement>('[data-mix-segment="dao"]')!.style.width,
    );
    const chainDao = parseFloat(
      chain.querySelector<HTMLElement>('[data-mix-segment="dao"]')!.style.width,
    );
    // The stage's deliberate DAO bias must be visible as geometry.
    expect(stageDao).toBeGreaterThan(chainDao * 5);
  });

  it('dims a mix measured against a stale census', () => {
    const { container } = renderScenario('stale-census');
    expect(container.querySelector<HTMLElement>(
      '[data-population-mix="Chain mix"]',
    )?.style.opacity).toBe('0.6');
    expect(container.querySelector<HTMLElement>(
      '[data-population-mix="Stage mix"]',
    )?.style.opacity).toBe('1');
  });
});

describe('the medium legend', () => {
  it('explains the two channels before anyone can try to click the field', () => {
    const text = textOf('chain-scope-mainnet');

    expect(text).toContain('Bright bodies');
    expect(text).toContain('INTERACTIVE CELLS');
    expect(text).toContain('Faint swarm');
    expect(text).toContain('NON-ADDRESSABLE');
  });

  it('states the scope the swarm claims and how far the stage falls short', () => {
    const mainnet = populationMediumRows(scenario('chain-scope-mainnet').model)[1].meaning;
    const testnet = populationMediumRows(scenario('chain-scope-testnet').model)[1].meaning;
    const retained = populationMediumRows(scenario('retained-scope').model)[1].meaning;

    expect(mainnet).toContain('CHAIN SCOPE');
    expect(mainnet).toContain('1 : 123');
    expect(testnet).toContain('1 : 1,574');
    expect(mainnet).not.toBe(testnet);
    expect(retained).toContain('RETAINED SCOPE');
  });

  it('says nothing is unresolved when nothing is', () => {
    const meaning = populationMediumRows(scenario('stage-covers-scope').model)[1].meaning;

    expect(meaning).toContain('NOTHING UNRESOLVED');
    expect(meaning).not.toContain('NON-ADDRESSABLE ·');
  });

  it('never prints the renderer gain', () => {
    for (const entry of scenarios) {
      const meanings = populationMediumRows(entry.model)
        .map((row) => row.meaning).join(' ');
      const gain = entry.model.gain.toFixed(2);
      if (entry.model.gain > 0) {
        expect(meanings, entry.id).not.toContain(gain);
      }
    }
  });
});

describe('the block', () => {
  it('holds local truth only, with the chain mix present as a labeled comparison', () => {
    const text = textOf('chain-scope-mainnet');

    expect(text).toContain('STAGE SAMPLE');
    // Its own panel identity, in the shared header system.
    expect(text).toContain('样本');
    expect(text).toContain('STAGE·07');
    // Capacity is a CKB amount, so it reads in the HUD-wide K/M/G family.
    expect(text).toContain('1.21 G CKB');
    expect(text).not.toContain('CHAIN CAPACITY');
    expect(text).not.toContain('Live capacity');
    expect(text).not.toContain('Chain live');
    // The one chain-scope line it keeps is the comparison the curation
    // disclosure exists for, and that line carries its own anchor.
    expect(text).toContain('Chain mix');
    expect(text).toContain('AS OF #');
  });

  it('keeps the four-family bars while the backend has counted nothing', () => {
    // A backend predating the census, or a galaxy restored from state written
    // before script identities existed: an empty census is not a distribution.
    const { container } = render(<StageCapacityPanel stats={stats} model={null} />);
    const text = container.textContent ?? '';
    expect(text).toContain('ASSETS');
    expect(text).toContain('LOCKS');
    expect(text).toContain('default 64%');
    expect(text).toContain('multisig 22%');
  });

  it('bars the real script families once the backend counts by identity', () => {
    const hash = (byte: string) => `0x${byte.repeat(32)}`;
    const counted: CellsStats = {
      ...stats,
      scripts: {
        locks: [
          { script: { code_hash: hash('9b'), hash_type: 'type' }, count: 3_000 },
          { script: { code_hash: hash('d0'), hash_type: 'type' }, count: 1_500 },
        ],
        locks_tail_cells: 0,
        locks_tail_scripts: 0,
        types: [{ script: { code_hash: hash('50'), hash_type: 'data1' }, count: 400 }],
        types_tail_cells: 0,
        types_tail_scripts: 0,
        types_absent: 4_100,
        unidentified: 0,
      },
    };
    const { container } = render(
      <StageCapacityPanel
        stats={counted}
        model={null}
        scriptRegistry={{
          source: 'ckbadger',
          as_of: { block: 100, hash: '0xblock100' },
          updated_at_ms: 1,
          entries: [
            { code_hash: hash('9b'), hash_type: 'type', name: 'Default Lock', deprecated: false },
            { code_hash: hash('50'), hash_type: 'data1', name: 'xUDT', deprecated: false },
          ],
          unresolved: 1,
        }}
      />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('Default Lock 67%');
    expect(text).toContain('xUDT 9%');
    expect(text).not.toMatch(/ 0%/);
    // The one family nothing named keeps its identity instead of joining a
    // bucket with everything else cknerv cannot place.
    expect(text).toContain('0xd0d0…0d0 33%');
    // And the four-family fallback vocabulary is gone, not shown alongside.
    expect(text).not.toContain('multisig');
    expect(text).not.toContain('sUDT');
  });

  it('collapses the legend names a 99% bar cannot show', () => {
    const hash = (byte: string) => `0x${byte.repeat(32)}`;
    const dominated: CellsStats = {
      ...stats,
      scripts: {
        locks: [
          { script: { code_hash: hash('9b'), hash_type: 'type' }, count: 10_000 },
          { script: { code_hash: hash('d0'), hash_type: 'type' }, count: 20 },
        ],
        locks_tail_cells: 30,
        locks_tail_scripts: 16,
        types: [],
        types_tail_cells: 0,
        types_tail_scripts: 0,
        types_absent: 10_050,
        unidentified: 0,
      },
    };
    const { container } = render(
      <StageCapacityPanel
        stats={dominated}
        model={null}
        scriptRegistry={{
          source: 'ckbadger',
          as_of: { block: 100, hash: '0xblock100' },
          updated_at_ms: 1,
          entries: [
            { code_hash: hash('9b'), hash_type: 'type', name: 'Default Lock', deprecated: false },
            { code_hash: hash('d0'), hash_type: 'type', name: 'JoyID', deprecated: false },
          ],
          unresolved: 0,
        }}
      />,
    );
    const text = container.textContent ?? '';

    // A name whose share the bar cannot draw is not a legend entry — it is a
    // claim of presence beside no visible presence. It folds into one honest
    // tail count and survives in full on the bar's tooltip.
    expect(text).not.toContain('JoyID');
    expect(text).toContain('+17 <1%');
    const bars = Array.from(container.querySelectorAll<HTMLElement>('[title]'));
    expect(bars.some((bar) => bar.title.includes('JoyID <1%'))).toBe(true);
  });

  it('shows the plain retained count for a consumer that derives no model', () => {
    const { container } = render(<StageCapacityPanel stats={stats} model={null} />);
    const text = container.textContent ?? '';

    expect(text).toContain('4,983');
    expect(text).toContain('LOCAL WINDOW');
    expect(container.querySelector('[data-funnel-fill]')).toBeNull();
    expect(container.querySelector('[data-population-medium]')).toBeNull();
    expect(container.querySelector('[data-population-mix]')).toBeNull();
  });

  it('reads the drawn colony as an inference, never as a census', () => {
    const { container } = render(
      <StageCapacityPanel stats={stats} model={null} colonyCount={277} />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('Colony');
    expect(text).toContain('~277 nodes · inferred');
  });

  it('prints no colony row for a consumer that stands up no scene', () => {
    const { container } = render(<StageCapacityPanel stats={stats} model={null} />);
    expect(container.textContent).not.toContain('Colony');
  });
});

describe('the review scenarios', () => {
  it('renders every one of them without throwing', () => {
    for (const entry of scenarios) {
      const { container, unmount } = render(
        <StageCapacityPanel stats={stats} model={entry.model} />,
      );
      expect(container.textContent, entry.id).toContain('STAGE SAMPLE');
      expect(
        container.querySelector('[data-population-scope-claim]'),
        entry.id,
      ).not.toBeNull();
      unmount();
    }
  });

  it('covers each condition the design has to survive, with distinct ids', () => {
    const ids = scenarios.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const required of [
      'empty-galaxy',
      'stage-covers-scope',
      'retained-scope',
      'chain-scope-mainnet',
      'chain-scope-testnet',
      'stale-census',
      'census-withdrawn',
      'manual-clamp',
      'selected-cell-overlay',
      'partial-retained-stats',
      'no-display-plane',
      'uncurated-stage',
      'census-without-classes',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('pins the gain each condition should be judged at', () => {
    // A reviewer looking at the live medium is looking at exactly these
    // numbers. Changing one should be a deliberate act with a diff.
    const gains = Object.fromEntries(
      scenarios.map((entry) => [entry.id, Number(entry.model.gain.toFixed(3))]),
    );

    expect(gains['empty-galaxy']).toBe(0);
    expect(gains['stage-covers-scope']).toBe(0);
    expect(gains['retained-scope']).toBeCloseTo(0.172, 3);
    expect(gains['chain-scope-mainnet']).toBeCloseTo(0.58, 2);
    expect(gains['chain-scope-testnet']).toBeCloseTo(0.888, 2);
    // A withdrawn census keeps a field, at a lower amount.
    expect(gains['census-withdrawn']).toBe(gains['retained-scope']);
    expect(gains['census-withdrawn']).toBeLessThan(gains['chain-scope-mainnet']);
  });
});
