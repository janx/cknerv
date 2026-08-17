import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import CellPopulationReadout from '../../../src/components/hud/CellPopulationReadout';
import {
  formatPopulationRatio,
  populationCompositionMixes,
  populationFieldSummary,
  populationRows,
} from '../../../src/components/hud/cellPopulation.presentation';
import {
  populationReviewScenarios,
  type PopulationReviewScenario,
} from '../../fixtures/cellPopulationFieldReview';

afterEach(cleanup);

const scenarios = populationReviewScenarios();

function scenario(id: string): PopulationReviewScenario {
  const found = scenarios.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown review scenario: ${id}`);
  return found;
}

function textOf(id: string): string {
  const { container } = render(
    <CellPopulationReadout model={scenario(id).model} />,
  );
  return container.textContent ?? '';
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

  it('says UNAVAILABLE rather than substituting a number it cannot prove', () => {
    const text = textOf('census-withdrawn');

    // Labels are uppercased by CSS, so the DOM text is title case here.
    expect(text).toContain('Chain live');
    expect(text).toContain('UNAVAILABLE');
    expect(text).toContain('NO VALIDATED CENSUS');
    // Never a synthesized zero, and never the retained count wearing the
    // chain's label.
    expect(text).not.toContain('ALL LIVE CELLS');
  });

  it('anchors a chain count to the block it was exact at', () => {
    const text = textOf('chain-scope-mainnet');
    expect(text).toContain('AS OF #20,181,778');
  });

  it('keeps a stale census, labeled and dimmed', () => {
    const { container } = render(
      <CellPopulationReadout model={scenario('stale-census').model} />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('STALE');
    // Scope does NOT fall back: the count was exact where it says it was.
    expect(container.querySelector('[data-population-scope-claim="chain"]'))
      .not.toBeNull();
  });
});

describe('the field line', () => {
  it('states the scope it is claiming and how far the stage falls short', () => {
    expect(populationFieldSummary(scenario('retained-scope').model))
      .toContain('RETAINED SCOPE');
    expect(populationFieldSummary(scenario('chain-scope-mainnet').model))
      .toContain('CHAIN SCOPE');
    expect(populationFieldSummary(scenario('chain-scope-mainnet').model))
      .toContain('1 : 123');
  });

  it('separates the two profiles instead of showing one number twice', () => {
    const mainnet = populationFieldSummary(scenario('chain-scope-mainnet').model);
    const testnet = populationFieldSummary(scenario('chain-scope-testnet').model);

    expect(mainnet).not.toBe(testnet);
    expect(testnet).toContain('1 : 1,574');
  });

  it('says nothing is unresolved when nothing is', () => {
    const summary = populationFieldSummary(scenario('stage-covers-scope').model);

    expect(summary).toContain('RESOLVED');
    expect(summary).not.toContain('UNRESOLVED ·');
  });

  it('never prints the renderer gain', () => {
    for (const entry of scenarios) {
      const summary = populationFieldSummary(entry.model);
      const gain = entry.model.gain.toFixed(2);
      if (entry.model.gain > 0) {
        expect(summary, entry.id).not.toContain(gain);
      }
    }
  });
});

describe('the manual clamp', () => {
  it('discloses both numbers instead of calling the stage addressable', () => {
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
    // Testnet DAO is 0.04% of the chain. It exists, so it must not read 0%.
    expect(mixes[1].dao).toBe('<1%');
  });
});

describe('the legend', () => {
  it('explains the medium before anyone can try to click it', () => {
    const text = textOf('chain-scope-mainnet');

    expect(text).toContain('Sharp bodies');
    expect(text).toContain('INTERACTIVE CELLS');
    expect(text).toContain('Ambient field');
    expect(text).toContain('AGGREGATED / NON-ADDRESSABLE');
  });
});

describe('the review scenarios', () => {
  it('renders every one of them without throwing', () => {
    for (const entry of scenarios) {
      const { container, unmount } = render(
        <CellPopulationReadout model={entry.model} />,
      );
      expect(container.textContent, entry.id).toContain('CELL POPULATION');
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
