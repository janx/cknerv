// Wire-shape parity smoke-test: the JSON fixtures shared with the Rust
// side (cknerv-core) must parse into the TS types declared by @cknerv/types
// without any structural drift.
//
// If a Rust struct field is renamed and the TS twin isn't updated, the
// cast below still compiles (TS doesn't enforce JSON shape at runtime)
// but the field-presence assertions catch it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Mutation,
  Cell,
  CellDelta,
  ChainEntry,
  CellGalaxySnapshot,
  SemanticsDelta,
  SemanticsSnapshot,
} from '../src';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) =>
  resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', name);
const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(fixturePath(name), 'utf8')) as T;

describe('wire-shape parity (TS twin of cknerv-core)', () => {
  it('mutation_samples.json parses into Mutation type', () => {
    const samples = fixture<Record<string, Mutation>>('mutation_samples.json');
    const variantTypes = new Set<string>();
    for (const [name, sample] of Object.entries(samples)) {
      expect(sample, `sample ${name} missing`).toBeDefined();
      const m = sample as { type: string };
      expect(m.type, `sample ${name} missing 'type' discriminant`).toBeTruthy();
      expect(m.type).toMatch(
        /^(block_mined|chain_reorganized|chain_rebuild|tx_landed|chain_mempool_updated|chain_info_updated|cell_tagged|chain_node_registered|cell_hydration_completed|peers_updated|chain_sync_updated|chain_node_info_updated)$/,
      );
      variantTypes.add(m.type);
    }
    // Confirm we covered every cknerv-core variant exactly once. Drift
    // here means either the fixture lost a variant or a new variant was
    // added and the test wasn't updated.
    expect(variantTypes).toEqual(
      new Set([
        'block_mined',
        'chain_reorganized',
        'chain_rebuild',
        'tx_landed',
        'chain_mempool_updated',
        'chain_info_updated',
        'cell_tagged',
        'chain_node_registered',
        'cell_hydration_completed',
        'peers_updated',
        'chain_sync_updated',
        'chain_node_info_updated',
      ]),
    );
  });

  it('snapshot_chain.json has ChainEntry shape', () => {
    const sample = fixture<ChainEntry>('snapshot_chain.json');
    expect(typeof sample.tip).toBe('number');
    expect(Array.isArray(sample.recent_blocks)).toBe(true);
    expect(Array.isArray(sample.recent_tx_hashes)).toBe(true);
    expect(typeof sample.total_blocks).toBe('number');
    expect(typeof sample.total_txs).toBe('number');
    expect(typeof sample.chain_name).toBe('string');
    expect(typeof sample.mempool).toBe('object');
    expect(typeof sample.epoch).toBe('object');
  });

  it('cell_delta_samples.json carries every CellDelta variant', () => {
    const samples = fixture<Record<string, CellDelta>>('cell_delta_samples.json');
    const variants = new Set(Object.values(samples).map((d) => d.type));
    // The Rust twin (`cknerv-core/tests/wire_shape.rs`) writes this file from
    // a total match over `CellDelta`, so a variant reaching the wire without
    // a sample fails there; this set is the browser-side half of that pin.
    expect(variants).toEqual(
      new Set([
        'birth',
        'death',
        'tag',
        'gc',
        'pulse',
        'stats',
        'script_census',
        'backfill',
        'link_prune',
        'link',
        'display',
      ]),
    );
    // Script identity travels on the delta path, not only in snapshots —
    // the half that silently lost it while only the snapshot was fixtured.
    const birth = samples.birth as Extract<CellDelta, { type: 'birth' }>;
    expect(birth.cell.lock_script?.hash_type).toBe('type');
    expect(birth.cell.type_script?.hash_type).toBe('data1');
    // A ranked census with a non-empty tail: a panel that reads only the head
    // must still be able to say how much it is not showing.
    const census = samples.script_census as Extract<
      CellDelta,
      { type: 'script_census' }
    >;
    expect(census.census.locks[0].script).toEqual(birth.cell.lock_script);
    expect(census.census.locks_tail_scripts).toBe(1);
    expect(census.census.unidentified).toBe(1);
    // Durable causal geometry: the anchors, not the live cells, are what a
    // client routes on once the inputs have left its retained window.
    const link = samples.link as Extract<CellDelta, { type: 'link' }>;
    expect(
      link.endpoint_anchors.filter((a) => a.resolved).map((a) => a.id),
    ).toEqual([...link.from_ids, ...link.to_ids]);
    // …and the identity-only kind, which the server emits for a spend it
    // never retained: an exact address, no content, and deliberately not a
    // resolved death. Its id carries the composition prefix (2^52), which is
    // what keeps `!to_ids.includes(id)` a sound input test on the client.
    const derived = link.endpoint_anchors.filter((a) => !a.resolved);
    expect(derived).toHaveLength(1);
    expect(derived[0].content_hash).toBe('');
    expect(derived[0].id).toBeGreaterThanOrEqual(2 ** 52);
    expect(link.from_ids).not.toContain(derived[0].id);
    expect(link.to_ids).not.toContain(derived[0].id);
  });

  it('cell_delta_samples.json covers reorg evidence, replay cause and display membership', () => {
    const samples = fixture<Record<string, CellDelta>>('cell_delta_samples.json');
    expect(samples.link_prune).toEqual({
      type: 'link_prune',
      from_block: 42,
    });
    expect(samples.backfill_rebuild).toEqual({
      type: 'backfill',
      done: 3,
      total: 10,
      active: true,
      phase: 'rebuild',
    });
    // Display-plane patch, composed mode: canonical enter by id, resident
    // enter with full payload (composition-range id, 2^52 + 5), an exit,
    // and full provenance.
    expect(samples.display_composed).toEqual({
      type: 'display',
      enter_ids: [1],
      enter_cells: [
        {
          id: 4503599627370501,
          born_at_ms: 0,
          death_at_ms: null,
          birth_block: 12,
          tag: null,
          pos_seed: [2.5, -1.25, 0.75],
          out_point: { tx_hash: '0xdef', index: 3 },
          capacity: 5000,
          data_hex: '0x',
          data_bytes: 0,
          content_hash:
            '0x2222222222222222222222222222222222222222222222222222222222222222',
          lock_shape_seed: [572662306, 858993459],
          type_shape_seed: null,
          data_shape_seed: [1145324612, 1431655765],
          lock_kind: 'acp',
          asset_kind: 'xudt',
        },
      ],
      exit_ids: [2],
      provenance: {
        mode: 'composed',
        source: 'ckbadger',
        as_of: { block: 12, hash: '0xfeed' },
        updated_at_ms: 2000,
      },
    });
    // Everyday activity-swap shape: id-only churn, no provenance key at
    // all (Rust skips a `None` provenance on the wire).
    expect(samples.display_minimal).toEqual({
      type: 'display',
      enter_ids: [2],
      enter_cells: [],
      exit_ids: [1],
    });
  });

  it('cell_samples.json entries match Cell shape', () => {
    const samples = fixture<Cell[]>('cell_samples.json');
    expect(Array.isArray(samples)).toBe(true);
    expect(samples.length).toBeGreaterThan(0);
    for (const cell of samples) {
      expect(typeof cell.id).toBe('number');
      expect(typeof cell.content_hash).toBe('string');
      expect(Number.isInteger(cell.data_bytes)).toBe(true);
      expect(cell.lock_shape_seed).toHaveLength(2);
      expect(cell.type_shape_seed === null || cell.type_shape_seed.length === 2).toBe(true);
      expect(cell.data_shape_seed).toHaveLength(2);
      expect(typeof cell.birth_block).toBe('number');
      expect(typeof cell.out_point.tx_hash).toBe('string');
      expect(typeof cell.out_point.index).toBe('number');
      expect(Array.isArray(cell.pos_seed)).toBe(true);
      expect(cell.pos_seed.length).toBe(3);
    }
  });

  it('snapshot_cells.json has CellGalaxySnapshot shape', () => {
    const sample = fixture<CellGalaxySnapshot>('snapshot_cells.json');
    expect(Array.isArray(sample.cells)).toBe(true);
    expect(typeof sample.last_pulse_at_ms).toBe('number');
    expect(typeof sample.total_births).toBe('number');
    expect(typeof sample.total_deaths).toBe('number');
    if (sample.recent_links !== undefined) {
      expect(Array.isArray(sample.recent_links)).toBe(true);
      for (const link of sample.recent_links) {
        expect(Array.isArray(link.endpoint_anchors)).toBe(true);
        expect(
          link.endpoint_anchors
            .filter((anchor) => anchor.resolved)
            .map((anchor) => anchor.id),
        ).toEqual([...link.from_ids, ...link.to_ids]);
        for (const anchor of link.endpoint_anchors) {
          expect(anchor.pos_seed).toHaveLength(3);
          expect(typeof anchor.content_hash).toBe('string');
          expect(typeof anchor.resolved).toBe('boolean');
        }
      }
      // The snapshot half carries the identity-only kind too — a spend the
      // server never retained, anchored by its outpoint alone.
      const derived = sample.recent_links.flatMap((link) =>
        link.endpoint_anchors.filter((anchor) => !anchor.resolved),
      );
      expect(derived).toHaveLength(1);
      expect(derived[0].content_hash).toBe('');
      expect(derived[0].id).toBeGreaterThanOrEqual(2 ** 52);
    }
    // Display plane: members mix canonical ids with resident ids; only
    // out-of-retained-set members carry a resident payload.
    expect(sample.display?.budget.cells).toBe(12000);
    expect(sample.display?.budget.nerve_edges).toBe(8000);
    expect(sample.display?.members).toEqual([1, 2, 4503599627370501]);
    expect(sample.display?.residents.map((cell) => cell.id)).toEqual([
      4503599627370501,
    ]);
    expect(sample.display?.provenance.mode).toBe('composed');
    expect(sample.display?.provenance.source).toBe('ckbadger');
    expect(sample.display?.provenance.as_of?.block).toBe(1);
    expect(typeof sample.display?.provenance.updated_at_ms).toBe('number');

    // Script identity travels with the cell, unclassified: `lock_kind` is
    // cknerv's coarse reading, `lock_script` is which script is actually
    // there. Both cells run the protocol's default lock; only one is typed,
    // and mainnet xUDT is `data1` — the hash type is part of the identity.
    const [plain, typed] = sample.cells;
    expect(plain.lock_script?.hash_type).toBe('type');
    expect(plain.type_script).toBeUndefined();
    expect(typed.lock_script?.code_hash).toBe(plain.lock_script?.code_hash);
    expect(typed.type_script?.hash_type).toBe('data1');
    // A staged resident under a lock cknerv does not pin at all: its
    // identity is readable even though no `lock_kind` names it.
    const resident = sample.display?.residents[0];
    expect(resident?.lock_script?.code_hash).not.toBe(plain.lock_script?.code_hash);

    // The census counts the same alive set by identity. It is ranked and
    // cut, so the tail counters are what keep a truncated head honest.
    const census = sample.stats?.scripts;
    expect(census?.locks).toEqual([
      { script: plain.lock_script, count: 2 },
    ]);
    expect(census?.types).toEqual([
      { script: typed.type_script, count: 1 },
    ]);
    expect(census?.types_absent).toBe(1);
    expect(census?.locks_tail_cells).toBe(0);
    expect(census?.locks_tail_scripts).toBe(0);
    expect(census?.unidentified).toBe(0);
  });

  it('enrichment_samples.json mirrors optional semantics shapes', () => {
    const sample = fixture<{
      snapshot: SemanticsSnapshot;
      deltas: Record<string, SemanticsDelta>;
    }>('enrichment_samples.json');

    expect(sample.snapshot.source.status).toBe('ready');
    expect(sample.snapshot.cells[0].lock_script?.name).toBe('Default Lock');
    expect(sample.snapshot.cells[0].asset?.symbol).toBe('NTT');
    expect(sample.snapshot.cells[0].asset?.amount).toBe('12345000000');
    expect(sample.snapshot.cells[0].common_knowledge?.total_bytes).toBe(102);
    expect(sample.snapshot.cells[0].content?.data_hex).toBe('0x5c000000000000');
    expect(sample.snapshot.cells[0].content?.deterministic?.segments[0])
      .toMatchObject({
        label: 'deposit_block',
        start_byte: 0,
        end_byte: 7,
        value: '92',
      });
    expect(sample.snapshot.cells[0].content?.heuristics[0].confidence).toBe('medium');
    expect(sample.snapshot.asset_ecosystem?.capacity_breakdown[0].share_bps).toBe(2500);
    expect(sample.snapshot.asset_ecosystem?.top_assets[0].symbol).toBe('NTT');
    expect(sample.snapshot.dao_state?.statistics_block).toBe(99);
    expect(sample.snapshot.dao_state?.total_deposited_shannons).toBe('837703738002110308');
    expect(sample.snapshot.dao_state?.estimated_apc_bps).toBe(201);
    expect(sample.snapshot.protocol_era?.current?.name).toBe('Meepo');
    expect(sample.snapshot.protocol_era?.indexed_tip_epoch).toBe(12293);
    expect(sample.snapshot.fork_watch?.recent_reorg?.kind).toBe('deep');
    expect(sample.snapshot.fork_watch?.deep_fork?.indexed_tip).toBe(99);
    expect(sample.snapshot.activity_feed?.activities[0].category).toBe('dao');
    expect(sample.snapshot.activity_feed?.activities[1].participant_count).toBe(2);
    expect(sample.snapshot.transaction_horizon?.current_day).toBe(345);
    expect(sample.snapshot.transaction_horizon?.hourly_counts).toEqual([7, 9, 12]);
    expect(sample.snapshot.network_atlas?.sample_size).toBe(3);
    expect(sample.snapshot.network_atlas?.countries[0].label).toBe('SG');
    expect(sample.deltas.cell_upsert.type).toBe('cell_upsert');
    expect(sample.deltas.asset_ecosystem_replace.type).toBe('asset_ecosystem_replace');
    expect(sample.deltas.dao_state_replace.type).toBe('dao_state_replace');
    expect(sample.deltas.protocol_era_replace.type).toBe('protocol_era_replace');
    expect(sample.deltas.fork_watch_replace.type).toBe('fork_watch_replace');
    expect(sample.deltas.activity_feed_replace.type).toBe('activity_feed_replace');
    expect(sample.deltas.transaction_horizon_replace.type).toBe('transaction_horizon_replace');
    expect(sample.deltas.network_atlas_replace.type).toBe('network_atlas_replace');
    expect(sample.deltas.network_atlas_clear.type).toBe('network_atlas_clear');
    // Script names are the other half of the cell census's identity join:
    // that side counts `(code_hash, hash_type)` and refuses to name it, this
    // side names it and counts nothing. `unresolved` says how many observed
    // identities the index found a code cell for but no name.
    expect(sample.snapshot.script_registry?.entries[0]).toMatchObject({
      code_hash: sample.snapshot.cells[0].lock_script?.code_hash,
      hash_type: sample.snapshot.cells[0].lock_script?.hash_type,
      name: 'Default Lock',
      kind: 'lock',
    });
    expect(sample.snapshot.script_registry?.unresolved).toBe(8);
    expect(sample.deltas.script_registry_replace.type).toBe(
      'script_registry_replace',
    );
    expect(sample.deltas.census_replace.type).toBe('census_replace');
    // The three class counters are a PARTITION of `live_cells`, not three
    // independent tallies: a fixture whose bins stop adding up would let a
    // composition disclosure state a chain mix that is not the chain's.
    const census = sample.snapshot.census;
    const classes = census?.classes;
    expect(classes).toBeDefined();
    expect(
      (classes?.dao ?? 0) + (classes?.typed_non_dao ?? 0) + (classes?.plain ?? 0),
    ).toBe(census?.live_cells);
    // `data_bearing` is orthogonal to that partition — it overlaps every bin.
    expect(census?.data_bearing).toBe(22_222);
    expect(sample.deltas.transaction_upsert.type).toBe('transaction_upsert');
    // Same total-match pin as the cell deltas: the Rust writer enumerates
    // `SemanticsDelta` exhaustively, and this is the browser-side half.
    expect(new Set(Object.values(sample.deltas).map((d) => d.type))).toEqual(
      new Set([
        'source_status',
        'cell_upsert',
        'cell_remove',
        'transaction_upsert',
        'transaction_remove',
        'census_replace',
        'asset_ecosystem_replace',
        'dao_state_replace',
        'protocol_era_replace',
        'fork_watch_replace',
        'activity_feed_replace',
        'transaction_horizon_replace',
        'network_atlas_replace',
        'network_atlas_clear',
        'script_registry_replace',
        'prune',
        'clear',
      ]),
    );
    // The galaxy composition record is display-plane input, not semantics:
    // it reaches the browser only as the cells projection's display section
    // and `display` deltas (see the cells fixtures above).
    expect(sample.snapshot).not.toHaveProperty('galaxy_composition');
    expect(sample.deltas).not.toHaveProperty('galaxy_composition_replace');
    expect(sample.deltas.prune).toEqual({ type: 'prune', from_block: 100 });
  });
});
