import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Html } from '@react-three/drei';
import type { Cell } from '@cknerv/types';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE } from '../components/hud/hudTheme';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import {
  consensusMemoryCellResponseForFrame,
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
import {
  frameDatasetBind,
  frameDatasetDelete,
  frameDatasetWrite,
  frameDatasetWriteNumber,
  frameLedgerMarkNumber,
  frameStyleWriteNumber,
  makeFrameDatasetLedger,
  type FrameDatasetLedger,
} from './frameDatasetLedger';

type ConsensusMemoryEndpointRole = 'source' | 'target';

const MEMORY_SOURCE_COPY_OFFSET_PX = 24;
const MEMORY_TARGET_COPY_OFFSET_PX = 42;

interface ConsensusMemoryEndpointCopy {
  headline: string;
  /** Rendered in `HUD_FONTS.cjk`, and every glyph of it has to be in the
   *  hand-cut subset behind that family (`src/fonts/README.md`). These three
   *  strings shipped needing ten glyphs the subset did not carry, inside a
   *  marker whose own `fontFamily` asked for `JetBrains Mono Local` — an ASCII
   *  face. Both halves silently fall back to a system serif, so the labels
   *  came out in whatever the machine had, at 7px, beside Latin set in mono. */
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

/** Everything the per-frame writes need from one solved label placement. */
interface MarkerLabelPlacement {
  shift: number;
  side: 'left' | 'right';
}

/**
 * Place every endpoint label against the measured geometry, writing the
 * result into `out` (index-parallel with `markers`; `null` where the marker
 * has no measurement yet). Sources are laid out first so the record label
 * yields to them, and each accepted placement becomes an obstacle for the
 * ones after it.
 *
 * Extracted from the frame loop and driven by the measure cadence: it reads
 * nothing that changes between measures.
 */
function solveMarkerLabelPlacements(
  out: Array<MarkerLabelPlacement | null>,
  markers: readonly MarkerRecord[],
  measurements: ReadonlyArray<MarkerScreenMeasurement | null>,
  obstacles: readonly ConsensusMemoryScreenRect[],
  viewportWidth: number,
  viewportHeight: number,
): void {
  out.length = markers.length;
  for (let index = 0; index < markers.length; index += 1) out[index] = null;
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
    out[index] = { shift: placement.shift, side: placement.side };
    placementObstacles.push(placement.rect);
  }
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
  /** Solver output, held between measures — see the solve block below. */
  const placementsRef = useRef<Array<MarkerLabelPlacement | null>>([]);
  /** One write-on-change ledger per marker slot. */
  const markerLedgersRef = useRef<FrameDatasetLedger[]>([]);
  // A commit rewrites the endpoint attributes from the markup, which is not
  // always what the frame loop last published (the markup knows nothing about
  // a running source handoff). Every commit therefore voids the ledgers.
  const commitEpochRef = useRef(0);
  useEffect(() => { commitEpochRef.current += 1; });
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
    const ledgers = markerLedgersRef.current;
    markers.forEach((_, index) => {
      const node = markerRefs.current[index];
      if (!node) return;
      const ledger = ledgers[index] ?? (ledgers[index] = makeFrameDatasetLedger());
      // A remounted marker — or any commit — carries the markup's own
      // attributes again, so the ledger forgets what it published.
      frameDatasetBind(ledger, node, commitEpochRef.current);
      const lodChanged = frameDatasetWrite(
        ledger,
        node.dataset,
        'memoryDistanceLod',
        labelLod,
      );
      frameDatasetWriteNumber(
        ledger,
        node.dataset,
        'memoryCameraDistance',
        distancePresentation.cameraDistance,
        1,
        0.1,
      );
      // The three copy layers are a pure function of the LOD, and a rebind
      // reports as a change, so this covers a fresh element too. Display
      // must settle BEFORE the measure block below reads any rect.
      if (!lodChanged) return;
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
    let measured = false;
    if (
      typeof document !== 'undefined'
      // No markers → nobody consumes the rects, so skip the forced-layout reads
      // entirely (a resting scene otherwise pays querySelectorAll + gBCR at the
      // 250ms cadence forever). A marker-set change still remeasures instantly
      // via the identity check below once markers exist.
      && markers.length > 0
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
      measured = true;
    }
    // Every input the label solver reads — endpoint rects, hud obstacles,
    // viewport, marker set — is refreshed only in the block above, so its
    // output cannot move between measures. Solving per frame re-derived the
    // same answer at frame rate (two Maps, four arrays and a placement object
    // per marker each time); it now runs on the same ≤4Hz cadence and the
    // frame loop reads the cached placements.
    const placements = placementsRef.current;
    if (measured) {
      solveMarkerLabelPlacements(
        placements,
        markers,
        markerMeasurementsRef.current,
        hudRectsRef.current,
        viewportWidth,
        viewportHeight,
      );
    }
    markers.forEach((marker, index) => {
      const node = markerRefs.current[index];
      if (!node) return;
      const ledger = ledgers[index] ?? (ledgers[index] = makeFrameDatasetLedger());
      // Bound already by the LOD pass above; this only reports whether that
      // pass found a fresh element or commit, which has to be written in full.
      const rebound = frameDatasetBind(ledger, node, commitEpochRef.current);
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
      frameStyleWriteNumber(
        ledger,
        node.style,
        'opacity',
        focusOpacity * sourceOpacity * evidenceScale,
        3,
        0.001,
      );
      frameDatasetWrite(
        ledger,
        node.dataset,
        'memoryRecordTransition',
        resolvedRecordTransition,
      );
      frameDatasetWrite(
        ledger,
        node.dataset,
        'memoryRecordBridge',
        (
          resolvedRecordTransition === 'departing'
          || resolvedRecordTransition === 'arriving'
        ) ? 'independent' : 'none',
      );
      frameDatasetWrite(
        ledger,
        node.dataset,
        'memoryEvidenceFocus',
        marker.source
          ? handoffRole
            ?? (evidenceFocusSourceId === null
              ? 'idle'
              : marker.source.id === evidenceFocusSourceId
                ? 'active'
                : 'passive')
          : evidenceFocusSourceId === null ? 'idle' : 'context',
      );
      frameDatasetWrite(
        ledger,
        node.dataset,
        'memorySourceHandoff',
        handoffRole ?? 'idle',
      );
      frameDatasetWriteNumber(
        ledger,
        node.dataset,
        'memorySourceHandoffProgress',
        handoffProgress,
        3,
        0.01,
      );
      if (handoffActive) {
        frameDatasetWriteNumber(
          ledger,
          node.dataset,
          'memorySourceHandoffFrom',
          sourceHandoff.from.sourceId,
          0,
          1,
        );
        frameDatasetWriteNumber(
          ledger,
          node.dataset,
          'memorySourceHandoffTo',
          sourceHandoff.to.sourceId,
          0,
          1,
        );
      } else {
        frameDatasetDelete(ledger, node.dataset, 'memorySourceHandoffFrom');
        frameDatasetDelete(ledger, node.dataset, 'memorySourceHandoffTo');
      }
      const cellResponse = consensusMemoryCellResponseForFrame(
        focus,
        marker.cell.id,
        nowSec,
      );
      frameDatasetWriteNumber(
        ledger,
        node.dataset,
        'memoryCellPhase',
        cellResponse?.phase ?? 0,
        3,
        0.01,
      );
      frameDatasetWriteNumber(
        ledger,
        node.dataset,
        'memoryCellConvergence',
        cellResponse?.convergence ?? 0,
        3,
        0.01,
      );
      const placement = placements[index];
      if (!placement) return;
      const { shift, side } = placement;
      // Emphasis follows the focus, not the layout, so it stays per-frame —
      // guarded on the flag so the drop-shadow string is built only when it
      // actually flips.
      const emphasized = Boolean(marker.source) && (
        evidenceFocusSourceId === marker.source?.id || handoffRole !== null
      );
      if (frameLedgerMarkNumber(ledger, 'emphasis', emphasized ? 1 : 0)) {
        const emphasisColor = marker.source
          ? consensusMemoryEvidenceCssColor(marker.sourceIndex)
          : HUD_COLORS.memoryUnbound;
        node.style.filter = emphasized
          ? `drop-shadow(0 0 11px ${emphasisColor}aa)`
          : `drop-shadow(0 0 7px ${emphasisColor}66)`;
      }
      // Everything below is a pure function of the solved placement, which
      // only moves on a measure tick.
      if (!measured && !rebound) return;
      const color = marker.source
        ? consensusMemoryEvidenceCssColor(marker.sourceIndex)
        : HUD_COLORS.memoryUnbound;
      node.dataset.memoryLabelSide = side;
      node.dataset.memoryLabelShift = shift.toFixed(1);
      node.style.flexDirection = side === 'left' ? 'row-reverse' : 'row';
      node.style.transform = side === 'left'
        ? 'translate(calc(-100% + 17px), -50%)'
        : 'translate(-17px, -50%)';
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
          : HUD_COLORS.memoryUnbound;
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
                {/* ⭐ THIS CHIP IS DOM, AND IT ANSWERS TO THE DOM LADDER.
                  * Every line of it was a size of its own — 8 / 7 / 7 / 6.8 —
                  * under an exemption `hudTheme` granted to "the in-scene
                  * label dialect" on the grounds that a scene mark is
                  * ADDITIVE MATERIAL under a camera. It is not: drei `Html`
                  * mounts a plain div in a DOM layer over the canvas, and
                  * these are ink on a `stageGround` wash — the HUD's own
                  * medium, at two rungs under the HUD's own floor. The
                  * exemption is now keyed on the CONSTRUCT (a troika `<Text>`
                  * is glyph geometry and its number is a world-unit distance),
                  * which leaves nothing here exempt.
                  *
                  * The headline was already ON a rung — `nav` — and it keeps
                  * its place one rung over the metadata under it, so the
                  * chip's hierarchy is the hierarchy it had. */}
                <div style={{ fontSize: HUD_TYPE.nav, letterSpacing: '0.15em', color }}>
                  {copy.headline}{sourceOrdinal}
                </div>
                <div
                  ref={(node) => { metadataRefs.current[index] = node; }}
                  data-memory-label-metadata="true"
                  style={{ marginTop: 2, fontSize: HUD_TYPE.micro, letterSpacing: '0.09em', color: HUD_COLORS.dim }}
                >
                  {/* ⭐⭐ AND THE HAN IS A RUNG HIGHER STILL, at 9.
                    * `micro` is the LATIN floor — where Chakra and Share Tech
                    * stop resolving their counters. A mincho glyph carries
                    * several times their stroke count in the same em, and
                    * `CellByteBudget` states the consequence: nothing in the
                    * HUD renders Han below `label`. These three companions
                    * were at SEVEN, which is not a quieter version of the
                    * word, it is the word with its strokes filled in.
                    *
                    * It sits a rung ABOVE the Latin beside it, which is the
                    * arrangement `CellByteBudget` already ships (字节元 at
                    * `label` next to CKBYTE at `micro`) and `WarningBar` ships
                    * one octave up (警告 at `heroSub` over a `panelTitle`
                    * chip): a companion is a NAME, and a name is allowed to be
                    * the loudest thing on a line that qualifies it.
                    *
                    * `fontWeight: 400` for the reason every other companion
                    * states it: Huiwen registers no weight at all, so silence
                    * here means "whatever an ancestor said", and an ancestor
                    * said 600 once already (D5b). */}
                  <span style={{ fontFamily: HUD_FONTS.cjk, fontWeight: 400, fontSize: HUD_TYPE.label }}>{copy.cjk}</span>
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
                    style={{ marginTop: 2, fontSize: HUD_TYPE.micro, letterSpacing: '0.11em', color: HUD_COLORS.moduleSlate }}
                  >
                    CONTENT {shortContentHash(cell)}
                  </div>
                )}
                {source && evidenceFocusState === 'active' && route && routeDurationMs !== null ? (
                  <div
                    data-memory-route-proof="true"
                    style={{ marginTop: 2, fontSize: HUD_TYPE.micro, letterSpacing: '0.09em', color }}
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
