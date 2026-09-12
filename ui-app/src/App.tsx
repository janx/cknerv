// Default SPA for the `cknerv` binary. Bootstraps from the chain + cells
// snapshots, then subscribes to the live WS streams so the cell galaxy
// fills in and block pulses fire as the chain advances. Renders a 3D
// canvas (CellGalaxy canopy) alongside the DOM `HudOverlay` (a sibling of
// the canvas) that carries the always-on telemetry panels (blockchain /
// network / cells stats) plus node / peer detail and the backfill/seeding
// indicator. Cell inspection opens one detail constellation tethered to the
// selected scene Cell. The leva knobs panel is hidden by default (toggle with
// backtick) — see Tweaks.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ElementRef,
} from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import {
  AdaptiveQualityController,
  beginBootPhase,
  BootFrameSentinel,
  BootViewSentinel,
  BootNerveRestSentinel,
  completeBootPhase,
  completeBootSeeding,
  readDrawingBufferSampleCount,
  setGpuSampleCount,
  reportBootSeeding,
  CELLS_Y,
  CELL_SELECTION_PREFIX,
  type HudCameraFrame,
  cellDetailViewFocus,
  chainNodeWorldPosition,
  canRecallConsensusMemory,
  cellIdentityProofBindingComplete,
  consensusMemoryRouteHopFocusEqual,
  consensusMemoryTraceRequestKey,
  attestedNodeId,
  deriveBlockProducers,
  networkHashRateHs,
  producerKeysSignature,
  deriveCellCausalLens,
  deriveConsensusMemoryRouteHopFocus,
  colonyFlood,
  deriveConsensusMemoryTraceEndpoints,
  deriveStreamHealthSummary,
  inferredTopology,
  latencyPlacementStep,
  livePulseDepartureDelayS,
  CellGalaxy,
  CellGalaxyProvider,
  createLandingFlashQueue,
  CellCausalLensLayer,
  CellInspectionAnchor,
  CellInspectionOverlay,
  CellPortraitInset,
  createCellInspectionHandles,
  type ProducerStanding,
  CellSemanticOrbit,
  ConsensusRouteCamera,
  ConsensusWriteSeal,
  HUD_COLORS,
  HUD_FONTS,
  HUD_MOTION,
  HUD_TYPE,
  HudOverlay,
  rgba,
  useCoarsePointer,
  useReducedMotion,
  deriveCellPopulationField,
  resolveCellDisplayLimit,
  useCellDisplayRuntime,
  NetworkColony,
  NeuralNetwork,
  NodeInspectionAnchor,
  NodeInspectionOverlay,
  createNodeInspectionHandles,
  PeerInspectionAnchor,
  PeerInspectionOverlay,
  createPeerInspectionHandles,
  usePeerInspectionRetention,
  QUALITY_PRESETS,
  RenderStatsPanel,
  RenderStatsSampler,
  PERFORMANCE_PROBE_LABELS,
  createGpuProbeCallbacks,
  createNonEmptyDrawGpuProbeCallbacks,
  measureCpuProbe,
  SightedInspectionAnchor,
  SightedInspectionOverlay,
  createSightedInspectionHandles,
  MINER_SELECTION_PREFIX,
  MinerInspectionAnchor,
  MinerInspectionOverlay,
  createMinerInspectionHandles,
  SimClockTicker,
  setQualityMode,
  TweakSync,
  UNIVERSE_SEED_FALLBACK,
  useQualityRuntime,
  type ConsensusMemoryTraceRequest,
  type ConsensusMemoryTraceOutcome,
  type ConsensusMemoryTraceReadout,
  type ConsensusMemoryRouteHopFocus,
  type ConsensusMemoryTargetResponse,
  type CellInspectionHandles,
  type NodeInspectionHandles,
  type PeerInspectionHandles,
  type SightedInspectionHandles,
  type MinerInspectionHandles,
  type MinerNodeSubject,
  type CellIdentityProofEvent,
  type CellIdentityProofKind,
  type NodeStreamHealth,
  type PeerSightingPhase,
  type PeerSightingState,
} from '@cknerv/ui';
import {
  cachedPeerSighting,
  connectCellsStream,
  connectEntityStream,
  connectSemanticsStream,
  emptySemanticsCache,
  fetchCellSemantics,
  fetchPeerSighting,
  fetchTransactionSemantics,
  fromCellsSnapshot,
  outPointKey,
  stageScriptCensus,
  type CellGalaxyCache,
  type ChainCache,
  type PeerSightingOutcome,
  type SemanticsCache,
  type StreamHealth,
} from '@cknerv/cache';
import type {
  Cell,
  CellGalaxySnapshot,
  ChainEntry,
  ChainNode,
  Peer,
  CellSemanticRecord,
  PeerAdvertisedEvidence,
  PeerSightingAbsence,
  PeerSightingRecord,
  TransactionSemanticRecord,
} from '@cknerv/types';
import Tweaks from './Tweaks';
import Jukebox from './Jukebox';
import TopBarSiteLink from './TopBarSiteLink';
import { ingestCellsCacheIntoField } from './cell-field-hook';
import { connectNodeHealth } from './connect';
import {
  INITIAL_CELL_IDENTITY_JOURNEY_STATE,
  cellIdentityJourneyReducer,
} from './cell-identity-journey-state';
import {
  INITIAL_CELL_CAUSAL_NAVIGATION_STATE,
  cellCausalNavigationReducer,
  cellCausalNavigationStep,
} from './cell-causal-navigation-state';
import {
  beginOrbitGesture,
  changeOrbitGesture,
  createOrbitGestureState,
  endOrbitGesture,
  noteOrbitCameraChange,
  noteOrbitPointerDown,
  noteOrbitPointerMove,
  orbitCameraSuspendsPicking,
  orbitGestureSuppressesPointerAction,
  orbitInMotion,
  settleOrbitCameraFrame,
  type OrbitGestureState,
} from './orbit-gesture-state';
import {
  CELL_MEMORY_RECALL_MAX_PULSES,
  INITIAL_CELL_MEMORY_RECALL_STATE,
  cellMemoryRecallReducer,
  cellMemoryRecallWriteSeqForTarget,
} from './cell-memory-recall-state';
import {
  cellMemoryRouteAnchor,
  restoreCellMemoryRouteAnchor,
  type CellMemoryRouteAnchor,
} from './cell-memory-route-continuity';
import {
  hasQuerySwitch,
  resolveCanvasDpr,
  resolveQualityOverride,
  resolveStartupAntialias,
} from './render-quality';
import {
  resolveBuildVersion,
  buildCommitHref,
  resolveEnrichmentConfig,
  resolveGalaxyConfig,
  resolveHosted,
} from './runtime-config';
import { restoreCellGalaxyFocus } from './cell-galaxy-focus';
import CameraFraming, { useInitialStageCamera } from './CameraFraming';
import { useInspectionExit } from './inspection-exit';

interface AppProps {
  /** Initial Chain entity from `/api/entities/chain/snapshot`. */
  initialChain: ChainEntry;
  /** Initial chain-node registry (one entry per RPC the adapter observes). */
  initialChainNodes: ChainNode[];
  /** Initial peer list from `/api/entities/chain/snapshot`. */
  initialPeers: Peer[];
  /** Revision attached to the chain snapshot — the WS stream resumes from
   *  here with `?since=` so there's no gap between bootstrap and live. */
  initialChainRevision: number;
  /** Initial cell-galaxy projection snapshot from
   *  `/api/projections/cells/snapshot`. */
  initialCells: CellGalaxySnapshot;
  /** Revision attached to the cells snapshot — same `?since=` resume role. */
  initialCellsRevision: number;
}

/**
 * THE IDLE A LOOKUP IS ALREADY IN.
 *
 * Three selection lookups — cell semantics, transaction semantics, peer
 * sighting — clear themselves whenever there is no subject to ask about, and
 * their effects re-run on every enrichment source refresh. Written as a fresh
 * object each time, "nothing is being looked up" was an App render per probe
 * round with nothing selected, and every one of those fanned out through the
 * whole tree (report L6-7). These recognise the state they are already in and
 * return it, which is React's own bail-out.
 */
function idleSemanticsLookup<R>(current: {
  key: string | null;
  phase: 'waiting' | 'loading' | 'ready' | 'unavailable' | 'error';
  record: R | null;
  message: string | null;
}) {
  return current.key === null
    && current.phase === 'waiting'
    && current.record === null
    && current.message === null
    ? current
    : { key: null, phase: 'waiting' as const, record: null, message: null };
}

function idlePeerSightingLookup(current: {
  key: string | null;
  phase: PeerSightingPhase;
  record: PeerSightingRecord | null;
  reason: PeerSightingAbsence | null;
  advertised: PeerAdvertisedEvidence | null;
  message: string | null;
}) {
  return current.key === null
    && current.phase === 'waiting'
    && current.record === null
    && current.reason === null
    && current.advertised === null
    && current.message === null
    ? current
    : {
      key: null,
      phase: 'waiting' as const,
      record: null,
      reason: null,
      advertised: null,
      message: null,
    };
}

const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, CELLS_Y, 0];
const STREAM_STALE_AFTER_MS = 15_000;

/**
 * Settles, once per frame, whether the camera is being moved by something
 * other than a pointer that is still down: OrbitControls' damping tail keeps
 * reporting `change` for a second or two after `end`, and the route camera
 * flies without any gesture at all. Two refs come out of it, from the same
 * three sources. The Cell picker reads `pickingSuspendedRef` and skips hover
 * probes while it is set; presses and clicks still answer, and the index
 * rebuilds once, lazily, on the first probe after the motion settles. The
 * adaptive-quality sampler reads `motionActiveRef` — the same OR widened by
 * the un-moved press (`orbitInMotion`) — and drops every frame it flags from
 * its sample: a drag is transient by construction and must not cost the page
 * a tier. Mounted after the route camera so a frame's verdict includes that
 * frame's flight step; at default priority it runs after the controls' own
 * update (drei schedules that at -1) and after the sampler, which therefore
 * reads each verdict one frame late — a lag that only lengthens the
 * exclusion at the end of a window, and is why the sampler needs no settle
 * of its own.
 */
function CameraMotionSentinel({
  gestureRef,
  automationActiveRef,
  pickingSuspendedRef,
  motionActiveRef,
}: {
  gestureRef: { readonly current: OrbitGestureState };
  automationActiveRef: { readonly current: boolean };
  pickingSuspendedRef: { current: boolean };
  motionActiveRef: { current: boolean };
}) {
  useFrame(() => {
    const gesture = gestureRef.current;
    settleOrbitCameraFrame(gesture);
    const automation = automationActiveRef.current;
    pickingSuspendedRef.current = orbitCameraSuspendsPicking(gesture)
      || automation;
    motionActiveRef.current = orbitInMotion(gesture) || automation;
  });
  return null;
}

/** How long after a block lands the adaptive sampler treats a frame as
 * block-disturbed. A block's arrival runs a main-thread burst (the pulse
 * reducer, the colony reflow, the delivery/courier layers arming) that
 * stretches a few rAF intervals; the tier cascade only buys GPU time, so a
 * step taken on that burst buys nothing. ~1.5 s covers two sample windows —
 * generous, because a wrongly-excluded window costs the sampler nothing it has
 * learned, while a wrongly-counted burst can cost the page a tier. */
const RECENT_BLOCK_WINDOW_MS = 1_500;

/**
 * Settles `recentBlockActiveRef`, once per frame, from the cells cache's
 * `lastPulseAtMs`, exactly as CameraMotionSentinel settles `motionActiveRef`.
 * AdaptiveQualityController reads it and drops every frame it flags.
 *
 * It KEYS ITS CLOCK ON `lastPulseAtMs` rather than differencing it — the same
 * pattern every block-driven layer uses (NetworkColony, the courier and
 * delivery layers). `lastPulseAtMs` is a server wall-clock stamp and cannot be
 * subtracted from a local `performance.now()`, so the sentinel notices the
 * stamp ADVANCE (App re-renders on it, handing this useFrame a fresh prop) and
 * holds the window open for `RECENT_BLOCK_WINDOW_MS` of local time after. The
 * opening stamp — a snapshot's last pulse, or 0 — is seeded, never fired: boot
 * is already excluded by warmup, and a stale stamp is not a live burst.
 */
function BlockWindowSentinel({
  lastPulseAtMs,
  recentBlockActiveRef,
}: {
  lastPulseAtMs: number;
  recentBlockActiveRef: { current: boolean };
}) {
  const seenPulseAtMs = useRef(lastPulseAtMs);
  const blockSeenAtMs = useRef(Number.NEGATIVE_INFINITY);
  useFrame(() => {
    if (lastPulseAtMs !== seenPulseAtMs.current) {
      seenPulseAtMs.current = lastPulseAtMs;
      blockSeenAtMs.current = performance.now();
    }
    recentBlockActiveRef.current =
      performance.now() - blockSeenAtMs.current < RECENT_BLOCK_WINDOW_MS;
  });
  return null;
}

function CellDetailViewTracker({
  controlsRef,
  focusRef,
}: {
  controlsRef: { readonly current: ElementRef<typeof OrbitControls> | null };
  focusRef: { current: number };
}) {
  useFrame(({ camera }) => {
    const target = controlsRef.current?.target;
    const targetX = target?.x ?? DEFAULT_CAMERA_TARGET[0];
    const targetY = target?.y ?? DEFAULT_CAMERA_TARGET[1];
    const targetZ = target?.z ?? DEFAULT_CAMERA_TARGET[2];
    focusRef.current = cellDetailViewFocus(Math.hypot(
      camera.position.x - targetX,
      camera.position.y - targetY,
      camera.position.z - targetZ,
    ));
  });
  return null;
}

function initialStreamHealth(): StreamHealth {
  return {
    phase: 'connecting',
    attempt: 0,
    lastMessageAtMs: null,
    reason: 'initial',
  };
}

/** Stable empty overlay list: a fresh array each render would re-run the
 *  population derive on every App render for no reason. */
const EMPTY_OVERLAY_IDS: number[] = [];
const TOP_BAR_ACTIONS = <TopBarSiteLink />;

export default function App({
  initialChain,
  initialChainNodes,
  initialPeers,
  initialChainRevision,
  initialCells,
  initialCellsRevision,
}: AppProps) {
  // `window.__CKNERV_RUNTIME_CONFIG__` is written once into the served HTML
  // (cknerv-cli assets.rs) before the bundle boots and nothing ever assigns it
  // again, so resolving it once is resolving it for the page's life. Resolving
  // it per render was not merely wasteful: with a config injected, the resolver
  // builds FRESH `topology` / `pulses` objects each call, and those are handed
  // straight to NeuralNetwork as props — new identities every App render, which
  // would defeat the memo on every scene root below.
  const galaxyConfig = useMemo(() => resolveGalaxyConfig(), []);
  const hosted = useMemo(() => resolveHosted(), []);
  // Deliberately NOT memoized: only its scalar fields are ever read
  // (`.enabled`, `.source`), never its identity, so a fresh object costs
  // nothing downstream.
  const enrichmentConfig = resolveEnrichmentConfig();
  const qualityOverride = useMemo(() => (
    typeof window === 'undefined'
      ? null
      : resolveQualityOverride(window.location.search)
  ), []);
  useEffect(() => {
    if (qualityOverride) setQualityMode(qualityOverride);
  }, [qualityOverride]);
  const qualityRuntime = useQualityRuntime();
  const qualityCascade = QUALITY_PRESETS[qualityRuntime.effective];
  const cellGalaxyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bootCellDrawnRef = useRef(false);
  const orbitControlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const [cameraFrame, setCameraFrame] = useState<HudCameraFrame | null>(null);
  const initialCamera = useInitialStageCamera(cameraFrame);
  /** The GPU has taken the drawing context back. See the Canvas's
   *  `onCreated`, which is the only place that can hear it. */
  const [glContextLost, setGlContextLost] = useState(false);
  const [cellScanInteractionActive, setCellScanInteractionActive] = useState(
    false,
  );
  const cellDetailViewFocusRef = useRef(0);
  // One channel for the split Cell inspector: the in-Canvas anchor writes
  // card/connector styles through it, the DOM card registers its nodes into
  // it. Created once for the app's lifetime.
  const cellInspectionHandlesRef = useRef<CellInspectionHandles | null>(null);
  if (cellInspectionHandlesRef.current === null) {
    cellInspectionHandlesRef.current = createCellInspectionHandles();
  }
  const cellInspectionHandles = cellInspectionHandlesRef.current;
  // The same split-inspector channel for the peer link probe. Selection axes
  // are mutually exclusive, but each dialect keeps its own channel so a card
  // swap never inherits the other's measured box.
  const peerInspectionHandlesRef = useRef<PeerInspectionHandles | null>(null);
  if (peerInspectionHandlesRef.current === null) {
    peerInspectionHandlesRef.current = createPeerInspectionHandles();
  }
  const peerInspectionHandles = peerInspectionHandlesRef.current;
  // …and one more for the local node's self probe. It reads the galaxy's own
  // anchor rather than the colony's, so it keeps its own measured box too.
  const nodeInspectionHandlesRef = useRef<NodeInspectionHandles | null>(null);
  if (nodeInspectionHandlesRef.current === null) {
    nodeInspectionHandlesRef.current = createNodeInspectionHandles();
  }
  const nodeInspectionHandles = nodeInspectionHandlesRef.current;
  // …and one for the sighted probe. It shares the colony's anchor slot with
  // the link probe (the selection is single, so only one is ever mounted), but
  // its card is a hundred pixels shorter — a shared channel would place the
  // first frame of each by the other's box.
  const sightedInspectionHandlesRef = useRef<SightedInspectionHandles | null>(null);
  if (sightedInspectionHandlesRef.current === null) {
    sightedInspectionHandlesRef.current = createSightedInspectionHandles();
  }
  const sightedInspectionHandles = sightedInspectionHandlesRef.current;
  // …and one for the miner probe, which shares the same colony slot for the
  // same reason and is shorter again: there is no dossier under it and no
  // record of anybody having reached the node, because nobody has.
  const minerInspectionHandlesRef = useRef<MinerInspectionHandles | null>(null);
  if (minerInspectionHandlesRef.current === null) {
    minerInspectionHandlesRef.current = createMinerInspectionHandles();
  }
  const minerInspectionHandles = minerInspectionHandlesRef.current;
  const [orbitInteractionRevision, noteOrbitInteraction] = useReducer(
    (revision: number) => revision + 1,
    0,
  );
  const orbitGestureRef = useRef(createOrbitGestureState());
  // While set, CellPicker skips its hover probes — the O(N) screen
  // re-projection a moving camera would force on every pointer move — and
  // still answers pointer-down and click from a precise snapshot. Set
  // synchronously by the first camera change of a gesture, and otherwise
  // owned by CameraMotionSentinel, which settles it once per frame from the
  // change latch below and the route camera's automation flag: the damping
  // tail after a release and a route flight both move the camera with no
  // gesture in progress. These refs change outside React's render path.
  const orbitPickingSuspendedRef = useRef(false);
  const cameraAutomationActiveRef = useRef(false);
  // The sampler's view of the same motion: a gesture held, the camera moving,
  // or a flight — settled once per frame by the sentinel, read by
  // AdaptiveQualityController, which drops the frames it flags.
  const cameraMotionActiveRef = useRef(false);
  // The sampler's view of a recent block: true for ~1.5 s after a block lands,
  // settled once per frame by BlockWindowSentinel from `lastPulseAtMs` and read
  // by AdaptiveQualityController, which drops the block's main-thread burst so
  // it never steps a tier the cascade cannot buy back.
  const recentBlockActiveRef = useRef(false);
  const beginOrbitInteraction = useCallback(() => {
    beginOrbitGesture(orbitGestureRef.current);
  }, []);
  const changeOrbitInteraction = useCallback(() => {
    const gesture = orbitGestureRef.current;
    noteOrbitCameraChange(gesture);
    // A drag's own moves must not wait for the frame: the pointer move that
    // follows this change would re-project the field before the sentinel
    // runs.
    if (gesture.active) orbitPickingSuspendedRef.current = true;
    if (changeOrbitGesture(gesture)) noteOrbitInteraction();
  }, []);
  const endOrbitInteraction = useCallback(() => {
    // Not cleared here: with damping the camera is still moving, and the
    // sentinel lifts the suspension on the first frame that passes without a
    // change.
    endOrbitGesture(orbitGestureRef.current, performance.now());
  }, []);
  // A click must not move the camera. OrbitControls rotates on the FIRST pixel
  // of travel, and that pixel moves the very target the press landed on out
  // from under the release — R3F only fires a click when the same object
  // answers both rays, so an ordinary hand-wobble click silently does nothing.
  // Hold rotate/pan at zero until the gesture is a real drag: zeroed speed
  // still advances OrbitControls' own rotateStart, so the drag, when it comes,
  // resumes from where the pointer is with no jump.
  const orbitDeadZoneRef = useRef<{ rotate: number; pan: number } | null>(null);
  const holdOrbitDeadZone = useCallback(() => {
    const controls = orbitControlsRef.current;
    if (!controls || orbitDeadZoneRef.current !== null) return;
    orbitDeadZoneRef.current = {
      rotate: controls.rotateSpeed,
      pan: controls.panSpeed,
    };
    controls.rotateSpeed = 0;
    controls.panSpeed = 0;
  }, []);
  const releaseOrbitDeadZone = useCallback(() => {
    const held = orbitDeadZoneRef.current;
    orbitDeadZoneRef.current = null;
    const controls = orbitControlsRef.current;
    if (held === null || !controls) return;
    controls.rotateSpeed = held.rotate;
    controls.panSpeed = held.pan;
  }, []);
  // OrbitControls answers "did the camera move"; a selection needs "did the
  // user drag", and the click tolerance is the difference. Read the pointer
  // itself, on the window: OrbitControls captures the pointer on its own
  // element, so a canvas listener stops hearing a drag the moment it starts.
  useEffect(() => {
    const gesture = orbitGestureRef.current;
    const notePress = (event: PointerEvent) => {
      noteOrbitPointerDown(
        gesture,
        event.clientX,
        event.clientY,
        event.pointerType,
      );
      holdOrbitDeadZone();
    };
    const noteTravel = (event: PointerEvent) => {
      if (noteOrbitPointerMove(gesture, event.clientX, event.clientY)) {
        releaseOrbitDeadZone();
      }
    };
    // A press that never reached the scene still has to give the camera back:
    // OrbitControls reports no gesture end for one, so the pointer does.
    window.addEventListener('pointerdown', notePress, true);
    window.addEventListener('pointermove', noteTravel, true);
    window.addEventListener('pointerup', releaseOrbitDeadZone, true);
    window.addEventListener('pointercancel', releaseOrbitDeadZone, true);
    return () => {
      window.removeEventListener('pointerdown', notePress, true);
      window.removeEventListener('pointermove', noteTravel, true);
      window.removeEventListener('pointerup', releaseOrbitDeadZone, true);
      window.removeEventListener('pointercancel', releaseOrbitDeadZone, true);
    };
  }, [holdOrbitDeadZone, releaseOrbitDeadZone]);
  const forceRenderStats = useMemo(() => (
    typeof window !== 'undefined'
    && hasQuerySwitch(window.location.search, 'render-stats')
  ), []);
  // The visitor's motion policy (D-11, `MOTION_POLICY` in `hudTheme.ts`). Two
  // things in this file are props rather than frame loops and need the hook
  // itself: drei's star drift and the orbit damping tail. Everything else on
  // the stage reads the same answer out of `LIVE.time.reduced`, which this
  // hook publishes.
  const reducedMotion = useReducedMotion();
  // The drei starfield takes no render-callback props, so its GPU scope is
  // installed on the Points object it forwards: one timer query around the
  // draw while the opt-in render probe is on, a boolean gate otherwise. The
  // object outlives every `count` change (only its geometry is rebuilt), so
  // this is mount-time wiring.
  const starsRef = useRef<ElementRef<typeof Stars>>(null);
  useEffect(() => {
    const points = starsRef.current;
    if (!points) return undefined;
    const probe = createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.stars),
    );
    points.onBeforeRender = probe.onBeforeRender;
    points.onAfterRender = probe.onAfterRender;
    return () => {
      points.onBeforeRender = () => {};
      points.onAfterRender = () => {};
    };
  }, []);
  // A touch device is a fanless one, and AUTO spends accordingly: the ceiling
  // drops to 1.5 while AUTO holds the tier, which costs 44% of the fill and
  // costs the reading nothing (the HUD is DOM — see
  // `COARSE_POINTER_AUTO_MAX_DPR`). A reader who names a tier by hand has
  // said what they want the picture to be, and keeps the display's density.
  const coarsePointer = useCoarsePointer();
  const canvasDpr = resolveCanvasDpr(
    typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    qualityCascade.maxDpr,
    coarsePointer && qualityRuntime.mode === 'auto',
  );
  // MSAA is a context attribute fixed when the Canvas creates its GL context,
  // so unlike the DPR it cannot follow the runtime tier: it is decided once at
  // mount from the same buffer class the startup ceiling uses. Off above 8 MP
  // (a buffer that opens at MED/LOW — exactly where the DPR lever is inert and
  // the per-frame resolve is largest), on for a HIGH-class buffer below it.
  // And off at ANY area once the buffer is 1.5× dense or more, where it cost
  // 2.2× the scene for edges the density had already softened (the density
  // rule and its measurement live at `MSAA_OFF_MIN_DPR`).
  const startupAntialias = useMemo(
    () => resolveStartupAntialias(
      typeof window === 'undefined' ? 0 : window.innerWidth,
      typeof window === 'undefined' ? 0 : window.innerHeight,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      QUALITY_PRESETS.high.maxDpr,
    ),
    [],
  );
  // Live caches, seeded from the bootstrap snapshots so the first paint is
  // already populated, then updated in place by the WS streams below. A
  // fresh cache object on every delta re-renders the tree; CellGalaxy reads
  // the new cells via useCellGalaxy() and animates births/deaths + pulses.
  const [chainCache, setChainCache] = useState<ChainCache>(() => ({
    revision: initialChainRevision,
    chain: initialChain,
    chainNodes: initialChainNodes,
    // Seeded from the bootstrap snapshot; the WS stream's first snapshot /
    // peers_updated delta keeps this live thereafter.
    peers: initialPeers,
  }));
  const initialCellsCacheRef = useRef<CellGalaxyCache | null>(null);
  const initialCellsCache = initialCellsCacheRef.current
    ?? fromCellsSnapshot(initialCellsRevision, initialCells, {
      recentLinksCapacity: galaxyConfig.recentLinksCap,
      linkRingCapacity: galaxyConfig.pulses.linkRingCapacity,
    });
  initialCellsCacheRef.current = initialCellsCache;
  const [cellsCache, setCellsCache] = useState<CellGalaxyCache>(
    initialCellsCache,
  );
  const initialSemanticsCacheRef = useRef<SemanticsCache | null>(null);
  if (initialSemanticsCacheRef.current === null) {
    const initial = emptySemanticsCache();
    initialSemanticsCacheRef.current = enrichmentConfig.enabled
      ? {
        ...initial,
        source: {
          source: enrichmentConfig.source ?? 'enrichment',
          status: 'connecting',
          capabilities: [],
        },
      }
      : initial;
  }
  const initialSemanticsCache = initialSemanticsCacheRef.current;
  const [semanticsCache, setSemanticsCache] = useState<SemanticsCache>(
    initialSemanticsCache,
  );
  const [chainStreamHealth, setChainStreamHealth] = useState<StreamHealth>(
    initialStreamHealth,
  );
  const [cellsStreamHealth, setCellsStreamHealth] = useState<StreamHealth>(
    initialStreamHealth,
  );
  const [semanticsStreamHealth, setSemanticsStreamHealth] = useState<StreamHealth>(
    initialStreamHealth,
  );
  // The node's hop starts `null` — unknown, and unknown is silence. It is not
  // seeded `connecting` like the three sockets above, because nothing is
  // connecting: the first poll either learns something about the node or
  // learns that the server cannot be asked.
  const [nodeStreamHealth, setNodeStreamHealth] = useState<NodeStreamHealth | null>(
    null,
  );
  // SND·06's switch. The registry that owns it is the HUD's; this is only
  // where the module it names happens to be mounted, so the default matches
  // `DEFAULT_PANEL_VISIBILITY.sound` and the HUD publishes every change.
  const [soundVisible, setSoundVisible] = useState(true);
  const retainedCellRecordsRef = useRef(cellsCache.cells);
  retainedCellRecordsRef.current = cellsCache.cells;
  // Cell and network ids retain separate state shapes because their scene
  // layers use different records. Selection itself is exclusive: entering a
  // Cell detail clears node/peer detail, while choosing a network entity closes
  // the Cell field so the scene always has one primary inspection target.
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [selectedNetId, setSelectedNetId] = useState<string | null>(null);
  const [cellCausalNavigation, dispatchCellCausalNavigation] = useReducer(
    cellCausalNavigationReducer,
    INITIAL_CELL_CAUSAL_NAVIGATION_STATE,
  );
  const [cellIdentityProof, setCellIdentityProof] = useState<
    CellIdentityProofEvent | null
  >(null);
  const cellIdentityProofSequenceRef = useRef(0);
  const [cellIdentityJourney, dispatchCellIdentityJourney] = useReducer(
    cellIdentityJourneyReducer,
    INITIAL_CELL_IDENTITY_JOURNEY_STATE,
  );
  const cellIdentityProofBinding = cellIdentityJourney.binding;
  const [memoryRecall, dispatchMemoryRecall] = useReducer(
    cellMemoryRecallReducer,
    INITIAL_CELL_MEMORY_RECALL_STATE,
  );
  const memoryTraceRequest = memoryRecall.request;
  const [memoryTraceReadout, setMemoryTraceReadout] = useState<
    ConsensusMemoryTraceReadout | null
  >(null);
  const [memoryEvidenceFocusSourceId, setMemoryEvidenceFocusSourceId] = useState<
    number | null
  >(null);
  const [memoryAgreementPreviewSourceId, setMemoryAgreementPreviewSourceId] =
    useState<number | null>(null);
  const [memoryRouteHopPreview, setMemoryRouteHopPreview] = useState<
    ConsensusMemoryRouteHopFocus | null
  >(null);
  const [memoryRouteHopLock, setMemoryRouteHopLock] = useState<
    ConsensusMemoryRouteHopFocus | null
  >(null);
  const memoryRouteHopAnchorRef = useRef<CellMemoryRouteAnchor | null>(null);
  const memoryTraceTargetResponseRef = useRef<
    ConsensusMemoryTargetResponse | null
  >(null);
  // A closing card is held for the length of the chassis's exit
  // (`HUD_MOTION.flip`), which is the only way it can have one: an unmounted
  // card cannot fade. What is held is the SELECTION — see `inspection-exit.ts`
  // for why it cannot be a copy of the Cell.
  const cellExit = useInspectionExit(HUD_MOTION.flip);
  const cellLeaving = cellExit.leaving;
  const clearCellSelection = useCallback(() => {
    // Closing is also an interaction-boundary reset. The nested Cell Scan can
    // disappear while it owns pointer capture, before its delayed R3F teardown
    // reports onEnd; never let that keep the main OrbitControls disabled, and
    // hand DOM focus back to the Galaxy for the user's next interaction. This
    // half is immediate: it is about the pointer, not about the card.
    setCellScanInteractionActive(false);
    cellExit.close(() => {
      memoryRouteHopAnchorRef.current = null;
      setCellIdentityProof(null);
      dispatchCellIdentityJourney({ type: 'clear' });
      dispatchCellCausalNavigation({ type: 'clear' });
      setSelectedCellId(null);
      dispatchMemoryRecall({ type: 'cancel' });
      restoreCellGalaxyFocus(cellGalaxyCanvasRef.current);
    });
  }, [cellExit]);
  // A selection that MOVES cancels the exit it interrupted — a cell → cell
  // switch, or a peer clicked while a card was leaving. The hold clears its own
  // timer before it writes, so this never fires on the hold's own landing.
  useEffect(() => {
    cellExit.cancel();
    // The selection is the event; the hold's identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCellId]);
  const inspectCell = useCallback((nextCellId: number) => {
    if (!Number.isSafeInteger(nextCellId) || nextCellId < 0) return;
    const selectionId = `${CELL_SELECTION_PREFIX}${nextCellId}`;
    dispatchCellIdentityJourney({
      type: 'select',
      cellId: nextCellId,
      atMs: performance.now(),
    });
    setCellIdentityProof((current) => (
      current?.cellId === nextCellId ? current : null
    ));
    setSelectedCellId((current) => {
      if (current !== selectionId) memoryRouteHopAnchorRef.current = null;
      return selectionId;
    });
    // Selecting another Cell is inspection, not yet a record replacement.
    // Keep the verified recall alive until the user explicitly recalls the
    // new Cell, so NeuralNetwork can stage two independent record layers.
    dispatchMemoryRecall({ type: 'inspect', targetCellId: nextCellId });
  }, []);
  const handleSelect = useCallback((id: string | null) => {
    if (
      id == null
      || orbitGestureSuppressesPointerAction(
        orbitGestureRef.current,
        performance.now(),
      )
    ) return;
    if (id.startsWith(CELL_SELECTION_PREFIX)) {
      const nextCellId = Number(id.slice(CELL_SELECTION_PREFIX.length));
      if (!Number.isSafeInteger(nextCellId) || nextCellId < 0) return;
      setSelectedNetId(null);
      dispatchCellCausalNavigation({ type: 'select', cellId: nextCellId });
      inspectCell(nextCellId);
    } else {
      clearCellSelection();
      setSelectedNetId(id);
    }
  }, [clearCellSelection, inspectCell]);
  const navigateCausalCell = useCallback((cellId: number) => {
    if (orbitGestureSuppressesPointerAction(
      orbitGestureRef.current,
      performance.now(),
    )) return;
    if (!retainedCellRecordsRef.current.has(cellId)) return;
    const encodedCurrent = selectedCellId?.startsWith(CELL_SELECTION_PREFIX)
      ? Number(selectedCellId.slice(CELL_SELECTION_PREFIX.length))
      : Number.NaN;
    const fromCellId = Number.isSafeInteger(encodedCurrent)
      ? encodedCurrent
      : null;
    dispatchCellCausalNavigation({
      type: 'navigate',
      fromCellId,
      targetCellId: cellId,
    });
    inspectCell(cellId);
  }, [inspectCell, selectedCellId]);
  const confirmCellIdentityProof = useCallback((
    kind: CellIdentityProofKind,
    cellId: number,
    reducedMotion: boolean,
  ) => {
    if (selectedCellId !== `${CELL_SELECTION_PREFIX}${cellId}`) return;
    const emittedAtMs = performance.now();
    cellIdentityProofSequenceRef.current += 1;
    setCellIdentityProof({
      kind,
      cellId,
      sequence: cellIdentityProofSequenceRef.current,
      emittedAtMs,
      reducedMotion,
    });
    dispatchCellIdentityJourney({
      type: 'resolve',
      kind,
      cellId,
      atMs: emittedAtMs,
      reducedMotion,
    });
  }, [selectedCellId]);

  // Subscribe once on mount. Each stream opens with `?since=<bootstrap
  // revision>` so the server replays missed deltas (or re-snapshots) with
  // no gap, then streams live. Disconnect on unmount.
  useEffect(() => {
    const entity = connectEntityStream(
      '/api/entities/chain/stream',
      {
        revision: initialChainRevision,
        chain: initialChain,
        chainNodes: initialChainNodes,
        peers: initialPeers,
      },
      setChainCache,
      {
        onHealth: setChainStreamHealth,
        staleAfterMs: STREAM_STALE_AFTER_MS,
      },
    );
    // Seed the columnar CellField mirror from the bootstrap cache, then keep
    // it in step inside the same callback that publishes each generation to
    // React. Sync is idempotent per cellsToken, so StrictMode double-runs
    // and re-delivered generations are no-ops.
    ingestCellsCacheIntoField(initialCellsCache);
    const cells = connectCellsStream(
      '/api/projections/cells/stream',
      initialCellsCache,
      (next) => {
        ingestCellsCacheIntoField(next);
        setCellsCache(next);
      },
      {
        recentLinksCapacity: galaxyConfig.recentLinksCap,
        linkRingCapacity: galaxyConfig.pulses.linkRingCapacity,
        onHealth: setCellsStreamHealth,
        staleAfterMs: STREAM_STALE_AFTER_MS,
        // The reducer apply behind every cells batch, under the opt-in render
        // probe: the cache package owns no clock, so the span is handed in.
        // Off, the probe runs the apply bare.
        instrumentApply: <T,>(apply: () => T): T => measureCpuProbe(
          PERFORMANCE_PROBE_LABELS.cellsCacheApply,
          apply,
        ),
      },
    );
    const semantics = enrichmentConfig.enabled
      ? connectSemanticsStream(
        '/api/projections/semantics/stream',
        initialSemanticsCache,
        setSemanticsCache,
        {
          // Same watchdog as chain/cells: a half-open socket (sleep/resume,
          // NAT timeout) must force the retry cycle instead of freezing
          // every enrichment panel until TCP happens to error.
          onHealth: setSemanticsStreamHealth,
          staleAfterMs: STREAM_STALE_AFTER_MS,
        },
      )
      : null;
    // The fourth channel, and the only one that is not a socket: cknerv → the
    // CKB node. It polls at the sockets' own reconnect cadence and publishes
    // `null` whenever the server itself will not answer, which is the sockets'
    // story rather than the node's.
    const node = connectNodeHealth(setNodeStreamHealth);
    return () => {
      entity.disconnect();
      cells.disconnect();
      semantics?.disconnect();
      node.disconnect();
    };
    // Seeds are mount-time constants; subscribe exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Historical replay is not renderer evidence for adaptive quality.
  const hydrationActiveRef = useRef(false);
  hydrationActiveRef.current = cellsCache.backfill !== null;
  const chain = chainCache.chain;
  const chainNodes = chainCache.chainNodes;
  const peers = chainCache.peers;
  // The observed local node anchors the constellation + supplies the
  // version used for peer version-mismatch coloring. Prefer an explicit id
  // lookup over positional [0] so a registry reorder can't silently anchor
  // the wrong node; fall back to the first entry.
  const localNode =
    chainNodes.find((n) => n.id === 'ckb:local') ?? chainNodes[0];
  const hostedNodeId = hosted !== null ? localNode?.id : undefined;
  const hostedNodeLabel = hosted !== null ? localNode?.label : undefined;
  // Labels are presentation only. Polls that refresh node telemetry must not
  // churn the scene root's props or the id-based topology memos.
  const ckbNodeLabels = useMemo(
    () => hostedNodeId !== undefined && hostedNodeLabel !== undefined
      ? { [hostedNodeId]: hostedNodeLabel }
      : undefined,
    [hostedNodeId, hostedNodeLabel],
  );

  // Shared per-cell flash buffers, owned here so the NeuralNetwork overlay
  // can write cell→cell pulse arrivals into the same Float32Array CellGalaxy
  // reads. burstArrivalRef carries terminal arrivals to ConsensusWriteSeal.
  const cellFlashRef = useRef<Map<number, number>>(new Map());
  const flashDirtyRef = useRef<boolean>(false);
  const flashDirtyIdsRef = useRef<Set<number>>(new Set());
  const burstArrivalRef = useRef<
    Map<number, { firedAt: number; color: [number, number, number] }>
  >(new Map());
  // The landing queue: NetworkColony's delivery layer pushes each block
  // landing's flashes here and CellGalaxy's landing layer drains it. Its own
  // channel beside the flash buffers, because a landing is not a write.
  const landingFlashRef = useRef(createLandingFlashQueue());

  // ckb node ids drive the icosahedra scatter inside the cell canopy. The
  // CkbDirectAdapter registers `ckb:local` on boot; fall back to a single
  // anchor so the galaxy always has one even before the registry arrives.
  // Keyed on the id CONTENT, not the chainNodes array identity: node-info
  // polls (version/connections) replace the array without changing the id
  // set, and this list feeds localCkbPos → the whole P2P topology memo.
  const ckbNodeIdsSig = useMemo(
    () => chainNodes.map((n) => n.id).join(' '),
    [chainNodes],
  );
  const ckbNodeIds = useMemo(() => {
    const ids = ckbNodeIdsSig.length > 0 ? ckbNodeIdsSig.split(' ') : [];
    return ids.length > 0 ? ids : ['ckb:local'];
  }, [ckbNodeIdsSig]);

  // Single seed source for chain-node placement, fed to BOTH CellGalaxy and
  // NetworkColony so carrier launch points and the galaxy stay locked to the
  // same layout (they'd diverge if only one got a real seed). The backend
  // universe_seed isn't plumbed to the SPA yet; when it is, source it HERE and
  // both move together.
  const universeSeed = UNIVERSE_SEED_FALLBACK;

  // World position of the `ckb:local` icosahedron — computed the SAME way
  // CellGalaxy places its labeled CkbNodeAnchor (chainNodeWorldPosition at the
  // `ckb:local` index, same count + seed). Fed to the colony as the local node's
  // position so the ONE visible "you" is that labeled cyan anchor: the measured
  // belts converge on it.
  // Memoized for a stable identity so it doesn't churn the topology every poll.
  const localCkbPos = useMemo(
    () => chainNodeWorldPosition(Math.max(0, ckbNodeIds.indexOf('ckb:local')), ckbNodeIds.length, universeSeed),
    [ckbNodeIds, universeSeed],
  );

  // The P2P colony topology (inferred cloud/mesh + measured core + local marker)
  // and the per-block flood over it. `peers` gets a NEW array identity on every
  // ~4s poll even when its content is unchanged (the store wholesale-replaces
  // the list), so memoize `topology` on a STABLE CONTENT SIGNATURE, not the array
  // identity — otherwise the inferred geometry (and Task 9's in-flight flood
  // flash/pulse buffers) would rebuild/reset every poll. No-op re-clones now keep
  // the same `topology` object; genuine peer changes still rebuild (accepted).
  // The signature includes ONLY the fields the colony actually renders from the
  // topology snapshot: node_id (identity), latency (measured position),
  // direction + version (measured colour via peerColorKind). `best_known` is
  // deliberately EXCLUDED — nothing rendered reads it (sync-brightness was
  // dropped), and it advances ~every block, so including it would rebuild the
  // topology mid-flood and truncate the in-flight wavefront every block. If
  // sync-based brightness is ever restored, drive it via a ref, not this sig.
  // Latency enters QUANTIZED for the same reason, one door further in: it is
  // read only through `latencyToRadius01`, which resolves the whole 0-400 ms
  // range onto 16 steps of the peer annulus, and the adapter deliberately
  // admits a telemetry-only refresh every ~32s whose OWN structural key
  // excludes latency. At raw resolution a peer's ping jitter re-keys the
  // topology on that refresh and the whole colony — flood, edges, clouds,
  // courier schedule — rebuilds for a move the ring cannot show. A ping that
  // crosses a step is a real move and still rebuilds.
  const peersSig = useMemo(
    () =>
      peers
        .map((p) => `${p.node_id}|${latencyPlacementStep(p.latency_ms)}|${p.direction}|${p.version ?? ''}`)
        .join(';'),
    [peers],
  );
  // The crawler's bounded roster stages the sighted tier. Its identity changes
  // only when a crawl round actually lands (the reducer replaces the record),
  // so keying on the reference rebuilds the colony per round, not per poll.
  const networkRoster = enrichmentConfig.enabled ? semanticsCache.networkRoster : null;
  // The indexer's week on the same producers the chain's 240-block window
  // holds the last half hour of. Gated on the capability and not merely on the
  // slot, unlike the roster above, because this is the one record NOTHING in
  // the client expires: it carries no anchor, so no prune cuts it, and the
  // server only emits `producer_ledger_clear` from a refresh that RAN — which
  // a source no longer declaring the capability never runs. Reading it through
  // the live capability list is what keeps a week from outliving the source's
  // ability to answer for it, and it is the switch `CONSUMED_CAPABILITIES`
  // pins the spelling of (`packages/cache/__tests__/wireFixtures.test.ts`): a
  // rename on the Rust side turns the ledger off here rather than silently
  // half-on. A stream that has not connected yet declares nothing and holds no
  // ledger either, so the gate cannot subtract a record that is there.
  const producerLedger = enrichmentConfig.enabled
    && semanticsCache.source.capabilities.includes('producer_ledger')
    ? semanticsCache.producerLedger
    : null;
  // The chain's recent block producers, joined against that roster: the staging
  // set the colony stands attested nodes from, and the live window every share
  // is measured over. `chain` is shallow-cloned by every batch that touches it
  // — a mempool tick, a peer refresh, a transaction — but `chain.producers` is
  // COPY-ON-WRITE in the reducer and only an attributed block (or a reorg
  // clearing the window) replaces it. Keying on the array rather than the
  // entity therefore runs this join once per attributed block instead of once
  // per delta, and `producer_window_blocks` rides along because it is the
  // denominator the derive checks the numerators against.
  const producerView = useMemo(
    // The derive takes the whole entity on purpose — there is no call site at
    // which the numerators reach it without the window they were counted over.
    () => deriveBlockProducers(chain, networkRoster, producerLedger),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chain.producers, chain.producer_window_blocks, networkRoster, producerLedger],
  );
  // What the whole network is searching at, which nothing on the wire carries:
  // difficulty over the chain's own realized cadence. It belongs beside the
  // producer view because the one surface that reads it is a cohort's card,
  // where this figure times that cohort's share is the only thing anybody can
  // say about the machines behind it — and it is derived here, once, rather
  // than in the card, so the estimate a reader sees and the estimate the app
  // holds are the same number.
  const networkHashRate = useMemo(
    () => networkHashRateHs(chain),
    // The two fields it reads. `chain` is shallow-cloned by every batch; the
    // difficulty moves once an epoch and the interval ring once a block, so
    // keying on them runs this at the cadence of the fact rather than of the
    // stream — the same bargain `producerView` above takes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chain.difficulty, chain.recent_block_intervals_ms],
  );
  // The live standings reach the colony BY REFERENCE. `staging` is a fresh
  // array on every attributed block (its tallies moved), and handing it to
  // `memo(NetworkColony)` as a prop re-rendered the whole colony subtree once
  // a block on top of the pulse's own render — for a change that moves one
  // instanced lane. The holder's identity never changes; the accretion layer
  // reads `.current` once a frame and rewrites its share lane exactly when
  // the array does. Written during render: the value is the memo above, and
  // the readers are frame callbacks that run after every commit.
  const producerSharesRef = useRef<readonly ProducerStanding[] | null>(null);
  producerSharesRef.current = producerView?.staging ?? null;
  // The colony's cache key over the producer tail: the KEY SET, in staging
  // order, and nothing a block moves. `producerKeysSignature` is where that
  // discipline is written down and tested — one node per key, placed from the
  // key alone, so a signature that admitted a tally would rebuild the whole
  // colony once a block and truncate any wavefront in flight.
  //
  // ⭐ IT IS NOW A UNION OF TWO WINDOWS, and that is the point of the leg: a
  // cohort the indexer's week names reaches the topology's attested set even
  // while the chain's 240-block ring holds none of its blocks, so the mist
  // keeps its holes through a boot, a reorg and a quiet half hour. The set is
  // bounded: the ledger ships at most `PRODUCER_LEDGER_ROW_CAP` = 16 rows
  // (`crates/cknerv-core/src/enrichment.rs`), so the week can add at most 16
  // keys to whatever the ring already stands. The ring itself is the unbounded
  // half in theory — 240 blocks could carry 240 distinct producers, which was
  // already true before the week existed — and `COHORT_MARK_CAP` = 64 is the
  // layer that bounds what is DRAWN, dropping the tail deterministically with
  // one warning. Live on 2026-09-02: 7 ledger rows over ~6 window producers.
  //
  // The live tally still reaches the nodes: `inferredTopology` re-stages both
  // tails on every call and hangs the standing on the node BY REFERENCE, so
  // whenever this memo does run the nodes carry the windows as they stand
  // then; between runs the live reading is `producerView` itself, which is
  // where a card asks.
  const producerKeysSig = useMemo(
    () => producerKeysSignature(producerView),
    [producerView],
  );
  // Both colony derives run under the opt-in render probe's CPU spans: they
  // are the block-frame work the review could only estimate. Off, the probe
  // runs the derive bare.
  const topology = useMemo(
    () => measureCpuProbe(
      PERFORMANCE_PROBE_LABELS.colonyTopology,
      () => inferredTopology(
        peers, universeSeed, localNode?.id ?? 'ckb:local', localCkbPos, networkRoster,
        // `localNode.id` is cknerv's own key for the endpoint; the crawler files
        // us under our base58 p2p id. Only this excludes us from our own roster.
        localNode?.p2p_node_id,
        producerView?.staging,
      ),
    ),
    // peers is read via the stable peersSig and the producer standings via
    // producerKeysSig; keying on either directly would rebuild the geometry
    // every poll / every block. localCkbPos is stably memoized (no churn).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peersSig, universeSeed, localNode?.id, localNode?.p2p_node_id, localCkbPos, networkRoster, producerKeysSig],
  );
  const cf = useMemo(
    // The producer of the block that FIRED THIS PULSE, carried by value on the
    // pulse delta rather than looked up off the chain cache — that lookup is a
    // cross-stream race whose wrong answers are rare, plausible and silent. The
    // wave starts where the block was made when the colony is standing a node
    // for that producer, and on the anonymous scatter when it is not. The key
    // moves in lockstep with the stamp, so it costs no recompute the pulse was
    // not already causing.
    () => measureCpuProbe(
      PERFORMANCE_PROBE_LABELS.colonyFlood,
      () => colonyFlood(topology, cellsCache.lastPulseAtMs, cellsCache.lastPulseProducerKey),
    ),
    [topology, cellsCache.lastPulseAtMs, cellsCache.lastPulseProducerKey],
  );
  const livePulseDelayS = livePulseDepartureDelayS(cf.localReceiveDelayS);

  // Maintained incrementally by the cells reducer (O(touched) per batch,
  // identity-stable when unchanged) — never re-aggregated here.
  const cellsStats = cellsCache.stats;
  // The same discipline one scope down: the reducer keeps a running tally of
  // the STAGE's script families, and this ranks it once per distinct tally.
  // `cellsStats.scripts` is the backend's retained window and stays where it
  // is — the two are different populations and never share a bar.
  const stageScripts = stageScriptCensus(cellsCache.stageScripts);
  // How many cells the viewer could be shown. Under a display plane that is
  // the STAGED MEMBERSHIP, not the retained map: the snapshot carries only the
  // canonical rows the plane staged, and the rest of the stage arrives as
  // resident payloads. Counting `cells.size` sees the canonical half alone and
  // reports a stage four times smaller than the one actually on screen.
  const showableCellCount = cellsCache.displayBudget !== null
    ? cellsCache.displayMembers.size
    : cellsCache.cells.size;

  // How much of CKB's live Cell set this dashboard has individualized, and at
  // what scope. Derived on cache / clamp / census identity changes only —
  // never per frame — and memoized by identity because HudOverlay is memoized
  // and CellGalaxy reads the gain inside its frame loop.
  const selectedCellOverlayIds = useMemo(() => {
    if (!selectedCellId?.startsWith(CELL_SELECTION_PREFIX)) return EMPTY_OVERLAY_IDS;
    const id = Number(selectedCellId.slice(CELL_SELECTION_PREFIX.length));
    return Number.isFinite(id) ? [id] : EMPTY_OVERLAY_IDS;
  }, [selectedCellId]);
  const cellDisplayRuntime = useCellDisplayRuntime();
  const cellDisplayLimit = resolveCellDisplayLimit(
    cellDisplayRuntime,
    galaxyConfig.cellCap,
    cellsCache.displayBudget?.cells,
  );
  const cellPopulation = useMemo(() => deriveCellPopulationField({
    cache: cellsCache,
    displayLimit: cellDisplayLimit,
    // Only a validated record widens the scope. With enrichment disabled the
    // field under-claims to the retained window instead of disappearing.
    census: enrichmentConfig.enabled ? semanticsCache.census : null,
    chainTip: chain.tip,
    // The client inspection overlay is rendered but never staged. The
    // selected Cell is the part of it this component can prove; the rest of
    // the inspection field lives behind a Canvas ref.
    overlayCellIds: selectedCellOverlayIds,
  }), [
    // Keyed on the INPUTS, not on the cache object. The projection stream
    // flushes on requestAnimationFrame and hands back a fresh cache for any
    // batch that advances the revision — pulses, links, backfill progress —
    // none of which can change this answer. Keying on the object would hand
    // memo(HudOverlay) a new prop every time, breaking a bail-out that used
    // to hold for cells-only frames. (The derive itself is cheap now: it
    // reads the reducer's `stagePopulation` tally instead of walking 12,000
    // staged members, so this list exists for the bail-out, not the walk.)
    //
    // These ARE the complete surface: `CellPopulationCache` picks exactly
    // `cells`, `displayMembers`, `displayResidents`, `displayBudget`,
    // `displayProvenance`, `stagePopulation`, `stats` and `statsScope`. The
    // first three are covered by the two tokens the reducer turns over with
    // them, and so is `stagePopulation`, which only moves when they do — it
    // is listed anyway so the dependency is visible. Widen this list if that
    // Pick ever widens.
    cellsCache.cellsToken,
    cellsCache.displayToken,
    cellsCache.displayBudget,
    cellsCache.displayProvenance,
    cellsCache.stagePopulation,
    cellsCache.stats,
    cellsCache.statsScope,
    cellDisplayLimit,
    enrichmentConfig.enabled,
    semanticsCache.census,
    chain.tip,
    selectedCellOverlayIds,
  ]);

  // ⭐ Carry the two per-block scalars the canopy needs to CellGalaxy through
  // refs, not props — exactly the `cellDetailViewFocusRef` precedent. Both
  // `cellPopulation.gain` and `cf.localReceiveDelayS` change VALUE every pulse
  // and birth, and passing them as props defeated `memo(CellGalaxy)`, forcing a
  // re-render of ~40 fibers (incl. a drei Html portal) every block. App still
  // re-renders per block, so mirroring here keeps `.current` live for the
  // canopy's frame loop while the memoized child holds its render. The
  // population field's PLACEMENT still needs a reactive gate, so the boolean
  // `gain > 0` travels as a prop — it is stable across blocks (it flips only on
  // the zero crossing), so it never defeats the memo the way the raw amount did.
  const populationGainRef = useRef(cellPopulation.gain);
  populationGainRef.current = cellPopulation.gain;
  const populationActive = cellPopulation.gain > 0;
  const localReceiveDelaySRef = useRef(cf.localReceiveDelayS);
  localReceiveDelaySRef.current = cf.localReceiveDelayS;
  // The third one, for the same reason one layer down: the nerve's departure
  // delay is a continuous function of WHICH PEER produced the block, so as a
  // prop it replaced the galaxy overlay element — and re-rendered every fibre
  // under it — on about four blocks in five (report L6-2). NeuralNetwork reads
  // this when a link batch opens, which is the same instant the prop was read
  // before: this write happens during the render that carries the block, and
  // effects run after it.
  const livePulseDelaySRef = useRef(livePulseDelayS);
  livePulseDelaySRef.current = livePulseDelayS;

  // Resolve the two selections. Cell = the galaxy axis; node/peer share the
  // network axis (selectedNetId holds a node id or a `peer:` id, never a cell).
  // Canonical-first over the display plane's resident payloads (staged
  // members outside the retained set).
  const selectedCell = useMemo(() => {
    if (!selectedCellId || !selectedCellId.startsWith(CELL_SELECTION_PREFIX)) return null;
    const id = Number(selectedCellId.slice(CELL_SELECTION_PREFIX.length));
    return Number.isFinite(id)
      ? cellsCache.cells.get(id) ?? cellsCache.displayResidents.get(id) ?? null
      : null;
  }, [selectedCellId, cellsCache.cells, cellsCache.displayResidents]);
  const cachedSelectedCellSemantics = selectedCell
    ? semanticsCache.cells.get(outPointKey(selectedCell.out_point)) ?? null
    : null;
  const [selectedSemanticsLookup, setSelectedSemanticsLookup] = useState<{
    key: string | null;
    phase: 'waiting' | 'loading' | 'ready' | 'unavailable' | 'error';
    record: CellSemanticRecord | null;
    message: string | null;
  }>({ key: null, phase: 'waiting', record: null, message: null });
  const selectedOutPointKey = selectedCell
    ? outPointKey(selectedCell.out_point)
    : null;
  useEffect(() => {
    if (!enrichmentConfig.enabled || !selectedCell || !selectedOutPointKey) {
      // ⭐ IDLE IS A STATE, NOT AN EVENT. This effect re-runs on every source
      // status refresh — an enrichment probe round, once a minute — and with
      // nothing selected it wrote a fresh "nothing is being looked up" object
      // into state each time, costing App a second render per round for a
      // reading that had not moved (report L6-7). Three lookups do this; all
      // three now recognise the idle they are already in.
      setSelectedSemanticsLookup(idleSemanticsLookup);
      return;
    }
    if (cachedSelectedCellSemantics) {
      setSelectedSemanticsLookup({
        key: selectedOutPointKey,
        phase: 'ready',
        record: cachedSelectedCellSemantics,
        message: null,
      });
      return;
    }
    const source = semanticsCache.source;
    if (!source.validated_anchor) {
      const hardFailure = source.status === 'error'
        || source.status === 'incompatible';
      setSelectedSemanticsLookup({
        key: selectedOutPointKey,
        phase: hardFailure ? 'error' : 'waiting',
        record: null,
        message: source.message ?? null,
      });
      return;
    }

    const controller = new AbortController();
    setSelectedSemanticsLookup({
      key: selectedOutPointKey,
      phase: 'loading',
      record: null,
      message: null,
    });
    void fetchCellSemantics(selectedCell.out_point, {
      signal: controller.signal,
    }).then((record) => {
      if (controller.signal.aborted) return;
      setSelectedSemanticsLookup({
        key: selectedOutPointKey,
        phase: record ? 'ready' : 'unavailable',
        record,
        message: record ? null : 'no semantic context is available for this Cell',
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setSelectedSemanticsLookup({
        key: selectedOutPointKey,
        phase: 'error',
        record: null,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return () => controller.abort();
  }, [
    cachedSelectedCellSemantics,
    enrichmentConfig.enabled,
    selectedCell,
    selectedOutPointKey,
    semanticsCache.source.message,
    semanticsCache.source.status,
    semanticsCache.source.validated_anchor,
  ]);
  const selectedCellSemantics = selectedSemanticsLookup.key === selectedOutPointKey
    ? selectedSemanticsLookup.record
    : cachedSelectedCellSemantics;
  const selectedCellSemanticsPhase = selectedSemanticsLookup.key === selectedOutPointKey
    ? selectedSemanticsLookup.phase
    : cachedSelectedCellSemantics
      ? 'ready'
      : 'waiting';
  // WHAT THE SEMANTIC MARKER ACTUALLY READS OFF THE SOURCE — its name, its
  // state and the anchor it has validated to. The source RECORD is replaced on
  // every probe round (the adapter restamps `last_success_at_ms`, which is
  // content, so the reducer's deep-equal cannot drop it), and keying the galaxy
  // overlay on the record turned the whole canopy over once a minute for a
  // marker whose answer had not moved (report L6-2). The anchor is unpacked
  // into its two scalars here because it is an object inside that replaced
  // record, and would carry the churn across on its own.
  const semanticAnchor = semanticsCache.source.validated_anchor;
  const semanticOrbitSource = useMemo(
    () => ({
      source: semanticsCache.source.source,
      status: semanticsCache.source.status,
      validated_anchor: semanticAnchor,
    }),
    // Rebuilt only when one of the four scalars moves; the anchor OBJECT it
    // then carries is whatever the current record holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      semanticsCache.source.source,
      semanticsCache.source.status,
      semanticAnchor?.block,
      semanticAnchor?.hash,
    ],
  );
  const selectedTransactionHash = selectedCell?.out_point.tx_hash ?? null;
  const transactionSemanticsEnabled = enrichmentConfig.enabled
    && semanticsCache.source.capabilities.includes('transaction_detail');
  const cachedSelectedTransactionSemantics = selectedTransactionHash
    ? semanticsCache.transactions.get(selectedTransactionHash) ?? null
    : null;
  const [selectedTransactionLookup, setSelectedTransactionLookup] = useState<{
    key: string | null;
    phase: 'waiting' | 'loading' | 'ready' | 'unavailable' | 'error';
    record: TransactionSemanticRecord | null;
    message: string | null;
  }>({ key: null, phase: 'waiting', record: null, message: null });
  useEffect(() => {
    if (!transactionSemanticsEnabled || !selectedTransactionHash) {
      setSelectedTransactionLookup(idleSemanticsLookup);
      return;
    }
    if (cachedSelectedTransactionSemantics) {
      setSelectedTransactionLookup({
        key: selectedTransactionHash,
        phase: 'ready',
        record: cachedSelectedTransactionSemantics,
        message: null,
      });
      return;
    }
    const source = semanticsCache.source;
    if (!source.validated_anchor) {
      const hardFailure = source.status === 'error'
        || source.status === 'incompatible';
      setSelectedTransactionLookup({
        key: selectedTransactionHash,
        phase: hardFailure ? 'error' : 'waiting',
        record: null,
        message: source.message ?? null,
      });
      return;
    }

    const controller = new AbortController();
    setSelectedTransactionLookup({
      key: selectedTransactionHash,
      phase: 'loading',
      record: null,
      message: null,
    });
    void fetchTransactionSemantics(selectedTransactionHash, {
      signal: controller.signal,
    }).then((record) => {
      if (controller.signal.aborted) return;
      setSelectedTransactionLookup({
        key: selectedTransactionHash,
        phase: record ? 'ready' : 'unavailable',
        record,
        message: record ? null : 'no origin transaction context is available',
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setSelectedTransactionLookup({
        key: selectedTransactionHash,
        phase: 'error',
        record: null,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return () => controller.abort();
  }, [
    cachedSelectedTransactionSemantics,
    selectedTransactionHash,
    semanticsCache.source.message,
    semanticsCache.source.status,
    semanticsCache.source.validated_anchor,
    transactionSemanticsEnabled,
  ]);
  const selectedTransactionSemantics =
    selectedTransactionLookup.key === selectedTransactionHash
      ? selectedTransactionLookup.record
      : cachedSelectedTransactionSemantics;
  const selectedTransactionSemanticsPhase =
    selectedTransactionLookup.key === selectedTransactionHash
      ? selectedTransactionLookup.phase
      : cachedSelectedTransactionSemantics
        ? 'ready'
        : 'waiting';
  const selectedCausalLens = useMemo(
    () => selectedCell
      ? deriveCellCausalLens(
        selectedCell,
        cellsCache.recentLinks,
        cellsCache.cells,
      )
      : null,
    [selectedCell, cellsCache.cells, cellsCache.recentLinks],
  );
  // ——— Causal navigation, held by identity ————————————————————————
  // `cellCausalNavigationStep` returns a fresh object per call, and App
  // renders several times a second — a mempool tick, a peer poll, a links
  // batch. Each fresh step re-created the two callbacks below and the readout
  // they ride in, which reached `memo(CellInspectionOverlay)` as a new prop
  // and re-rendered the 2,200-line dossier on every one of those renders.
  // Retention is the only input that moves without the trail moving, and it
  // moves only when a trail entry appears in or leaves `cells`: a string over
  // the trail's ≤24 entries is that signal, so the steps re-derive exactly
  // then, and the cells Map itself is deliberately not a key.
  const retainedCells = cellsCache.cells;
  const causalRetainedSig = useMemo(
    () => cellCausalNavigation.entries
      .map((cellId) => (retainedCells.has(cellId) ? '1' : '0'))
      .join(''),
    [cellCausalNavigation.entries, retainedCells],
  );
  const causalBackStep = useMemo(
    () => cellCausalNavigationStep(
      cellCausalNavigation,
      -1,
      (cellId) => retainedCells.has(cellId),
    ),
    // `retainedCells` is read through `causalRetainedSig` — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cellCausalNavigation, causalRetainedSig],
  );
  const causalForwardStep = useMemo(
    () => cellCausalNavigationStep(
      cellCausalNavigation,
      1,
      (cellId) => retainedCells.has(cellId),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cellCausalNavigation, causalRetainedSig],
  );
  const navigateCausalBack = useCallback(() => {
    if (!causalBackStep) return;
    dispatchCellCausalNavigation({
      type: 'move',
      index: causalBackStep.index,
    });
    inspectCell(causalBackStep.cellId);
  }, [causalBackStep, inspectCell]);
  const navigateCausalForward = useCallback(() => {
    if (!causalForwardStep) return;
    dispatchCellCausalNavigation({
      type: 'move',
      index: causalForwardStep.index,
    });
    inspectCell(causalForwardStep.cellId);
  }, [causalForwardStep, inspectCell]);
  // The readout the card receives, held for as long as its six inputs hold:
  // the id rather than the record, because a record patched by a cells
  // batch (a death, a tag) is the same subject in the same trail.
  const selectedCellRecordId = selectedCell?.id ?? null;
  const selectedCausalNavigation = useMemo(
    () => selectedCellRecordId !== null
      && cellCausalNavigation.entries[cellCausalNavigation.index]
        === selectedCellRecordId
      && cellCausalNavigation.entries.length > 1
      ? {
        position: cellCausalNavigation.index + 1,
        total: cellCausalNavigation.entries.length,
        backCellId: causalBackStep?.cellId ?? null,
        forwardCellId: causalForwardStep?.cellId ?? null,
        onBack: navigateCausalBack,
        onForward: navigateCausalForward,
      }
      : null,
    [
      selectedCellRecordId,
      cellCausalNavigation,
      causalBackStep,
      causalForwardStep,
      navigateCausalBack,
      navigateCausalForward,
    ],
  );
  // The causal lens already scanned the link ring for this exact record; a
  // second scan per links batch would only risk disagreeing with it.
  const selectedOriginLink = selectedCausalLens?.originLink ?? null;
  const selectedOriginTrace = useMemo(
    () => selectedOriginLink
      ? deriveConsensusMemoryTraceEndpoints(selectedOriginLink, cellsCache.cells)
      : null,
    [selectedOriginLink, cellsCache.cells],
  );
  const selectedOriginTraceable = !!selectedCell
    && !!selectedOriginTrace
    && selectedOriginTrace.sourceKind !== 'none'
    && selectedOriginTrace.retainedOutputIds.includes(selectedCell.id);
  const memoryRecordIdentity = memoryTraceRequest
    ? `${memoryTraceRequest.linkSeq}:${memoryTraceRequest.targetCellId}`
    : null;
  const memoryRecordSwitchPending = memoryTraceRequest !== null
    && selectedCell !== null
    && selectedCell.id !== memoryTraceRequest.targetCellId;
  useEffect(() => {
    const targetCellId = memoryTraceRequest?.targetCellId;
    if (
      memoryTraceRequest
      && typeof targetCellId === 'number'
      && cellIdentityProofBinding?.cellId === targetCellId
      && cellIdentityProofBindingComplete(cellIdentityProofBinding)
    ) {
      dispatchCellIdentityJourney({
        type: 'recall-start',
        cellId: targetCellId,
        requestKey: consensusMemoryTraceRequestKey(memoryTraceRequest),
        atMs: performance.now(),
      });
    } else if (
      memoryTraceRequest === null
      && cellIdentityProofBinding?.phase === 'recalling'
    ) {
      dispatchCellIdentityJourney({
        type: 'recall-stop',
        atMs: performance.now(),
      });
    }
  }, [
    cellIdentityProofBinding,
    memoryTraceRequest,
  ]);
  const selectedMemoryTraceReadout = useMemo(() => {
    if (!selectedCell || !memoryTraceRequest || !memoryTraceReadout) return null;
    return memoryTraceReadout.targetCellId === selectedCell.id
      && memoryTraceReadout.key === consensusMemoryTraceRequestKey(memoryTraceRequest)
      ? memoryTraceReadout
      : null;
  }, [selectedCell, memoryTraceRequest, memoryTraceReadout]);
  useEffect(() => {
    const validate = (
      current: ConsensusMemoryRouteHopFocus | null,
    ): ConsensusMemoryRouteHopFocus | null => {
      if (!current) return null;
      const verified = deriveConsensusMemoryRouteHopFocus(
        selectedMemoryTraceReadout,
        current.sourceId,
        current.hopIndex,
      );
      return consensusMemoryRouteHopFocusEqual(verified, current)
        ? verified
        : null;
    };
    setMemoryRouteHopPreview(validate);
    setMemoryRouteHopLock((current) => {
      const verified = validate(current);
      if (verified) {
        memoryRouteHopAnchorRef.current = cellMemoryRouteAnchor(verified);
        return verified;
      }
      const restored = restoreCellMemoryRouteAnchor(
        memoryRouteHopAnchorRef.current,
        selectedMemoryTraceReadout,
      );
      if (restored) {
        memoryRouteHopAnchorRef.current = cellMemoryRouteAnchor(restored);
      }
      return restored;
    });
  }, [selectedMemoryTraceReadout]);
  const memoryRouteHopFocus = memoryRouteHopPreview ?? memoryRouteHopLock;
  useEffect(() => {
    setMemoryEvidenceFocusSourceId((current) => {
      const preferredSourceId = memoryRouteHopFocus?.sourceId ?? current;
      return preferredSourceId !== null
        && selectedMemoryTraceReadout?.evidence.some(
          (evidence) => evidence.sourceId === preferredSourceId,
        )
        ? preferredSourceId
        : null;
    });
  }, [memoryRouteHopFocus, selectedMemoryTraceReadout]);
  useEffect(() => {
    setMemoryAgreementPreviewSourceId((current) => (
      current !== null
      && selectedMemoryTraceReadout?.evidence.some(
        (evidence) => evidence.sourceId === current,
      )
        ? current
        : null
    ));
  }, [selectedMemoryTraceReadout]);
  const previewMemoryTraceAgreement = useCallback((sourceId: number | null) => {
    const verifiedSourceId = sourceId !== null
      && selectedMemoryTraceReadout?.evidence.some(
        (evidence) => evidence.sourceId === sourceId,
      )
      ? sourceId
      : null;
    setMemoryAgreementPreviewSourceId(verifiedSourceId);
  }, [selectedMemoryTraceReadout]);
  const focusMemoryTraceEvidence = useCallback((sourceId: number | null) => {
    const lockedSourceId = memoryRouteHopLock?.sourceId ?? null;
    if (lockedSourceId !== null && sourceId !== lockedSourceId) {
      setMemoryEvidenceFocusSourceId(lockedSourceId);
      setMemoryRouteHopPreview(null);
      return;
    }
    if (sourceId === null) {
      setMemoryEvidenceFocusSourceId(null);
      setMemoryRouteHopPreview(null);
      return;
    }
    const verifiedSourceId = selectedMemoryTraceReadout?.evidence.some(
      (evidence) => evidence.sourceId === sourceId,
    )
      ? sourceId
      : null;
    setMemoryEvidenceFocusSourceId(verifiedSourceId);
    setMemoryRouteHopPreview((current) => (
      current?.sourceId === verifiedSourceId ? current : null
    ));
  }, [memoryRouteHopLock, selectedMemoryTraceReadout]);
  const focusMemoryTraceRouteHop = useCallback((
    candidate: ConsensusMemoryRouteHopFocus | null,
  ) => {
    if (!candidate) {
      setMemoryRouteHopPreview(null);
      return;
    }
    if (
      memoryRouteHopLock
      && candidate.sourceId !== memoryRouteHopLock.sourceId
    ) {
      setMemoryRouteHopPreview(null);
      return;
    }
    const verified = deriveConsensusMemoryRouteHopFocus(
      selectedMemoryTraceReadout,
      candidate.sourceId,
      candidate.hopIndex,
    );
    if (
      !verified
      || verified.traceKey !== candidate.traceKey
      || verified.targetCellId !== candidate.targetCellId
      || verified.cellId !== candidate.cellId
    ) {
      setMemoryRouteHopPreview(null);
      return;
    }
    setMemoryEvidenceFocusSourceId(verified.sourceId);
    setMemoryRouteHopPreview(verified);
  }, [memoryRouteHopLock, selectedMemoryTraceReadout]);
  const lockMemoryTraceRouteHop = useCallback((
    candidate: ConsensusMemoryRouteHopFocus | null,
  ) => {
    if (!candidate) {
      memoryRouteHopAnchorRef.current = null;
      setMemoryRouteHopLock(null);
      return;
    }
    const verified = deriveConsensusMemoryRouteHopFocus(
      selectedMemoryTraceReadout,
      candidate.sourceId,
      candidate.hopIndex,
    );
    if (!verified || !consensusMemoryRouteHopFocusEqual(verified, candidate)) {
      memoryRouteHopAnchorRef.current = null;
      setMemoryRouteHopLock(null);
      return;
    }
    setMemoryEvidenceFocusSourceId(verified.sourceId);
    memoryRouteHopAnchorRef.current = cellMemoryRouteAnchor(verified);
    setMemoryRouteHopLock(verified);
  }, [selectedMemoryTraceReadout]);
  const recallSelectedCellOrigin = useCallback((linkSeq: number) => {
    if (
      !selectedCell
      || cellIdentityProofBinding?.cellId !== selectedCell.id
      || !cellIdentityProofBindingComplete(cellIdentityProofBinding)
    ) return;
    const link = cellsCache.recentLinks.find((candidate) => candidate.seq === linkSeq);
    if (
      !link
      || !canRecallConsensusMemory(link, cellsCache.cells, selectedCell.id)
    ) return;
    dispatchMemoryRecall({
      type: 'toggle',
      linkSeq,
      targetCellId: selectedCell.id,
    });
  }, [
    cellIdentityProofBinding,
    selectedCell,
    cellsCache.cells,
    cellsCache.recentLinks,
  ]);
  const completeMemoryRecall = useCallback((
    request: ConsensusMemoryTraceRequest,
    outcome: ConsensusMemoryTraceOutcome,
  ) => {
    dispatchMemoryRecall({ type: 'complete', request });
    if (outcome === 'unavailable') return;
    if (typeof request.targetCellId !== 'number') return;
    dispatchCellIdentityJourney({
      type: 'recall-retained',
      cellId: request.targetCellId,
      requestKey: consensusMemoryTraceRequestKey(request),
      atMs: performance.now(),
    });
  }, []);
  const selectedNode = useMemo(() => {
    if (!selectedNetId || selectedNetId.startsWith('peer:')) return null;
    return chainNodes.find((n) => n.id === selectedNetId) ?? null;
  }, [selectedNetId, chainNodes]);
  // Where that node's labeled icosahedron stands in the galaxy. Placement is a
  // pure function of (index, count, seed), so this resolves the SAME point
  // CellGalaxy draws the anchor at — the card tethers to the thing clicked,
  // not to a second guess at where it is.
  const selectedNodeAnchor = useMemo(() => {
    if (!selectedNode) return null;
    const index = ckbNodeIds.indexOf(selectedNode.id);
    if (index < 0) return null;
    return chainNodeWorldPosition(
      index,
      Math.max(1, ckbNodeIds.length),
      universeSeed,
    );
  }, [selectedNode, ckbNodeIds, universeSeed]);
  const selectedPeer = useMemo(() => {
    if (!selectedNetId || !selectedNetId.startsWith('peer:')) return null;
    const id = selectedNetId.slice('peer:'.length);
    return peers.find((p) => p.node_id === id) ?? null;
  }, [selectedNetId, peers]);
  // Where that peer currently stands in the colony. Latency drives the ring
  // radius, so the node moves between polls and the probe follows it.
  const selectedPeerAnchor = useMemo(() => {
    if (!selectedNetId || !selectedNetId.startsWith('peer:')) return null;
    const id = selectedNetId.slice('peer:'.length);
    return topology.nodes.find((n) => n.id === id)?.pos ?? null;
  }, [selectedNetId, topology]);
  // The crawler's own row for a staged sighted node. The roster is replaced
  // whole per crawl round, so this always resolves against the round the scene
  // is currently standing on.
  const selectedSighted = useMemo(() => {
    if (!selectedNetId || !selectedNetId.startsWith('sighted:')) return null;
    const id = selectedNetId.slice('sighted:'.length);
    return networkRoster?.entries.find((n) => n.node_id === id) ?? null;
  }, [selectedNetId, networkRoster]);
  // Where that node was placed. Placement is a pure function of its id, so the
  // point is stable across rounds — but the kind is checked, not just the id:
  // the same node reappearing as `measured` is a promotion, not this card's
  // subject, and the sighted anchor must not follow it there.
  const selectedSightedAnchor = useMemo(() => {
    if (!selectedNetId || !selectedNetId.startsWith('sighted:')) return null;
    const id = selectedNetId.slice('sighted:'.length);
    const node = topology.nodes.find((n) => n.id === id);
    return node?.kind === 'sighted' ? node.pos : null;
  }, [selectedNetId, topology]);
  // A sighted node can leave the stage two ways, and only one of them is a
  // disappearance. If the id is now in `peers[]`, the node came ONLINE: the
  // derive's dedupe (measured wins) pulled it out of the sighted tier and drew
  // it as a real link instead, so the selection follows it into the richer
  // live dialect — the user is inspecting the same node, now with telemetry.
  // Otherwise the crawl round simply stopped naming it, and the selection
  // clears; nothing was ever linked here, so there is no epilogue to play.
  useEffect(() => {
    if (!selectedNetId?.startsWith('sighted:')) return;
    if (selectedSighted && selectedSightedAnchor) return;
    const id = selectedNetId.slice('sighted:'.length);
    setSelectedNetId(
      peers.some((p) => p.node_id === id) ? `peer:${id}` : null,
    );
  }, [selectedNetId, selectedSighted, selectedSightedAnchor, peers]);
  // ⭐⭐⭐ The producer behind an open MINER card, resolved out of the LIVE
  // producer view — never off the standing hanging on the staged node. The
  // topology memo is keyed on the producer KEY SET alone and has to be, so
  // `node.attested` is whatever it was at the last key-set change and goes
  // stale for every block in between; the node is the authority on identity
  // and placement, the view is the authority on the window. Same split
  // `selectedSighted` above draws against the live roster.
  //
  // The standing and the denominator its build share is measured against come
  // out of ONE read of ONE view, deliberately: pairing a standing from one
  // round with a roster size from another would print a fraction whose halves
  // were counted at different moments.
  //
  // It asks `ranked` because this is the HUD side of the view — the scene is
  // the only thing that may read `staging`, whose sequence is a cache key.
  // Which one is asked cannot change the answer: the two arrays are
  // permutations of each other over the SAME standing objects, so a lookup by
  // key finds the identical one either way.
  const selectedMiner = useMemo<MinerNodeSubject | null>(() => {
    if (!selectedNetId || !selectedNetId.startsWith(MINER_SELECTION_PREFIX)) return null;
    if (!producerView) return null;
    const key = selectedNetId.slice(MINER_SELECTION_PREFIX.length);
    const producer = producerView.ranked.find((p) => p.key === key);
    if (!producer) return null;
    return {
      producer,
      versionedRosterSize: producerView.versionedRosterSize,
      // Both of these are facts about the WHOLE view rather than about this
      // standing, and both ride along for the same reason the roster size
      // does: the week is the denominator its share was divided by, and a card
      // holding one from this round and the other from the last would print a
      // fraction whose halves were counted at different moments.
      ledgerWindow: producerView.ledgerWindow,
      networkHashRateHs: networkHashRate,
    };
  }, [selectedNetId, producerView, networkHashRate]);
  // Where that producer was placed. Placement is a pure function of its key, so
  // the point is stable for as long as the key is staged — and the kind is
  // checked rather than the id alone, the same guard the sighted anchor keeps.
  const selectedMinerAnchor = useMemo(() => {
    if (!selectedNetId || !selectedNetId.startsWith(MINER_SELECTION_PREFIX)) return null;
    const id = attestedNodeId(selectedNetId.slice(MINER_SELECTION_PREFIX.length));
    const node = topology.nodes.find((n) => n.id === id);
    return node?.kind === 'attested' ? node.pos : null;
  }, [selectedNetId, topology]);
  // ⚠️ The colony's overlay slot takes the KEY and not the subject. The subject
  // is a fresh object on every attributed block (its tally moved), and handing
  // that identity to the hoisted colony overlay would defeat `NetworkColony`'s
  // memo once a block for a fragment whose only moving part is a position — the
  // same trap `producerKeysSig` exists to keep out of the topology one tier up.
  const selectedMinerKey = selectedMiner?.producer.key ?? null;
  // A producer leaves this card exactly one way: its last block rolls out of
  // the window and the colony stops standing a node for it. There is no
  // promotion path — knowing WHICH machine it is is precisely what this
  // evidence class does not carry — so unlike the sighted dialect there is
  // nowhere richer for the selection to follow it to, and it simply ends.
  useEffect(() => {
    if (!selectedNetId?.startsWith(MINER_SELECTION_PREFIX)) return;
    if (selectedMiner && selectedMinerAnchor) return;
    setSelectedNetId(null);
  }, [selectedNetId, selectedMiner, selectedMinerAnchor]);
  // The mining question a SIGHTED card may carry. Read from the same live
  // view for the same reason, and `null` for every node that is not in a drawn
  // fan — which is almost all of them.
  const selectedSightedCandidacy = selectedSighted
    ? producerView?.candidacyByPeer.get(selectedSighted.node_id) ?? null
    : null;

  // Stable identities: HudOverlay is memoized, so its object/callback props
  // must not be re-created per App render.
  const build = useMemo(() => {
    const buildVersion = resolveBuildVersion();
    return { version: buildVersion, href: buildCommitHref(buildVersion) };
  }, []);
  const hudStreamHealth = useMemo(
    () => ({
      chain: chainStreamHealth,
      cells: cellsStreamHealth,
      ...(enrichmentConfig.enabled ? { semantics: semanticsStreamHealth } : {}),
      // Absent, not live, when the probe has nothing: an undefined channel is
      // how `semantics` already says "there is nothing here to report on", and
      // a probe that cannot reach the server is reporting on the server rather
      // than on the node.
      ...(nodeStreamHealth ? { node: nodeStreamHealth } : {}),
    }),
    [
      chainStreamHealth,
      cellsStreamHealth,
      semanticsStreamHealth,
      nodeStreamHealth,
      enrichmentConfig.enabled,
    ],
  );

  // ── The renderer's half of the boot record ────────────────────────────
  // Three effects here; the GL completion rides the Canvas `onCreated` below
  // and first light rides an in-Canvas sentinel, because those are the only
  // two places that can witness them. Every write is idempotent in the
  // record, so a StrictMode double-mount needs no guard of its own — and the
  // record refuses every write once boot completes, which is what keeps a
  // mid-session reconnect or replay from reopening a line watched here.

  // Building the GL context is the freeze the visitor sits through (two dozen
  // shader programs compile and link behind it), so the START is worth
  // showing — and the Canvas cannot report itself until it exists. The
  // matching completion rides `onCreated` below.
  useEffect(() => { beginBootPhase('gl'); }, []);

  // The data plane stands up when every stream this page actually subscribed
  // to is live — the same collapse the HUD banner reads, so the readout and
  // the banner can never disagree about it. The timestamp only dates an
  // interrupted channel's silence; the phase does not depend on it.
  const bootDataPlaneRef = useRef(false);
  useEffect(() => {
    if (bootDataPlaneRef.current) return;
    const summary = deriveStreamHealthSummary(hudStreamHealth, Date.now());
    if (summary.phase !== 'live') return;
    bootDataPlaneRef.current = true;
    completeBootPhase('data_plane');
  }, [hudStreamHealth]);

  // The server's chain replay folds INTO the sequence as one line carrying its
  // real done/total, rather than a second banner overlapping the first. With
  // no replay in this boot the line is never inserted and finishing it is a
  // no-op, which is exactly the boot that should not mention seeding at all.
  const bootSeeding = cellsCache.backfill;
  useEffect(() => {
    if (bootSeeding) reportBootSeeding(bootSeeding.done, bootSeeding.total);
    else completeBootSeeding();
  }, [bootSeeding]);

  // The network dialects share the chassis, so they share its exit: the same
  // hold, on the one gesture that ends a selection rather than moving it (the
  // × and the peer card's retention expiry). A click that selects something
  // ELSE is not an exit — the card is re-dressed for the new subject, or the
  // next dialect's card takes the stage, and neither wants a fade first.
  const netExit = useInspectionExit(HUD_MOTION.flip);
  const netLeaving = netExit.leaving;
  const clearNetSelection = useCallback(() => {
    netExit.close(() => setSelectedNetId(null));
  }, [netExit]);
  useEffect(() => {
    netExit.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNetId]);
  // A dropped link is the peer's own ending: the probe holds its last snapshot
  // and anchor long enough to say so, then retires the selection itself.
  const peerInspection = usePeerInspectionRetention({
    selectionKey: selectedNetId?.startsWith('peer:') ? selectedNetId : null,
    peer: selectedPeer,
    position: selectedPeerAnchor,
    onExpire: clearNetSelection,
  });
  const inspectedPeer = peerInspection.peer;
  const inspectedPeerAnchor = peerInspection.position;
  // The same question for the peer dialect, asked of the RETAINED snapshot
  // rather than of `peers[]`: a link that just dropped does not change what
  // build the node at the other end was reporting, and a stamp that vanished
  // the instant the connection did would be describing the connection.
  const inspectedPeerCandidacy = inspectedPeer
    ? producerView?.candidacyByPeer.get(inspectedPeer.node_id) ?? null
    : null;

  // The crawler's dossier on whichever network node is open — the only
  // enrichment lookup keyed by a node id rather than a chain object. Nothing
  // pushes it and nothing holds a projection slot for it, so it is asked once
  // per selection and remembered for the session. A lost link keeps asking:
  // the dossier describes the node at the far end, not the link that dropped.
  const peerSightingEnabled = enrichmentConfig.enabled
    && semanticsCache.source.capabilities.includes('peer_sighting');
  // The crawler indexes nodes by their peer id, so the local node has to be
  // asked about under the name the network knows it by — never under
  // cknerv's own key for the endpoint. A server that carries no identity for
  // it leaves that key in place, where the plate still says the honest thing.
  // A sighted node is already keyed that way — the roster carries the same
  // base58 vocabulary — so it joins the same one lookup rather than standing
  // up a second machine beside it. The selection axis is single: at most one
  // of these three is ever a string.
  const inspectedNetNodeId = inspectedPeer?.node_id
    ?? selectedSighted?.node_id
    ?? selectedNode?.p2p_node_id
    ?? selectedNode?.id
    ?? null;
  // The memo's horizon. A source that reconnected, went stale or was swapped
  // out is a different observer, and its predecessor's sightings are not its.
  const sightingSourceIdentity =
    `${semanticsCache.source.source}:${semanticsCache.source.status}`;
  const [peerSightingLookup, setPeerSightingLookup] = useState<{
    key: string | null;
    phase: PeerSightingPhase;
    record: PeerSightingRecord | null;
    reason: PeerSightingAbsence | null;
    advertised: PeerAdvertisedEvidence | null;
    message: string | null;
  }>({
    key: null,
    phase: 'waiting',
    record: null,
    reason: null,
    advertised: null,
    message: null,
  });
  useEffect(() => {
    if (!peerSightingEnabled || !inspectedNetNodeId) {
      setPeerSightingLookup(idlePeerSightingLookup);
      return;
    }
    const settle = (outcome: PeerSightingOutcome) => setPeerSightingLookup({
      key: inspectedNetNodeId,
      phase: outcome.state === 'sighted'
        ? 'ready'
        : outcome.state === 'unsighted' ? 'unsighted' : 'disabled',
      record: outcome.state === 'sighted' ? outcome.sighting : null,
      reason: outcome.state === 'unsighted' ? outcome.reason : null,
      // The one absence that carries evidence. It rides beside the reason all
      // the way to the plate rather than being flattened into a record: it is
      // not a sighting, and nothing downstream may read it as one.
      advertised: outcome.state === 'unsighted' ? outcome.advertised ?? null : null,
      message: null,
    });
    const remembered = cachedPeerSighting(inspectedNetNodeId, sightingSourceIdentity);
    if (remembered) {
      settle(remembered);
      return;
    }
    const source = semanticsCache.source;
    if (!source.validated_anchor) {
      const hardFailure = source.status === 'error'
        || source.status === 'incompatible';
      setPeerSightingLookup({
        key: inspectedNetNodeId,
        phase: hardFailure ? 'error' : 'waiting',
        record: null,
        reason: null,
        advertised: null,
        message: source.message ?? null,
      });
      return;
    }

    const controller = new AbortController();
    setPeerSightingLookup({
      key: inspectedNetNodeId,
      phase: 'loading',
      record: null,
      reason: null,
      advertised: null,
      message: null,
    });
    void fetchPeerSighting(inspectedNetNodeId, {
      signal: controller.signal,
      cacheIdentity: sightingSourceIdentity,
    }).then((outcome) => {
      if (controller.signal.aborted) return;
      settle(outcome);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setPeerSightingLookup({
        key: inspectedNetNodeId,
        phase: 'error',
        record: null,
        reason: null,
        advertised: null,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return () => controller.abort();
  }, [
    inspectedNetNodeId,
    peerSightingEnabled,
    semanticsCache.source.message,
    semanticsCache.source.status,
    semanticsCache.source.validated_anchor,
    sightingSourceIdentity,
  ]);
  // Keyed to the node on screen, so an answer that arrived for the previous
  // selection can never land on this one.
  const inspectedNetSighting = useMemo<PeerSightingState | undefined>(() => {
    if (!peerSightingEnabled || !inspectedNetNodeId) return undefined;
    if (peerSightingLookup.key !== inspectedNetNodeId) {
      return { phase: 'waiting', record: null, reason: null, advertised: null, message: null };
    }
    return {
      phase: peerSightingLookup.phase,
      record: peerSightingLookup.record,
      reason: peerSightingLookup.reason,
      advertised: peerSightingLookup.advertised,
      message: peerSightingLookup.message,
    };
  }, [inspectedNetNodeId, peerSightingEnabled, peerSightingLookup]);

  // ── Scene-root overlays ────────────────────────────────────────────────────
  // CellGalaxy and NetworkColony are memoized, and a fragment written inline at
  // the call site is a NEW element every App render. A shallow compare needs
  // ALL props equal, so that single fresh child would have defeated the memo
  // outright and kept dragging both roots — and every layer beneath them —
  // through a full re-render for each chain poll, stream-health flip, semantics
  // round and orbit gesture. Hoisted here, the element identity turns over only
  // when something the overlay actually draws from turns over.
  //
  // DEP DISCIPLINE: each list mirrors EVERY component-scope binding its body
  // reads — refs and state setters included, though React already guarantees
  // those never change — so the list can be read against the body one line at a
  // time instead of trusting a lint rule this repo does not run in CI. Add a
  // prop below, add its source to the list; `__tests__/App.sceneRoots.test.tsx`
  // fails if you don't.
  const galaxyOverlay = useMemo(() => (
    <>
      {selectedCell ? (
        <CellInspectionAnchor
          key={selectedCell.id}
          cell={selectedCell}
          handles={cellInspectionHandles}
        />
      ) : null}
      {selectedCell && selectedCellSemantics ? (
        <CellSemanticOrbit
          cell={selectedCell}
          record={selectedCellSemantics}
          source={semanticOrbitSource}
        />
      ) : null}
      {selectedCausalLens ? (
        <CellCausalLensLayer
          key={selectedCausalLens.key}
          lens={selectedCausalLens}
          onNavigateCell={navigateCausalCell}
        />
      ) : null}
      {/* Cell→cell consensus packets: each observed transaction routes its
          carrier from input cells to outputs through the shared neighbour
          graph, illuminating the maintained data structure before the terminal
          write seal resolves. */}
      <NeuralNetwork
        cellCapacity={galaxyConfig.cellCap}
        cellFlashRef={cellFlashRef}
        flashDirtyRef={flashDirtyRef}
        flashDirtyIdsRef={flashDirtyIdsRef}
        burstArrivalRef={burstArrivalRef}
        topology={galaxyConfig.topology}
        pulses={galaxyConfig.pulses}
        livePulseDelaySRef={livePulseDelaySRef}
        cellDetailViewFocusRef={cellDetailViewFocusRef}
        traceRequest={memoryTraceRequest}
        traceMaxPulses={CELL_MEMORY_RECALL_MAX_PULSES}
        traceHoldForRecordSwitch={memoryRecordSwitchPending}
        onTraceComplete={completeMemoryRecall}
        onTraceReadoutChange={setMemoryTraceReadout}
        traceTargetResponseRef={memoryTraceTargetResponseRef}
        traceEvidenceFocusSourceId={memoryEvidenceFocusSourceId}
        traceRouteHopFocus={memoryRouteHopFocus}
        traceRouteHopLock={memoryRouteHopLock}
        onTraceAgreementPreviewChange={previewMemoryTraceAgreement}
        onTraceRouteHopLockChange={lockMemoryTraceRouteHop}
      />
      <ConsensusWriteSeal arrivalRef={burstArrivalRef} />
    </>
  ), [
    burstArrivalRef,
    cellDetailViewFocusRef,
    cellFlashRef,
    cellInspectionHandles,
    completeMemoryRecall,
    flashDirtyIdsRef,
    flashDirtyRef,
    galaxyConfig.cellCap,
    galaxyConfig.pulses,
    galaxyConfig.topology,
    livePulseDelaySRef,
    lockMemoryTraceRouteHop,
    memoryEvidenceFocusSourceId,
    memoryRecordSwitchPending,
    memoryRouteHopFocus,
    memoryRouteHopLock,
    memoryTraceRequest,
    memoryTraceTargetResponseRef,
    navigateCausalCell,
    previewMemoryTraceAgreement,
    selectedCausalLens,
    selectedCell,
    selectedCellSemantics,
    semanticOrbitSource,
    setMemoryTraceReadout,
  ]);
  // Both probes tether from colony space, and the colony's one selection means
  // only ever one of them is mounted.
  const colonyOverlay = useMemo(() => (
    <>
      {inspectedPeer && inspectedPeerAnchor ? (
        <PeerInspectionAnchor
          key={inspectedPeer.node_id}
          position={inspectedPeerAnchor}
          handles={peerInspectionHandles}
        />
      ) : null}
      {selectedSighted && selectedSightedAnchor ? (
        <SightedInspectionAnchor
          key={selectedSighted.node_id}
          position={selectedSightedAnchor}
          handles={sightedInspectionHandles}
        />
      ) : null}
      {selectedMinerKey && selectedMinerAnchor ? (
        <MinerInspectionAnchor
          key={selectedMinerKey}
          position={selectedMinerAnchor}
          handles={minerInspectionHandles}
        />
      ) : null}
    </>
  ), [
    inspectedPeer,
    inspectedPeerAnchor,
    minerInspectionHandles,
    peerInspectionHandles,
    selectedMinerAnchor,
    selectedMinerKey,
    selectedSighted,
    selectedSightedAnchor,
    sightedInspectionHandles,
  ]);

  return (
    <>
      {/* Leva knobs panel (DOM overlay) — hidden by default, backtick toggles. */}
      <Tweaks />
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        hostedName={hosted ?? undefined}
        cellsStats={cellsStats}
        stageScripts={stageScripts}
        cellPopulation={cellPopulation}
        cellCount={showableCellCount}
        cellCapacity={galaxyConfig.cellCap}
        enrichmentSource={enrichmentConfig.enabled ? semanticsCache.source : undefined}
        assetEcosystem={enrichmentConfig.enabled
          ? semanticsCache.assetEcosystem
          : undefined}
        scriptRegistry={enrichmentConfig.enabled
          ? semanticsCache.scriptRegistry
          : undefined}
        scriptFamilyCensus={enrichmentConfig.enabled
          ? semanticsCache.scriptFamilyCensus
          : undefined}
        daoState={enrichmentConfig.enabled
          ? semanticsCache.daoState
          : undefined}
        protocolEra={enrichmentConfig.enabled
          ? semanticsCache.protocolEra
          : undefined}
        activityFeed={enrichmentConfig.enabled
          ? semanticsCache.activityFeed
          : undefined}
        transactionHorizon={enrichmentConfig.enabled
          ? semanticsCache.transactionHorizon
          : undefined}
        networkAtlas={enrichmentConfig.enabled
          ? semanticsCache.networkAtlas
          : undefined}
        backfill={cellsCache.backfill}
        streamHealth={hudStreamHealth}
        build={build}
        topBarActions={TOP_BAR_ACTIONS}
        colonyCount={topology.nodes.length}
        producerView={producerView}
        onSoundVisibleChange={setSoundVisible}
        onCameraFrame={setCameraFrame}
      />
      {/* SND·06. The chip wears a module code, so the module registry's own
          menu lists it and this is what that switch reaches (D-14). It
          UNMOUNTS rather than hiding, which is what OFF means everywhere else
          in that menu — and for a music player it is also the honest reading:
          a chip you have switched off should not still be playing. */}
      {soundVisible ? (
        <Jukebox
          blockPulseAtMs={cellsCache.lastPulseAtMs}
        />
      ) : null}
      {/* Render-stats HUD overlay (DOM sibling of HudOverlay, NOT in-Canvas):
          visible through the ` panel toggle or ?render-stats=1. */}
      {forceRenderStats ? <RenderStatsPanel /> : null}

      {/* The stage is gone and nothing else on the page can say so: the HUD
          is DOM and goes on reading the chain perfectly over a black canvas.
          Above the empty-stage notice below, which would otherwise argue with
          it — there is no shortage of Cells here, there is no renderer. */}
      {glContextLost ? (
        <div
          data-gl-context="lost"
          role="alert"
          style={{
            position: 'fixed',
            left: '50%',
            top: '50%',
            zIndex: 14,
            transform: 'translate(-50%, -50%)',
            maxWidth: 'min(420px, calc(100vw - 48px))',
            padding: '13px 16px 14px',
            border: `1px solid ${rgba(HUD_COLORS.danger, 0.34)}`,
            background: rgba(HUD_COLORS.stageGround, 0.96),
            boxShadow: `0 8px 28px ${rgba(HUD_COLORS.ground, 0.72)}`,
            color: HUD_COLORS.dim,
            fontFamily: HUD_FONTS.mono,
            fontSize: HUD_TYPE.label,
            letterSpacing: 0.9,
            lineHeight: 1.55,
            textAlign: 'center',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ color: HUD_COLORS.danger, letterSpacing: 1.2 }}>
            THE GPU RECLAIMED THE STAGE
          </div>
          <div style={{ marginTop: 6 }}>
            The browser took this page's drawing context back — memory
            pressure, a long spell in the background, or another tab. The
            readings above are live and the scene is not.
          </div>
          <button
            type="button"
            className="cknerv-hud-control-button cknerv-touch-target"
            data-gl-context-reload
            onClick={() => window.location.reload()}
            style={{
              appearance: 'none',
              marginTop: 9,
              padding: '5px 12px',
              border: 0,
              borderBottom: `1px solid ${rgba(HUD_COLORS.dim, 0.55)}`,
              background: 'transparent',
              color: HUD_COLORS.ink,
              font: `400 ${HUD_TYPE.label}px/1.4 ${HUD_FONTS.mono}`,
              letterSpacing: 1.2,
              cursor: 'pointer',
            }}
          >
            RELOAD
          </button>
        </div>
      ) : null}

      {showableCellCount === 0 && !glContextLost ? (
        <div
          data-empty-stage={cellsCache.backfill ? 'populating' : 'empty'}
          role="status"
          style={{
            position: 'fixed',
            left: '50%',
            top: '58%',
            zIndex: 2,
            transform: 'translate(-50%, -50%)',
            color: HUD_COLORS.dim,
            fontFamily: "'Share Tech Mono', ui-monospace, monospace",
            fontSize: 10,
            letterSpacing: 1.4,
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {cellsCache.backfill
            ? 'WAITING FOR THE SERVER TO POPULATE THE STAGE'
            : 'NO CELLS ARE CURRENTLY AVAILABLE TO DISPLAY'}
        </div>
      ) : null}

      <CellGalaxyProvider value={cellsCache}>
        {/* HUD layout is available before paint, independently of boot/data
            readiness. The first Canvas frame already has its final pose. */}
        {initialCamera && cameraFrame ? <Canvas
          ref={cellGalaxyCanvasRef}
          camera={initialCamera.camera}
          // ⚠️ This does NOT make the drawing buffer opaque. three hardcodes
          // `alpha: true` in the context attributes it creates
          // (WebGLRenderer.js), so the surface the compositor blends always
          // carries an alpha channel; the flag only picks the default clear
          // alpha, and the scene background below overrides even that. It is
          // the honest value for a scene that paints its own ground, and the
          // one the clear falls back to if that background ever goes away.
          // A genuinely opaque canvas would mean handing three a context
          // created here with `alpha: false` — three then reads the real
          // attributes back off it.
          //
          // `antialias` is decided once at mount by the startup buffer's
          // density and class (see `startupAntialias`): off at 1.5× or denser
          // and off above 8 MP, on only for a 1×-ish HIGH-class buffer. It is
          // a context attribute and cannot change without remounting the
          // Canvas, so it must not be a runtime tier.
          gl={{ antialias: startupAntialias, alpha: false }}
          dpr={canvasDpr}
          style={{ background: HUD_COLORS.stageGround }}
          // The context exists — the boot record's GL line closes here, the
          // one place that knows. And the same callback is the only place that
          // can ask the DRAWING BUFFER what it actually got: `antialias` above
          // is a request, the context decides, and `gl.SAMPLES` is the answer.
          // GL·08 and every timer-query reading depend on knowing it, because
          // MSAA splits a pass across resolves the per-draw scopes never see.
          onCreated={({ gl }) => {
            completeBootPhase('gl');
            setGpuSampleCount(readDrawingBufferSampleCount(gl.getContext()));
            // ——— WHEN THE GPU TAKES THE SCENE BACK ———
            //
            // A browser may drop a WebGL context at any moment and iPadOS
            // Safari does it readily: under memory pressure, after a long
            // spell in the background, when another tab wants the GPU. three
            // already calls `preventDefault` on the loss (so the context CAN
            // be restored) and re-initialises on `webglcontextrestored`, and
            // it announces both with a `console.log` — which is the whole of
            // what the reader was told. The canvas simply went black under a
            // live HUD, and if the restore never came it stayed that way.
            //
            // `index.html` has a vocabulary for exactly this and the running
            // application had none, so the loss now says so on the glass.
            // RELOAD is offered rather than promised-away: three restores its
            // own GL state, but this scene also carries timer-query pools and
            // a drawing-buffer sample count read once at creation, so the
            // honest offer is "it may come back, and here is the sure path".
            const canvas = gl.domElement;
            const onLost = () => setGlContextLost(true);
            const onRestored = () => {
              // Read again: `antialias` is negotiated per context, and a
              // restored one may not have answered the same way.
              setGpuSampleCount(readDrawingBufferSampleCount(gl.getContext()));
              setGlContextLost(false);
            };
            canvas.addEventListener('webglcontextlost', onLost);
            canvas.addEventListener('webglcontextrestored', onRestored);
          }}
          onPointerMissed={() => {
            // The inspection card is a Canvas sibling, so its clicks can no
            // longer surface here as scene misses.
            if (orbitGestureSuppressesPointerAction(
              orbitGestureRef.current,
              performance.now(),
            )) return;
            clearCellSelection();
            setSelectedNetId(null);
          }}
        >
          {/* The ground the scene clears to every frame, and the same token the
              CSS above it wears: the wrapper carries the colour until the first
              frame exists, this carries it afterwards, and the black window
              before first light stays the one black. This is what makes the
              ground the scene's own fact rather than a colour showing through
              a transparent buffer. `index.html` spells the value out because a
              stylesheet cannot import; nothing else needs to. */}
          <color attach="background" args={[HUD_COLORS.stageGround]} />
          {/* Advances the module-level simClock once per frame so every
              useSimFrame animation (CellGalaxy, BlockDeliveryLayer, GlowNode,
              NeuralNetwork, NetworkColony) actually plays. Must live
              under the r3f context; mount exactly once. */}
          <SimClockTicker />
          <BootViewSentinel
            populated={showableCellCount > 0}
            contentDrawnRef={bootCellDrawnRef}
          />
          {/* Watches frame deltas for first light — the loop running steadily
              with cells on the stage — and closes that line of the boot
              record. Draws nothing; same discipline as the ticker above
              (r3f context, mounted exactly once). */}
          <BootFrameSentinel populated={showableCellCount > 0} />
          {/* Holds the boot record's fabric line open until the nerve tiers
              are at rest — fabric growth, halo placement, first bridge
              growth — ticking the gate on the same sim clock the growth is
              drawn against. Same discipline again: r3f context, mounted
              exactly once, draws nothing. */}
          <BootNerveRestSentinel />
          <CellDetailViewTracker
            controlsRef={orbitControlsRef}
            focusRef={cellDetailViewFocusRef}
          />
          {/* Takes over the render loop (main pass + braid scissor pass on
              the ONE shared context) only while a Cell is selected; closed
              state keeps R3F's stock auto-render pipeline. */}
          {selectedCell ? (
            <CellPortraitInset
              onInteractionChange={setCellScanInteractionActive}
            />
          ) : null}
          {/* Auto mode samples raw frame time with long hysteresis, outside
              replay and outside motion windows. Manual high/med/low in the
              backtick panel overrides it immediately. */}
          {qualityOverride ? null : (
            <AdaptiveQualityController
              hydrationActiveRef={hydrationActiveRef}
              motionActiveRef={cameraMotionActiveRef}
              recentBlockActiveRef={recentBlockActiveRef}
            />
          )}
          {/* Mirrors the backtick leva panel into the LIVE tuning store.
              Re-renders only on knob drag (no per-frame cost); mount once. */}
          <TweakSync />
          {/* Samples gl.info when the ` panel toggle or ?render-stats=1 is on;
              inert otherwise. Mount once. */}
          <RenderStatsSampler forceEnabled={forceRenderStats} />

          {/* The starfield's drift is AMBIENT — it has no cause and runs
              because the scene is on screen — so it stops for a visitor who
              asked for stillness (D-11). The stars stay: they are the depth
              cue behind the whole composition, and removing them would be a
              different picture rather than a stiller one. */}
          <Stars
            ref={starsRef}
            radius={400}
            depth={120}
            count={qualityCascade.starsCount}
            factor={2}
            saturation={0}
            fade
            speed={reducedMotion ? 0 : 0.3}
          />

          {/* CellGalaxy owns exact ledger-apply feedback only. The broad
              new-block brightness shockwave now belongs to NetworkColony. */}
          <CellGalaxy
            contentDrawnRef={bootCellDrawnRef}
            ckbNodeIds={ckbNodeIds}
            ckbNodeLabels={ckbNodeLabels}
            universeSeed={universeSeed}
            cellCapacity={galaxyConfig.cellCap}
            populationGainRef={populationGainRef}
            populationActive={populationActive}
            cellDetailViewFocusRef={cellDetailViewFocusRef}
            localReceiveDelaySRef={localReceiveDelaySRef}
            selectedId={selectedNetId}
            selectedCellId={selectedCellId}
            identityProof={cellIdentityProof}
            identityProofBinding={cellIdentityProofBinding}
            onSelect={handleSelect}
            cellFlashRef={cellFlashRef}
            flashDirtyRef={flashDirtyRef}
            flashDirtyIdsRef={flashDirtyIdsRef}
            landingFlashRef={landingFlashRef}
            pickingSuspendedRef={orbitPickingSuspendedRef}
            cameraMotionActiveRef={cameraMotionActiveRef}
            overlay={galaxyOverlay}
          />

          {/* Scene half of the local node's self probe. It sits beside
              CellGalaxy rather than inside its `overlay` slot: that slot lives
              within the canopy's rotating, CELLS_Y-lifted group, while the
              labeled CkbNodeAnchor is drawn in plain world space outside it.
              Untransformed here is EXACTLY the anchor's own frame, so the same
              chainNodeWorldPosition lands the tether on the icosahedron and
              keeps it there while the canopy turns. */}
          {selectedNode && selectedNodeAnchor ? (
            <NodeInspectionAnchor
              key={selectedNode.id}
              position={selectedNodeAnchor}
              handles={nodeInspectionHandles}
            />
          ) : null}

          {/* The P2P colony: a broad inferred glow-node cloud + gossamer glow-line
              mesh, the bright measured glow-nodes set within it (one confidence
              gradient; the local node is the galaxy's labeled anchor, not drawn
              here). Each block sends a courier cascade through the mesh
              (colonyFlood tree); each measured peer and the local anchor weave a
              protocol carrier into the Cell field as the front reaches it. */}
          <NetworkColony
            topology={topology}
            cf={cf}
            blockPulseAtMs={cellsCache.lastPulseAtMs}
            backfillActive={!!cellsCache.backfill}
            selectedId={selectedNetId}
            onSelect={handleSelect}
            landingFlashRef={landingFlashRef}
            localVersion={localNode?.version ?? ''}
            producersRef={producerSharesRef}
            cellDetailViewFocusRef={cellDetailViewFocusRef}
            overlay={colonyOverlay}
          />

          {/* Opening or switching Cell detail is camera-passive. Only explicit
              memory recall / route-lock state may drive this controller; the
              unfiltered readout also keeps an active frame stable while the
              user inspects a different Cell. */}
          <ConsensusRouteCamera
            focus={memoryRouteHopLock}
            controlsRef={orbitControlsRef}
            manualRevision={orbitInteractionRevision}
            automationActiveRef={cameraAutomationActiveRef}
            recordIdentity={memoryRecordIdentity}
            recordTargetCellId={memoryTraceRequest?.targetCellId ?? null}
            recordTraceReadout={memoryTraceReadout}
          />

          <OrbitControls
            ref={orbitControlsRef}
            enabled={!cellScanInteractionActive}
            // The damping TAIL is motion the hand did not ask for: the camera
            // keeps gliding for a second or two after the pointer lets go
            // (~100–130 frames at 0.08). Under reduced motion the camera stops
            // where the hand stopped — the drag itself is still a drag,
            // because a gesture is the visitor's own motion and this policy is
            // about the ones that are not (D-11).
            enableDamping={!reducedMotion}
            dampingFactor={0.08}
            minDistance={4}
            maxDistance={400}
            // Dolly toward the Cell canopy, the scene's primary inspection
            // surface. The peer plane remains visible below in the overview.
            //
            // The controls and camera start from the same measured frame.
            target={initialCamera.target}
            onStart={beginOrbitInteraction}
            onChange={changeOrbitInteraction}
            onEnd={endOrbitInteraction}
          />
          <CameraFraming
            frame={cameraFrame}
            controlsRef={orbitControlsRef}
            gestureRef={orbitGestureRef}
            automationActiveRef={cameraAutomationActiveRef}
            manualRevision={orbitInteractionRevision}
          />
          {/* Last in the Canvas on purpose: its frame verdict has to follow
              the route camera's step and the controls' update above. */}
          <CameraMotionSentinel
            gestureRef={orbitGestureRef}
            automationActiveRef={cameraAutomationActiveRef}
            pickingSuspendedRef={orbitPickingSuspendedRef}
            motionActiveRef={cameraMotionActiveRef}
          />
          {/* Marks the ~1.5 s after a block lands so the adaptive sampler drops
              the block's main-thread burst; keys its clock on `lastPulseAtMs`. */}
          <BlockWindowSentinel
            lastPulseAtMs={cellsCache.lastPulseAtMs}
            recentBlockActiveRef={recentBlockActiveRef}
          />
        </Canvas> : null}
      </CellGalaxyProvider>

      {/* DOM half of the Cell inspector — a Canvas sibling, positioned each
          frame by the CellInspectionAnchor inside the Galaxy overlay. */}
      {selectedCell ? (
        <CellInspectionOverlay
          /* NO `key`. A cell → cell switch re-dresses this card in place
             instead of unmounting it: the dossier is built to take a new
             subject (its scan clock re-primes on `cell.id`, its selected facet
             is keyed by it), and the remount was what made a switch blink the
             old card out, replay every enter and let the solver drop the card
             on the other side of the anchor between two adjacent selections
             (report E, E-5). The placement lock's hysteresis keeps the held
             side whenever the new anchor still fits it. */
          handles={cellInspectionHandles}
          leaving={cellLeaving}
          cell={selectedCell}
          routeCellById={cellsCache.cells}
          recentLinks={cellsCache.recentLinks}
          causalLens={selectedCausalLens}
          causalNavigation={selectedCausalNavigation}
          tracedWriteSeq={cellMemoryRecallWriteSeqForTarget(
            memoryTraceRequest,
            selectedCell.id,
          )}
          traceSource={selectedOriginTrace?.sourceKind ?? 'none'}
          traceReadout={selectedMemoryTraceReadout}
          traceResponseRef={memoryTraceTargetResponseRef}
          traceEvidenceFocusSourceId={memoryEvidenceFocusSourceId}
          traceEvidencePreviewSourceId={memoryAgreementPreviewSourceId}
          onTraceEvidenceFocusChange={focusMemoryTraceEvidence}
          traceRouteHopFocus={memoryRouteHopFocus}
          onTraceRouteHopFocusChange={focusMemoryTraceRouteHop}
          traceRouteHopLock={memoryRouteHopLock}
          onTraceRouteHopLockChange={lockMemoryTraceRouteHop}
          identityProofBinding={cellIdentityProofBinding}
          onTraceWrite={selectedOriginTraceable
            ? recallSelectedCellOrigin
            : undefined}
          onIdentityProofRead={confirmCellIdentityProof}
          semanticSource={enrichmentConfig.enabled
            ? semanticsCache.source
            : undefined}
          semanticPhase={enrichmentConfig.enabled
            ? selectedCellSemanticsPhase
            : undefined}
          semanticRecord={selectedCellSemantics}
          semanticMessage={selectedSemanticsLookup.message}
          semanticTransactionPhase={transactionSemanticsEnabled
            ? selectedTransactionSemanticsPhase
            : undefined}
          semanticTransactionRecord={selectedTransactionSemantics}
          semanticTransactionMessage={selectedTransactionLookup.message}
          onScanInteractionChange={setCellScanInteractionActive}
          onClose={clearCellSelection}
        />
      ) : null}

      {/* DOM half of the peer link probe — the same chassis in its own
          dialect, positioned each frame by the anchor inside the colony. */}
      {inspectedPeer && inspectedPeerAnchor ? (
        <PeerInspectionOverlay
          key={inspectedPeer.node_id}
          handles={peerInspectionHandles}
          peer={inspectedPeer}
          tip={chain.tip}
          localVersion={localNode?.version ?? ''}
          hostedNodeLabel={hostedNodeLabel}
          linkLost={peerInspection.linkLost}
          sighting={inspectedNetSighting}
          candidacy={inspectedPeerCandidacy}
          leaving={netLeaving}
          onClose={clearNetSelection}
        />
      ) : null}

      {/* DOM half of the sighted probe — the shortest dialect on the same
          chassis, for a node we can name and have never spoken to. No
          retention epilogue: nothing is linked, so nothing can be lost; the
          selection either follows the node into the live dialect or ends. */}
      {selectedSighted && selectedSightedAnchor ? (
        <SightedInspectionOverlay
          key={selectedSighted.node_id}
          handles={sightedInspectionHandles}
          node={selectedSighted}
          sighting={inspectedNetSighting}
          candidacy={selectedSightedCandidacy}
          leaving={netLeaving}
          onClose={clearNetSelection}
        />
      ) : null}

      {/* DOM half of the miner probe — the shortest dialect on the same
          chassis, for a subject the chain proves exists and nobody has ever
          addressed. No dossier under it: the crawler indexes nodes by peer id
          and this subject has none, so there is nothing to ask about. No
          retention epilogue and no promotion: a producer leaves the window and
          the selection ends. */}
      {selectedMiner && selectedMinerAnchor ? (
        <MinerInspectionOverlay
          key={selectedMiner.producer.key}
          handles={minerInspectionHandles}
          subject={selectedMiner}
          leaving={netLeaving}
          onClose={clearNetSelection}
        />
      ) : null}

      {/* DOM half of the local node's self probe — the last detail card to
          leave the rail. No retention epilogue: the local node cannot churn
          out of the list the way a peer link can. */}
      {selectedNode && selectedNodeAnchor ? (
        <NodeInspectionOverlay
          key={selectedNode.id}
          handles={nodeInspectionHandles}
          node={selectedNode}
          hostedNodeLabel={hostedNodeLabel}
          chain={chain}
          peers={peers}
          sighting={inspectedNetSighting}
          leaving={netLeaving}
          onClose={clearNetSelection}
        />
      ) : null}
    </>
  );
}
