import { useMemo, useRef, type RefObject } from 'react';
import { Html } from '@react-three/drei';
import type { Cell } from '@cknerv/types';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import {
  consensusMemoryCellResponse,
  consensusMemoryTraceRouteForTarget,
  consensusMemoryTraceFocusStrength,
  consensusMemoryTraceSourceStrength,
  type ConsensusMemoryTraceFocus,
  type ConsensusMemoryTraceFocusSource,
  type ConsensusMemoryTraceSource,
} from './consensusMemoryTrace';
import { consensusMemoryEvidenceCssColor } from '../derives/consensusMemoryEvidence.derive';
import {
  consensusMemorySourceHandoffActive,
  consensusMemorySourceHandoffEvidenceScale,
  consensusMemorySourceHandoffProgress,
  type ConsensusMemorySourceHandoff,
} from './consensusMemorySourceHandoff';
import { consensusMemoryTraceShapeKey } from './consensusMemoryTraceContinuity';
import {
  chooseConsensusMemoryLabelSide,
  MEMORY_SOURCE_LABEL_RADIAL_SHIFT_PX,
  layoutConsensusMemorySourceLabels,
  placeConsensusMemoryLabel,
  type ConsensusMemoryScreenRect,
} from './consensusMemoryLayout';
import {
  CONSENSUS_MEMORY_NEAR_PRESENTATION,
  type ConsensusMemoryDistancePresentation,
} from './consensusMemoryDistancePresentation';

type ConsensusMemoryEndpointRole = 'source' | 'target';

const MEMORY_SOURCE_COPY_OFFSET_PX = 24;
const MEMORY_TARGET_COPY_OFFSET_PX = 42;

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

function routeDurationReadout(durationMs: number): string {
  const clamped = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return clamped < 1_000
    ? `${Math.round(clamped)} MS`
    : `${(clamped / 1_000).toFixed(2)} S`;
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
      <path
        d="M16 5h4M31 16v4M20 31h-4M5 20v-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.7"
        opacity="0.52"
      />
    </svg>
  );
}

interface MarkerRecord {
  cell: Cell;
  role: ConsensusMemoryEndpointRole;
  source: ConsensusMemoryTraceFocusSource | null;
  sourceIndex: number;
}

/** Label anchor point and copy box, measured on the throttled hud cadence. */
interface MarkerScreenMeasurement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ConsensusMemoryRecordTransition =
  | 'native'
  | 'departing'
  | 'arriving'
  | 'parked';

export default function ConsensusMemoryMarkers({
  focus,
  evidenceFocusSourceId = null,
  sourceHandoffRef,
  sourceHandoffTimeRef,
  distancePresentationRef,
  recordTransition = 'native',
}: {
  focus: ConsensusMemoryTraceFocus | null;
  evidenceFocusSourceId?: number | null;
  sourceHandoffRef?: RefObject<ConsensusMemorySourceHandoff | null>;
  sourceHandoffTimeRef?: RefObject<number>;
  /** Shared camera-distance treatment for route weight and endpoint copy. */
  distancePresentationRef?: RefObject<ConsensusMemoryDistancePresentation>;
  recordTransition?: ConsensusMemoryRecordTransition;
}) {
  const simClock = useSimClock();
  const cellsCache = useCellGalaxy();
  const markerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const copyRefs = useRef<Array<HTMLDivElement | null>>([]);
  const leaderSvgRefs = useRef<Array<SVGSVGElement | null>>([]);
  const leaderRefs = useRef<Array<SVGPathElement | null>>([]);
  const metadataRefs = useRef<Array<HTMLDivElement | null>>([]);
  const sourceContentRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const targetContentRefs = useRef<Array<HTMLDivElement | null>>([]);
  const hudRectsRef = useRef<ConsensusMemoryScreenRect[]>([]);
  const hudMeasureRef = useRef({ atMs: Number.NEGATIVE_INFINITY, width: -1, height: -1 });
  const markerMeasurementsRef = useRef<Array<MarkerScreenMeasurement | null>>([]);
  const measuredMarkersRef = useRef<MarkerRecord[] | null>(null);
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
  const traceShapeKey = useMemo(
    () => consensusMemoryTraceShapeKey(focus) ?? 'none',
    [focus],
  );

  useSimFrame(() => {
    const nowSec = simClock.elapsedSec;
    const focusOpacity = consensusMemoryTraceFocusStrength(focus, nowSec);
    const resolvedRecordTransition = recordTransition === 'arriving'
      && (
        focus?.visualContinuity?.mode !== 'entry'
        || nowSec >= focus.visualContinuity.endsAtSec
      )
      ? 'native'
      : recordTransition;
    const sourceHandoff = sourceHandoffRef?.current ?? null;
    const sourceHandoffNowSec = sourceHandoffTimeRef?.current ?? nowSec;
    const handoffActive = consensusMemorySourceHandoffActive(
      sourceHandoff,
      evidenceFocusSourceId,
      sourceHandoffNowSec,
    );
    const handoffProgress = handoffActive
      ? consensusMemorySourceHandoffProgress(sourceHandoff, sourceHandoffNowSec)
      : 1;
    const distancePresentation = distancePresentationRef?.current
      ?? CONSENSUS_MEMORY_NEAR_PRESENTATION;
    const labelLod = distancePresentation.labelLod;
    markers.forEach((_, index) => {
      const node = markerRefs.current[index];
      if (node) {
        node.dataset.memoryDistanceLod = labelLod;
        node.dataset.memoryCameraDistance =
          distancePresentation.cameraDistance.toFixed(1);
      }
      const metadata = metadataRefs.current[index];
      if (metadata) metadata.style.display = labelLod === 'signal' ? 'none' : '';
      const sourceContent = sourceContentRefs.current[index];
      if (sourceContent) {
        sourceContent.style.display = labelLod === 'full' ? '' : 'none';
      }
      const targetContent = targetContentRefs.current[index];
      if (targetContent) {
        targetContent.style.display = labelLod === 'full' ? '' : 'none';
      }
    });
    const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
    const layoutNowMs = typeof performance === 'undefined' ? 0 : performance.now();
    const hudMeasure = hudMeasureRef.current;
    if (
      typeof document !== 'undefined'
      && (viewportWidth !== hudMeasure.width
        || viewportHeight !== hudMeasure.height
        || measuredMarkersRef.current !== markers
        || layoutNowMs - hudMeasure.atMs >= 250)
    ) {
      hudRectsRef.current = Array.from(
        document.querySelectorAll<HTMLElement>('[data-hud-occlusion="true"]'),
      ).flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          ? [{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }]
          : [];
      });
      // Endpoint rect reads share this throttled cadence: per-frame reads
      // force a synchronous layout pass whenever HUD React work has dirtied
      // styles. Marker FOLLOWING stays per-frame via the drei Html transform;
      // these rects only steer side/shift/leader decisions, which may trail by
      // ≤250ms. A marker-set change forces an immediate remeasure so a stale
      // array can never be indexed against different markers.
      markerMeasurementsRef.current = markers.map((marker, index) => {
        const node = markerRefs.current[index];
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const copyRect = copyRefs.current[index]?.getBoundingClientRect();
        const currentSide = node.dataset.memoryLabelSide === 'right'
          ? 'right'
          : node.dataset.memoryLabelSide === 'left'
            ? 'left'
            : marker.role === 'source' ? 'left' : 'right';
        return {
          x: currentSide === 'right' ? rect.left + 17 : rect.right - 17,
          y: rect.top + rect.height / 2,
          width: copyRect?.width ?? rect.width,
          height: copyRect?.height ?? rect.height,
        };
      });
      measuredMarkersRef.current = markers;
      hudMeasureRef.current = {
        atMs: layoutNowMs,
        width: viewportWidth,
        height: viewportHeight,
      };
    }
    const obstacles = hudRectsRef.current;
    const measurements = markerMeasurementsRef.current;
    const targetIndex = markers.findIndex((marker) => marker.role === 'target');
    const targetMeasurement = targetIndex >= 0 ? measurements[targetIndex] : null;
    const targetX = targetMeasurement?.x ?? null;
    const targetY = targetMeasurement?.y ?? null;
    const sourceBaseShifts = new Map<number, number>();
    const sourceAnchors = markers.flatMap((marker, index) => {
      const measurement = measurements[index];
      if (!marker.source || !measurement) return [];
      const preferredSide: 'left' | 'right' = targetX !== null
        && measurement.x > targetX
        ? 'right'
        : 'left';
      const baseShift = targetY === null
        ? 0
        : measurement.y <= targetY
          ? -MEMORY_SOURCE_LABEL_RADIAL_SHIFT_PX
          : MEMORY_SOURCE_LABEL_RADIAL_SHIFT_PX;
      sourceBaseShifts.set(marker.source.id, baseShift);
      const side = chooseConsensusMemoryLabelSide({
        x: measurement.x,
        y: measurement.y + baseShift,
        width: measurement.width,
        height: measurement.height,
        preferredSide,
        viewportWidth,
        obstacles,
        horizontalOffsetPx: MEMORY_SOURCE_COPY_OFFSET_PX,
      });
      return [{
        id: marker.source.id,
        x: side === 'left'
          ? measurement.x - MEMORY_SOURCE_COPY_OFFSET_PX
          : measurement.x + MEMORY_SOURCE_COPY_OFFSET_PX,
        y: measurement.y + baseShift,
        width: measurement.width,
        side,
      }];
    });
    const sourceShifts = layoutConsensusMemorySourceLabels(sourceAnchors);
    const desiredShifts = markers.map((marker) => marker.source
      ? (sourceBaseShifts.get(marker.source.id) ?? 0)
        + (sourceShifts.get(marker.source.id) ?? 0)
      : 42);
    const placements = new Map<number, ReturnType<typeof placeConsensusMemoryLabel>>();
    const placementObstacles = [...obstacles];
    const placementOrder = markers
      .map((marker, index) => ({
        index,
        source: Boolean(marker.source),
        desiredY: (measurements[index]?.y ?? 0) + desiredShifts[index],
      }))
      .sort((a, b) => Number(b.source) - Number(a.source)
        || a.desiredY - b.desiredY
        || a.index - b.index);
    for (const { index } of placementOrder) {
      const marker = markers[index];
      const measurement = measurements[index];
      if (!measurement) continue;
      const preferredSide: 'left' | 'right' = marker.source
        ? (targetX !== null && measurement.x > targetX ? 'right' : 'left')
        : (measurement.x > viewportWidth / 2 ? 'left' : 'right');
      const placement = placeConsensusMemoryLabel({
        x: measurement.x,
        y: measurement.y,
        width: measurement.width,
        height: measurement.height,
        preferredSide,
        viewportWidth,
        viewportHeight,
        desiredShiftPx: desiredShifts[index],
        obstacles: placementObstacles,
        horizontalOffsetPx: marker.source
          ? MEMORY_SOURCE_COPY_OFFSET_PX
          : MEMORY_TARGET_COPY_OFFSET_PX,
      });
      placements.set(index, placement);
      placementObstacles.push(placement.rect);
    }

    markers.forEach((marker, index) => {
      const node = markerRefs.current[index];
      if (!node) return;
      const sourceOpacity = marker.source
        ? consensusMemoryTraceSourceStrength(marker.source, nowSec)
        : 1;
      const evidenceScale = marker.source
        ? consensusMemorySourceHandoffEvidenceScale(
          marker.source.id,
          evidenceFocusSourceId,
          sourceHandoff,
          sourceHandoffNowSec,
        )
        : evidenceFocusSourceId === null ? 1 : 0.62;
      const handoffRole = marker.source && handoffActive
        ? marker.source.id === sourceHandoff.from.sourceId
          ? 'departing'
          : marker.source.id === sourceHandoff.to.sourceId
            ? 'arriving'
            : null
        : null;
      node.style.opacity = (
        focusOpacity * sourceOpacity * evidenceScale
      ).toFixed(3);
      node.dataset.memoryRecordTransition = resolvedRecordTransition;
      node.dataset.memoryRecordBridge = (
        resolvedRecordTransition === 'departing'
        || resolvedRecordTransition === 'arriving'
      ) ? 'independent' : 'none';
      node.dataset.memoryEvidenceFocus = marker.source
        ? handoffRole
          ?? (evidenceFocusSourceId === null
            ? 'idle'
            : marker.source.id === evidenceFocusSourceId
              ? 'active'
              : 'passive')
        : evidenceFocusSourceId === null ? 'idle' : 'context';
      node.dataset.memorySourceHandoff = handoffRole ?? 'idle';
      node.dataset.memorySourceHandoffProgress = handoffProgress.toFixed(3);
      if (handoffActive) {
        node.dataset.memorySourceHandoffFrom = String(sourceHandoff.from.sourceId);
        node.dataset.memorySourceHandoffTo = String(sourceHandoff.to.sourceId);
      } else {
        delete node.dataset.memorySourceHandoffFrom;
        delete node.dataset.memorySourceHandoffTo;
      }
      const cellResponse = consensusMemoryCellResponse(focus, marker.cell.id, nowSec);
      node.dataset.memoryCellPhase = (cellResponse?.phase ?? 0).toFixed(3);
      node.dataset.memoryCellConvergence = (cellResponse?.convergence ?? 0).toFixed(3);
      const measurement = measurements[index];
      if (!measurement) return;
      const placement = placements.get(index);
      if (!placement) return;
      const { shift, side } = placement;
      node.dataset.memoryLabelSide = side;
      node.dataset.memoryLabelShift = shift.toFixed(1);
      node.style.flexDirection = side === 'left' ? 'row-reverse' : 'row';
      node.style.transform = side === 'left'
        ? 'translate(calc(-100% + 17px), -50%)'
        : 'translate(-17px, -50%)';

      const color = marker.source
        ? consensusMemoryEvidenceCssColor(marker.sourceIndex)
        : '#8FF7FF';
      node.style.filter = marker.source && (
        evidenceFocusSourceId === marker.source.id || handoffRole !== null
      )
        ? `drop-shadow(0 0 11px ${color}aa)`
        : `drop-shadow(0 0 7px ${color}66)`;
      const copy = copyRefs.current[index];
      if (copy) {
        copy.style.padding = side === 'left' ? '3px 7px 3px 0' : '3px 0 3px 7px';
        copy.style.borderRight = side === 'left' ? `1px solid ${color}88` : '';
        copy.style.borderLeft = side === 'right' ? `1px solid ${color}88` : '';
        copy.style.textAlign = side;
        copy.style.background = side === 'left'
          ? `linear-gradient(270deg, ${color}12, transparent)`
          : `linear-gradient(90deg, ${color}12, transparent)`;
        copy.style.transform = marker.source
          ? `translateY(${shift.toFixed(1)}px)`
          : `translate(${side === 'right' ? '18px' : '-18px'}, ${shift.toFixed(1)}px)`;
      }
      const leaderSvg = leaderSvgRefs.current[index];
      if (leaderSvg) {
        leaderSvg.style.left = side === 'right' ? '34px' : '';
        leaderSvg.style.right = side === 'left' ? '34px' : '';
      }
      const leader = leaderRefs.current[index];
      if (leader) {
        if (marker.source) {
          leader.setAttribute(
            'd',
            side === 'right'
              ? `M 0 0 L 7 ${shift.toFixed(1)}`
              : `M 7 0 L 0 ${shift.toFixed(1)}`,
          );
        } else {
          const leadY = shift === 0 ? 0 : shift - Math.sign(shift) * 8;
          leader.setAttribute(
            'd',
            side === 'right'
              ? `M 0 0 L 0 ${leadY.toFixed(1)} L 25 ${leadY.toFixed(1)}`
              : `M 25 0 L 25 ${leadY.toFixed(1)} L 0 ${leadY.toFixed(1)}`,
          );
        }
      }
    });
  });

  if (!focus) return null;

  return (
    <>
      {markers.map(({ cell, role, source: focusSource, sourceIndex }, index) => {
        const source = role === 'source';
        const routeTargetId = focus.targetIds.length === 1
          ? focus.targetIds[0]
          : undefined;
        const route = focusSource && routeTargetId !== undefined
          ? consensusMemoryTraceRouteForTarget(focusSource, routeTargetId)
          : null;
        const routeDurationMs = route
          ? route.hopCount * route.hopMs
          : null;
        const copy = consensusMemoryEndpointCopy(role, focus.sourceKind);
        const color = source
          ? consensusMemoryEvidenceCssColor(sourceIndex)
          : '#8FF7FF';
        const evidenceFocusState = source
          ? evidenceFocusSourceId === null
            ? 'idle'
            : focusSource?.id === evidenceFocusSourceId
              ? 'active'
              : 'passive'
          : evidenceFocusSourceId === null ? 'idle' : 'context';
        const sourceOrdinal = source && focus.routedSourceCount > 1
          ? ` ${String(sourceIndex + 1).padStart(2, '0')}/${String(focus.routedSourceCount).padStart(2, '0')}`
          : '';
        const evidenceNoun = focus.sourceKind === 'input'
          ? focus.routedSourceCount === 1 ? 'INPUT' : 'INPUTS'
          : focus.routedSourceCount === 1 ? 'WITNESS' : 'WITNESSES';
        return (
          <Html
            key={`${traceShapeKey}:${role}:${cell.id}`}
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
              data-memory-source-id={focusSource?.id}
              data-memory-evidence-focus={evidenceFocusState}
              data-memory-source-handoff="idle"
              data-memory-source-handoff-progress="1.000"
              data-memory-trace-continuity={
                focus.visualContinuity?.mode ?? 'native'
              }
              data-memory-trace-continuity-floor={
                focus.visualContinuity?.floorStrength.toFixed(3) ?? '0.000'
              }
              data-memory-record-transition={recordTransition}
              data-memory-record-bridge={
                recordTransition === 'departing'
                || recordTransition === 'arriving'
                  ? 'independent'
                  : 'none'
              }
              data-memory-route={route?.path.join('>')}
              data-memory-route-hops={route?.hopCount}
              data-memory-route-duration-ms={routeDurationMs ?? undefined}
              data-memory-distance-lod="full"
              data-memory-camera-distance={
                CONSENSUS_MEMORY_NEAR_PRESENTATION.cameraDistance.toFixed(1)
              }
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
              <svg
                ref={(node) => { leaderSvgRefs.current[index] = node; }}
                aria-hidden="true"
                width={source ? 7 : 25}
                height="1"
                style={{
                  position: 'absolute',
                  right: source ? 34 : undefined,
                  left: source ? undefined : 34,
                  top: 17,
                  overflow: 'visible',
                }}
              >
                <path
                  ref={(node) => { leaderRefs.current[index] = node; }}
                  d={source ? 'M 7 0 L 0 0' : 'M 0 0 L 0 34 L 25 34'}
                  fill="none"
                  stroke={color}
                  strokeWidth="0.8"
                  opacity="0.52"
                />
              </svg>
              <div
                ref={(node) => { copyRefs.current[index] = node; }}
                data-memory-label-copy={role}
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
                <div
                  ref={(node) => { metadataRefs.current[index] = node; }}
                  data-memory-label-metadata="true"
                  style={{ marginTop: 2, fontSize: 7, letterSpacing: '0.09em', color: '#7B8CA6' }}
                >
                  {copy.cjk}
                  {!source ? ` · ${String(focus.routedSourceCount).padStart(2, '0')} ${evidenceNoun}` : ''}
                  {source ? (
                    <span
                      ref={(node) => { sourceContentRefs.current[index] = node; }}
                      data-memory-label-source-content="true"
                    >
                      {' · CONTENT '}{shortContentHash(cell)}
                    </span>
                  ) : null}
                </div>
                {!source && (
                  <div
                    ref={(node) => { targetContentRefs.current[index] = node; }}
                    data-memory-label-target-content="true"
                    style={{ marginTop: 2, fontSize: 7, letterSpacing: '0.11em', color: '#56738A' }}
                  >
                    CONTENT {shortContentHash(cell)}
                  </div>
                )}
                {source && evidenceFocusState === 'active' && route && routeDurationMs !== null ? (
                  <div
                    data-memory-route-proof="true"
                    style={{ marginTop: 2, fontSize: 6.8, letterSpacing: '0.09em', color }}
                  >
                    CELL #{route.path[0]} · H{String(route.hopCount).padStart(2, '0')} · {routeDurationReadout(routeDurationMs)}
                  </div>
                ) : null}
              </div>
            </div>
          </Html>
        );
      })}
    </>
  );
}
