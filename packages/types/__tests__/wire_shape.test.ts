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

import {
  PEER_PROBE_HANDSHAKE_AXIS,
  type Mutation,
  type Cell,
  type CellDelta,
  type ChainEntry,
  type CellGalaxySnapshot,
  type PeerSightingLookup,
  type SemanticsDelta,
  type SemanticsSnapshot,
} from '../src';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) =>
  resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', name);
const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(fixturePath(name), 'utf8')) as T;

/** Wire-visible tags the SPA's `Mutation` union deliberately does NOT model.
 *
 *  `backfill_progress` rides the entity mutation broadcast like any other
 *  mutation, but the SPA acts on replay progress through the CELLS projection
 *  stream (`CellDelta.backfill`) — see the doc on `Mutation::BackfillProgress`
 *  in `crates/cknerv-core/src/mutation.rs`. The fixture still has to carry it,
 *  because the fixture pins the wire and this is on the wire; what must not
 *  happen is the chain reducer growing an arm for it by accident, which
 *  `chainReducer.test.ts` pins from the other side. */
const OUTSIDE_THE_TS_UNION = ['backfill_progress'] as const;

/** Type-level pin for the sentence above: if the union ever grows the tag,
 *  `Extract` stops being `never` and this assignment fails to compile — so
 *  the exclusion cannot rot into a lie. */
type BackfillArm = Extract<Mutation, { type: 'backfill_progress' }>;
const _backfillIsNotAChainMutation: [BackfillArm] extends [never] ? true : false = true;
void _backfillIsNotAChainMutation;

describe('wire-shape parity (TS twin of cknerv-core)', () => {
  it('mutation_samples.json parses into Mutation type', () => {
    const samples = fixture<Record<string, Mutation>>('mutation_samples.json');
    const variantTypes = new Set<string>();
    for (const [name, sample] of Object.entries(samples)) {
      expect(sample, `sample ${name} missing`).toBeDefined();
      const m = sample as { type: string };
      expect(m.type, `sample ${name} missing 'type' discriminant`).toBeTruthy();
      expect(m.type).toMatch(
        /^(block_mined|chain_reorganized|chain_rebuild|tx_landed|chain_mempool_updated|chain_info_updated|cell_tagged|chain_node_registered|backfill_progress|cell_hydration_completed|peers_updated|chain_sync_updated|chain_node_info_updated)$/,
      );
      variantTypes.add(m.type);
    }
    // Confirm we covered every wire-visible cknerv-core variant exactly once.
    // Drift here means either the fixture lost a variant or a new variant was
    // added and the test wasn't updated. The Rust twin
    // (`mutation_samples_cover_every_wire_visible_variant`) holds the same
    // set against a total match over the enum, so neither side can drift
    // alone; the two server-internal `galaxy_reservoir_*` variants are absent
    // from both, because `Mutation::entity_wire_visible` keeps them off the
    // wire entirely.
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
        ...OUTSIDE_THE_TS_UNION,
      ]),
    );
    // The observed node's own network identity is optional on the wire, so
    // the fixture carries both halves: a node that named itself, and one
    // that did not (which is also every server older than the field). The
    // second must read as absent — never as an id, never as an empty one.
    const named = samples.ChainNodeInfoUpdated as Extract<
      Mutation,
      { type: 'chain_node_info_updated' }
    >;
    const unnamed = samples.ChainNodeInfoUpdatedWithoutP2pNodeId as Extract<
      Mutation,
      { type: 'chain_node_info_updated' }
    >;
    // `id` is cknerv's key for the endpoint; `p2p_node_id` is the name the
    // network knows it by, in the same base58 vocabulary as every peer id.
    expect(named.id).toBe('ckb:local');
    expect(named.p2p_node_id).toMatch(/^Qm/);
    expect(unnamed.id).toBe(named.id);
    expect(unnamed.p2p_node_id).toBeUndefined();
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
      // The one optional seed, and the one spelled by an ABSENT key rather
      // than a null — mirroring Rust's `skip_serializing_if`, which is what
      // `cellContentEquals` compares.
      expect(
        cell.collection_seed === undefined || cell.collection_seed.length === 2,
      ).toBe(true);
      expect(cell.collection_seed).not.toBeNull();
    }
  });

  /** `collection_seed` is the only field on a `Cell` whose job is to be the
   *  SAME across cells. The fixture carries the shape mainnet produces — a
   *  Spore Cluster container and a spore inside it, two asset kinds, one
   *  seed — so both languages read kinship off the very same bytes. */
  it('cell_samples.json carries one collection shared by two kinds of cell', () => {
    const kin = fixture<Cell[]>('cell_samples.json')
      .filter((cell) => cell.collection_seed !== undefined);
    expect(kin).toHaveLength(2);
    expect(kin[0].collection_seed).toEqual(kin[1].collection_seed);
    expect(kin.map((cell) => cell.asset_kind).sort()).toEqual(['object', 'spore']);
    // Every other seed still tells them apart — kinship adds a channel, it
    // does not collapse the ones that carry individuality.
    expect(kin[0].type_shape_seed).not.toEqual(kin[1].type_shape_seed);
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
      peer_sightings: Record<string, PeerSightingLookup>;
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
    // The exact occupied capacity is NOT `total_bytes * 100_000_000`: it comes
    // from the source's stored figure, which counts script args the byte
    // breakdown never itemized. The two are shipped side by side precisely so
    // the residual stays visible — a parity test that recomputed one from the
    // other would be asserting the bug this field exists to expose.
    expect(sample.snapshot.cells[0].common_knowledge?.occupied_shannons).toBe(
      '12200000000',
    );
    expect(
      Number(sample.snapshot.cells[0].common_knowledge?.occupied_shannons),
    ).toBeGreaterThan(
      (sample.snapshot.cells[0].common_knowledge?.total_bytes ?? 0) * 100_000_000,
    );
    // A death the source can attribute: outpoint spent, spender named.
    expect(sample.snapshot.cells[0].consumed?.tx_hash).toBe('0xspendtx');
    expect(sample.snapshot.cells[0].consumed?.block).toBe(99);
    // DAO wall clocks ride the facet as ms-epoch rows APPENDED after the block
    // rows, so a reader that shows only the leading attributes still leads
    // with blocks.
    const daoFacet = sample.snapshot.cells[0].facets.find(
      (facet) => facet.kind === 'dao',
    );
    expect(daoFacet?.attributes.map((attribute) => attribute.key)).toEqual([
      'deposit_block',
      'withdraw_request_block',
      'deposit_at_ms',
      'withdraw_request_at_ms',
    ]);
    expect(
      daoFacet?.attributes.find((a) => a.key === 'deposit_at_ms'),
    ).toMatchObject({ value: '1709618828000', unit: 'ms' });
    // The second cell is the same shape from a source that stated none of the
    // three: every one of them is ABSENT, never a zero or an empty string.
    const legacy = sample.snapshot.cells[1];
    expect(legacy.common_knowledge?.total_bytes).toBe(102);
    expect(legacy.common_knowledge?.occupied_shannons).toBeUndefined();
    expect(legacy.consumed).toBeUndefined();
    expect(
      legacy.facets
        .flatMap((facet) => facet.attributes)
        .filter((attribute) => attribute.key.endsWith('_at_ms')),
    ).toEqual([]);
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
    // The atlas is asserted by its arithmetic rather than by its figures. The
    // fixture is regenerated from a live crawl, so a literal here would pin a
    // number the network is free to change overnight — while the relationships
    // below are the contract itself, and are what a reader of the panel is
    // being shown.
    const atlas = sample.snapshot.network_atlas!;
    // Three ways a completed candidate ends, and no fourth.
    expect(atlas.last_round_reachable + atlas.exhausted_candidates + atlas.foreign_peers)
      .toBe(atlas.candidate_peers);
    // The cross-cut: reached this round, or held from an earlier one.
    expect(atlas.last_round_reachable + atlas.verified_unavailable_peers)
      .toBe(atlas.verified_retained_peers);
    // Three histograms, one population — the census that replaced a 64-row
    // sample, which is why every strip may be drawn as shares of one number.
    for (const family of [atlas.countries, atlas.versions, atlas.asns]) {
      expect(family.length).toBeGreaterThan(0);
      expect(family.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(atlas.indexed_peers);
    }
    expect(atlas.asns[0].label).toMatch(/^AS\d+ /);
    // And the round's address histogram, which is the one thing in this record
    // that partitions something OTHER than peers: a peer is dialed once per
    // address anybody advertised for it, so this population runs several times
    // the peer counts above it.
    expect(atlas.handshake_depth.map((rung) => rung.result))
      .toEqual([...PEER_PROBE_HANDSHAKE_AXIS]);
    expect(atlas.handshake_depth.reduce((sum, rung) => sum + rung.attempts, 0))
      .toBe(atlas.address_attempts);
    expect(atlas.address_attempts).toBeGreaterThan(atlas.candidate_peers);
    // The bridge to the ladder, as a bound rather than an equality — upstream
    // holds an identified peer to exactly one identifying dial today, and that
    // is a property of dialing a peer's addresses in turn rather than a
    // guarantee cknerv may refuse a record over.
    const identified = atlas.handshake_depth
      .find((rung) => rung.result === 'same_network_identified');
    expect(identified?.attempts).toBeGreaterThanOrEqual(atlas.last_round_reachable);
    expect(sample.deltas.cell_upsert.type).toBe('cell_upsert');
    expect(sample.deltas.asset_ecosystem_replace.type).toBe('asset_ecosystem_replace');
    expect(sample.deltas.dao_state_replace.type).toBe('dao_state_replace');
    expect(sample.deltas.protocol_era_replace.type).toBe('protocol_era_replace');
    expect(sample.deltas.fork_watch_replace.type).toBe('fork_watch_replace');
    expect(sample.deltas.activity_feed_replace.type).toBe('activity_feed_replace');
    expect(sample.deltas.transaction_horizon_replace.type).toBe('transaction_horizon_replace');
    expect(sample.deltas.network_atlas_replace.type).toBe('network_atlas_replace');
    expect(sample.deltas.network_atlas_clear.type).toBe('network_atlas_clear');
    // The roster is the atlas's twin: the atlas counts the crawler's known
    // set and names nobody, this names a bounded few and counts nothing. Its
    // ids are base58 — the same vocabulary a peer row and
    // `/api/enrichment/peers/:node_id` speak — so a sighted node can be
    // carried straight from this list into a dossier lookup.
    const roster = sample.snapshot.network_roster;
    expect(roster?.crawl_round).toBe(7);
    expect(roster?.truncated).toBe(true);
    expect(roster?.entries.map((node) => node.node_id)).toEqual(
      [...(roster?.entries.map((node) => node.node_id) ?? [])].sort(),
    );
    expect(roster?.entries[0].node_id).toBe(
      'QmQHmapDhRnzHqcAJQ5geABWdMVRaa6qah9gEdBEF7ejyL',
    );
    expect(roster?.entries[0].addr).toBe('/ip4/203.0.113.7/tcp/8115');
    expect(roster?.entries[0].rtt_ms).toBe(41);
    // Dark matter is carried, not filtered: a node the crawler could not
    // reach is still a node it saw, and it has no dial to report.
    expect(roster?.entries[1].reachable).toBe(false);
    expect(roster?.entries[1].rtt_ms).toBeUndefined();
    // An honest label, not an absent field.
    expect(roster?.entries[2].country).toBe('Unknown');
    expect(roster?.entries[2].asn).toBe('Unknown');
    expect(sample.deltas.network_roster_replace.type).toBe('network_roster_replace');
    expect(sample.deltas.network_roster_clear.type).toBe('network_roster_clear');
    // A round that found nobody and no crawler at all are different answers
    // and arrive as different arms: an empty roster still names its round.
    const emptyRoster = sample.deltas.network_roster_replace_empty;
    expect(emptyRoster.type).toBe('network_roster_replace');
    if (emptyRoster.type === 'network_roster_replace') {
      expect(emptyRoster.network_roster.entries).toEqual([]);
      expect(emptyRoster.network_roster.crawl_round).toBe(7);
    }
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
        'network_roster_replace',
        'network_roster_clear',
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

    // The peer dossier is neither a snapshot slot nor a delta arm: it is
    // resolved one node at a time through /api/enrichment/peers/:node_id,
    // because the set of peers belongs to the network, not to the chain.
    expect(sample.snapshot).not.toHaveProperty('peer_sightings');
    expect(sample.deltas).not.toHaveProperty('peer_sighting_replace');
    const sighted = sample.peer_sightings.sighted;
    expect(sighted.state).toBe('sighted');
    if (sighted.state !== 'sighted') throw new Error('sighted sample is unsighted');
    // The crawler counts unix SECONDS; cknerv's wire counts milliseconds
    // everywhere, and the adapter is where that conversion happens.
    expect(sighted.sighting.last_seen_ms).toBe(1_699_999_940_000);
    expect(sighted.sighting.first_seen_ms).toBe(1_650_000_000_000);
    expect(sighted.sighting.last_reachable_at_ms).toBe(1_699_999_940_000);
    expect(sighted.sighting.node_id).toMatch(/^Qm/);
    expect(sighted.sighting.asn).toBe('AS24940 Hetzner Online GmbH');
    expect(sighted.sighting.protocols).toEqual(['/ckb/syn', '/ckb/relay']);
    expect(sighted.sighting.rtt_ms).toBe(41);
    expect(sighted.sighting.reachable).toBe(true);
    // The outbound address-book count upstream deleted is absent rather than
    // zero, and the CROWD row stands down on it. `advertisers[]` is what
    // replaced it upstream, and it counts the peers that named THIS node —
    // the same relationship read from the other end, so it must never be
    // read into this slot.
    expect(sighted.sighting.known_peers_count).toBeUndefined();
    // Same total-match pin as the deltas: the Rust writer enumerates every
    // absence reason, and the plate prints a different sentence for each.
    const absences = Object.values(sample.peer_sightings).flatMap((lookup) =>
      lookup.state === 'unsighted' ? [lookup.reason] : [],
    );
    expect(new Set(absences)).toEqual(
      new Set([
        'no_crawler',
        'unreadable_node_id',
        'never_sighted',
        'advertised_unverified',
      ]),
    );
    // The one absence with evidence under it, and the shape the plate reads
    // its two captions from. A sample of the word alone would let the payload
    // be dropped without anything noticing.
    const advertised = sample.peer_sightings.advertised_unverified;
    if (advertised.state !== 'unsighted') throw new Error('advertised sample is a sighting');
    expect(advertised.advertised?.furthest_result)
      .toBe('no_authenticated_session_before_deadline');
    expect(advertised.advertised?.consecutive_exhausted_rounds).toBe(2);
    expect(advertised.advertised?.last_advertised_at_ms).toBe(1_699_999_940_000);
    // And the absences that are only a word carry no payload at all.
    const neverSighted = sample.peer_sightings.never_sighted;
    if (neverSighted.state !== 'unsighted') throw new Error('never_sighted sample is a sighting');
    expect(neverSighted.advertised).toBeUndefined();
  });
});
