import { useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import type { Cell } from '@cknerv/types';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import {
  consensusMemoryTraceFocusStrength,
  consensusMemoryTraceSourceStrength,
  type ConsensusMemoryTraceFocus,
  type ConsensusMemoryTraceFocusSource,
  type ConsensusMemoryTraceSource,
} from './consensusMemoryTrace';
import {
  MEMORY_SOURCE_LABEL_RADIAL_SHIFT_PX,
  layoutConsensusMemorySourceLabels,
} from './consensusMemoryLayout';

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

function EndpointGlyph({
  role,
  phaseIndex,
}: {
  role: ConsensusMemoryEndpointRole;
  phaseIndex: number;
}) {
  if (role === 'source') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 36 36"
        width="34"
        height="34"
        style={{
          transform: `rotate(${phaseIndex * 41}deg)`,
          transformOrigin: 'center',
        }}
      >
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
  source: ConsensusMemoryTraceFocusSource | null;
  sourceIndex: number;
}

export default function ConsensusMemoryMarkers({
  focus,
}: {
  focus: ConsensusMemoryTraceFocus | null;
}) {
  const simClock = useSimClock();
  const cellsCache = useCellGalaxy();
  const markerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const copyRefs = useRef<Array<HTMLDivElement | null>>([]);
  const sourceLeaderSvgRefs = useRef<Array<SVGSVGElement | null>>([]);
  const sourceLeaderRefs = useRef<Array<SVGPathElement | null>>([]);
  const markers = useMemo<MarkerRecord[]>(() => {
    if (!focus) return [];
    const result: MarkerRecord[] = [];
    focus.sources.forEach((source, sourceIndex) => {
      const cell = cellsCache.cells.get(source.id);
      if (cell) result.push({ cell, role: 'source', source, sourceIndex });
    });
    for (const id of focus.targetIds) {
      const cell = cellsCache.cells.get(id);
      if (cell) {
        result.push({ cell, role: 'target', source: null, sourceIndex: -1 });
      }
    }
    return result;
  }, [focus, cellsCache.cells]);

  useSimFrame(() => {
    const nowSec = simClock.elapsedSec;
    const focusOpacity = consensusMemoryTraceFocusStrength(focus, nowSec);
    const sourceColor = focus?.sourceKind === 'input' ? '#72B7FF' : '#A58AFF';
    const targetIndex = markers.findIndex((marker) => marker.role === 'target');
    const targetRect = targetIndex >= 0
      ? markerRefs.current[targetIndex]?.getBoundingClientRect()
      : null;
    const targetX = targetRect ? targetRect.left + 17 : null;
    const targetY = targetRect ? targetRect.top + 17 : null;
    const sourceBaseShifts = new Map<number, number>();
    const sourceAnchors = markers.flatMap((marker, index) => {
      const node = markerRefs.current[index];
      if (!marker.source || !node) return [];
      const rect = node.getBoundingClientRect();
      const currentSide = node.dataset.memoryLabelSide === 'right'
        ? 'right'
        : 'left';
      const x = currentSide === 'right' ? rect.left + 17 : rect.right - 17;
      const side: 'left' | 'right' = targetX !== null && x > targetX
        ? 'right'
        : 'left';
      node.dataset.memoryLabelSide = side;
      node.style.flexDirection = side === 'left' ? 'row-reverse' : 'row';
      node.style.transform = side === 'left'
        ? 'translate(calc(-100% + 17px), -50%)'
        : 'translate(-17px, -50%)';

      const copy = copyRefs.current[index];
      if (copy) {
        copy.style.padding = side === 'left' ? '3px 7px 3px 0' : '3px 0 3px 7px';
        copy.style.borderRight = side === 'left' ? `1px solid ${sourceColor}88` : '';
        copy.style.borderLeft = side === 'right' ? `1px solid ${sourceColor}88` : '';
        copy.style.textAlign = side;
        copy.style.background = side === 'left'
          ? `linear-gradient(270deg, ${sourceColor}12, transparent)`
          : `linear-gradient(90deg, ${sourceColor}12, transparent)`;
      }
      const leaderSvg = sourceLeaderSvgRefs.current[index];
      if (leaderSvg) {
        leaderSvg.style.left = side === 'right' ? '34px' : '';
        leaderSvg.style.right = side === 'left' ? '34px' : '';
      }
      const y = rect.top + rect.height / 2;
      const baseShift = targetY === null
        ? 0
        : y <= targetY
          ? -MEMORY_SOURCE_LABEL_RADIAL_SHIFT_PX
          : MEMORY_SOURCE_LABEL_RADIAL_SHIFT_PX;
      sourceBaseShifts.set(marker.source.id, baseShift);
      return [{
        id: marker.source.id,
        x,
        y: y + baseShift,
        width: rect.width,
        side,
      }];
    });
    const sourceShifts = layoutConsensusMemorySourceLabels(sourceAnchors);

    markers.forEach((marker, index) => {
      const node = markerRefs.current[index];
      if (!node) return;
      const sourceOpacity = marker.source
        ? consensusMemoryTraceSourceStrength(marker.source, nowSec)
        : 1;
      node.style.opacity = (focusOpacity * sourceOpacity).toFixed(3);
      if (!marker.source) return;

      const shift = (sourceBaseShifts.get(marker.source.id) ?? 0)
        + (sourceShifts.get(marker.source.id) ?? 0);
      node.dataset.memoryLabelShift = shift.toFixed(1);
      const copy = copyRefs.current[index];
      if (copy) copy.style.transform = `translateY(${shift.toFixed(1)}px)`;
      sourceLeaderRefs.current[index]?.setAttribute(
        'd',
        node.dataset.memoryLabelSide === 'right'
          ? `M 0 0 L 7 ${shift.toFixed(1)}`
          : `M 7 0 L 0 ${shift.toFixed(1)}`,
      );
    });
  });

  if (!focus) return null;

  return (
    <>
      {markers.map(({ cell, role, source: focusSource, sourceIndex }, index) => {
        const source = role === 'source';
        const copy = consensusMemoryEndpointCopy(role, focus.sourceKind);
        const color = source
          ? focus.sourceKind === 'input' ? '#72B7FF' : '#A58AFF'
          : '#8FF7FF';
        const sourceOrdinal = source && focus.routedSourceCount > 1
          ? ` ${String(sourceIndex + 1).padStart(2, '0')}/${String(focus.routedSourceCount).padStart(2, '0')}`
          : '';
        const evidenceNoun = focus.sourceKind === 'input'
          ? focus.routedSourceCount === 1 ? 'INPUT' : 'INPUTS'
          : focus.routedSourceCount === 1 ? 'WITNESS' : 'WITNESSES';
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
              data-memory-source-index={source ? sourceIndex + 1 : undefined}
              data-memory-source-total={source ? focus.routedSourceCount : undefined}
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
              <EndpointGlyph role={role} phaseIndex={Math.max(0, sourceIndex)} />
              {source ? (
                <svg
                  ref={(node) => { sourceLeaderSvgRefs.current[index] = node; }}
                  aria-hidden="true"
                  width="7"
                  height="1"
                  style={{
                    position: 'absolute',
                    right: 34,
                    top: 17,
                    overflow: 'visible',
                  }}
                >
                  <path
                    ref={(node) => { sourceLeaderRefs.current[index] = node; }}
                    d="M 7 0 L 0 0"
                    fill="none"
                    stroke={color}
                    strokeWidth="0.8"
                    opacity="0.52"
                  />
                </svg>
              ) : (
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
              )}
              <div
                ref={(node) => { copyRefs.current[index] = node; }}
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
                  {copy.headline}{sourceOrdinal}
                </div>
                <div style={{ marginTop: 2, fontSize: 7, letterSpacing: '0.09em', color: '#7B8CA6' }}>
                  {copy.cjk}
                  {!source ? ` · ${String(focus.routedSourceCount).padStart(2, '0')} ${evidenceNoun}` : ''}
                  {' · CONTENT '}{shortContentHash(cell)}
                </div>
              </div>
            </div>
          </Html>
        );
      })}
    </>
  );
}
