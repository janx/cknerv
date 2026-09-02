// The shared sample fixtures, driven through the REAL reducers.
//
// `tests/fixtures/{cell_delta_samples,enrichment_samples}.json` are written
// by the Rust serializer (`crates/cknerv-core/tests/wire_shape.rs`), and the
// types package asserts they parse into the TS unions. That is a compile-time
// claim about erased casts: it cannot tell whether the client can actually
// CONSUME a variant. This file closes that gap — every sample in both files
// goes through `applyCellDelta` / `applySemanticsDelta` and the batch paths
// beside them, and each one has to show what it did.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Cell,
  CellDelta,
  RevisionedCellDelta,
  RevisionedSemanticsDelta,
  SemanticsDelta,
  SemanticsSnapshot,
} from '@cknerv/types';

import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
  type CellGalaxyCache,
} from '../src/cellsReducer';
import {
  applyRevisionedSemanticsDeltas,
  applySemanticsDelta,
  emptySemanticsCache,
  fromSemanticsSnapshot,
  outPointKey,
  type SemanticsCache,
} from '../src/semanticsReducer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', name), 'utf8'),
  ) as T;

const cellSamples = fixture<Record<string, CellDelta>>('cell_delta_samples.json');
const enrichmentSamples = fixture<{
  snapshot: SemanticsSnapshot;
  deltas: Record<string, SemanticsDelta>;
}>('enrichment_samples.json');

function sample<K extends CellDelta['type']>(
  name: string,
  kind: K,
): Extract<CellDelta, { type: K }> {
  const delta = cellSamples[name];
  expect(delta, `cell_delta_samples.json is missing ${name}`).toBeDefined();
  expect(delta.type).toBe(kind);
  return delta as Extract<CellDelta, { type: K }>;
}

const birth = sample('birth', 'birth');

/** The fixture's own cell under a different id, so the seed a delta acts on
 *  is still server-authored rather than a hand-written stand-in. */
function bornAs(id: number): CellDelta {
  const cell: Cell = {
    ...birth.cell,
    id,
    out_point: { ...birth.cell.out_point, index: id },
  };
  return { type: 'birth', cell };
}

function seededCells(ids: readonly number[]): CellGalaxyCache {
  let cache = emptyCellsCache();
  for (const id of ids) cache = applyCellDelta(cache, bornAs(id));
  return cache;
}

describe('cell delta fixtures drive the real cells reducer', () => {
  it('applies every sample without throwing and advances the batch revision', () => {
    const deltas: RevisionedCellDelta[] = Object.values(cellSamples).map(
      (delta, i) => ({ revision: i + 1, delta }),
    );
    const next = applyRevisionedCellDeltas(emptyCellsCache(), deltas);
    expect(next.revision).toBe(deltas.length);
    // A batch containing an arm the reducer silently ignored would still get
    // here, so each variant's own effect is asserted below.
    for (const [name, delta] of Object.entries(cellSamples)) {
      expect(
        () => applyCellDelta(emptyCellsCache(), delta),
        `${name} threw on an empty cache`,
      ).not.toThrow();
    }
  });

  it('birth retains the cell with its script identity intact', () => {
    const next = applyCellDelta(emptyCellsCache(), birth);
    const cell = next.cells.get(birth.cell.id);
    expect(cell?.out_point).toEqual(birth.cell.out_point);
    expect(cell?.lock_script).toEqual(birth.cell.lock_script);
    expect(cell?.type_script).toEqual(birth.cell.type_script);
  });

  it('death stamps the retained cell rather than removing it', () => {
    const death = sample('death', 'death');
    const next = applyCellDelta(seededCells([death.id]), death);
    expect(next.cells.get(death.id)?.death_at_ms).toBe(death.at_ms);
  });

  it('tag replaces the tag on a retained cell', () => {
    const tag = sample('tag', 'tag');
    const next = applyCellDelta(seededCells([tag.id]), tag);
    expect(next.cells.get(tag.id)?.tag).toBe(tag.tag);
  });

  it('gc removes every listed id', () => {
    const gc = sample('gc', 'gc');
    const next = applyCellDelta(seededCells(gc.ids), gc);
    expect(next.cells.size).toBe(0);
    expect([...next.cellChanges.removed].sort()).toEqual([...gc.ids].sort());
  });

  it('pulse lands the block stamp and the producer that caused it', () => {
    const pulse = sample('pulse', 'pulse');
    const next = applyCellDelta(emptyCellsCache(), pulse);
    expect(next.lastPulseAtMs).toBe(pulse.at_ms);
    expect(next.lastPulseProducerKey).toBe(pulse.producer_key);
  });

  it('an anonymous pulse lands the stamp and no producer', () => {
    const pulse = sample('pulse_anonymous', 'pulse');
    // The server omits the key entirely rather than blanking it, and the
    // reducer has to read that absence as absence.
    expect('producer_key' in pulse).toBe(false);
    const seeded = applyCellDelta(emptyCellsCache(), sample('pulse', 'pulse'));
    const next = applyCellDelta(seeded, pulse);
    expect(next.lastPulseAtMs).toBe(pulse.at_ms);
    expect(next.lastPulseProducerKey).toBeNull();
  });

  it('stats overwrite the cumulative counters', () => {
    const stats = sample('stats', 'stats');
    const next = applyCellDelta(emptyCellsCache(), stats);
    expect(next.totalBirths).toBe(stats.total_births);
    expect(next.totalDeaths).toBe(stats.total_deaths);
  });

  it('script_census is adopted verbatim into the stats block', () => {
    const census = sample('script_census', 'script_census');
    const next = applyCellDelta(emptyCellsCache(), census);
    expect(next.stats.scripts).toEqual(census.census);
  });

  it('backfill publishes replay progress', () => {
    const backfill = sample('backfill_rebuild', 'backfill');
    const next = applyCellDelta(emptyCellsCache(), backfill);
    expect(next.backfill).toEqual({
      done: backfill.done,
      total: backfill.total,
      phase: backfill.phase,
    });
  });

  it('link appends causal evidence with its endpoint anchors', () => {
    const link = sample('link', 'link');
    const next = applyCellDelta(emptyCellsCache(), link);
    expect(next.recentLinks).toHaveLength(1);
    expect(next.recentLinks[0].tx_hash).toBe(link.tx_hash);
    expect(next.recentLinks[0].endpoint_anchors).toEqual(link.endpoint_anchors);
    expect(next.pulseLinks).toHaveLength(1);
  });

  it('link_prune records the invalidation boundary and drops the suffix', () => {
    const link = sample('link', 'link');
    const prune = sample('link_prune', 'link_prune');
    let cache = applyCellDelta(emptyCellsCache(), link);
    cache = applyCellDelta(cache, prune);
    expect(cache.linkPrune?.fromBlock).toBe(prune.from_block);
    // The sample link sits at a block above the boundary, so it is evidence
    // the prune must retract.
    expect(link.block).toBeGreaterThanOrEqual(prune.from_block);
    expect(cache.recentLinks).toHaveLength(0);
  });

  it('the two display samples move the stage and its provenance', () => {
    const composed = sample('display_composed', 'display');
    const minimal = sample('display_minimal', 'display');
    const resident = composed.enter_cells[0];

    let cache = applyCellDelta(emptyCellsCache(), composed);
    expect([...cache.displayMembers].sort()).toEqual(
      [...composed.enter_ids, resident.id].sort(),
    );
    expect(cache.displayResidents.get(resident.id)).toEqual(resident);
    expect(cache.displayProvenance).toEqual(composed.provenance);

    cache = applyCellDelta(cache, minimal);
    expect(cache.displayMembers.has(minimal.enter_ids[0])).toBe(true);
    expect(cache.displayMembers.has(minimal.exit_ids[0])).toBe(false);
    // `provenance` is absent from the minimal sample's bytes; an absent key
    // must leave the previous provenance standing, not clear it.
    expect(cache.displayProvenance).toEqual(composed.provenance);
  });
});

describe('enrichment fixtures drive the real semantics reducer', () => {
  const { snapshot, deltas } = enrichmentSamples;
  const seeded = (): SemanticsCache => fromSemanticsSnapshot(1, snapshot);

  it('applies every sample without throwing, from empty and from a snapshot', () => {
    const batch: RevisionedSemanticsDelta[] = Object.values(deltas).map(
      (delta, i) => ({ revision: i + 1, delta }),
    );
    expect(applyRevisionedSemanticsDeltas(seeded(), batch).revision).toBe(
      batch.length,
    );
    for (const [name, delta] of Object.entries(deltas)) {
      expect(
        () => applySemanticsDelta(emptySemanticsCache(), delta),
        `${name} threw on an empty cache`,
      ).not.toThrow();
      expect(
        () => applySemanticsDelta(seeded(), delta),
        `${name} threw on a seeded cache`,
      ).not.toThrow();
    }
  });

  it('the snapshot half seeds every record slot the deltas can replace', () => {
    const cache = seeded();
    expect(cache.cells.size).toBe(snapshot.cells.length);
    expect(cache.transactions.size).toBe(snapshot.transactions.length);
    expect(cache.census).toEqual(snapshot.census);
    expect(cache.scriptRegistry).toEqual(snapshot.script_registry);
    expect(cache.networkRoster).toEqual(snapshot.network_roster);
    expect(cache.producerLedger).toEqual(snapshot.producer_ledger);
    // The roster is the one snapshot record whose ORDER is part of the
    // contract: the server ships it sorted by `node_id` so the same known
    // set stages as the same set round after round.
    const rosterIds = cache.networkRoster?.entries.map((node) => node.node_id);
    expect(rosterIds).toEqual([...(rosterIds ?? [])].sort());
  });

  it('upsert arms land their record on an empty cache', () => {
    const cellUpsert = deltas.cell_upsert as Extract<
      SemanticsDelta,
      { type: 'cell_upsert' }
    >;
    const cells = applySemanticsDelta(emptySemanticsCache(), cellUpsert).cells;
    expect(cells.get(outPointKey(cellUpsert.cell.out_point))).toEqual(
      cellUpsert.cell,
    );

    const txUpsert = deltas.transaction_upsert as Extract<
      SemanticsDelta,
      { type: 'transaction_upsert' }
    >;
    const transactions = applySemanticsDelta(
      emptySemanticsCache(),
      txUpsert,
    ).transactions;
    expect(transactions.get(txUpsert.transaction.tx_hash)).toEqual(
      txUpsert.transaction,
    );

    expect(applySemanticsDelta(emptySemanticsCache(), deltas.source_status).source)
      .toEqual(snapshot.source);
  });

  it('every *_replace arm lands its record slot', () => {
    const landed: [string, keyof SemanticsCache][] = [
      ['census_replace', 'census'],
      ['asset_ecosystem_replace', 'assetEcosystem'],
      ['dao_state_replace', 'daoState'],
      ['protocol_era_replace', 'protocolEra'],
      ['fork_watch_replace', 'forkWatch'],
      ['activity_feed_replace', 'activityFeed'],
      ['transaction_horizon_replace', 'transactionHorizon'],
      ['network_atlas_replace', 'networkAtlas'],
      ['network_roster_replace', 'networkRoster'],
      ['producer_ledger_replace', 'producerLedger'],
      ['script_registry_replace', 'scriptRegistry'],
    ];
    for (const [name, slot] of landed) {
      const next = applySemanticsDelta(emptySemanticsCache(), deltas[name]);
      expect(next[slot], `${name} left ${String(slot)} empty`).not.toBeNull();
    }
    // The registry is the half of the script-identity join the browser
    // performs against the cells census, so its content is pinned, not just
    // its presence.
    const registry = deltas.script_registry_replace as Extract<
      SemanticsDelta,
      { type: 'script_registry_replace' }
    >;
    expect(
      applySemanticsDelta(emptySemanticsCache(), registry).scriptRegistry,
    ).toEqual(registry.script_registry);
  });

  it('the empty roster sample lands as a report, not an absence', () => {
    const empty = deltas.network_roster_replace_empty as Extract<
      SemanticsDelta,
      { type: 'network_roster_replace' }
    >;
    expect(empty.network_roster.entries).toEqual([]);

    // The snapshot seeded three named nodes; this round knew nobody. The
    // slot holds that report — falling back to null would say the crawler
    // is gone, which is what `network_roster_clear` says and this does not.
    const next = applySemanticsDelta(seeded(), empty);
    expect(next.networkRoster).toEqual(empty.network_roster);
    expect(next.networkRoster?.entries).toEqual([]);
  });

  it('the ledger folds whole, with the row whose lookup failed intact', () => {
    const replace = deltas.producer_ledger_replace as Extract<
      SemanticsDelta,
      { type: 'producer_ledger_replace' }
    >;
    const next = applySemanticsDelta(emptySemanticsCache(), replace);
    expect(next.producerLedger).toEqual(replace.producer_ledger);

    // The fixture carries the pair on purpose: one row the address lookup
    // answered for and one it did not. The absent keys are ABSENT on the wire
    // — not null, not zero — and the reducer may not invent them, because a
    // reader that spelled absence as zero would print `0 CKB` over a balance
    // nobody read.
    const [resolved, unresolved] = next.producerLedger?.rows ?? [];
    expect(typeof resolved.balance_shannons).toBe('string');
    // ⚠️ Above `Number.MAX_SAFE_INTEGER`: it rides as a decimal string all the
    // way to the formatter, and `Number()` on it is the bug.
    expect(BigInt(resolved.balance_shannons ?? '0')).toBeGreaterThan(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
    for (const absent of ['address', 'balance_shannons', 'live_cells'] as const) {
      expect(unresolved).not.toHaveProperty(absent);
    }

    // A reorg is not an answer about last week: the ledger carries no anchor,
    // so the prune that empties every other slot leaves it standing.
    expect(applySemanticsDelta(next, deltas.prune).producerLedger)
      .toEqual(replace.producer_ledger);
    // Only its own clear takes it, and only then.
    expect(applySemanticsDelta(next, deltas.producer_ledger_clear).producerLedger)
      .toBeNull();
  });

  it('remove and clear arms retract what the snapshot seeded', () => {
    const cellRemove = deltas.cell_remove as Extract<
      SemanticsDelta,
      { type: 'cell_remove' }
    >;
    expect(applySemanticsDelta(seeded(), cellRemove).cells.size).toBe(
      snapshot.cells.length - 1,
    );

    const txRemove = deltas.transaction_remove as Extract<
      SemanticsDelta,
      { type: 'transaction_remove' }
    >;
    expect(applySemanticsDelta(seeded(), txRemove).transactions.size).toBe(
      snapshot.transactions.length - 1,
    );

    expect(
      applySemanticsDelta(seeded(), deltas.network_atlas_clear).networkAtlas,
    ).toBeNull();
    expect(
      applySemanticsDelta(seeded(), deltas.network_roster_clear).networkRoster,
    ).toBeNull();
  });

  it('prune drops every record anchored at or past the boundary', () => {
    const prune = deltas.prune as Extract<SemanticsDelta, { type: 'prune' }>;
    const next = applySemanticsDelta(seeded(), prune);
    // The whole fixture is anchored at the prune boundary, so this is the
    // total-retraction case — including the script registry, which the
    // client dropped nowhere before the reducer grew that arm.
    expect(snapshot.census?.as_of.block).toBe(prune.from_block);
    expect(next.cells.size).toBe(0);
    expect(next.transactions.size).toBe(0);
    expect(next.census).toBeNull();
    expect(next.scriptRegistry).toBeNull();
    expect(next.networkRoster).toBeNull();
  });

  it('clear empties every slot the source can refill', () => {
    const next = applySemanticsDelta(seeded(), deltas.clear);
    expect(next.cells.size).toBe(0);
    expect(next.transactions.size).toBe(0);
    for (const slot of [
      'census',
      'assetEcosystem',
      'daoState',
      'protocolEra',
      'forkWatch',
      'activityFeed',
      'transactionHorizon',
      'networkAtlas',
      'networkRoster',
      'scriptRegistry',
      'producerLedger',
    ] as const) {
      expect(next[slot], `clear left ${slot} standing`).toBeNull();
    }
  });

  /** Every capability string the CLIENT tests by literal name. A capability
   *  is a feature switch: `peer_sighting` alone gates the entire crawler
   *  dossier, so a rename on the Rust side turns the feature off here with
   *  every type check and every test still green. The fixture is the pinned
   *  spelling — `crates/cknerv-adapter-ckbadger/src/source.rs` asserts it
   *  equals what that crate declares, and this asserts the client only asks
   *  for strings that are in it.
   *
   *  ADD TO THIS LIST whenever new client code reads a capability by name.
   *  Grep for `capabilities.includes(` to find them all. */
  const CONSUMED_CAPABILITIES = [
    // ui-app/src/App.tsx — the transaction reader and the crawler dossier.
    'transaction_detail',
    'peer_sighting',
    // ui-app/src/App.tsx — the POW cohort ledger. Gated on the capability and
    // not merely on the slot, unlike every other pushed record, because this
    // is the one record NOTHING in the client expires: it carries no anchor,
    // so no prune cuts it, and the server emits `producer_ledger_clear` only
    // from a refresh that RAN — which a source no longer declaring the
    // capability never runs. So the live capability list is what keeps a week
    // from outliving the source's ability to answer for it, and a rename on
    // the Rust side has to fail here rather than silently fall the cohorts
    // back to the 240-block window.
    'producer_ledger',
    // packages/ui/src/derives/*.derive.ts — one gate each.
    'protocol_era',
    'transaction_horizon',
    'dao_state',
    'network_atlas',
  ] as const;

  it('pins every capability string the client gates a feature on', () => {
    for (const capability of CONSUMED_CAPABILITIES) {
      expect(
        snapshot.source.capabilities,
        `the client gates on "${capability}" but no source declares it — ` +
          'if it was renamed in crates/cknerv-adapter-ckbadger, the feature ' +
          'is silently off',
      ).toContain(capability);
    }
  });
});
