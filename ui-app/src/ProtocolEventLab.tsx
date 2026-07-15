import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CellGalaxySnapshot } from '@cknerv/types';
import { fromCellsSnapshot } from '@cknerv/cache';
import {
  AdaptiveQualityController,
  CELLS_Y,
  CellGalaxy,
  CellGalaxyProvider,
  ConsensusWriteSeal,
  NetworkColony,
  NeuralNetwork,
  QUALITY_PRESETS,
  RenderStatsPanel,
  RenderStatsSampler,
  createSimClock,
  SimClockScope,
  SimClockTicker,
  TweakSync,
  chainNodeWorldPosition,
  colonyFlood,
  consensusBlockColor,
  inferredTopology,
  useQualityRuntime,
  type MutableSimClock,
} from '@cknerv/ui';
import Tweaks from './Tweaks';
import { hasQuerySwitch, resolveCanvasDpr } from './render-quality';
import {
  advanceProtocolEventLab,
  PROTOCOL_EVENT_REVIEW_PERIOD_S,
  PROTOCOL_EVENT_STAGE_TIME_S,
  protocolEventLabSnapshot,
  protocolEventReviewNonce,
  protocolEventReviewTarget,
  protocolEventStage,
  type ProtocolEventStage,
} from './protocol-event-lab-state';

const EVENT_SEED = 0x5053494f;
const REVIEW_LOCAL_DELAY_S = 0.6;
const REVIEW_NODE_IDS = ['ckb:local', 'ckb:observer'] as const;
const REVIEW_SEEK_TIME_SCALE = 4;
const REVIEW_FIXED_FRAME_S = 1 / 60;
const REVIEW_SETTLE_FRAMES = 2;

type ReviewClockMode =
  | 'arming'
  | 'priming'
  | 'playing'
  | 'seeking'
  | 'settling'
  | 'paused';

const STAGE_META: Record<ProtocolEventStage, { code: string; name: string; cjk: string }> = {
  network: { code: '00', name: 'NETWORK AGREEMENT', cjk: '网络共识' },
  carrier: { code: '01', name: 'WOVEN CARRIER', cjk: '编织载体' },
  commit: { code: '02', name: 'FIELD COMMIT', cjk: '场写入' },
  settled: { code: '03', name: 'CONSENSUS MEMORY', cjk: '共识记忆' },
};

function colorCss(color: readonly [number, number, number]): string {
  return `rgb(${color.map((channel) => Math.round(channel * 255)).join(' ')})`;
}

function replaceReviewLocation(value: { stage?: ProtocolEventStage; at?: number } | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete('stage');
  url.searchParams.delete('at');
  if (value?.stage) url.searchParams.set('stage', value.stage);
  else if (value?.at !== undefined) url.searchParams.set('at', value.at.toFixed(2));
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function DeterministicReviewStars({ count }: { count: number }) {
  const geometry = useMemo(() => {
    const random = seededRandom(EVENT_SEED);
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const radius = 140 + random() * 170;
      const z = random() * 2 - 1;
      const theta = random() * Math.PI * 2;
      const radial = Math.sqrt(1 - z * z);
      positions[index * 3] = radius * radial * Math.cos(theta);
      positions[index * 3 + 1] = radius * z;
      positions[index * 3 + 2] = radius * radial * Math.sin(theta);
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return next;
  }, [count]);
  const material = useMemo(() => new THREE.PointsMaterial({
    color: '#91a8c8',
    size: 0.72,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    toneMapped: false,
  }), []);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

function ProtocolReviewClock({
  clock,
  mode,
  targetS,
  onBaselineReady,
  onPrimed,
  onElapsed,
  onTargetReached,
  onSettled,
  onCycle,
}: {
  clock: MutableSimClock;
  mode: ReviewClockMode;
  targetS: number | null;
  onBaselineReady: () => void;
  onPrimed: () => void;
  onElapsed: (elapsedS: number) => void;
  onTargetReached: (elapsedS: number) => void;
  onSettled: (elapsedS: number) => void;
  onCycle: () => void;
}) {
  const lastPublished = useRef(-1);
  const boundaryHandled = useRef(false);
  const settleFrames = useRef(0);

  // Wait one browser frame after the pulse=0 scene mounts. This gives every
  // child a chance to establish its bootstrap cursors before the event arrives.
  useEffect(() => {
    if (mode !== 'arming' || boundaryHandled.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (boundaryHandled.current) return;
      boundaryHandled.current = true;
      onBaselineReady();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode, onBaselineReady]);

  useEffect(() => {
    boundaryHandled.current = false;
    settleFrames.current = 0;
  }, [mode, targetS]);

  useFrame(() => {
    const elapsed = Math.max(0, clock.elapsedSec);
    if (mode === 'priming' && !boundaryHandled.current) {
      boundaryHandled.current = true;
      onPrimed();
    } else if (mode === 'seeking' && targetS !== null && elapsed >= targetS) {
      if (!boundaryHandled.current) {
        boundaryHandled.current = true;
        onTargetReached(targetS);
      }
    } else if (mode === 'settling') {
      settleFrames.current += 1;
      if (settleFrames.current >= REVIEW_SETTLE_FRAMES && !boundaryHandled.current) {
        boundaryHandled.current = true;
        onSettled(elapsed);
      }
    } else if (mode === 'playing' && elapsed >= PROTOCOL_EVENT_REVIEW_PERIOD_S) {
      if (!boundaryHandled.current) {
        boundaryHandled.current = true;
        onCycle();
      }
    }

    if (
      lastPublished.current < 0
      || Math.abs(elapsed - lastPublished.current) >= 0.08
      || mode === 'paused'
    ) {
      lastPublished.current = elapsed;
      onElapsed(elapsed);
    }
  });
  return null;
}

export default function ProtocolEventLab({ snapshot }: { snapshot: CellGalaxySnapshot }) {
  const showRenderStats = useMemo(
    () => hasQuerySwitch(window.location.search, 'render-stats'),
    [],
  );
  const adaptiveQuality = useMemo(
    () => hasQuerySwitch(window.location.search, 'adaptive-quality'),
    [],
  );
  const { effective: effectiveQuality } = useQualityRuntime();
  const qualityCascade = QUALITY_PRESETS[adaptiveQuality ? effectiveQuality : 'high'];
  const canvasDpr = resolveCanvasDpr(window.devicePixelRatio, qualityCascade.maxDpr);
  const starsCount = Math.round(
    900 * (qualityCascade.starsCount / QUALITY_PRESETS.high.starsCount),
  );
  const fieldSnapshot = useMemo(() => protocolEventLabSnapshot(snapshot), [snapshot]);
  const observedTemplates = useMemo(
    () => fieldSnapshot.recent_links ?? [],
    [fieldSnapshot],
  );
  const initialTarget = useMemo(
    () => protocolEventReviewTarget(window.location.search),
    [],
  );
  const baseCache = useMemo(() => fromCellsSnapshot(1, {
    ...fieldSnapshot,
    recent_links: [],
  }), [fieldSnapshot]);
  // Historical links are a real template library, not boot-time animation.
  // Each deterministic review cycle injects exactly one of them below.
  const [cache, setCache] = useState(baseCache);
  const [serial, setSerial] = useState(0);
  const [sceneKey, setSceneKey] = useState(0);
  const [reviewClock, setReviewClock] = useState(() => createSimClock());
  const [elapsedS, setElapsedS] = useState(0);
  const [clockMode, setClockMode] = useState<ReviewClockMode>('paused');
  const [clockTargetS, setClockTargetS] = useState<number | null>(0);
  const [reviewReady, setReviewReady] = useState(false);
  const cellFlashRef = useRef<Map<number, number>>(new Map());
  const flashDirtyRef = useRef(false);
  const burstArrivalRef = useRef<
    Map<number, { firedAt: number; color: [number, number, number] }>
  >(new Map());
  const didStart = useRef(false);
  const modeAfterPrime = useRef<'playing' | 'seeking'>('playing');

  const startReview = useCallback((
    nextSerial: number,
    targetS: number | null,
    destination: 'playing' | 'seeking',
  ) => {
    const nextClock = createSimClock();
    cellFlashRef.current.clear();
    burstArrivalRef.current.clear();
    flashDirtyRef.current = false;
    modeAfterPrime.current = destination;
    setReviewClock(nextClock);
    setCache(baseCache);
    setSerial(nextSerial);
    setElapsedS(0);
    setClockTargetS(targetS);
    setReviewReady(false);
    setClockMode('arming');
    // A new generation starts from pulse=0. The event is injected only after
    // the imperative renderers have mounted and recorded that baseline.
    setSceneKey((current) => current + 1);
  }, [baseCache]);

  useEffect(() => {
    if (didStart.current) return;
    didStart.current = true;
    startReview(
      1,
      initialTarget,
      initialTarget === null ? 'playing' : 'seeking',
    );
  }, [initialTarget, startReview]);

  const handleBaselineReady = useCallback(() => {
    setCache(advanceProtocolEventLab(
      baseCache,
      protocolEventReviewNonce(serial),
      observedTemplates,
    ));
    setClockMode('priming');
  }, [baseCache, observedTemplates, serial]);

  const handlePrimed = useCallback(() => {
    setClockMode(modeAfterPrime.current);
  }, []);

  const handleTargetReached = useCallback((at: number) => {
    setElapsedS(at);
    setClockTargetS(at);
    setClockMode('settling');
  }, []);

  const handleSettled = useCallback((at: number) => {
    setElapsedS(at);
    setReviewReady(true);
    setClockMode('paused');
  }, []);

  const handleCycle = useCallback(() => {
    replaceReviewLocation(null);
    startReview(serial + 1, null, 'playing');
  }, [serial, startReview]);

  const handleStageSeek = useCallback((stage: ProtocolEventStage) => {
    const at = PROTOCOL_EVENT_STAGE_TIME_S[stage];
    replaceReviewLocation({ stage });
    // Fixed URLs always replay block 01; otherwise the same URL would change
    // after an automatic cycle selected another observed link template.
    startReview(1, at, 'seeking');
  }, [startReview]);

  const handlePlaybackToggle = useCallback(() => {
    if (clockMode === 'paused') {
      replaceReviewLocation(null);
      setReviewReady(false);
      setClockTargetS(null);
      setClockMode('playing');
      return;
    }
    const at = Math.max(
      0,
      Math.min(PROTOCOL_EVENT_REVIEW_PERIOD_S - 0.05, reviewClock.elapsedSec),
    );
    replaceReviewLocation({ at });
    startReview(1, at, 'seeking');
  }, [clockMode, reviewClock, startReview]);

  const handleRestart = useCallback(() => {
    replaceReviewLocation(null);
    startReview(Math.max(1, serial), null, 'playing');
  }, [serial, startReview]);

  const topology = useMemo(() => {
    const local = chainNodeWorldPosition(0, REVIEW_NODE_IDS.length, EVENT_SEED);
    return inferredTopology([], EVENT_SEED, 'ckb:local', local);
  }, []);
  const flood = useMemo(
    () => colonyFlood(topology, cache.lastPulseAtMs),
    [topology, cache.lastPulseAtMs],
  );
  // Review-only clock normalization: production still uses latency-derived
  // arrival. Fixing the local handoff lets every 8 s loop expose the carrier
  // and landing seal at repeatable timestamps while reusing the same renderer.
  const reviewFlood = useMemo(() => ({
    ...flood,
    localReceiveDelayS: REVIEW_LOCAL_DELAY_S,
  }), [flood]);
  const localWorld = useMemo(
    () => topology.nodes.find((node) => node.kind === 'local')?.pos ?? null,
    [topology],
  );
  const entryWorld = useMemo(
    () => flood.entryId
      ? topology.nodes.find((node) => node.id === flood.entryId)?.pos ?? localWorld
      : localWorld,
    [flood.entryId, topology, localWorld],
  );
  const entryArrivalS = reviewFlood.entryId
    ? reviewFlood.colonyArrivalS[reviewFlood.entryId] ?? 0
    : reviewFlood.localReceiveDelayS;

  const stage = protocolEventStage(elapsedS);
  const carrier = consensusBlockColor(cache.lastPulseAtMs);
  const carrierCss = colorCss(carrier);
  const reviewTransitioning = clockMode === 'arming'
    || clockMode === 'priming'
    || clockMode === 'seeking'
    || clockMode === 'settling';
  const scopePaused = clockMode === 'arming' || clockMode === 'paused';
  const fixedDeltaSec = clockMode === 'seeking'
    ? REVIEW_FIXED_FRAME_S
    : clockMode === 'priming' || clockMode === 'settling'
      ? 0
      : null;

  if (fieldSnapshot.cells.length === 0) {
    return <pre style={{ color: '#f88', padding: 20 }}>No Cell data available.</pre>;
  }

  return (
    <main
      data-review-ready={reviewReady ? 'true' : 'false'}
      data-review-time={elapsedS.toFixed(2)}
      data-review-stage={stage}
      data-review-mode={clockMode}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: '#02030a',
        color: '#dbeafe',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}
    >
      <Tweaks />
      {showRenderStats ? <RenderStatsPanel forceVisible /> : null}
      <header style={{
        position: 'absolute',
        zIndex: 5,
        left: 22,
        top: 18,
        pointerEvents: 'none',
      }}>
        <div style={{
          color: '#f5c66c',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.24em',
          textShadow: '0 0 16px rgba(245,198,108,0.24)',
        }}>
          A / CONSENSUS PROTOCOL EVENT
        </div>
        <div style={{ marginTop: 6, color: '#64748b', fontSize: 9, letterSpacing: '0.1em' }}>
          REAL CELLS · OBSERVED LINKS · ISOLATED FIXED-STEP {clockMode.toUpperCase()} · CLICK A STAGE TO FREEZE
        </div>
      </header>

      <aside style={{
        position: 'absolute',
        zIndex: 5,
        right: 22,
        top: 18,
        minWidth: 230,
        padding: '12px 14px',
        boxSizing: 'border-box',
        border: `1px solid ${carrierCss}`,
        background: 'rgba(2, 5, 14, 0.78)',
        boxShadow: `inset 0 0 24px color-mix(in srgb, ${carrierCss} 8%, transparent)`,
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
          <span style={{ color: carrierCss, fontSize: 10, letterSpacing: '0.16em' }}>
            {STAGE_META[stage].code} / {STAGE_META[stage].name}
          </span>
          <span style={{ color: '#a78bfa', fontSize: 9 }}>{STAGE_META[stage].cjk}</span>
        </div>
        <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{
            width: 54,
            height: 1,
            background: carrierCss,
            boxShadow: `0 0 10px ${carrierCss}`,
          }} />
          <span style={{ color: '#64748b', fontSize: 8, letterSpacing: '0.1em' }}>
            BLOCK {String(serial).padStart(2, '0')} · {Math.min(elapsedS, 9.9).toFixed(1)}S · LINKS {String(observedTemplates.length).padStart(2, '0')} · WRITES {String(burstArrivalRef.current.size).padStart(2, '0')}
          </span>
        </div>
      </aside>

      <nav style={{
        position: 'absolute',
        zIndex: 5,
        left: 22,
        bottom: 18,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, auto)',
        gap: 8,
        pointerEvents: 'auto',
      }}>
        {(Object.keys(STAGE_META) as ProtocolEventStage[]).map((key) => {
          const active = key === stage;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active && reviewReady}
              onClick={() => handleStageSeek(key)}
              style={{
              minWidth: 126,
              padding: '8px 10px',
              border: 0,
              borderTop: `1px solid ${active ? carrierCss : 'rgba(125,211,252,0.13)'}`,
              background: active ? 'rgba(12, 18, 38, 0.72)' : 'rgba(2, 5, 14, 0.48)',
              opacity: active ? 1 : 0.42,
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}>
              <div style={{ color: active ? carrierCss : '#708198', fontSize: 8, letterSpacing: '0.12em' }}>
                {STAGE_META[key].code} {STAGE_META[key].name}
              </div>
              <div style={{ marginTop: 3, color: '#718096', fontSize: 8 }}>{STAGE_META[key].cjk}</div>
            </button>
          );
        })}
      </nav>

      <div style={{
        position: 'absolute',
        zIndex: 6,
        right: 22,
        bottom: 18,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 8,
        letterSpacing: '0.12em',
      }}>
        <span style={{ marginRight: 3, color: reviewReady ? carrierCss : '#64748b' }}>
          {clockMode === 'seeking' ? 'SEEK ×4' : clockMode.toUpperCase()}
        </span>
        <button
          type="button"
          onClick={handlePlaybackToggle}
          disabled={reviewTransitioning}
          style={{
            padding: '7px 10px',
            border: '1px solid rgba(125,211,252,0.24)',
            background: 'rgba(2,5,14,0.82)',
            color: '#7dd3fc',
            cursor: reviewTransitioning ? 'wait' : 'pointer',
            opacity: reviewTransitioning ? 0.42 : 1,
            font: 'inherit',
            letterSpacing: 'inherit',
          }}
        >
          {clockMode === 'paused' ? 'PLAY' : 'PAUSE'}
        </button>
        <button
          type="button"
          onClick={handleRestart}
          style={{
            padding: '7px 10px',
            border: '1px solid rgba(125,211,252,0.14)',
            background: 'rgba(2,5,14,0.72)',
            color: '#718096',
            cursor: 'pointer',
            font: 'inherit',
            letterSpacing: 'inherit',
          }}
        >
          RESTART
        </button>
      </div>

      {sceneKey > 0 ? <CellGalaxyProvider value={cache}>
        <Canvas
          key={sceneKey}
          camera={{ position: [76, 70, 76], fov: 46, near: 0.5, far: 1200 }}
          gl={{ antialias: true, alpha: false }}
          dpr={canvasDpr}
          frameloop={clockMode === 'paused' ? 'demand' : 'always'}
          style={{ background: '#02030a' }}
        >
          <SimClockScope
            clock={reviewClock}
            paused={scopePaused}
            timeScale={clockMode === 'seeking' ? REVIEW_SEEK_TIME_SCALE : 1}
            fixedDeltaSec={fixedDeltaSec}
            maxElapsedSec={clockMode === 'seeking' ? clockTargetS : null}
          >
            <SimClockTicker />
            <ProtocolReviewClock
              clock={reviewClock}
              mode={clockMode}
              targetS={clockTargetS}
              onBaselineReady={handleBaselineReady}
              onPrimed={handlePrimed}
              onElapsed={setElapsedS}
              onTargetReached={handleTargetReached}
              onSettled={handleSettled}
              onCycle={handleCycle}
            />
            {adaptiveQuality ? <AdaptiveQualityController /> : null}
            <TweakSync />
            {showRenderStats ? <RenderStatsSampler forceEnabled /> : null}
            <DeterministicReviewStars count={starsCount} />
            <CellGalaxy
              ckbNodeIds={[...REVIEW_NODE_IDS]}
              minerCkbNodeIds={['ckb:local']}
              universeSeed={EVENT_SEED}
              localReceiveDelayS={reviewFlood.localReceiveDelayS}
              entryWorld={entryWorld}
              entryArrivalS={entryArrivalS}
              selectedId={null}
              selectedCellId={null}
              onSelect={() => undefined}
              cellFlashRef={cellFlashRef}
              flashDirtyRef={flashDirtyRef}
              overlay={(
                <>
                  <NeuralNetwork
                    cellFlashRef={cellFlashRef}
                    flashDirtyRef={flashDirtyRef}
                    burstArrivalRef={burstArrivalRef}
                    topology={{ neighborK: 3, maxEdgeLength: 28, maxHops: 24 }}
                    pulses={{ maxActivePulses: 36, maxPulsesPerLink: 3, maxSourcesPerParent: 2 }}
                  />
                  <ConsensusWriteSeal arrivalRef={burstArrivalRef} />
                </>
              )}
            />
            <NetworkColony
              topology={topology}
              cf={reviewFlood}
              blockPulseAtMs={cache.lastPulseAtMs}
              selectedId={null}
              onSelect={() => undefined}
              cellFlashRef={cellFlashRef}
              flashDirtyRef={flashDirtyRef}
              localVersion=""
            />
            <OrbitControls
              enableDamping={clockMode === 'playing'}
              dampingFactor={0.08}
              minDistance={18}
              maxDistance={190}
              target={[0, CELLS_Y - 8, 0]}
            />
          </SimClockScope>
        </Canvas>
      </CellGalaxyProvider> : null}
    </main>
  );
}
