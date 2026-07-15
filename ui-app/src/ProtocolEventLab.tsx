import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
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
  SimClockTicker,
  TweakSync,
  chainNodeWorldPosition,
  colonyFlood,
  consensusBlockColor,
  inferredTopology,
  useQualityRuntime,
} from '@cknerv/ui';
import Tweaks from './Tweaks';
import { hasQuerySwitch, resolveCanvasDpr } from './render-quality';
import {
  advanceProtocolEventLab,
  protocolEventLabSnapshot,
  protocolEventStage,
  type ProtocolEventStage,
} from './protocol-event-lab-state';

const EVENT_PERIOD_MS = 8_000;
const EVENT_SEED = 0x5053494f;
const REVIEW_LOCAL_DELAY_S = 0.6;
const REVIEW_NODE_IDS = ['ckb:local', 'ckb:observer'] as const;

const STAGE_META: Record<ProtocolEventStage, { code: string; name: string; cjk: string }> = {
  network: { code: '00', name: 'NETWORK AGREEMENT', cjk: '网络共识' },
  carrier: { code: '01', name: 'WOVEN CARRIER', cjk: '编织载体' },
  commit: { code: '02', name: 'FIELD COMMIT', cjk: '场写入' },
  settled: { code: '03', name: 'CONSENSUS MEMORY', cjk: '共识记忆' },
};

function colorCss(color: readonly [number, number, number]): string {
  return `rgb(${color.map((channel) => Math.round(channel * 255)).join(' ')})`;
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
  // Historical links are a real template library, not boot-time animation.
  // Each review cycle injects exactly one of them below.
  const [cache, setCache] = useState(() => fromCellsSnapshot(1, {
    ...fieldSnapshot,
    recent_links: [],
  }));
  const [firedAt, setFiredAt] = useState(0);
  const [serial, setSerial] = useState(0);
  const [elapsedS, setElapsedS] = useState(99);
  const cellFlashRef = useRef<Map<number, number>>(new Map());
  const flashDirtyRef = useRef(false);
  const burstArrivalRef = useRef<
    Map<number, { firedAt: number; color: [number, number, number] }>
  >(new Map());

  useEffect(() => {
    let interval = 0;
    const fire = () => {
      const nonce = Date.now();
      // Active seals own their slots after arrival, so clearing this handoff
      // map safely makes the HUD count describe only the current event.
      burstArrivalRef.current.clear();
      setCache((current) => advanceProtocolEventLab(current, nonce, observedTemplates));
      setFiredAt(performance.now());
      setSerial((current) => current + 1);
    };
    const kickoff = window.setTimeout(() => {
      fire();
      interval = window.setInterval(fire, EVENT_PERIOD_MS);
    }, 700);
    return () => {
      window.clearTimeout(kickoff);
      if (interval) window.clearInterval(interval);
    };
  }, [observedTemplates]);

  useEffect(() => {
    const update = () => setElapsedS(
      firedAt > 0 ? Math.max(0, (performance.now() - firedAt) / 1000) : 99,
    );
    update();
    const interval = window.setInterval(update, 100);
    return () => window.clearInterval(interval);
  }, [firedAt]);

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

  if (fieldSnapshot.cells.length === 0) {
    return <pre style={{ color: '#f88', padding: 20 }}>No Cell data available.</pre>;
  }

  return (
    <main style={{
      position: 'fixed',
      inset: 0,
      overflow: 'hidden',
      background: '#02030a',
      color: '#dbeafe',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>
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
          REAL CELLS · OBSERVED LINKS · PRODUCTION MATERIALS · 8S REVIEW LOOP
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
        pointerEvents: 'none',
      }}>
        {(Object.keys(STAGE_META) as ProtocolEventStage[]).map((key) => {
          const active = key === stage;
          return (
            <div key={key} style={{
              minWidth: 126,
              padding: '8px 10px',
              borderTop: `1px solid ${active ? carrierCss : 'rgba(125,211,252,0.13)'}`,
              background: active ? 'rgba(12, 18, 38, 0.72)' : 'rgba(2, 5, 14, 0.48)',
              opacity: active ? 1 : 0.42,
            }}>
              <div style={{ color: active ? carrierCss : '#708198', fontSize: 8, letterSpacing: '0.12em' }}>
                {STAGE_META[key].code} {STAGE_META[key].name}
              </div>
              <div style={{ marginTop: 3, color: '#718096', fontSize: 8 }}>{STAGE_META[key].cjk}</div>
            </div>
          );
        })}
      </nav>

      <CellGalaxyProvider value={cache}>
        <Canvas
          camera={{ position: [76, 70, 76], fov: 46, near: 0.5, far: 1200 }}
          gl={{ antialias: true, alpha: false }}
          dpr={canvasDpr}
          style={{ background: '#02030a' }}
        >
          <SimClockTicker />
          {adaptiveQuality ? <AdaptiveQualityController /> : null}
          <TweakSync />
          {showRenderStats ? <RenderStatsSampler forceEnabled /> : null}
          <Stars
            radius={250}
            depth={90}
            count={starsCount}
            factor={1.7}
            saturation={0}
            fade
            speed={0.22}
          />
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
            enableDamping
            dampingFactor={0.08}
            minDistance={18}
            maxDistance={190}
            target={[0, CELLS_Y - 8, 0]}
          />
        </Canvas>
      </CellGalaxyProvider>
    </main>
  );
}
