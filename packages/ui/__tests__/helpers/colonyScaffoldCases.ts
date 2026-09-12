import type {
  BlockProducer, ChainEntry, NetworkRosterRecord, Peer, RosterNode, RosterNodeState,
} from '@cknerv/types';
import { emptyChainCache } from '@cknerv/cache';
import {
  deriveBlockProducers, type ProducerStanding,
} from '../../src/derives/blockProducers.derive';

/**
 * The three rosters the colony's scaffold is built over and the fifty seeds it
 * is built for — the sweep lane L5 measured `inferredTopology` with.
 *
 * A scaffold MISS is the whole cost (L5-1: 33–100 ms of synchronous work inside
 * App's render), and what it spends the time on is a k-nearest-neighbour pass
 * over every node of the colony. The three shapes below are the ones the live
 * page reaches: the pre-roster build (ghosts only), the full 256-row crawl with
 * a measured belt around it — V_s = 263, the number L5-1 prices — and a roster
 * with a producer window beside it, whose cohort discs move ghosts aside.
 */
export const SCAFFOLD_SEEDS = Array.from({ length: 50 }, (_, i) =>
  (0x9e3779b1 + i * 0x01000193) >>> 0);

function peer(p: Partial<Peer>): Peer {
  return {
    node_id: 'Qm',
    addr: '1.2.3.4:8115',
    direction: 'outbound',
    version: '0.116.1',
    connected_ms: 0,
    ...p,
  };
}

function rosterNode(p: Partial<RosterNode> & { node_id: string }): RosterNode {
  return {
    addr: '/ip4/10.0.0.1/tcp/8115',
    state: 'reachable',
    version: '0.116.1',
    country: 'Unknown',
    asn: 'Unknown',
    last_reachable_ms: 1_700_000_000_000,
    last_advertised_ms: 1_700_000_060_000,
    last_observed_ms: 1_700_000_000_000,
    latest_positive_observed_ms: 1_700_000_065_000,
    ...p,
  };
}

function roster(entries: RosterNode[], truncated: boolean): NetworkRosterRecord {
  return {
    source: 'ckbadger',
    as_of: { block: 12_000_000, hash: '0xabc' },
    updated_at_ms: 1_700_000_000_000,
    crawl_round: 1,
    truncated,
    entries,
  };
}

function producers(count: number): readonly ProducerStanding[] {
  const rows: BlockProducer[] = Array.from({ length: count }, (_, i) => ({
    key: `0x${String(i).padStart(40, '3')}`,
    message: '0.209.0 (aaaaaaa 2026-07-30)',
    blocks: 3 + i * 2,
    last_seen_ms: 1_700_000_000_000 + i * 1_000,
  }));
  const chain: ChainEntry = {
    ...emptyChainCache(),
    producers: rows,
    producer_window: rows.flatMap((p, i) => Array<number>(p.blocks).fill(i)),
    producer_window_blocks: rows.reduce((sum, p) => sum + p.blocks, 0),
  };
  return deriveBlockProducers(chain, null)?.staging ?? [];
}

export interface ScaffoldCase {
  readonly name: string;
  readonly peers: Peer[];
  readonly roster: NetworkRosterRecord | null;
  readonly producers: readonly ProducerStanding[] | null;
}

let cached: readonly ScaffoldCase[] | null = null;

export function scaffoldCases(): readonly ScaffoldCase[] {
  if (cached !== null) return cached;
  const belt = Array.from({ length: 12 }, (_, i) => peer({
    node_id: `Qmpeer${String(i).padStart(3, '0')}`,
    latency_ms: 20 + i * 23,
  }));
  const patchy = Array.from({ length: 256 }, (_, i) => rosterNode({
    node_id: `Qm${String(i).padStart(4, '0')}`,
    state: (i % 7 === 0 ? 'unreachable' : 'reachable') as RosterNodeState,
  }));
  const whole = Array.from({ length: 256 }, (_, i) => rosterNode({
    node_id: `Qm${String(i).padStart(4, '0')}`,
  }));
  cached = [
    { name: 'ghosts only', peers: [], roster: null, producers: null },
    { name: 'a patchy crawl and a measured belt', peers: belt, roster: roster(patchy, true), producers: null },
    {
      // The scaffold L5-1 priced: 256 stageable rows and seven cohorts,
      // V_s = 263.
      name: 'a full crawl with seven cohorts beside it',
      peers: belt,
      roster: roster(whole, true),
      producers: producers(7),
    },
  ];
  return cached;
}
