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
  type Mutation,
  type Cell,
  type CellDelta,
  type ChainEntry,
  type CellGalaxySnapshot,
  type PeerSightingLookup,
  type ProducerLedgerRow,
  type RosterNode,
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

    // A block's producer is optional on the wire for the same reason: the
    // adapter cannot always read one (genesis names nobody, a witness may not
    // parse, and the simulator emits none at all). Both halves ride one
    // reading, so they are present together or absent together — never a
    // synthesized key, never an empty-string one.
    const mined = samples.BlockMined as Extract<Mutation, { type: 'block_mined' }>;
    const minedAnonymously = samples.BlockMinedWithoutProducer as Extract<
      Mutation,
      { type: 'block_mined' }
    >;
    expect(mined.producer_key).toMatch(/^0x[0-9a-f]{64}$/);
    expect(typeof mined.producer_message).toBe('string');
    expect(minedAnonymously.number).toBe(mined.number);
    expect(minedAnonymously.producer_key).toBeUndefined();
    expect(minedAnonymously.producer_message).toBeUndefined();
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
    // The producer window ships its own denominator, so a share can never be
    // rendered against a window it was not measured over.
    expect(Array.isArray(sample.producers)).toBe(true);
    expect(Array.isArray(sample.producer_window)).toBe(true);
    expect(typeof sample.producer_window_blocks).toBe('number');
    for (const producer of sample.producers) {
      expect(typeof producer.key).toBe('string');
      expect(typeof producer.message).toBe('string');
      expect(typeof producer.blocks).toBe('number');
      expect(typeof producer.last_seen_ms).toBe('number');
    }
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
    // The block wave's cause, carried on the event that makes the wave. The
    // anonymous twin must be missing the key OUTRIGHT: a blank string would
    // reach the client as a producer nobody has, where absence reaches it as
    // the anonymous origin it is.
    const pulse = samples.pulse as Extract<CellDelta, { type: 'pulse' }>;
    expect(pulse.producer_key).toMatch(/^0x[0-9a-f]{64}$/);
    expect(samples.pulse_anonymous).toEqual({
      type: 'pulse',
      at_ms: 1_700_000_007_000,
    });
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
    // Two histograms, one population — the census that replaced a 64-row
    // sample, which is why every strip may be drawn as shares of one number.
    // And it is NOT the number the bar above them is drawn as shares of: the
    // round names every peer it heard of, these count only the peers it holds
    // a verification for, so a fixture where those two happened to agree would
    // stop being evidence that the panel keeps them apart.
    for (const family of [atlas.countries, atlas.versions]) {
      expect(family.length).toBeGreaterThan(0);
      expect(family.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(atlas.indexed_peers);
    }
    expect(atlas.candidate_peers).toBeGreaterThan(atlas.indexed_peers);
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
      'QmNRAvtC6L85hwp6vWnqaKonJw3dz1q39B4nXVQErzC4Hx',
    );
    expect(roster?.entries[0].state).toBe('reachable');
    expect(roster?.entries[0].rtt_ms).toBe(1331);
    // Four clocks, and the fixture gives each of them its own value, because
    // two that agreed would let a reader collapse the pair and still pass.
    // The required one is the newest, which is what it means: the maximum
    // over every positive channel, of which the advertise clock is only one.
    expect(roster?.entries[0].last_reachable_ms).toBe(1_699_999_940_000);
    expect(roster?.entries[0].last_advertised_ms).toBe(1_699_999_990_000);
    expect(roster?.entries[0].last_observed_ms).toBe(1_699_999_945_000);
    expect(roster?.entries[0].latest_positive_observed_ms).toBe(1_699_999_995_000);
    // ⭐ The distinction the whole record turns on. A node the crawler REACHED
    // and could not place carries the crawler's own word for that; a node
    // nobody has ever got an answer out of carries nothing at all. Two
    // different true sentences, and a reader that spelled them the same way
    // would print a verdict over a peer nobody has spoken to.
    expect(roster?.entries[1].state).toBe('reachable');
    expect(roster?.entries[1].country).toBe('Unknown');
    expect(roster?.entries[1].asn).toBe('Unknown');
    const hearsay = roster?.entries[2];
    expect(hearsay?.state).toBe('advertised_unverified');
    expect(hearsay?.version).toBeUndefined();
    expect(hearsay?.country).toBeUndefined();
    expect(hearsay?.asn).toBeUndefined();
    expect(hearsay?.rtt_ms).toBeUndefined();
    // The reach clock in particular: an unverified peer was never reached, so
    // the field that means "the crawler saw this node" has to be gone rather
    // than filled from either of the two clocks beside it.
    expect(hearsay?.last_reachable_ms).toBeUndefined();
    expect(hearsay?.last_advertised_ms).toBe(1_699_999_990_000);
    expect(hearsay?.last_observed_ms).toBe(1_699_999_920_000);
    // ⭐ And the one clock that is never absent, on the row with the fewest
    // fields of any. The advertise clock used to hold that job and no longer
    // can: the crawler hears of peers through sessions nobody gossiped, so it
    // answers `null` there rather than inventing a moment. Every row on this
    // wire still carries a date, which is what lets a scene age a node it has
    // placed — this is the assertion that says so.
    expect(hearsay?.latest_positive_observed_ms).toBe(1_699_999_991_000);
    // ⭐ And a pin no runtime assertion can stand in for. Every check above
    // reads a fixture that HAS the field, so all of them keep passing the day
    // someone marks it optional on this side — and the moment it is optional,
    // readers start writing `?? 0` and the property that no roster row is
    // undated dies quietly on the twin while the Rust side still guarantees
    // it. This is a type-level equality: it stops compiling if the required
    // clock stops being required, and `pnpm typecheck` is what reads it.
    type RequiredClockStaysRequired =
      RosterNode extends { latest_positive_observed_ms: number } ? true : false;
    const requiredClockStaysRequired: RequiredClockStaysRequired = true;
    expect(requiredClockStaysRequired).toBe(true);
    expect(
      roster?.entries.every((node) => typeof node.latest_positive_observed_ms === 'number'),
    ).toBe(true);
    // Dark matter is carried, not filtered: a node the crawler could not
    // reach this round is still a node it holds a verification for, so it
    // answers every field the reached rows do and has no dial to report.
    expect(roster?.entries[3].state).toBe('verified_unavailable');
    expect(roster?.entries[3].version).toBe('0.208.1');
    expect(roster?.entries[3].last_reachable_ms).toBe(1_699_999_100_000);
    expect(roster?.entries[3].latest_positive_observed_ms).toBe(1_699_999_985_000);
    expect(roster?.entries[3].rtt_ms).toBeUndefined();
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
    // The POW cohort ledger: the other window on the same producers. The
    // 240-block `Chain.producer_window` is RECENCY and this is SIZE — seven
    // complete days, warm from the first frame, unaffected by the reorg that
    // empties the window. Both print; neither replaces the other.
    const ledger = sample.snapshot.producer_ledger;
    expect(ledger?.window_days).toBe(7);
    expect(ledger?.from_date).toBe('2026-08-26');
    expect(ledger?.to_date).toBe('2026-09-01');
    expect(ledger?.total_blocks).toBe(67_800);
    // Rows arrive blocks-descending, so the same answer stages as the same
    // list refresh after refresh, and the cap never cuts the head off.
    expect(ledger?.rows.map((row) => row.blocks)).toEqual([41_824, 2]);
    // ⚠️ THE ASSERTION THE WHOLE FIELD EXISTS FOR. `balance_shannons` is a
    // decimal STRING carrying a value no double can hold: the live top miner
    // held 9,820,183,392,640,200 shannons on 2026-09-02 against a
    // `Number.MAX_SAFE_INTEGER` of 9,007,199,254,740,991. Compared with
    // `BigInt` on both sides, because `Number(balance)` is the bug — it
    // returns a number that looks right and is not, and the HUD prints it.
    const top = ledger?.rows[0];
    expect(typeof top?.balance_shannons).toBe('string');
    expect(BigInt(top?.balance_shannons ?? '0')).toBeGreaterThan(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
    expect(top?.balance_shannons).toBe('9820183392640200');
    // And the proof that reading it as a number is silently lossy, MEASURED
    // rather than assumed. This particular figure happens to round-trip
    // through `String(Number(...))` — it is even, and doubles above 2^53 land
    // on every second integer — which is exactly what makes the field
    // dangerous: the damage does not show up in the value, it shows up in the
    // arithmetic. One shannon added to it disappears.
    const asDouble = Number(top?.balance_shannons);
    expect(asDouble + 1).toBe(asDouble);
    expect(BigInt(top?.balance_shannons ?? '0') + 1n).not.toBe(
      BigInt(top?.balance_shannons ?? '0'),
    );
    expect(top?.address?.startsWith('ckb1')).toBe(true);
    expect(top?.live_cells).toBe(155_450);
    expect(top?.tx_count).toBe(4_094_449);
    expect(top?.last_reward_shannons).toBe('71011833086');
    expect(top?.last_reward_block).toBe(88);
    // ⭐ Share is never on the wire. `blocks / total_blocks` is computed where
    // it is printed, so a share can never be restated against a window it was
    // not measured over — and the source's own percentage string is not
    // declared anywhere.
    expect(top).not.toHaveProperty('share');
    expect(top).not.toHaveProperty('percentage');
    expect(ledger).not.toHaveProperty('as_of');
    // ⭐ The row that is the point of the pair. The window figures come from
    // one request; everything below them comes from a per-address request that
    // can fail on its own. This producer's address the source would not
    // resolve, so its optionals are ABSENT — not null, and not zero. A reader
    // that spelled those the same way would print `0 CKB` over a balance
    // nobody read.
    const unresolved = ledger?.rows[1];
    expect(unresolved?.key).toBe(
      '0x6aa42538dd2de2ba4d022c7fdc92d35e760331a9d0f9992a03d2550e82cb7bc2',
    );
    expect(unresolved?.blocks).toBe(2);
    for (const absent of [
      'address',
      'balance_shannons',
      'live_cells',
      'tx_count',
      'last_reward_shannons',
      'last_reward_block',
    ] as const) {
      expect(unresolved).not.toHaveProperty(absent);
      expect(unresolved?.[absent]).toBeUndefined();
    }
    // ⭐ A pin no runtime assertion can stand in for, the roster's lesson
    // applied here: every check above reads a fixture that HAS the balance, so
    // all of them keep passing the day someone types the field as a `number`.
    // This is a type-level equality — it stops compiling if the balance stops
    // being a string, and `pnpm typecheck` is what reads it.
    type BalanceStaysAString =
      ProducerLedgerRow extends { balance_shannons?: string } ? true : false;
    const balanceStaysAString: BalanceStaysAString = true;
    expect(balanceStaysAString).toBe(true);
    expect(sample.deltas.producer_ledger_replace.type).toBe('producer_ledger_replace');
    expect(sample.deltas.producer_ledger_clear.type).toBe('producer_ledger_clear');

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
    // The chain-scope twin of the stage's script census: every family the
    // index counts, and the remainders it cannot place, so the CELL CENSUS
    // bars partition `live_cells` exactly — the fixture pins that arithmetic
    // rather than the shape alone.
    const familyCensus = sample.snapshot.script_family_census;
    expect(familyCensus).toBeDefined();
    const familyCells = (kind: string) => familyCensus!.families
      .filter((family) => family.kind === kind)
      .reduce((sum, family) => sum + family.live_cells, 0);
    expect(familyCells('type') + familyCensus!.types_absent + familyCensus!.types_unlisted)
      .toBe(familyCensus!.live_cells);
    expect(familyCells('lock') + familyCensus!.locks_unlisted).toBe(familyCensus!.live_cells);
    expect(familyCensus!.families.map((family) => family.kind))
      .toEqual(expect.arrayContaining(['type', 'lock']));
    // The index's own inventory verdict rides each family, and the DAO count
    // is the census's: together they are what the CELL CENSUS bar splits
    // the typed Cells by, so the fixture carries every kind the bar names.
    expect(new Set(familyCensus!.families.map((family) => family.inventory).filter(Boolean)))
      .toEqual(new Set(['token', 'object', 'identity']));
    expect(familyCensus!.types_dao).toBeLessThanOrEqual(familyCells('type'));
    expect(sample.deltas.script_family_census_replace.type).toBe(
      'script_family_census_replace',
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
        // Arms of the TS union since the reducer grew the fold beside them —
        // `semanticsReducer.ts` closes its switch on a `never` binding, so the
        // union arm and the arm that folds it were necessarily one change.
        'producer_ledger_replace',
        'producer_ledger_clear',
        'script_registry_replace',
        'script_family_census_replace',
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
    // The address book, read from both ends, in two units that are not the
    // same unit. The slot that held one number for both is gone: it counted
    // PEERS this node knew, upstream deleted it, and what replaced it counts
    // peers that know THIS node — there was never a way to fill it that did
    // not say the sentence backwards.
    expect(sighted.sighting).not.toHaveProperty('known_peers_count');
    expect(sighted.sighting.advertiser_peer_count).toBe(47);
    expect(sighted.sighting.advertised_address_count).toBe(5_727);
    // ⚠️ A peer is advertised under every alias anybody ever saw it at, so
    // the ADDRESS count runs several times the PEER count. The sample keeps
    // them orders apart on purpose: two figures of the same size would let a
    // surface print either one under either label and still look right.
    expect(sighted.sighting.advertised_address_count)
      .toBeGreaterThan((sighted.sighting.advertiser_peer_count ?? 0) * 10);
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
    // Two clocks, and the sample keeps them apart on purpose. The advertise
    // clock is what the rung is about and is now OPTIONAL — a peer met only
    // through a session nobody gossiped has no advertise moment — so the
    // report is dated by the observation maximum, which upstream answers for
    // every peer it answers about at all. Equal figures would let the plate
    // print either one under either phrase and still look right.
    expect(advertised.advertised?.last_advertised_at_ms).toBe(1_699_999_940_000);
    expect(advertised.advertised?.latest_positive_observed_ms).toBe(1_699_999_985_000);
    // The rung has somewhere it happened, and a denominator: one refused
    // address out of one is a dead entry in the gossip, one out of three is a
    // node that is not answering anywhere.
    expect(advertised.advertised?.furthest_address).toBe('/ip4/198.51.100.4/tcp/8115');
    expect(advertised.advertised?.dialed_address_count).toBe(3);
    // The INBOUND count stands on both sides of the sighted/unsighted split —
    // the peers that name a node are counted whether or not anybody ever got
    // an answer out of it — so it is the same field name in both records.
    expect(advertised.advertised?.advertiser_peer_count).toBe(6);
    // And the absences that are only a word carry no payload at all.
    const neverSighted = sample.peer_sightings.never_sighted;
    if (neverSighted.state !== 'unsighted') throw new Error('never_sighted sample is a sighting');
    expect(neverSighted.advertised).toBeUndefined();
  });
});
