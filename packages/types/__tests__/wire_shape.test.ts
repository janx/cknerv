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

  it('cell_delta_samples.json covers reorg evidence and replay cause', () => {
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
  });

  it('cell_samples.json entries match Cell shape', () => {
    const samples = fixture<Cell[]>('cell_samples.json');
    expect(Array.isArray(samples)).toBe(true);
    expect(samples.length).toBeGreaterThan(0);
    for (const cell of samples) {
      expect(typeof cell.id).toBe('number');
      expect(typeof cell.content_hash).toBe('string');
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
        expect(link.endpoint_anchors.map((anchor) => anchor.id)).toEqual(
          [...link.from_ids, ...link.to_ids],
        );
        for (const anchor of link.endpoint_anchors) {
          expect(anchor.pos_seed).toHaveLength(3);
          expect(typeof anchor.content_hash).toBe('string');
        }
      }
    }
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
    expect(sample.deltas.prune).toEqual({ type: 'prune', from_block: 100 });
  });
});
