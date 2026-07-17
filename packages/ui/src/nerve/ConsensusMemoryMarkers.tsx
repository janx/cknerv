import { useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import type { Cell } from '@cknerv/types';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import {
  consensusMemoryTraceFocusStrength,
  type ConsensusMemoryTraceFocus,
  type ConsensusMemoryTraceSource,
} from './consensusMemoryTrace';

type ConsensusMemoryEndpointRole = 'source' | 'target';

interface ConsensusMemoryEndpointCopy {
  headline: string;
  cjk: string;
}

function consensusMemoryEndpointCopy(
  role: ConsensusMemoryEndpointRole,
  sourceKind: Exclude<ConsensusMemoryTraceSource, 'none'>,
): ConsensusMemoryEndpointCopy {
  if (role === 'target') {
    return { headline: 'SHARED RECORD', cjk: '共识记录' };
  }
  return sourceKind === 'input'
    ? { headline: 'RETAINED INPUT', cjk: '交易输入' }
    : { headline: 'LINEAGE WITNESS', cjk: '谱系见证' };
}

function shortContentHash(cell: Cell): string {
  return cell.content_hash.replace(/^0x/i, '').slice(0, 10).toUpperCase();
}

function EndpointGlyph({ role }: { role: ConsensusMemoryEndpointRole }) {
  if (role === 'source') {
    return (
      <svg aria-hidden="true" viewBox="0 0 36 36" width="34" height="34">
        <circle cx="18" cy="18" r="12" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="6 4" />
        <circle cx="18" cy="18" r="6" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.56" />
        <circle cx="18" cy="6" r="1.5" fill="currentColor" />
        <circle cx="28.4" cy="24" r="1.5" fill="currentColor" />
        <circle cx="7.6" cy="24" r="1.5" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 36 36" width="34" height="34">
      <path d="M5 13V5h8M23 5h8v8M31 23v8h-8M13 31H5v-8" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="18" cy="18" r="5" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.72" />
      <circle cx="18" cy="18" r="1.8" fill="currentColor" />
    </svg>
  );
}

interface MarkerRecord {
  cell: Cell;
  role: ConsensusMemoryEndpointRole;
}

export default function ConsensusMemoryMarkers({
  focus,
}: {
  focus: ConsensusMemoryTraceFocus | null;
}) {
  const simClock = useSimClock();
  const cellsCache = useCellGalaxy();
  const markerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const markers = useMemo<MarkerRecord[]>(() => {
    if (!focus) return [];
    const result: MarkerRecord[] = [];
    for (const id of focus.sourceIds) {
      const cell = cellsCache.cells.get(id);
      if (cell) result.push({ cell, role: 'source' });
    }
    for (const id of focus.targetIds) {
      const cell = cellsCache.cells.get(id);
      if (cell) result.push({ cell, role: 'target' });
    }
    return result;
  }, [focus, cellsCache.cells]);

  useSimFrame(() => {
    const opacity = consensusMemoryTraceFocusStrength(focus, simClock.elapsedSec);
    for (const marker of markerRefs.current) {
      if (marker) marker.style.opacity = opacity.toFixed(3);
    }
  });

  if (!focus) return null;

  return (
    <>
      {markers.map(({ cell, role }, index) => {
        const source = role === 'source';
        const copy = consensusMemoryEndpointCopy(role, focus.sourceKind);
        const color = source
          ? focus.sourceKind === 'input' ? '#72B7FF' : '#A58AFF'
          : '#8FF7FF';
        return (
          <Html
            key={`${focus.key}:${role}:${cell.id}`}
            position={[cell.pos_seed[0], cell.pos_seed[1], cell.pos_seed[2]]}
            zIndexRange={[6, 6]}
            occlude={false}
            style={{ pointerEvents: 'none' }}
          >
            <div
              ref={(node) => { markerRefs.current[index] = node; }}
              aria-hidden="true"
              data-memory-endpoint={role}
              data-memory-source-kind={source ? focus.sourceKind : undefined}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: source ? 'row-reverse' : 'row',
                alignItems: 'center',
                gap: 7,
                minWidth: 150,
                opacity: 0,
                color,
                transform: source
                  ? 'translate(calc(-100% + 17px), -50%)'
                  : 'translate(-17px, -50%)',
                filter: `drop-shadow(0 0 7px ${color}66)`,
                transition: 'none',
                whiteSpace: 'nowrap',
                fontFamily: '"JetBrains Mono Local", ui-monospace, monospace',
              }}
            >
              <EndpointGlyph role={role} />
              {!source ? (
                <span
                  style={{
                    position: 'absolute',
                    left: 34,
                    top: 17,
                    width: 25,
                    height: 34,
                    borderLeft: `1px solid ${color}66`,
                    borderBottom: `1px solid ${color}66`,
                  }}
                />
              ) : null}
              <div
                style={{
                  padding: source ? '3px 7px 3px 0' : '3px 0 3px 7px',
                  borderRight: source ? `1px solid ${color}88` : undefined,
                  borderLeft: source ? undefined : `1px solid ${color}88`,
                  textAlign: source ? 'right' : 'left',
                  background: source
                    ? `linear-gradient(270deg, ${color}12, transparent)`
                    : `linear-gradient(90deg, ${color}12, transparent)`,
                  transform: source ? undefined : 'translate(18px, 42px)',
                }}
              >
                <div style={{ fontSize: 8, letterSpacing: '0.15em', color }}>
                  {copy.headline}
                </div>
                <div style={{ marginTop: 2, fontSize: 7, letterSpacing: '0.09em', color: '#7B8CA6' }}>
                  {copy.cjk} · CONTENT {shortContentHash(cell)}
                </div>
              </div>
            </div>
          </Html>
        );
      })}
    </>
  );
}
