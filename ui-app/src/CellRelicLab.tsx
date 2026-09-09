import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { View } from '@react-three/drei';
import type { CellGalaxySnapshot } from '@cknerv/types';
import {
  ASSET_COLORS,
  BootViewSentinel,
  CellCoreArtwork,
  CellMorphologyLabArtwork,
  QUALITY_PRESETS,
  deriveCellMorphologyTopology,
  formatAssetKind,
  formatCkb,
  formatLockKind,
  morphologySignature,
  useQualityRuntime,
  type CellMorphologyLabMode,
} from '@cknerv/ui';
import Tweaks from './Tweaks';
import EmptyLabState from './EmptyLabState';
import { selectRelicSamples, type RelicSampleBasis } from './cell-relic-samples';
import {
  CONTROLLED_RELIC_CAMERAS,
  controlledRelicRows,
  type ControlledRelicAxis,
} from './cell-relic-controlled-samples';
import { selectInitialLabCell } from './cell-form-lab-selection';
import {
  cellRelicMemoryResponse,
  resolveCellRelicMemoryPose,
} from './cell-relic-memory-pose';
import { resolveCanvasDpr } from './render-quality';

const BASIS_COLOR: Record<RelicSampleBasis, string> = {
  asset: '#7dd3fc',
  lock: '#a78bfa',
  capacity: '#f8d477',
  data: '#67e8b5',
  hash: '#8294aa',
};

const AXIS_COLOR: Record<ControlledRelicAxis, string> = {
  type: '#7dd3fc',
  lock: '#c084fc',
  'data-content': '#67e8b5',
  'data-size': '#34d399',
  capacity: '#f8d477',
  collection: '#fb923c',
  fallback: '#fb7185',
};

function toggleHref(search: string, key: string, active: boolean): string {
  const params = new URLSearchParams(search);
  params.set(key, active ? '0' : '1');
  return `?${params.toString()}`;
}

function Toggle({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <a
      href={href}
      style={{
        color: active ? '#f8d477' : '#64748b',
        border: `1px solid ${active ? 'rgba(248,212,119,.42)' : 'rgba(100,116,139,.25)'}`,
        padding: '4px 7px',
        textDecoration: 'none',
        letterSpacing: '0.08em',
      }}
    >
      {label} {active ? 'ON' : 'OFF'}
    </a>
  );
}

export default function CellRelicLab({ snapshot }: { snapshot: CellGalaxySnapshot }) {
  const { effective: quality } = useQualityRuntime();
  const qualityCascade = QUALITY_PRESETS[quality];
  const canvasDpr = resolveCanvasDpr(window.devicePixelRatio, qualityCascade.maxDpr);
  const search = window.location.search;
  const params = new URLSearchParams(search);
  const controlled = params.get('controlled') !== '0';
  const moving = params.get('motion') === '1';
  const greyscale = params.get('greyscale') === '1';
  const structureOnly = params.get('structure') === '1';
  const memoryPose = resolveCellRelicMemoryPose(search);
  const morphologyMode: CellMorphologyLabMode = memoryPose === 'rest'
    ? (moving ? 'normal' : 'static')
    : 'resolved';

  const samples = useMemo(() => selectRelicSamples(snapshot), [snapshot]);
  const sourceCell = useMemo(
    () => selectInitialLabCell(snapshot, search),
    [search, snapshot],
  );
  const controlledMatrix = useMemo(() => {
    if (!sourceCell) return [];
    let viewIndex = 1;
    return controlledRelicRows(sourceCell).map((row) => ({
      ...row,
      tiles: row.variants.flatMap((sample) => {
        const topology = deriveCellMorphologyTopology(sample.cell);
        const signature = morphologySignature(topology);
        return CONTROLLED_RELIC_CAMERAS.map((camera) => ({
          sample,
          camera,
          topology,
          signature,
          viewIndex: viewIndex++,
        }));
      }),
    }));
  }, [sourceCell]);
  const memoryResponseRefs = useMemo(
    () => new Map(samples.map(({ cell }) => [
      cell.id,
      { current: cellRelicMemoryResponse(cell.id, memoryPose) },
    ])),
    [memoryPose, samples],
  );
  const assetCoverage = new Set(samples.map(({ cell }) => cell.asset_kind ?? 'other')).size;
  const lockCoverage = new Set(samples.map(({ cell }) => cell.lock_kind ?? 'other')).size;
  const controlledTileCount = controlledMatrix.reduce((sum, row) => sum + row.tiles.length, 0);

  return (
    <main
      data-cell-relic-memory-pose={memoryPose}
      data-cell-relic-quality={quality}
      data-cell-relic-controlled={controlled ? 'true' : 'false'}
      data-cell-relic-greyscale={greyscale ? 'true' : 'false'}
      data-cell-relic-structure-only={structureOnly ? 'true' : 'false'}
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: '18px 18px 24px',
        overflow: 'auto',
        color: '#dbeafe',
        background: 'radial-gradient(circle at 50% 30%, #090c1c 0%, #02030a 48%, #010207 100%)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}
    >
      <Tweaks />
      <header style={{
        minHeight: 70,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 24,
        padding: '0 2px 14px',
        borderBottom: '1px solid rgba(125, 211, 252, 0.12)',
      }}>
        <div>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.24em',
            color: controlled ? '#f8d477' : '#7dd3fc',
          }}>
            PSIONIC BRAID / {controlled ? 'V2 CONTROLLED DERIVE' : 'A REAL CELLS'}
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: '#64748b', letterSpacing: '0.08em' }}>
            {controlled
              ? `LAB-ONLY COUNTERFACTUALS FROM REAL CELL #${sourceCell?.id ?? '—'}`
              : 'REAL CELL CALIBRATION MATRIX'}{' '}
            · {memoryPose.toUpperCase()} · {moving ? 'MOTION' : 'CANONICAL STATIC'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9, fontSize: 8 }}>
            <Toggle label="CONTROLLED" active={controlled} href={toggleHref(search, 'controlled', controlled)} />
            <Toggle label="GREYSCALE" active={greyscale} href={toggleHref(search, 'greyscale', greyscale)} />
            <Toggle label="STRUCTURE" active={structureOnly} href={toggleHref(search, 'structure', structureOnly)} />
            <Toggle label="MOTION" active={moving} href={toggleHref(search, 'motion', moving)} />
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 9, lineHeight: 1.65, color: '#718096' }}>
          <div>
            {controlled
              ? `${controlledTileCount} VIEWS · ${controlledMatrix.length} CONTROLLED AXES`
              : `${samples.length} CELLS · ${assetCoverage} ASSETS · ${lockCoverage} LOCKS`}
          </div>
          <div style={{ color: '#8ba3b8' }}>
            TYPE→CARRIER · LOCK→BRAID WORD · DATA→KNOT CODE · CAP→PRESENCE
          </div>
          {controlled ? (
            <div style={{ color: '#fb7185' }}>
              SYNTHETIC DERIVES · NOT ADDITIONAL OBSERVED CELLS
            </div>
          ) : null}
        </div>
      </header>

      {(controlled ? sourceCell === null : samples.length === 0) ? (
        <EmptyLabState />
      ) : controlled ? (
        <section style={{ paddingTop: 12 }}>
          {controlledMatrix.map((row) => (
            <section key={row.axis} style={{ marginBottom: 20 }}>
              {!structureOnly ? (
                <div style={{
                  marginBottom: 7,
                  color: AXIS_COLOR[row.axis],
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                }}>
                  {row.title}
                </div>
              ) : null}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))',
                alignItems: 'start',
                gap: 8,
              }}>
                {row.tiles.map(({ sample, camera, topology, signature, viewIndex }) => (
                  <article
                    key={`${row.axis}/${sample.role}/${camera}`}
                    aria-label={`${row.title}; ${sample.role}; ${camera}`}
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      border: `1px solid ${signature.fallback
                        ? 'rgba(251,113,133,.42)'
                        : 'rgba(125,211,252,.14)'}`,
                      background: 'linear-gradient(180deg, rgba(8,12,28,.88), rgba(3,5,14,.96))',
                    }}
                  >
                    {!structureOnly ? (
                      <div style={{
                        minHeight: 27,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        padding: '0 7px',
                        borderBottom: '1px solid rgba(125,211,252,.08)',
                        fontSize: 7,
                        letterSpacing: '0.07em',
                      }}>
                        <span style={{ color: AXIS_COLOR[row.axis] }}>{sample.role}</span>
                        <span style={{ color: '#64748b' }}>{camera.toUpperCase()}</span>
                      </div>
                    ) : null}
                    <View
                      index={viewIndex}
                      frames={Infinity}
                      style={{ width: '100%', aspectRatio: '1 / 1' }}
                    >
                      <BootViewSentinel populated />
                      <CellMorphologyLabArtwork
                        topology={topology}
                        camera={camera}
                        mode={morphologyMode}
                        greyscale={greyscale}
                        structureOnly={structureOnly}
                      />
                    </View>
                    {!structureOnly ? (
                      <div style={{
                        minHeight: 74,
                        boxSizing: 'border-box',
                        padding: '6px 7px 7px',
                        borderTop: '1px solid rgba(125,211,252,.08)',
                        color: '#718096',
                        fontSize: 7,
                        lineHeight: 1.45,
                        overflowWrap: 'anywhere',
                      }}>
                        <div>T {signature.type}</div>
                        <div>L {signature.lock}</div>
                        <div>D 0x{signature.slotMaskHex} · {signature.markKinds || 'EMPTY'}</div>
                        <div style={{ color: signature.fallback ? '#fb7185' : '#64748b' }}>
                          {signature.segments} SEG · {signature.nodes} NODE · FALLBACK {signature.fallback ? 'YES' : 'NO'}
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </section>
      ) : (
        <section style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(205px, 1fr))',
          alignItems: 'start',
          gap: 10,
          paddingTop: 12,
        }}>
          {samples.map(({ cell, basis, role }, index) => {
            const asset = cell.asset_kind ?? 'other';
            const accent = ASSET_COLORS[asset] ?? '#64748b';
            return (
              <article
                key={cell.id}
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  border: '1px solid rgba(125,211,252,.14)',
                  background: 'linear-gradient(180deg, rgba(8,12,28,.88), rgba(3,5,14,.96))',
                }}
              >
                <div style={{
                  height: 27,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 8px',
                  borderBottom: '1px solid rgba(125,211,252,.08)',
                  fontSize: 8,
                  letterSpacing: '0.1em',
                }}>
                  <span style={{ color: BASIS_COLOR[basis] }}>{role}</span>
                  <span style={{ color: '#46566b' }}>{String(index + 1).padStart(2, '0')}</span>
                </div>
                <View index={index + 1} frames={Infinity} style={{ width: '100%', aspectRatio: '1 / 1' }}>
                  <BootViewSentinel populated />
                  <CellCoreArtwork
                    cell={cell}
                    direction="relic"
                    reducedMotion={!moving}
                    traceResponseRef={memoryResponseRefs.get(cell.id)}
                  />
                </View>
                <div style={{
                  minHeight: 62,
                  padding: '7px 8px 8px',
                  boxSizing: 'border-box',
                  borderTop: '1px solid rgba(125,211,252,.08)',
                  fontSize: 8,
                  lineHeight: 1.55,
                  color: '#718096',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: accent }}>{formatAssetKind(cell.asset_kind).toUpperCase()}</span>
                    <span style={{ color: '#a78bfa' }}>{formatLockKind(cell.lock_kind).toUpperCase()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{formatCkb(cell.capacity)}</span>
                    <span>{cell.data_bytes.toLocaleString()} B</span>
                  </div>
                  <div style={{ color: '#46566b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    #{cell.id} · {cell.content_hash.slice(0, 14)}…
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
      <Canvas
        camera={{ position: [0, 0, 3], fov: 40, near: 0.1, far: 20 }}
        gl={{ alpha: true, antialias: true }}
        dpr={canvasDpr}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          background: 'transparent',
        }}
      >
        <View.Port />
      </Canvas>
    </main>
  );
}
