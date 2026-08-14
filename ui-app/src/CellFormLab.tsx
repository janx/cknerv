import { useCallback, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import type { Cell, CellGalaxySnapshot } from '@cknerv/types';
import { fromCellsSnapshot } from '@cknerv/cache';
import {
  CELL_CORE_DIRECTIONS,
  CONSENSUS_BRAID_FIELDS,
  CELLS_Y,
  CellDetailPanel,
  CellGalaxy,
  CellGalaxyProvider,
  CellNucleusPortrait,
  ConsensusWriteSeal,
  NeuralNetwork,
  QUALITY_PRESETS,
  RenderStatsPanel,
  RenderStatsSampler,
  SimClockTicker,
  TweakSync,
  useQualityRuntime,
  type CellCoreDirection,
  type ConsensusBraidField,
} from '@cknerv/ui';
import Tweaks from './Tweaks';
import { selectInitialLabCell } from './cell-form-lab-selection';
import { resolveCanvasDpr } from './render-quality';

const SAMPLE_ASSETS = ['native', 'sudt', 'xudt', 'dao', 'spore', 'other'] as const;
const FIELD_COUNT = 260;
const SCHEMA_LABEL: Record<(typeof SAMPLE_ASSETS)[number], string> = {
  native: 'PHOTONIC MONAD',
  sudt: 'TOKEN CHOIR',
  xudt: 'EXTENDED CHOIR',
  dao: 'TEMPORAL LATTICE',
  spore: 'RECURSIVE FIELD',
  other: 'UNRESOLVED RELIC',
};

const DIRECTION_ENCODING: Record<CellCoreDirection, string> = {
  relic: 'ASSET→FREQUENCY · LOCK→STRANDS · DATA→AGREEMENTS',
  loom: 'ASSET→ORBIT · LOCK→BANDS · DATA→SCRIPT CLUSTERS',
  synthesis: 'ASSET→WEAVE · LOCK→RAILS · DATA→SIGNED CROSSINGS',
};

function initialCoreDirection(): CellCoreDirection {
  const requested = new URLSearchParams(window.location.search).get('direction');
  return CELL_CORE_DIRECTIONS.some((item) => item.id === requested)
    ? requested as CellCoreDirection
    : 'relic';
}

export default function CellFormLab({ snapshot }: { snapshot: CellGalaxySnapshot }) {
  const query = new URLSearchParams(window.location.search);
  const { effective: quality } = useQualityRuntime();
  const qualityCascade = QUALITY_PRESETS[quality];
  const canvasDpr = resolveCanvasDpr(
    window.devicePixelRatio,
    qualityCascade.maxDpr,
  );
  const compareMode = query.get('compare') === '1';
  const comparisonMoving = query.get('motion') === '1';
  const lodMode = query.get('lod') === '1';
  const focusMode = query.get('focus') === '1';
  const panelMode = query.get('panel') === '1';
  const requestedField = query.get('field');
  const semanticFocus = CONSENSUS_BRAID_FIELDS.includes(
    requestedField as ConsensusBraidField,
  )
    ? requestedField as ConsensusBraidField
    : null;
  const initialCell = selectInitialLabCell(snapshot, window.location.search);
  const [selectedId, setSelectedId] = useState<number | null>(() => initialCell?.id ?? null);
  const [direction, setDirection] = useState<CellCoreDirection>(initialCoreDirection);
  const selected = snapshot.cells.find((cell) => cell.id === selectedId) ?? initialCell;
  const selectedKind = (selected?.asset_kind ?? 'other') as (typeof SAMPLE_ASSETS)[number];
  const directionMeta = CELL_CORE_DIRECTIONS.find((item) => item.id === direction)
    ?? CELL_CORE_DIRECTIONS[0];
  const fieldCells = useMemo(() => {
    const recent = snapshot.cells.slice(-FIELD_COUNT);
    if (!selected || recent.some((cell) => cell.id === selected.id)) return recent;
    return [...recent.slice(1), selected];
  }, [snapshot.cells, selected]);
  const fieldSnapshot = useMemo<CellGalaxySnapshot>(() => ({
    ...snapshot,
    cells: fieldCells,
    recent_links: (snapshot.recent_links ?? []).filter((link) => {
      const ids = new Set(fieldCells.map((cell) => cell.id));
      return link.from_ids.some((id) => ids.has(id)) || link.to_ids.some((id) => ids.has(id));
    }),
  }), [snapshot, fieldCells]);
  const cache = useMemo(() => fromCellsSnapshot(1, fieldSnapshot), [fieldSnapshot]);
  const cellFlashRef = useRef<Map<number, number>>(new Map());
  const flashDirtyRef = useRef(false);
  const flashDirtyIdsRef = useRef<Set<number>>(new Set());
  const burstArrivalRef = useRef<Map<number, { firedAt: number; color: [number, number, number] }>>(new Map());
  const handleSelect = useCallback((id: string | null) => {
    if (!id?.startsWith('cell:')) return;
    const numeric = Number(id.slice('cell:'.length));
    if (Number.isFinite(numeric)) setSelectedId(numeric);
  }, []);

  if (!selected) {
    return <pre style={{ color: '#f88', padding: 20 }}>No Cell data available.</pre>;
  }

  const selectedWorldY = CELLS_Y + selected.pos_seed[1];
  const galaxyCamera: [number, number, number] = lodMode
    ? [selected.pos_seed[0], selectedWorldY + 0.65, selected.pos_seed[2] + 2.8]
    : focusMode
      ? [selected.pos_seed[0], selectedWorldY + 4, selected.pos_seed[2] + 48]
    : [20, 52, 24];
  const galaxyTarget: [number, number, number] = lodMode || focusMode
    ? [selected.pos_seed[0], selectedWorldY, selected.pos_seed[2]]
    : [0, CELLS_Y, 0];

  if (compareMode) {
    return (
      <main style={{
        position: 'fixed',
        inset: 0,
        boxSizing: 'border-box',
        padding: '14px 16px 16px',
        overflow: 'hidden',
        background: 'radial-gradient(circle at 50% 42%, #0a0b1d 0%, #03040d 48%, #010207 100%)',
        color: '#dbeafe',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>
        <Tweaks />
        <header style={{
          height: 54,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 24,
          padding: '1px 2px 10px',
          borderBottom: '1px solid rgba(125, 211, 252, 0.13)',
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.22em', color: '#7dd3fc' }}>
              CONSENSUS CELL / A · C · A+C
            </div>
            <div style={{ marginTop: 5, fontSize: 9, color: '#64748b', letterSpacing: '0.08em' }}>
              SAME REAL CELL · SAME CAMERA · {comparisonMoving ? 'MOTION' : 'HASH-STABLE STATIC'}
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 8, lineHeight: 1.55, color: '#718096' }}>
            <div style={{ color: '#8ba3b8' }}>
              #{selected.id} · {(selected.asset_kind ?? 'other').toUpperCase()} · {(selected.lock_kind ?? 'other').toUpperCase()}
            </div>
            <div>
              {(selected.capacity / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 })} CKB · {selected.content_hash.slice(0, 16)}…
            </div>
          </div>
        </header>

        <section style={{
          height: 'calc(100% - 54px)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gridTemplateRows: 'minmax(0, 1fr)',
          gap: 10,
          paddingTop: 10,
          boxSizing: 'border-box',
        }}>
          {CELL_CORE_DIRECTIONS.map((item) => (
            <article
              key={item.id}
              style={{
                minWidth: 0,
                minHeight: 0,
                position: 'relative',
                overflow: 'hidden',
                border: '1px solid rgba(125, 211, 252, 0.14)',
                background: 'radial-gradient(circle at 50% 52%, rgba(63, 54, 137, 0.09), rgba(4, 7, 18, 0.8) 54%, rgba(2, 3, 10, 0.96))',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.018)',
              }}
            >
              <div style={{
                position: 'absolute',
                zIndex: 2,
                left: 10,
                right: 10,
                top: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                pointerEvents: 'none',
              }}>
                <span style={{ fontSize: 10, letterSpacing: '0.15em', color: '#7dd3fc' }}>
                  {item.code} / {item.name}
                </span>
              </div>

              <div style={{
                position: 'absolute',
                inset: '32px 0 30px',
                display: 'grid',
                placeItems: 'center',
              }}>
                <div style={{ width: 'min(100%, calc(100vh - 120px))', aspectRatio: '1 / 1' }}>
                  <CellNucleusPortrait
                    cell={selected}
                    direction={item.id}
                    reducedMotion={!comparisonMoving}
                    scanEpochMs={0}
                    standalone
                  />
                </div>
              </div>

              <div style={{
                position: 'absolute',
                zIndex: 2,
                left: 10,
                right: 10,
                bottom: 7,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                pointerEvents: 'none',
                fontSize: 7,
                letterSpacing: '0.07em',
                color: '#56667b',
              }}>
                <span>{item.character.toUpperCase()}</span>
                <span style={{ textAlign: 'right' }}>{DIRECTION_ENCODING[item.id]}</span>
              </div>
            </article>
          ))}
        </section>
      </main>
    );
  }

  return (
    <div
      data-cell-form-quality={quality}
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#02030a', color: '#dbeafe' }}
    >
      <Tweaks />
      <RenderStatsPanel />
      <div style={{ position: 'absolute', left: 18, top: 15, zIndex: 5, pointerEvents: 'none' }}>
        <div style={{ font: '600 12px "JetBrains Mono", monospace', letterSpacing: '0.22em', color: '#7dd3fc' }}>
          CONSENSUS CELL / CODE MOCKUP
        </div>
        <div style={{ marginTop: 5, font: '11px "JetBrains Mono", monospace', color: '#718096' }}>
          {panelMode
            ? 'one real Cell · production A · readable consensus grammar'
            : lodMode
            ? 'one real Cell · production A · far / braid / agreement LOD'
            : focusMode
              ? `one real Cell · production A · ${semanticFocus ?? 'selected'} field handoff`
            : 'one real Cell · refined A · refined C · A+C synthesis'}
        </div>
      </div>

      <div style={{ position: 'absolute', inset: '0 39% 0 0', borderRight: '1px solid rgba(125,211,252,0.16)' }}>
        <CellGalaxyProvider value={cache}>
          <Canvas
            camera={{ position: galaxyCamera, fov: 44, near: 0.1, far: 1000 }}
            gl={{ antialias: true, alpha: false }}
            dpr={canvasDpr}
            style={{ background: '#02030a' }}
            onPointerMissed={() => undefined}
          >
            <SimClockTicker />
            <TweakSync />
            <RenderStatsSampler />
            <Stars
              radius={180}
              depth={70}
              count={Math.max(
                45,
                Math.round(
                  450
                    * qualityCascade.starsCount
                    / QUALITY_PRESETS.high.starsCount,
                ),
              )}
              factor={1.5}
              saturation={0}
              fade
              speed={0.2}
            />
            <CellGalaxy
              ckbNodeIds={['ckb:local']}
              universeSeed={0x434b42}
              selectedId={null}
              selectedCellId={`cell:${selected.id}`}
              onSelect={handleSelect}
              cellFlashRef={cellFlashRef}
              flashDirtyRef={flashDirtyRef}
              flashDirtyIdsRef={flashDirtyIdsRef}
              overlay={(
                <>
                  <NeuralNetwork
                    cellFlashRef={cellFlashRef}
                    flashDirtyRef={flashDirtyRef}
                    flashDirtyIdsRef={flashDirtyIdsRef}
                    burstArrivalRef={burstArrivalRef}
                    topology={{ neighborK: 3, maxEdgeLength: 28, maxHops: 24 }}
                    pulses={{ maxActivePulses: 32, maxPulsesPerLink: 2, maxSourcesPerParent: 1 }}
                  />
                  <ConsensusWriteSeal arrivalRef={burstArrivalRef} />
                </>
              )}
            />
            <OrbitControls
              enableDamping
              dampingFactor={0.08}
              minDistance={2.5}
              maxDistance={120}
              target={galaxyTarget}
            />
          </Canvas>
        </CellGalaxyProvider>
      </div>

      <aside style={{
        position: 'absolute',
        inset: '0 0 0 61%',
        padding: '54px 22px 18px',
        boxSizing: 'border-box',
        background: 'radial-gradient(circle at 52% 34%, rgba(85, 67, 170, 0.085), rgba(4, 7, 18, 0) 48%)',
      }}>
        {panelMode ? (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            <CellDetailPanel
              cell={selected}
              onClose={() => undefined}
              portraitStandalone
              style={{ position: 'relative' }}
            />
          </div>
        ) : (
          <>
            <div style={{ height: 'calc(100% - 154px)', minHeight: 340, position: 'relative' }}>
              <CellNucleusPortrait
                cell={selected}
                direction={direction}
                reducedMotion={false}
                scanEpochMs={performance.now()}
                focusField={semanticFocus}
                standalone
              />
              <div style={{ position: 'absolute', left: 10, bottom: 8, pointerEvents: 'none', font: '10px "JetBrains Mono", monospace', color: '#8ba3b8', lineHeight: 1.65 }}>
                <div style={{ color: '#a78bfa', letterSpacing: '0.16em' }}>{selectedKind.toUpperCase()}</div>
                <div style={{ color: '#7dd3fc' }}>DIR {directionMeta.code} / {directionMeta.name}</div>
                {semanticFocus ? <div>FOCUS {semanticFocus.toUpperCase()}</div> : null}
                <div>SCHEMA {SCHEMA_LABEL[selectedKind]}</div>
                <div>LOCK {selected.lock_kind ?? 'other'}</div>
                <div>CAP {(selected.capacity / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 })} CKB</div>
                <div>HASH {selected.content_hash.slice(0, 12)}…</div>
              </div>
            </div>

            <div style={{ height: 132, display: 'grid', gridTemplateColumns: `repeat(${CELL_CORE_DIRECTIONS.length}, 1fr)`, gap: 8, marginTop: 8 }}>
              {CELL_CORE_DIRECTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDirection(item.id)}
                  style={{
                    padding: 0,
                    position: 'relative',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    background: '#040713',
                    border: item.id === direction ? '1px solid #7dd3fc' : '1px solid rgba(125,211,252,0.16)',
                    opacity: item.id === direction ? 1 : 0.72,
                  }}
                >
                  <CellNucleusPortrait
                    cell={selected}
                    direction={item.id}
                    reducedMotion
                    scanEpochMs={0}
                    standalone
                  />
                  <span style={{ position: 'absolute', left: 6, bottom: 5, textAlign: 'left', font: '7px "JetBrains Mono", monospace', letterSpacing: '0.08em', color: item.id === direction ? '#7dd3fc' : '#64748b', pointerEvents: 'none', lineHeight: 1.45 }}>
                    {item.code} / {item.name}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
