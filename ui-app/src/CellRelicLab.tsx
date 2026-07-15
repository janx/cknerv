import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { View } from '@react-three/drei';
import type { CellGalaxySnapshot } from '@cknerv/types';
import {
  ASSET_COLORS,
  CellCoreArtwork,
  formatAssetKind,
  formatCkb,
  formatDataSize,
  formatLockKind,
} from '@cknerv/ui';
import Tweaks from './Tweaks';
import { selectRelicSamples, type RelicSampleBasis } from './cell-relic-samples';

const BASIS_COLOR: Record<RelicSampleBasis, string> = {
  asset: '#7dd3fc',
  lock: '#a78bfa',
  capacity: '#f8d477',
  data: '#67e8b5',
  hash: '#8294aa',
};

export default function CellRelicLab({ snapshot }: { snapshot: CellGalaxySnapshot }) {
  const samples = useMemo(() => selectRelicSamples(snapshot), [snapshot]);
  const moving = new URLSearchParams(window.location.search).get('motion') === '1';
  const assetCoverage = new Set(samples.map(({ cell }) => cell.asset_kind ?? 'other')).size;
  const lockCoverage = new Set(samples.map(({ cell }) => cell.lock_kind ?? 'other')).size;

  return (
    <main style={{
      minHeight: '100vh',
      boxSizing: 'border-box',
      padding: '18px 18px 24px',
      overflow: 'auto',
      color: '#dbeafe',
      background: 'radial-gradient(circle at 50% 30%, #090c1c 0%, #02030a 48%, #010207 100%)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>
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
            color: '#7dd3fc',
          }}>
            PSIONIC BRAID / A
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: '#64748b', letterSpacing: '0.08em' }}>
            REAL CELL CALIBRATION MATRIX · {moving ? 'MOTION' : 'HASH-STABLE STATIC'}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 9, lineHeight: 1.65, color: '#718096' }}>
          <div>{samples.length} CELLS · {assetCoverage} ASSETS · {lockCoverage} LOCKS</div>
          <div style={{ color: '#8ba3b8' }}>
            CAP→SCALE · ASSET→FREQUENCY · LOCK→STRANDS · DATA→KNOTS · HASH→PHASE
          </div>
        </div>
      </header>

      {samples.length === 0 ? (
        <pre style={{ color: '#f88', padding: 20 }}>No Cell data available.</pre>
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
                  position: 'relative',
                  overflow: 'hidden',
                  border: '1px solid rgba(125, 211, 252, 0.14)',
                  background: 'linear-gradient(180deg, rgba(8, 12, 28, 0.88), rgba(3, 5, 14, 0.96))',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.018)',
                }}
              >
                <div style={{
                  height: 27,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 8px',
                  borderBottom: '1px solid rgba(125, 211, 252, 0.08)',
                  fontSize: 8,
                  letterSpacing: '0.1em',
                }}>
                  <span style={{ color: BASIS_COLOR[basis] }}>{role}</span>
                  <span style={{ color: '#46566b' }}>{String(index + 1).padStart(2, '0')}</span>
                </div>

                <div style={{ position: 'relative' }}>
                  <View
                    index={index + 1}
                    frames={Infinity}
                    style={{ width: '100%', aspectRatio: '1 / 1' }}
                  >
                    <CellCoreArtwork
                      cell={cell}
                      direction="relic"
                      reducedMotion={!moving}
                    />
                  </View>
                  <div style={{
                    position: 'absolute',
                    left: 8,
                    top: 8,
                    width: 3,
                    height: 24,
                    background: accent,
                    boxShadow: `0 0 12px ${accent}`,
                    opacity: 0.72,
                  }} />
                </div>

                <div style={{
                  minHeight: 62,
                  padding: '7px 8px 8px',
                  boxSizing: 'border-box',
                  borderTop: '1px solid rgba(125, 211, 252, 0.08)',
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
                    <span>{formatDataSize(cell.data_hex)}</span>
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
