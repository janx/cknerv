// The three scene roots are memoized (packages/ui pins the wrappers). A memo
// bails out only when EVERY prop compares equal, so one fresh object handed
// down from App defeats the whole thing silently — nothing throws, nothing
// warns, the roots just keep re-running. These tests guard the App half of that
// contract: the runtime config is resolved once, the two overlay fragments are
// hoisted into memos, and each memo's dep list still mirrors every binding its
// body reads.
//
// The dep-list check is the one that earns its keep. This repo runs no eslint
// gate, so `react-hooks/exhaustive-deps` catches nothing in CI; a prop added to
// the overlay without its source added to the deps would be a stale closure —
// a real bug, and a worse one than the re-render the memo was avoiding.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HUD_COLORS } from '@cknerv/ui';

const APP_SOURCE = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

interface HoistedOverlay {
  body: string;
  deps: string[];
}

/** Split `const <name> = useMemo(() => (<jsx>), [<deps>]);` into its halves. */
function hoistedOverlay(name: string): HoistedOverlay {
  const opening = `const ${name} = useMemo(() => (\n`;
  const start = APP_SOURCE.indexOf(opening);
  expect(start, `${name} is not a hoisted useMemo`).toBeGreaterThan(-1);
  const closing = APP_SOURCE.indexOf('\n  ), [\n', start);
  expect(closing, `${name} has no dep list`).toBeGreaterThan(start);
  const depsEnd = APP_SOURCE.indexOf('\n  ]);', closing);
  expect(depsEnd, `${name}'s dep list is unterminated`).toBeGreaterThan(closing);

  return {
    body: APP_SOURCE.slice(start + opening.length, closing),
    deps: APP_SOURCE.slice(closing + '\n  ), [\n'.length, depsEnd)
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter((line) => line.length > 0 && !line.startsWith('//')),
  };
}

/**
 * Every component-scope binding the JSX reads: `prop={value}` / `key={value}`
 * on the left, and the roots of the `x ? …` / `x && y ? …` guards on the right.
 * UPPER_SNAKE names are module constants, which are not deps and cannot go
 * stale.
 */
function bindingsRead(body: string): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    if (/^[A-Z0-9_]+$/.test(raw.split('.')[0])) return;
    found.add(raw);
  };
  for (const [, path] of body.matchAll(/=\{([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\}/g)) {
    add(path);
  }
  for (const [, path] of body.matchAll(/\{([a-z_$][\w$]*(?:\.[\w$]+)*)\s*(?:\?|&&)/g)) {
    add(path);
  }
  for (const [, path] of body.matchAll(/&&\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*\?/g)) {
    add(path);
  }
  return [...found];
}

/** The source of `const <name> = useMemo(...)`, up to its terminator. */
function memoBody(name: string): string {
  const start = APP_SOURCE.indexOf(`const ${name} = useMemo(`);
  expect(start, `${name} is not a useMemo`).toBeGreaterThan(-1);
  const end = APP_SOURCE.indexOf('\n  );', start);
  expect(end, `${name}'s memo is unterminated`).toBeGreaterThan(start);
  return APP_SOURCE.slice(start, end);
}

/** Its dep list, as written. The LAST bracketed group in the memo, so a `[]`
 *  default or an index inside the body cannot be mistaken for it. */
function memoDeps(name: string): string[] {
  const body = memoBody(name);
  const open = body.lastIndexOf('[');
  return body.slice(open + 1, body.indexOf(']', open))
    .split(',')
    .map((dep) => dep.trim())
    .filter((dep) => dep.length > 0);
}

function coveredByDeps(path: string, deps: string[]): boolean {
  // A dep may name the whole path (`galaxyConfig.cellCap`) or its root
  // (`selectedCell` covering `selectedCell.id`); either pins the identity the
  // body closed over.
  return deps.includes(path) || deps.includes(path.split('.')[0]);
}

describe('scene-root memo inputs', () => {
  it('resolves the injected runtime config once, not per render', () => {
    // `window.__CKNERV_RUNTIME_CONFIG__` is written into the served HTML before
    // the bundle boots and never assigned again, so one resolve covers the
    // page. Per render it rebuilt fresh `topology` / `pulses` objects — handed
    // straight to NeuralNetwork as props, defeating its memo every time.
    expect(APP_SOURCE).toContain(
      'const galaxyConfig = useMemo(() => resolveGalaxyConfig(), []);',
    );
    expect(APP_SOURCE).not.toContain('const galaxyConfig = resolveGalaxyConfig()');
    expect(APP_SOURCE).toContain('topology={galaxyConfig.topology}');
    expect(APP_SOURCE).toContain('pulses={galaxyConfig.pulses}');
  });

  it('hands each memoized root a hoisted overlay, never a fresh fragment', () => {
    expect(APP_SOURCE).toContain('overlay={galaxyOverlay}');
    expect(APP_SOURCE).toContain('overlay={colonyOverlay}');
    // A fragment built in the prop position is a new element every render.
    expect(APP_SOURCE).not.toMatch(/overlay=\{\(?\s*\n\s*<>/);
  });

  it('hands both ends of a block landing the same queue', () => {
    // NetworkColony's delivery layer fills it; CellGalaxy's landing layer
    // drains it. One ref, owned here beside the flash buffers, so a landing
    // never has to go through the write-seal map to reach the tissue — and
    // one stable object, so neither memoized root sees a fresh prop.
    expect(APP_SOURCE).toContain('const landingFlashRef = useRef(createLandingFlashQueue());');
    expect(APP_SOURCE.match(/landingFlashRef=\{landingFlashRef\}/g)).toHaveLength(2);
    const galaxy = APP_SOURCE.indexOf('<CellGalaxy\n');
    const colony = APP_SOURCE.indexOf('<NetworkColony\n');
    expect(galaxy).toBeGreaterThan(-1);
    expect(colony).toBeGreaterThan(-1);
    const galaxyMount = APP_SOURCE.slice(galaxy, APP_SOURCE.indexOf('/>', galaxy));
    const colonyMount = APP_SOURCE.slice(colony, APP_SOURCE.indexOf('/>', colony));
    expect(galaxyMount).toContain('landingFlashRef={landingFlashRef}');
    expect(colonyMount).toContain('landingFlashRef={landingFlashRef}');
    // The colony no longer touches the write-seal buffers at all.
    expect(colonyMount).not.toMatch(/cellFlashRef|flashDirty/);
  });

  it.each(['galaxyOverlay', 'colonyOverlay'])(
    '%s lists every binding its body closes over',
    (name) => {
      const { body, deps } = hoistedOverlay(name);
      const read = bindingsRead(body);

      expect(read.length).toBeGreaterThan(0);
      expect(
        read.filter((path) => !coveredByDeps(path, deps)),
        `${name} reads these without listing them as deps`,
      ).toEqual([]);
    },
  );

  it.each(['galaxyOverlay', 'colonyOverlay'])(
    '%s lists no dep its body stopped reading',
    (name) => {
      const { body, deps } = hoistedOverlay(name);

      expect(
        deps.filter((dep) => !new RegExp(`\\b${dep.split('.')[0]}\\b`).test(body)),
        `${name} lists these but no longer reads them`,
      ).toEqual([]);
    },
  );

  it('hands the colony overlay a producer key, never the standing that moves', () => {
    // The subject a MINER card renders is a fresh object on every attributed
    // block — its tally moved — and the anchor in this fragment needs none of
    // it but the identity. Listing the subject here would defeat
    // `NetworkColony`'s memo once a block for a fragment whose only moving part
    // is a projected point, which is the same trap `producerKeysSig` keeps out
    // of the topology memo one tier up.
    const { body, deps } = hoistedOverlay('colonyOverlay');
    expect(body).toContain('selectedMinerKey');
    expect(body).not.toContain('selectedMiner.');
    expect(deps).not.toContain('selectedMiner');
  });

  it('keeps the nerve inside the galaxy overlay, where the canopy turns', () => {
    const { body } = hoistedOverlay('galaxyOverlay');

    // The overlay slot is the galaxy's rotating, CELLS_Y-lifted group; the
    // nerve and the write seal are drawn in Cell space and must stay in it.
    expect(body).toContain('<NeuralNetwork');
    expect(body).toContain('<ConsensusWriteSeal');
    expect(body).toContain('<CellInspectionAnchor');
  });
});

describe('per-block scalars', () => {
  it('hands the nerve its departure delay by ref, never as a prop', () => {
    // The third scalar to make this trip, for the same reason as the first
    // two: `livePulseDepartureDelayS(cf.localReceiveDelayS)` is a continuous
    // function of WHICH PEER produced the block, so as a prop it was a dep of
    // `galaxyOverlay` and replaced the overlay element — and re-rendered every
    // fibre under it — on about four blocks in five (report L6-2). The ref is
    // written during render, so the plan effect that opens the block's link
    // batch still reads the block's own value.
    expect(APP_SOURCE).toContain('const livePulseDelaySRef = useRef(livePulseDelayS);');
    expect(APP_SOURCE).toContain('livePulseDelaySRef.current = livePulseDelayS;');
    expect(APP_SOURCE).toContain('livePulseDelaySRef={livePulseDelaySRef}');
    expect(APP_SOURCE).not.toContain('livePulseDelayS={livePulseDelayS}');
    const { deps } = hoistedOverlay('galaxyOverlay');
    expect(deps).toContain('livePulseDelaySRef');
    expect(deps).not.toContain('livePulseDelayS');
  });

  it('leaves the scalar prop standing for the Lab that holds a constant delay', () => {
    // A consumer with no per-block value has nothing to mirror into a ref.
    // The prop is the fallback, not a leftover — and this is the consumer
    // that proves it, so a future sweep for "unused prop" finds the answer
    // here rather than deleting it.
    const lab = readFileSync(resolve(process.cwd(), 'src/ProtocolEventLab.tsx'), 'utf8');
    expect(lab).toContain('livePulseDelayS={livePulseDelayS}');
    expect(lab).not.toContain('livePulseDelaySRef');
  });

  it('hands the semantic marker the three fields it reads off the source', () => {
    // The source RECORD is replaced on every probe round, so keying the
    // overlay on it turned the canopy over once a minute for a marker whose
    // answer had not moved. The anchor is unpacked into its two scalars
    // because it is an object inside that replaced record.
    expect(APP_SOURCE).toContain('const semanticOrbitSource = useMemo(');
    expect(memoDeps('semanticOrbitSource')).toEqual([
      'semanticsCache.source.source',
      'semanticsCache.source.status',
      'semanticAnchor?.block',
      'semanticAnchor?.hash',
    ]);
    const { deps } = hoistedOverlay('galaxyOverlay');
    expect(deps).toContain('semanticOrbitSource');
    expect(deps).not.toContain('semanticsCache.source');
  });
});

describe('canvas ground', () => {
  it('paints its own ground rather than showing one through', () => {
    // ⚠️ The `alpha: false` flag does not reach the compositor: three hardcodes
    // `alpha: true` in the context attributes it creates, so the surface always
    // carries an alpha channel and the flag only picks the default clear alpha.
    // It is pinned as the honest value for a scene that paints its own ground —
    // the one the clear falls back to if the background below ever goes away.
    // `antialias` beside it is no longer a literal: it is decided once at mount
    // by the startup buffer's density and class (off at 1.5× or denser, off
    // above 8 MP), so this guards the ground flag, not the MSAA value —
    // render-quality.test.ts owns that boundary.
    expect(APP_SOURCE).toContain('antialias: startupAntialias, alpha: false }}');
    // The clear IS the ground: the CSS below the canvas carries it until the
    // first frame exists, the scene carries it afterwards, and both now say the
    // one token, so the pre-first-light black cannot shift by half an edit.
    expect(APP_SOURCE).toContain('<color attach="background" args={[HUD_COLORS.stageGround]} />');
    expect(APP_SOURCE).toContain('style={{ background: HUD_COLORS.stageGround }}');
    // Both, or neither: this pair spent its whole life as two literals that
    // happened to agree, which is a guarantee nobody was keeping.
    expect(APP_SOURCE.toLowerCase()).not.toContain(HUD_COLORS.stageGround.toLowerCase());
  });

  it('holds the shell stylesheet to the token it cannot import', () => {
    // `index.html` paints before a module has evaluated, so its copy of the
    // ground is a literal by necessity — the same bargain the boot shell one
    // element down makes with cyanWire / dim / danger. A literal by necessity
    // still needs a keeper: this is the surface a visitor stares at for the
    // whole snapshot download, and nothing else compares it to anything.
    const background = /body\s*\{[^}]*background:\s*(#[0-9a-fA-F]{3,8})/.exec(INDEX_HTML);
    expect(background?.[1]?.toLowerCase()).toBe(HUD_COLORS.stageGround.toLowerCase());
  });
});

describe('colony topology signature', () => {
  it('admits identity, direction and version raw — and a ping only by its step', () => {
    // The signature is what stands between a ~4s peer poll and a full colony
    // rebuild, so every field it reads is a field the colony draws. Raw
    // `latency_ms` reads as one of those and is not: the annulus resolves a
    // ping onto 16 steps, while the adapter deliberately admits a
    // telemetry-only refresh whose own structural key excludes latency — so at
    // raw resolution the whole colony rebuilds on jitter, mid-flood.
    //
    // The step is also HELD: half a step of hysteresis, so a ping straddling a
    // boundary stops re-keying the colony on alternate refreshes (L5-3). The
    // held ring lives in a ref written during render, and the rule itself is
    // `heldLatencyPlacementStep`, pinned by `peers.derive.test.ts`.
    const sig = APP_SOURCE.slice(
      APP_SOURCE.indexOf('const peersSig = useMemo('),
      APP_SOURCE.indexOf('const networkRoster ='),
    );
    expect(sig).toContain('heldLatencyPlacementStep(p.latency_ms, held.get(p.node_id))');
    expect(sig).toContain('${p.node_id}|${step}|${p.direction}|${p.version ?? \'\'}');
    expect(sig).not.toContain('latencyPlacementStep(p.latency_ms)');
    expect(sig).not.toContain('p.latency_ms ??');
    expect(sig).not.toContain('best_known');
  });

  it('keys the sighted tier on what the crawl says, not on which round said it', () => {
    // The server republishes the roster whenever `crawl_round` moves, without
    // comparing content (L5-2), so the record's identity is a clock and not a
    // fact: keying the topology on it rebuilt the whole colony once a minute.
    // What the geometry and the mark read is the node id and the state
    // (`stageSighted`, `sightedStop`) — and the card that prints freshness
    // keeps reading the record itself.
    const sig = memoBody('rosterSig');
    expect(sig).toContain('networkRoster.entries.map((e) => `${e.node_id}|${e.state}`)');
    expect(sig).not.toContain('crawl_round');
    expect(sig).not.toContain('updated_at_ms');
    const topology = memoBody('topology');
    expect(topology).toContain('rosterSig');
    expect(topology.slice(topology.indexOf('// eslint-disable-next-line')))
      .not.toContain('networkRoster');
  });

  it('keys the producer tail on its key set, and on nothing a block moves', () => {
    // The same trap one tier along, and a worse one to read: a block bumps its
    // producer's count and re-divides EVERY share against the window, so the
    // standings move about every ten seconds while the key set does not. Only
    // the key set moves geometry — one node per key, each displacing one ghost
    // — so a memo that re-keyed on a numerator would rebuild the whole colony
    // once a block, and ColonyEdges owns its line geometry on the topology:
    // the symptom is a wave that stops halfway, not an error.
    //
    // The signature itself is `producerKeysSignature`, a pure function of the
    // view, and the field discipline moved there WITH A STRONGER TEST than a
    // regex over this file could be: `blockProducers.derive.test.ts` pins that
    // two views differing in every tally, message, fan and ledger figure — and
    // in their `ranked` order — produce one identical signature, which is the
    // property, rather than the spelling that happens to have it today.
    //
    // What is still App's to guard is that this memo DELEGATES. A second
    // signature spelled here could drift from the pinned one silently, and the
    // only symptom would be a colony rebuilding on something it should not.
    const sig = memoBody('producerKeysSig');
    expect(sig).toContain('producerKeysSignature(producerView)');
    expect([...sig.matchAll(/\bproducerView\??\.([A-Za-z_$][\w$]*)/g)]).toEqual([]);

    // ⭐⭐ AND THE OTHER DOOR INTO THE SAME REBUILD, which a field check cannot
    // see: the ORDER the keys arrive in. A signature over keys is a sequence of
    // keys, and the scaffold it guards really is a function of that sequence —
    // so the array reaching it has to be one only the SET can reorder.
    // `staging` is key-ascending; `ranked` is ordered by a tally, and keying on
    // it would rebuild the whole colony every time two miners traded rank
    // without either of them joining or leaving a window.
    expect(sig).not.toContain('ranked');
    for (const source of [memoBody('topology'), sig]) {
      expect(source).not.toContain('producerView?.ranked');
    }

    const deps = memoDeps('topology');
    expect(deps).toContain('producerKeysSig');
    // The VIEW's identity moves on every attributed block and the chain
    // entity's on every delta that touches it; neither may key the geometry.
    expect(deps).not.toContain('producerView');
    expect(deps.some((dep) => /^chain\b/.test(dep))).toBe(false);
  });

  it('reads an open MINER card off the live view, never off the staged node', () => {
    // ⭐⭐⭐ §4.2b. The memo above is keyed on the producer KEY SET alone and has
    // to be, so the standing hanging on a staged `attested` node is whatever it
    // was at the last key-set change and is stale for every block in between.
    // The node is the authority on IDENTITY and PLACEMENT; the view is the
    // authority on the window. The precedent is `selectedSighted`, which asks
    // the live roster rather than the `sighted` row on a staged node.
    const start = APP_SOURCE.indexOf('const selectedMiner = useMemo');
    expect(start, 'the miner selection is not a useMemo').toBeGreaterThan(-1);
    const subject = APP_SOURCE.slice(
      start,
      APP_SOURCE.indexOf('const selectedMinerAnchor = useMemo'),
    );
    expect(subject).toContain('producerView.ranked.find');
    // The two ways this could go wrong, named rather than left to a reviewer.
    expect(subject).not.toContain('.attested');
    expect(subject).not.toContain('topology');
    // …and the fraction the card prints comes off ONE read of ONE view, so its
    // numerator and its denominator cannot be counted at two different moments.
    expect(subject).toContain('producerView.versionedRosterSize');

    // The other half of the same split: placement is asked of the staged node,
    // which is exactly what a node IS the authority on.
    const anchorAt = APP_SOURCE.indexOf('const selectedMinerAnchor = useMemo');
    const anchor = APP_SOURCE.slice(anchorAt, APP_SOURCE.indexOf('useEffect(', anchorAt));
    expect(anchor).toContain('topology.nodes.find');
    expect(anchor).toContain("kind === 'attested'");
    expect(anchor).not.toContain('producerView');
  });

  it('asks the same live view for the mining question on a named node', () => {
    // The stamp a PEER or SIGHTED card carries is the same evidence one step
    // over, and it comes from the same place for the same reason.
    for (const reader of ['inspectedPeerCandidacy', 'selectedSightedCandidacy']) {
      const at = APP_SOURCE.indexOf(`const ${reader} =`);
      expect(at, `${reader} is not declared`).toBeGreaterThan(-1);
      expect(APP_SOURCE.slice(at, APP_SOURCE.indexOf(';', at)))
        .toContain('producerView?.candidacyByPeer.get');
    }
    // And PEER·02's row is handed the view whole rather than a tally, so the
    // share it prints arrives attached to the window it was measured over.
    expect(APP_SOURCE).toContain('producerView={producerView}');
  });

  it('reads the producer window off the copy-on-write array, not the entity', () => {
    // `chain` is shallow-cloned by every batch that touches it -- a mempool
    // tick, a peer refresh, a transaction — while `chain.producers` is
    // replaced only by an attributed block or a reorg. Keying the join on the
    // entity would re-run it many times a block for an answer that did not
    // change, and would hand every consumer a fresh view each time.
    //
    // The ledger joins the list rather than replacing anything: it is the
    // OTHER window on the same producers, it lands on its own 120 s cadence,
    // and the reducer replaces the record only when its content moved — so
    // keying on it re-runs the join once per new week, not once per poll.
    expect(memoDeps('producerView')).toEqual([
      'chain.producers', 'chain.producer_window_blocks', 'networkRoster',
      'producerLedger',
    ]);
  });

  it('hands the colony the live standings by reference, never by array', () => {
    // `staging` is a fresh array on every attributed block. As a prop it
    // defeated `memo(NetworkColony)` once a block — a second colony render on
    // top of the pulse's — for a change that moves one instanced lane. The
    // holder is a ref written during render, so the cohort layer's frame
    // callback reads the window the memo above just produced.
    expect(APP_SOURCE).toContain(
      'const producerSharesRef = useRef<readonly ProducerStanding[] | null>(null);',
    );
    expect(APP_SOURCE).toContain('producerSharesRef.current = producerView?.staging ?? null;');
    expect(APP_SOURCE).toContain('producersRef={producerSharesRef}');
    expect(APP_SOURCE).not.toContain('producers={producerView?.staging}');
  });
});

describe('inspector memo inputs', () => {
  it('holds the causal navigation readout by identity across App renders', () => {
    // `memo(CellInspectionOverlay)` is only as good as its least stable prop.
    // A step object rebuilt per render re-created both callbacks and the
    // readout, and the dossier re-rendered on every mempool tick.
    for (const name of ['causalBackStep', 'causalForwardStep', 'selectedCausalNavigation']) {
      expect(APP_SOURCE, `${name} is not a useMemo`).toContain(`const ${name} = useMemo(`);
    }
    // The steps key on retention as a signal, never on the cells Map: the Map
    // is replaced by every cells batch, and the answer moves only when a
    // trail entry appears in or leaves it.
    for (const name of ['causalBackStep', 'causalForwardStep']) {
      expect(memoDeps(name)).toEqual(['cellCausalNavigation', 'causalRetainedSig']);
    }
    expect(memoDeps('causalRetainedSig')).toEqual(['cellCausalNavigation.entries', 'retainedCells']);
    expect(memoDeps('selectedCausalNavigation')).toEqual([
      'selectedCellRecordId',
      'cellCausalNavigation',
      'causalBackStep',
      'causalForwardStep',
      'navigateCausalBack',
      'navigateCausalForward',
    ]);
    expect(APP_SOURCE).toContain('causalNavigation={selectedCausalNavigation}');
  });
});
