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
  ChainEntry,
  CellGalaxySnapshot,
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
        /^(block_mined|tx_landed|chain_mempool_updated|chain_info_updated|cell_tagged|chain_node_registered|peers_updated|chain_sync_updated|chain_node_info_updated)$/,
      );
      variantTypes.add(m.type);
    }
    // Confirm we covered every cknerv-core variant exactly once. Drift
    // here means either the fixture lost a variant or a new variant was
    // added and the test wasn't updated.
    expect(variantTypes).toEqual(
      new Set([
        'block_mined',
        'tx_landed',
        'chain_mempool_updated',
        'chain_info_updated',
        'cell_tagged',
        'chain_node_registered',
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
});
