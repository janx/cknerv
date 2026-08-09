import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Cell } from '@cknerv/types';
import CellDetailPanel, {
  type CellDetailLayoutSide,
  type CellInspectionFacet,
  type CellDetailPanelProps,
} from './hud/CellDetailPanel';
import { ASSET_COLORS, LOCK_COLORS } from './hud/cellFormat';
import { HUD_COLORS } from './hud/hudTheme';
import { useReducedMotion } from './hud/useReducedMotion';

const INSPECTOR_GAP_PX = 42;
const INSPECTOR_EDGE_PX = 14;
const INSPECTOR_SAFE_TOP_PX = 104;
const DEFAULT_PANEL_WIDTH_PX = 800;
const DEFAULT_PANEL_HEIGHT_PX = 600;

export type CellInspectorPlacementSide = CellDetailLayoutSide;

export interface CellInspectorPlacement {
  side: CellInspectorPlacementSide;
  x: number;
  y: number;
}

/**
 * Mutable bridge between the two halves of the Cell inspector. The anchor
 * lives in the R3F tree (it must inherit the Galaxy group transform to
 * project the Cell), while the card is DOM outside the Canvas container.
 * They run in different renderers, so the anchor writes styles through this
 * channel instead of React state — nothing here may allocate per frame.
 */
export interface CellInspectionHandles {
  card: HTMLDivElement | null;
  leader: HTMLSpanElement | null;
  leaderDot: HTMLSpanElement | null;
  /** Focus accent, written by the card render, read by the anchor frame. */
  accent: string;
  /** Card size from ResizeObserver; never read layout in the frame loop. */
  measured: { width: number; height: number };
  /** Last committed frame signature — clearing forces a re-write. */
  frameKey: string;
  visible: boolean;
  layoutSide: CellDetailLayoutSide;
  layoutListeners: Set<() => void>;
}

export function createCellInspectionHandles(): CellInspectionHandles {
  return {
    card: null,
    leader: null,
    leaderDot: null,
    accent: HUD_COLORS.cyanWire,
    measured: {
      width: DEFAULT_PANEL_WIDTH_PX,
      height: DEFAULT_PANEL_HEIGHT_PX,
    },
    frameKey: '',
    visible: false,
    layoutSide: 'left',
    layoutListeners: new Set(),
  };
}

function setHandlesLayoutSide(
  handles: CellInspectionHandles,
  side: CellDetailLayoutSide,
): void {
  if (handles.layoutSide === side) return;
  handles.layoutSide = side;
  handles.layoutListeners.forEach((listener) => listener());
}

/** Treat only the rendered detail satellites as the active inspection region.
 * Gaps between them remain part of the Galaxy and dismiss the inspection. */
export function useCellInspectionDismiss(
  boundaryRef: RefObject<HTMLElement>,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const boundary = boundaryRef.current;
      const target = event.target;
      if (boundary && target instanceof Node && boundary.contains(target)) {
        return;
      }
      onDismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('keydown', dismissOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('keydown', dismissOnEscape, true);
    };
  }, [boundaryRef, onDismiss]);
}

export function cellInspectorPlacement({
  anchorX,
  anchorY,
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
  gap = INSPECTOR_GAP_PX,
  edge = INSPECTOR_EDGE_PX,
  safeTop = INSPECTOR_SAFE_TOP_PX,
}: {
  anchorX: number;
  anchorY: number;
  panelWidth: number;
  panelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  edge?: number;
  safeTop?: number;
}): CellInspectorPlacement {
  const roomRight = viewportWidth - edge - anchorX;
  const roomLeft = anchorX - edge;
  const canRight = roomRight >= panelWidth + gap;
  const canLeft = roomLeft >= panelWidth + gap;
  const minY = safeTop - anchorY;
  const maxY = viewportHeight - edge - panelHeight - anchorY;
  const centeredY = -panelHeight / 2;
  const y = minY <= maxY
    ? Math.max(minY, Math.min(maxY, centeredY))
    : minY;

  if (canRight || canLeft) {
    const side = canRight && (!canLeft || roomRight >= roomLeft)
      ? 'right'
      : 'left';
    return {
      side,
      x: side === 'right' ? gap : -panelWidth - gap,
      y,
    };
  }

  // Phone / narrow-canvas fallback: keep the Cell itself unobscured and let
  // the inspector open above or below it, still tethered to its screen point.
  const roomBelow = viewportHeight - edge - anchorY;
  const roomAbove = anchorY - safeTop;
  const side = roomBelow >= roomAbove ? 'below' : 'above';
  const minX = edge - anchorX;
  const maxX = viewportWidth - edge - panelWidth - anchorX;
  const x = Math.max(minX, Math.min(maxX, -panelWidth / 2));
  const preferredY = side === 'below' ? gap : -panelHeight - gap;
  return {
    side,
    x,
    y: minY <= maxY
      ? Math.max(minY, Math.min(maxY, preferredY))
      : minY,
  };
}

function updateLeader(
  line: HTMLSpanElement,
  anchor: HTMLSpanElement,
  placement: CellInspectorPlacement,
  panelWidth: number,
  panelHeight: number,
  gap: number,
  accent: string,
): void {
  const horizontal = placement.side === 'left' || placement.side === 'right';
  line.style.width = horizontal ? `${gap}px` : '2px';
  line.style.height = horizontal ? '2px' : `${gap}px`;
  line.style.left = '';
  line.style.right = '';
  line.style.top = '';
  line.style.bottom = '';
  anchor.style.left = '';
  anchor.style.right = '';
  anchor.style.top = '';
  anchor.style.bottom = '';
  anchor.style.borderColor = accent;
  anchor.style.boxShadow = `0 0 9px ${accent}99`;
  line.style.boxShadow = `0 0 7px ${accent}55`;
  line.dataset.cellInspectorConnectorDirection = placement.side;

  if (placement.side === 'right') {
    line.style.background = `linear-gradient(90deg,${accent}dd,${HUD_COLORS.cyanWire}38)`;
    const top = Math.max(15, Math.min(panelHeight - 15, -placement.y));
    line.style.left = `${-gap}px`;
    line.style.top = `${top}px`;
    anchor.style.left = `${-gap - 4}px`;
    anchor.style.top = `${top - 4}px`;
  } else if (placement.side === 'left') {
    line.style.background = `linear-gradient(90deg,${HUD_COLORS.cyanWire}38,${accent}dd)`;
    const top = Math.max(15, Math.min(panelHeight - 15, -placement.y));
    line.style.right = `${-gap}px`;
    line.style.top = `${top}px`;
    anchor.style.right = `${-gap - 4}px`;
    anchor.style.top = `${top - 4}px`;
  } else if (placement.side === 'below') {
    line.style.background = `linear-gradient(180deg,${accent}dd,${HUD_COLORS.cyanWire}38)`;
    const left = Math.max(15, Math.min(panelWidth - 15, -placement.x));
    line.style.left = `${left}px`;
    line.style.top = `${-gap}px`;
    anchor.style.left = `${left - 4}px`;
    anchor.style.top = `${-gap - 4}px`;
  } else {
    line.style.background = `linear-gradient(180deg,${HUD_COLORS.cyanWire}38,${accent}dd)`;
    const left = Math.max(15, Math.min(panelWidth - 15, -placement.x));
    line.style.left = `${left}px`;
    line.style.bottom = `${-gap}px`;
    anchor.style.left = `${left - 4}px`;
    anchor.style.bottom = `${-gap - 4}px`;
  }
}

export function selectedCellScanAccent(
  props: Pick<CellDetailPanelProps, 'cell'>,
  field: CellInspectionFacet | null,
): string {
  const { cell } = props;
  if (field === 'lock' && cell.lock_kind) return LOCK_COLORS[cell.lock_kind];
  if (field === 'asset' && cell.asset_kind) return ASSET_COLORS[cell.asset_kind];
  if (field === 'data') return HUD_COLORS.nominal;
  if (field === 'state') {
    return cell.death_at_ms === null ? HUD_COLORS.nominal : HUD_COLORS.caution;
  }
  if (field === 'born') return HUD_COLORS.orange;
  return cell.asset_kind ? ASSET_COLORS[cell.asset_kind] : HUD_COLORS.cyanWire;
}

/**
 * Scene half of the inspector: an empty group at the Cell's seed position,
 * rendered inside the Galaxy overlay so it inherits the Galaxy's transform.
 * Each frame it projects that point and writes the card / connector styles
 * through the handles channel. It renders no geometry of its own.
 */
export function CellInspectionAnchor({
  cell,
  handles,
}: {
  cell: Cell;
  handles: CellInspectionHandles;
}) {
  const anchorRef = useRef<THREE.Group>(null);
  const projected = useRef(new THREE.Vector3());

  useFrame(({ camera, size }) => {
    const anchor = anchorRef.current;
    const card = handles.card;
    const leader = handles.leader;
    const leaderDot = handles.leaderDot;
    if (!anchor || !card || !leader || !leaderDot) return;

    anchor.updateWorldMatrix(true, false);
    projected.current
      .setFromMatrixPosition(anchor.matrixWorld)
      .project(camera);
    const visible = projected.current.z >= -1
      && projected.current.z <= 1
      && Math.abs(projected.current.x) <= 1.08
      && Math.abs(projected.current.y) <= 1.08;
    if (visible !== handles.visible) {
      handles.visible = visible;
      card.style.opacity = visible ? '1' : '0';
    }
    if (!visible) return;

    // The card layer is viewport-fixed while `size` is the Canvas CSS box;
    // App keeps the Canvas full-viewport, so the two coordinate spaces match.
    const anchorX = (projected.current.x * 0.5 + 0.5) * size.width;
    const anchorY = (-projected.current.y * 0.5 + 0.5) * size.height;
    const { width, height } = handles.measured;
    const placement = cellInspectorPlacement({
      anchorX,
      anchorY,
      panelWidth: width,
      panelHeight: height,
      viewportWidth: size.width,
      viewportHeight: size.height,
    });
    setHandlesLayoutSide(handles, placement.side);
    const cardX = anchorX + placement.x;
    const cardY = anchorY + placement.y;
    const frameKey = [
      placement.side,
      cardX.toFixed(1),
      cardY.toFixed(1),
      width,
      height,
      handles.accent,
    ].join(':');
    if (frameKey === handles.frameKey) return;
    handles.frameKey = frameKey;
    card.dataset.cellInspectorPlacement = placement.side;
    card.style.transform = `translate3d(${cardX}px, ${cardY}px, 0)`;
    updateLeader(
      leader,
      leaderDot,
      placement,
      width,
      height,
      INSPECTOR_GAP_PX,
      handles.accent,
    );
  });

  return <group ref={anchorRef} position={cell.pos_seed} />;
}

export type CellInspectionOverlayProps = CellDetailPanelProps & {
  handles: CellInspectionHandles;
};

/**
 * Cell-centred detail constellation — the DOM half. The selected scene Cell
 * remains visually intact; one screen-space connector makes it the explicit
 * source of the decoded windows, flips around viewport edges, and avoids both
 * fixed rails. Rendered as a sibling of the Canvas: pointer events inside the
 * card can never reach the R3F root, so no stopPropagation shims are needed
 * and onPointerMissed only ever sees genuine scene clicks.
 */
export default function CellInspectionOverlay(props: CellInspectionOverlayProps) {
  const {
    handles,
    ...panelProps
  } = props;
  const {
    cell,
    onClose,
    onInspectionFieldChange,
    onScanInteractionChange,
  } = panelProps;
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const [focusField, setFocusField] = useState<CellInspectionFacet | null>(null);
  // Render-time write into the mutable channel: the anchor folds the accent
  // into its frame signature, so a focus change re-tints the connector on the
  // next frame without any React coupling between the two trees.
  handles.accent = selectedCellScanAccent({ cell }, focusField);
  const subscribeLayoutSide = useCallback((listener: () => void) => {
    handles.layoutListeners.add(listener);
    return () => handles.layoutListeners.delete(listener);
  }, [handles]);
  const readLayoutSide = useCallback(
    () => handles.layoutSide,
    [handles],
  );
  const layoutSide = useSyncExternalStore(
    subscribeLayoutSide,
    readLayoutSide,
    readLayoutSide,
  );
  const handleInspectionFieldChange = useCallback((field: CellInspectionFacet | null) => {
    setFocusField(field);
    onInspectionFieldChange?.(field);
  }, [onInspectionFieldChange]);
  useCellInspectionDismiss(cardRef, onClose);

  // The portrait owns a second pointer boundary. Reset the parent interaction
  // lock at the overlay boundary as well as inside the portrait, so a close
  // during pointer capture cannot leave Galaxy controls disabled.
  useEffect(() => () => {
    onInspectionFieldChange?.(null);
    onScanInteractionChange?.(false);
  }, [onInspectionFieldChange, onScanInteractionChange]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    handles.card = card;
    if (!card) return;
    const commitMeasurement = (width: number, height: number) => {
      handles.measured = {
        width: width || DEFAULT_PANEL_WIDTH_PX,
        height: height || DEFAULT_PANEL_HEIGHT_PX,
      };
      handles.frameKey = '';
    };
    const initialRect = card.getBoundingClientRect();
    commitMeasurement(initialRect.width, initialRect.height);
    const detach = () => {
      if (handles.card === card) handles.card = null;
      handles.frameKey = '';
      handles.visible = false;
    };
    if (typeof ResizeObserver === 'undefined') return detach;
    const observer = new ResizeObserver(([entry]) => {
      const borderBox = entry.borderBoxSize?.[0];
      commitMeasurement(
        borderBox?.inlineSize ?? entry.contentRect.width,
        borderBox?.blockSize ?? entry.contentRect.height,
      );
    });
    observer.observe(card);
    return () => {
      observer.disconnect();
      detach();
    };
  }, [cell.id, handles]);

  return (
    <div
      data-cell-inspection-layer
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        overflow: 'hidden',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div
        ref={cardRef}
        data-cell-inspection-overlay
        data-cell-inspection-dismiss-boundary="true"
        data-cell-id={cell.id}
        role="region"
        aria-label={`Cell ${cell.id} details`}
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          userSelect: 'text',
          willChange: 'transform',
          transition: 'opacity 120ms ease',
        }}
      >
        <span
          ref={(node) => { handles.leader = node; }}
          aria-hidden="true"
          data-cell-inspector-leader
          data-cell-detail-connector
          style={{
            position: 'absolute',
            zIndex: 2,
            background: `linear-gradient(90deg,${HUD_COLORS.cyanWire}24,${HUD_COLORS.orange}bb)`,
            boxShadow: `0 0 7px ${HUD_COLORS.cyanWire}55`,
            pointerEvents: 'none',
          }}
        />
        <span
          ref={(node) => { handles.leaderDot = node; }}
          aria-hidden="true"
          data-cell-detail-anchor
          style={{
            position: 'absolute',
            zIndex: 2,
            width: 9,
            height: 9,
            boxSizing: 'border-box',
            borderRadius: '50%',
            border: `1px solid ${HUD_COLORS.orange}`,
            background: 'rgba(1,5,13,.78)',
            boxShadow: `0 0 9px ${HUD_COLORS.orange}`,
            pointerEvents: 'none',
            animation: reduced
              ? undefined
              : 'cknerv-cell-detail-anchor-enter 360ms cubic-bezier(.2,.82,.2,1) both',
          }}
        />
        <CellDetailPanel
          {...panelProps}
          layoutSide={layoutSide}
          onInspectionFieldChange={handleInspectionFieldChange}
        />
      </div>
    </div>
  );
}
