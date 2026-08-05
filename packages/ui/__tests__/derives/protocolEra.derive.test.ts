import { describe, expect, it } from 'vitest';
import type {
  ChainEntry,
  EnrichmentSourceStatus,
  ProtocolEraRecord,
} from '@cknerv/types';
import {
  deriveProtocolEraVisual,
  PROTOCOL_ERA_STALE_AFTER_MS,
  protocolEraVisualState,
} from '../../src/derives/protocolEra.derive';

const chain: ChainEntry = {
  tip: 100,
  recent_blocks: [],
  recent_tx_hashes: [],
  total_blocks: 101,
  total_txs: 0,
  mempool: {
    pending: 0,
    proposed: 0,
    orphan: 0,
    total_tx_size: 0,
    total_tx_cycles: 0,
    min_fee_rate: 0,
  },
  epoch: { number: 12_300, index: 1, length: 1_800 },
  median_time_ms: 0,
  difficulty: '0x0',
  chain_name: 'ckb',
  reorgs: 0,
  recent_block_intervals_ms: [],
  recent_block_tx_counts: [],
  recent_block_sizes: [],
  ibd: false,
  best_known_block: 100,
};

const record: ProtocolEraRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: `0x${'aa'.repeat(32)}` },
  updated_at_ms: 1_700_000_000_000,
  network: 'mainnet',
  indexed_tip_block: 100,
  indexed_tip_epoch: 12_300,
  current: {
    name: 'Meepo',
    edition_year: 2024,
    activation_epoch: 12_293,
    activation_block: 99,
  },
};

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['protocol_era'],
  validated_anchor: { block: 100, hash: `0x${'aa'.repeat(32)}` },
};

describe('protocol-era visual derivation', () => {
  it('reduces a proven indexed edition to one compact label', () => {
    const visual = deriveProtocolEraVisual(record, chain);

    expect(visual?.label).toBe('MEEPO·24');
    expect(visual?.current?.activation_epoch).toBe(12_293);
    expect(visual?.title).toContain('epoch 12,293, block #99');
    expect(visual?.title).toContain('ckbadger tip epoch 12,300');
  });

  it('represents a pre-edition network without treating the next era as active', () => {
    const preEdition: ProtocolEraRecord = {
      ...record,
      indexed_tip_epoch: 5_000,
      current: undefined,
      upcoming: {
        name: 'Mirana',
        edition_year: 2021,
        activation_epoch: 5_414,
      },
    };

    expect(deriveProtocolEraVisual(preEdition, {
      ...chain,
      epoch: { ...chain.epoch, number: 5_000 },
    })?.label).toBe('PRE-MIRANA·21');
  });

  it('rejects network, canonical-tip, and activation inconsistencies', () => {
    expect(deriveProtocolEraVisual({ ...record, network: 'testnet' }, chain)).toBeNull();
    expect(deriveProtocolEraVisual({
      ...record,
      indexed_tip_block: 101,
    }, chain)).toBeNull();
    expect(deriveProtocolEraVisual({
      ...record,
      indexed_tip_epoch: 12_301,
    }, chain)).toBeNull();
    expect(deriveProtocolEraVisual({
      ...record,
      current: { ...record.current!, activation_epoch: 12_301 },
    }, chain)).toBeNull();
    expect(deriveProtocolEraVisual({
      ...record,
      upcoming: {
        name: 'Future',
        edition_year: 2028,
        activation_epoch: 13_000,
        activation_block: 101,
      },
    }, chain)).toBeNull();
  });

  it('requires a usable source proof and dims missed refreshes', () => {
    expect(protocolEraVisualState(source, record, record.updated_at_ms)).toBe('ready');
    expect(protocolEraVisualState({ ...source, capabilities: [] }, record)).toBeNull();
    expect(protocolEraVisualState({ ...source, status: 'error' }, record)).toBeNull();
    expect(protocolEraVisualState({
      ...source,
      validated_anchor: { block: 100, hash: `0x${'bb'.repeat(32)}` },
    }, record)).toBeNull();
    expect(protocolEraVisualState(
      source,
      record,
      record.updated_at_ms + PROTOCOL_ERA_STALE_AFTER_MS + 1,
    )).toBe('stale');
  });
});
