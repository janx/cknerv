// The render-count instrument for App's fan-out.
//
// A memo bails out only when EVERY prop compares equal, so one fresh object
// handed down from App silently re-runs a whole scene root. `App.sceneRoots`
// guards the shape of that contract by reading the source; this guards the
// BEHAVIOUR, which is the half a source scan cannot see: mount the real App
// with the real reducers, replace each root with a `memo` that records the
// props that changed, drive the real publish paths, and count.
//
// Everything App owns is real here — its state, its memos, its effects, its
// callbacks, the cells/chain/semantics reducers behind every push. What is
// replaced is what sits BELOW the boundary being measured (the scene roots,
// the HUD, the dossier) and what jsdom cannot run at all (the WebGL canvas and
// its frame loop). A counter that renders null still re-renders exactly when
// the real child would, which is the whole reading.
//
// Nothing the test file MOCKS is imported at module scope here (the type-only
// import below is erased): a static import would re-enter a mock factory that
// is still running, so the reducers and the scene modules are reached through
// dynamic imports, after the tree is standing.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Children,
  forwardRef,
  isValidElement,
  memo,
  useEffect,
  type ComponentType,
  type ReactNode,
} from 'react';
import type {
  Cell,
  CellDelta,
  CellGalaxySnapshot,
  ChainEntry,
  ChainNode,
  Peer,
  RevisionedCellDelta,
  RevisionedMutation,
} from '@cknerv/types';

export interface RenderRecord {
  readonly name: string;
  /** Props whose identity moved since this component's previous render. Empty
   *  on a render forced by something other than props (state, context). */
  readonly changed: readonly string[];
}

const records: RenderRecord[] = [];
const lastProps = new Map<string, Record<string, unknown>>();

/**
 * A memoized counter standing in for one child. Records the prop keys whose
 * identity moved, which is why the render happened.
 *
 * `slot` names a prop carrying an ELEMENT the real child mounts inside itself
 * — the two scene roots both take one. It has to be rendered here or the
 * overlay's own children never mount, and the memo that holds them across a
 * block is exactly what several of these tests are reading.
 */
export function countingComponent(
  name: string,
  slot?: string,
): ComponentType<never> {
  function Counter(props: Record<string, unknown>) {
    const previous = lastProps.get(name);
    const changed: string[] = [];
    if (previous === undefined) {
      changed.push(...Object.keys(props));
    } else {
      const keys = new Set([...Object.keys(previous), ...Object.keys(props)]);
      for (const key of keys) {
        if (!Object.is(previous[key], props[key])) changed.push(key);
      }
    }
    lastProps.set(name, { ...props });
    records.push({ name, changed: changed.sort() });
    return slot === undefined ? null : <>{props[slot] as ReactNode}</>;
  }
  Counter.displayName = name;
  return memo(Counter) as unknown as ComponentType<never>;
}

/** The HUD's stand-in also has to hand App a camera frame: the Canvas mounts
 *  only once one exists, and the scene roots live inside it. One frozen frame,
 *  published once, so the layout is never a source of renders. */
export const HUD_CAMERA_FRAME = Object.freeze({
  width: 1920,
  height: 1080,
  hole: Object.freeze({ left: 384, right: 1574 }),
});

function countingHudOverlay(): ComponentType<never> {
  const Counter = countingComponent('HudOverlay') as ComponentType<
    Record<string, unknown>
  >;
  function HudOverlayStub(props: Record<string, unknown>) {
    const publish = props.onCameraFrame as
      | ((frame: typeof HUD_CAMERA_FRAME) => void)
      | undefined;
    useEffect(() => { publish?.(HUD_CAMERA_FRAME); }, [publish]);
    return <Counter {...props} />;
  }
  HudOverlayStub.displayName = 'HudOverlayStub';
  return HudOverlayStub as unknown as ComponentType<never>;
}

/**
 * A counter that is NOT memoized — for a child that takes no props, where a
 * memo would bail on every re-render and count nothing. Its count is the count
 * of its PARENT's renders, which for a child of App is App's own.
 */
export function plainCounter(name: string): ComponentType<never> {
  function PlainCounter() {
    records.push({ name, changed: [] });
    return null;
  }
  PlainCounter.displayName = name;
  return PlainCounter as unknown as ComponentType<never>;
}

/** Drop everything recorded so far. Called after the mount settles, so a
 *  window's counts start from a tree that is already standing. */
export function resetRenders(): void {
  records.length = 0;
}

/** Forget the previous props too — a fresh mount must not diff against the
 *  props of the tree the last test tore down. */
export function resetHarness(): void {
  records.length = 0;
  lastProps.clear();
  realNodeHealthPollMs = null;
  streams.entity = null;
  streams.cells = null;
  streams.semantics = null;
  streams.health = null;
}

/** The props one counter last received — the handle a test needs to reach a
 *  callback App only ever hands downward. */
export function propOf(name: string, key: string): unknown {
  return lastProps.get(name)?.[key];
}

/** Open a Cell card the way the galaxy does: through the selection callback
 *  the scene root was handed. */
export async function selectCell(id: number | null): Promise<void> {
  const select = propOf('CellGalaxy', 'onSelect') as
    ((id: string | null) => void) | undefined;
  await publish(() => select?.(id === null ? null : `cell:${id}`));
}

export function renderCount(name: string): number {
  return records.filter((record) => record.name === name).length;
}

/** Every render of `name` in the current window, as its changed-prop set. */
export function renderReasons(name: string): readonly (readonly string[])[] {
  return records.filter((record) => record.name === name).map((r) => r.changed);
}

/** `Name=count{key+key}` for every component that rendered, in first-render
 *  order — the row shape lane L6 read its findings off. */
export function renderSummary(): string {
  const order: string[] = [];
  const changed = new Map<string, Set<string>>();
  for (const record of records) {
    if (!changed.has(record.name)) {
      order.push(record.name);
      changed.set(record.name, new Set());
    }
    for (const key of record.changed) changed.get(record.name)!.add(key);
  }
  return order
    .map((name) => {
      const keys = [...changed.get(name)!].sort();
      return `${name}=${renderCount(name)}${keys.length ? `{${keys.join('+')}}` : ''}`;
    })
    .join(' ');
}

// ——— the connectors App opens on mount ———
//
// Each one hands its publish callback straight to a `useState` setter, so
// holding the callback is holding the stream.

interface Streams {
  entity: ((next: unknown) => void) | null;
  cells: ((next: unknown) => void) | null;
  semantics: ((next: unknown) => void) | null;
  health: ((next: unknown) => void) | null;
}

export const streams: Streams = {
  entity: null,
  cells: null,
  semantics: null,
  health: null,
};

const INERT = { disconnect: () => {} };

/** Inside a Canvas every lowercase tag is a three element, not an HTML one.
 *  React components pass; intrinsics are dropped rather than handed to jsdom,
 *  which has no spelling for them. */
function sceneChildren(children: ReactNode): ReactNode {
  return Children.toArray(children).filter(
    (child) => !(isValidElement(child) && typeof child.type === 'string'),
  );
}

/** `@react-three/fiber` — the Canvas is a plain element and the frame loop
 *  never runs, so every in-Canvas child still mounts and renders. */
export async function fiberMock(): Promise<Record<string, unknown>> {
  const { PerspectiveCamera, Scene, Vector2 } = await import('three');
  const camera = new PerspectiveCamera(50, 1920 / 1080, 1, 3000);
  const scene = new Scene();
  const state = {
    camera,
    scene,
    gl: {
      domElement: { addEventListener: () => {}, removeEventListener: () => {} },
      info: { render: { calls: 0, triangles: 0 }, programs: [] },
      getContext: () => null,
      getSize: (target: Vector2) => target.set(1920, 1080),
      getPixelRatio: () => 1,
    },
    size: { width: 1920, height: 1080, top: 0, left: 0 },
    viewport: { width: 1920, height: 1080, factor: 1, dpr: 1 },
    invalidate: () => {},
    setEvents: () => {},
    clock: { getElapsedTime: () => 0 },
  };
  return {
    // A plain element, so every in-Canvas child still mounts — but NOT a DOM
    // host for the scene's own intrinsics: `<color attach="background">` is a
    // three element with no HTML spelling, and rendering it into jsdom earns
    // an unrecognized-tag warning on every mount. R3F swallows unknown
    // intrinsics into the scene graph; here they are simply dropped.
    Canvas: forwardRef<HTMLDivElement, { children?: ReactNode }>(
      ({ children }, ref) => (
        <div data-r3f-canvas ref={ref}>{sceneChildren(children)}</div>
      ),
    ),
    useFrame: () => {},
    useThree: (selector?: (s: typeof state) => unknown) =>
      (selector ? selector(state) : state),
    useLoader: () => null,
    invalidate: () => {},
    extend: () => {},
    createPortal: (children: ReactNode) => children,
    addEffect: () => () => {},
    addAfterEffect: () => () => {},
    addTail: () => () => {},
  };
}

/** `@react-three/drei` — App reaches only for the two below, and both are
 *  scene furniture the count never depends on. */
export function dreiMock(): Record<string, unknown> {
  // Both take a ref from App (the controls ref the camera reads, the stars
  // handle the quality tier writes), so both have to be able to hold one.
  return {
    OrbitControls: forwardRef(() => null),
    Stars: forwardRef(() => null),
    Html: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
}

/** The names counted, in the order the fan-out reaches them. */
export const COUNTED = [
  'CellGalaxy',
  'NetworkColony',
  'CellInspectionOverlay',
  'HudOverlay',
  'NeuralNetwork',
  'CellSemanticOrbit',
  'Jukebox',
  'Tweaks',
] as const;

/** Every in-Canvas component App mounts that this harness does not count:
 *  inert, so nothing below the boundary can publish, animate or measure. */
const INERT_UI_EXPORTS = [
  'AdaptiveQualityController',
  'BootFrameSentinel',
  'BootNerveRestSentinel',
  'BootViewSentinel',
  'CellCausalLensLayer',
  'CellInspectionAnchor',
  'CellPortraitInset',
  'ConsensusRouteCamera',
  'ConsensusWriteSeal',
  'MinerInspectionAnchor',
  'MinerInspectionOverlay',
  'NodeInspectionAnchor',
  'NodeInspectionOverlay',
  'PeerInspectionAnchor',
  'PeerInspectionOverlay',
  'RenderStatsPanel',
  'RenderStatsSampler',
  'SightedInspectionAnchor',
  'SightedInspectionOverlay',
  'SimClockTicker',
] as const;

/**
 * `@cknerv/ui` with the measured boundary replaced. Everything else — the
 * derives, the constants, the boot record, the tuning stores, the inspection
 * handles — stays exactly as the app runs it.
 */
export function uiMock(actual: Record<string, unknown>): Record<string, unknown> {
  const mocked: Record<string, unknown> = { ...actual };
  for (const name of INERT_UI_EXPORTS) mocked[name] = () => null;
  mocked.CellGalaxy = countingComponent('CellGalaxy', 'overlay');
  mocked.NetworkColony = countingComponent('NetworkColony', 'overlay');
  mocked.CellInspectionOverlay = countingComponent('CellInspectionOverlay');
  mocked.NeuralNetwork = countingComponent('NeuralNetwork');
  mocked.CellSemanticOrbit = countingComponent('CellSemanticOrbit');
  mocked.HudOverlay = countingHudOverlay();
  // Counted rather than inert: whether leva's bridge is mounted at all is a
  // reading, not scenery. Unmemoized, because it takes no props and a memo
  // would hide every re-render it costs.
  mocked.TweakSync = plainCounter('TweakSync');
  return mocked;
}

/** `@cknerv/cache` with the three sockets replaced by their callbacks and the
 *  two selection fetches silenced. Every reducer stays real. */
export function cacheMock(
  actual: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...actual,
    connectEntityStream: (
      _url: string,
      _initial: unknown,
      onChange: (next: unknown) => void,
    ) => { streams.entity = onChange; return INERT; },
    connectCellsStream: (
      _url: string,
      _initial: unknown,
      onChange: (next: unknown) => void,
    ) => { streams.cells = onChange; return INERT; },
    connectSemanticsStream: (
      _url: string,
      _initial: unknown,
      onChange: (next: unknown) => void,
    ) => { streams.semantics = onChange; return INERT; },
    fetchCellSemantics: () => new Promise(() => {}),
    fetchTransactionSemantics: () => new Promise(() => {}),
    fetchPeerSighting: () => new Promise(() => {}),
    cachedPeerSighting: () => null,
  };
}

/** Poll cadence for the tests that drive the REAL node-health channel (see
 *  `useRealNodeHealth`); `null` keeps the capture-only stand-in. */
let realNodeHealthPollMs: number | null = null;

/**
 * Run the actual `connectNodeHealth` under this mount, so a test can read what
 * the POLL publishes rather than what a stub decided to. The caller owns
 * `fetch` and the clock. Reset by `resetHarness`.
 */
export function useRealNodeHealth(pollMs: number): void {
  realNodeHealthPollMs = pollMs;
}

/** `ui-app/src/connect` — only the node-health poll is reached from App. */
export function connectMock(
  actual: Record<string, unknown>,
): Record<string, unknown> {
  const real = actual.connectNodeHealth as (
    onHealth: (next: unknown) => void,
    opts?: { pollMs?: number },
  ) => { disconnect: () => void };
  return {
    ...actual,
    connectNodeHealth: (onHealth: (next: unknown) => void) => {
      streams.health = onHealth;
      return realNodeHealthPollMs === null
        ? INERT
        : real(onHealth, { pollMs: realNodeHealthPollMs });
    },
  };
}

export function tweaksMock(): Record<string, unknown> {
  return { default: plainCounter('App') };
}

export function jukeboxMock(): Record<string, unknown> {
  return { default: countingComponent('Jukebox') };
}

// ——— the fixtures and the pushes ———

const fixture = <T,>(name: string): T => JSON.parse(
  readFileSync(resolve(process.cwd(), '..', 'tests', 'fixtures', name), 'utf8'),
) as T;

export const CHAIN_SNAPSHOT = fixture<ChainEntry>('snapshot_chain.json');
export const CELLS_SNAPSHOT = fixture<CellGalaxySnapshot>('snapshot_cells.json');

/** The producers the bootstrap window already stands nodes for. A block from
 *  one of them moves the standings and nothing geometric; a block from a name
 *  the window has never seen adds a node, which is a real rebuild and not the
 *  steady state any of these counts are about. */
export const KNOWN_PRODUCERS: readonly string[] =
  (CHAIN_SNAPSHOT.producers ?? []).map((p) => p.key);

export const CHAIN_NODES: ChainNode[] = [{
  id: 'ckb:local',
  label: 'LOCAL',
  url: 'http://127.0.0.1:8114',
  version: '0.209.0',
  p2p_node_id: 'QmLocal',
  alive: true,
  tip: CHAIN_SNAPSHOT.tip,
  last_seen_ms: 1234567890000,
} as unknown as ChainNode];

export function peer(index: number, latencyMs: number): Peer {
  return {
    node_id: `QmPeer${index}`,
    address: `/ip4/198.51.100.${index}/tcp/8115`,
    direction: index % 2 === 0 ? 'inbound' : 'outbound',
    version: '0.209.0',
    latency_ms: latencyMs,
    connected_at_ms: 1234567800000 + index,
    last_seen_ms: 1234567890000,
  } as unknown as Peer;
}

export const PEERS: Peer[] = [peer(1, 40), peer(2, 90), peer(3, 140)];

export function appProps() {
  return {
    initialChain: CHAIN_SNAPSHOT,
    initialChainNodes: CHAIN_NODES,
    initialPeers: PEERS,
    initialChainRevision: 100,
    initialCells: CELLS_SNAPSHOT,
    initialCellsRevision: 100,
  };
}

let revision = 1_000;
const nextRevision = () => (revision += 1);

/** The chain cache as App last saw it, advanced by the real entity reducer. */
let chainCache: unknown = null;
let cellsCache: unknown = null;
let semanticsCache: unknown = null;

export function seedCaches(): void {
  chainCache = null;
  cellsCache = null;
  semanticsCache = null;
  revision = 1_000;
}

async function chainNow(): Promise<Record<string, unknown>> {
  if (chainCache === null) {
    const cache = await import('@cknerv/cache');
    chainCache = cache.fromEntitiesSnapshot(100, {
      chain: CHAIN_SNAPSHOT,
      chain_nodes: CHAIN_NODES,
      peers: PEERS,
    });
  }
  return chainCache as Record<string, unknown>;
}

async function cellsNow(): Promise<Record<string, unknown>> {
  if (cellsCache === null) {
    const cache = await import('@cknerv/cache');
    cellsCache = cache.fromCellsSnapshot(100, CELLS_SNAPSHOT);
  }
  return cellsCache as Record<string, unknown>;
}

/**
 * One publish, in its own `act`. The socket delivers each batch on its own
 * task, so each one is its own React render; folding several into one `act`
 * would let React batch them and hide the count this file exists to read.
 */
async function publish(deliver: () => void): Promise<void> {
  const { act } = await import('@testing-library/react');
  await act(async () => { deliver(); await Promise.resolve(); });
}

/** Fold mutations through the real entity reducer and publish, exactly as the
 *  socket's batcher does. */
export async function pushChain(mutations: RevisionedMutation[]): Promise<void> {
  const cache = await import('@cknerv/cache');
  const prev = await chainNow();
  const next = cache.applyEntityDelta(prev as never, mutations);
  chainCache = next;
  await publish(() => streams.entity?.(next));
}

export async function pushCells(deltas: CellDelta[]): Promise<void> {
  const cache = await import('@cknerv/cache');
  const prev = await cellsNow();
  const revisioned: RevisionedCellDelta[] = deltas.map((delta) => ({
    revision: nextRevision(), delta,
  }));
  const next = cache.applyRevisionedCellDeltas(prev as never, revisioned);
  cellsCache = next;
  await publish(() => streams.cells?.(next));
}

export function mempoolTick(pending: number): RevisionedMutation[] {
  return [{
    revision: nextRevision(),
    mutation: {
      type: 'chain_mempool_updated',
      pending,
      proposed: 0,
      orphan: 0,
      total_tx_size: 0,
      total_tx_cycles: 0,
      min_fee_rate: 1000,
    },
  } as unknown as RevisionedMutation];
}

/** A peers poll republishes the roster whether or not anything moved — the
 *  adapter re-sends the list, the reducer swaps the array, App re-renders. */
export function peersPoll(peers: Peer[] = PEERS): RevisionedMutation[] {
  return [{
    revision: nextRevision(),
    mutation: { type: 'peers_updated', peers: peers.map((p) => ({ ...p })) },
  } as unknown as RevisionedMutation];
}

export function blockMined(
  number: number,
  producerKey: string | null,
): RevisionedMutation[] {
  return [{
    revision: nextRevision(),
    mutation: {
      type: 'block_mined',
      number,
      hash: `0x${number.toString(16)}`,
      tx_count: 3,
      size: 2048,
      at: 1234567890000 + number * 8000,
      producer_key: producerKey,
      producer_message: producerKey === null ? null : '0.209.0',
    },
  } as unknown as RevisionedMutation];
}

let bornId = 10_000;

export function birth(block: number): Cell {
  const id = (bornId += 1);
  return {
    id,
    born_at_ms: 1234567890000 + block * 8000,
    death_at_ms: null,
    birth_block: block,
    tag: null,
    pos_seed: [id % 17, id % 7, id % 23],
    out_point: { tx_hash: `0xblock${block}`, index: id % 64 },
    capacity: 100 + id,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${id.toString(16).padStart(64, '0')}`,
    lock_shape_seed: [id * 3, id * 5],
    type_shape_seed: null,
    data_shape_seed: [id * 7, id * 11],
    lock_kind: 'sighash',
    asset_kind: 'native',
  } as unknown as Cell;
}

/**
 * One block as the wire delivers it: the chain mutation, then the cells
 * batches (births + the link), then the pulse that fires the wave. Each is its
 * own publish, because each is its own React render in the app.
 */
export async function pushBlock(
  number: number,
  producerKey: string | null,
): Promise<void> {
  await pushChain(blockMined(number, producerKey));
  const cells = [birth(number), birth(number)];
  await pushCells([
    ...cells.map((cell) => ({ type: 'birth', cell }) as CellDelta),
    {
      type: 'display',
      enter_ids: cells.map((c) => c.id),
      enter_cells: cells,
      exit_ids: [],
    } as unknown as CellDelta,
  ]);
  await pushCells([{
    type: 'link',
    tx_hash: `0xtx${number}`,
    block: number,
    from_ids: [],
    to_ids: cells.map((c) => c.id),
    endpoint_anchors: [],
  } as unknown as CellDelta]);
  await pushCells([{
    type: 'pulse',
    at_ms: 1234567890000 + number * 8000,
    producer_key: producerKey,
  } as unknown as CellDelta]);
}

/**
 * One node-health poll. The channel publishes a whole derived reading per
 * poll, and the stamp inside it is `now − tipAgeMs`, so consecutive polls
 * differ by identity even when the node's condition has not moved — which is
 * exactly the publish this instrument is here to count.
 */
export async function pushHealth(tipAgeMs: number, degraded = false): Promise<void> {
  await publish(() => streams.health?.({
    phase: degraded ? 'stale' : 'live',
    attempt: 0,
    lastMessageAtMs: 1234567890000 - tipAgeMs,
    reason: degraded ? 'closed' : null,
    fault: degraded ? { kind: 'unreachable' } : null,
  }));
}

// ——— the enrichment channel ———
//
// Off by default, like a page with no enrichment configured. A test that needs
// the semantic marker turns it on BEFORE mounting: App resolves the config
// during render and opens the semantics socket in its mount effect.

export function enableEnrichment(source = 'ckbadger'): void {
  window.__CKNERV_RUNTIME_CONFIG__ = { enrichment: { enabled: true, source } };
}

export function disableEnrichment(): void {
  delete window.__CKNERV_RUNTIME_CONFIG__;
}

async function semanticsNow(): Promise<Record<string, unknown>> {
  if (semanticsCache === null) {
    const cache = await import('@cknerv/cache');
    semanticsCache = cache.emptySemanticsCache();
  }
  return semanticsCache as Record<string, unknown>;
}

export async function pushSemantics(
  deltas: readonly unknown[],
): Promise<void> {
  const cache = await import('@cknerv/cache');
  const prev = await semanticsNow();
  const next = cache.applyRevisionedSemanticsDeltas(
    prev as never,
    deltas.map((delta) => ({ revision: nextRevision(), delta })) as never,
  );
  semanticsCache = next;
  await publish(() => streams.semantics?.(next));
}

/** A source the marker will accept: ready, named, anchored at the tip. */
export function sourceStatus(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: 'source_status',
    source: {
      source: 'ckbadger',
      status: 'ready',
      capabilities: [],
      indexed_tip: 100,
      lag_blocks: 0,
      validated_anchor: { block: 100, hash: '0x100' },
      last_success_at_ms: 1234567890000,
      ...overrides,
    },
  };
}

/** A record for one of the bootstrap snapshot's cells, anchored below the
 *  source's own anchor so the marker's visual state resolves. */
export function cellSemantics(cellId: number): unknown {
  const cell = CELLS_SNAPSHOT.cells.find((c) => c.id === cellId);
  if (!cell) throw new Error(`no fixture cell ${cellId}`);
  return {
    type: 'cell_upsert',
    cell: {
      out_point: cell.out_point,
      source: 'ckbadger',
      as_of: { block: 99, hash: '0x99' },
      observed_at_block: 99,
      updated_at_ms: 1234567880000,
      facets: [],
    },
  };
}
