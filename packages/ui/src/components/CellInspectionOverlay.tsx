import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
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
  line.style.width = horizontal ? `${gap}px` : '1px';
  line.style.height = horizontal ? '1px' : `${gap}px`;
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
 * Cell-centred detail constellation. The selected scene Cell remains visually
 * intact; one screen-space connector makes it the explicit source of the
 * decoded windows, flips around viewport edges, and avoids both fixed rails.
 */
export default function CellInspectionOverlay(props: CellDetailPanelProps) {
  const { cell, onClose, onInspectionFieldChange } = props;
  const reduced = useReducedMotion();
  const anchorRef = useRef<THREE.Group>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const leaderRef = useRef<HTMLSpanElement>(null);
  const leaderDotRef = useRef<HTMLSpanElement>(null);
  const measuredRef = useRef({
    width: DEFAULT_PANEL_WIDTH_PX,
    height: DEFAULT_PANEL_HEIGHT_PX,
  });
  const lastFrameKeyRef = useRef('');
  const projected = useRef(new THREE.Vector3());
  const [focusField, setFocusField] = useState<CellInspectionFacet | null>(null);
  const accent = selectedCellScanAccent({ cell }, focusField);
  const layoutSideRef = useRef<CellDetailLayoutSide>('left');
  const [layoutSide, setLayoutSide] = useState<CellDetailLayoutSide>('left');
  const handleInspectionFieldChange = useCallback((field: CellInspectionFacet | null) => {
    setFocusField(field);
    onInspectionFieldChange?.(field);
  }, [onInspectionFieldChange]);
  useCellInspectionDismiss(cardRef, onClose);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () => {
      measuredRef.current = {
        width: card.offsetWidth || DEFAULT_PANEL_WIDTH_PX,
        height: card.offsetHeight || DEFAULT_PANEL_HEIGHT_PX,
      };
      lastFrameKeyRef.current = '';
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [cell.id]);

  useFrame(({ camera, size }) => {
    const anchor = anchorRef.current;
    const card = cardRef.current;
    const leader = leaderRef.current;
    const leaderDot = leaderDotRef.current;
    if (!anchor || !card || !leader || !leaderDot) return;

    anchor.updateWorldMatrix(true, false);
    projected.current
      .setFromMatrixPosition(anchor.matrixWorld)
      .project(camera);
    const visible = projected.current.z >= -1
      && projected.current.z <= 1
      && Math.abs(projected.current.x) <= 1.08
      && Math.abs(projected.current.y) <= 1.08;
    card.style.opacity = visible ? '1' : '0';
    // The constellation has no panel surface: blank space must keep orbit and
    // Cell picking available. Explicit buttons/readout controls opt back in.
    card.style.pointerEvents = 'none';
    if (!visible) return;

    const anchorX = (projected.current.x * 0.5 + 0.5) * size.width;
    const anchorY = (-projected.current.y * 0.5 + 0.5) * size.height;
    // Read the live box as well as observing it. The inspector modules have
    // different heights, and a tab switch can be committed between observer
    // deliveries; using the current box keeps the edge clamp correct on that
    // very frame (most visibly on phone-sized canvases).
    const renderedWidth = card.offsetWidth;
    const renderedHeight = card.offsetHeight;
    if (renderedWidth > 0 && renderedHeight > 0) {
      measuredRef.current = {
        width: renderedWidth,
        height: renderedHeight,
      };
    }
    const { width, height } = measuredRef.current;
    const placement = cellInspectorPlacement({
      anchorX,
      anchorY,
      panelWidth: width,
      panelHeight: height,
      viewportWidth: size.width,
      viewportHeight: size.height,
    });
    if (layoutSideRef.current !== placement.side) {
      layoutSideRef.current = placement.side;
      setLayoutSide(placement.side);
    }
    const frameKey = [
      placement.side,
      placement.x.toFixed(1),
      placement.y.toFixed(1),
      width,
      height,
      accent,
    ].join(':');
    if (frameKey === lastFrameKeyRef.current) return;
    lastFrameKeyRef.current = frameKey;
    card.dataset.cellInspectorPlacement = placement.side;
    card.style.transform = `translate3d(${placement.x}px, ${placement.y}px, 0)`;
    updateLeader(
      leader,
      leaderDot,
      placement,
      width,
      height,
      INSPECTOR_GAP_PX,
      accent,
    );
  });

  return (
    <group ref={anchorRef} position={cell.pos_seed}>
      <Html
        occlude={false}
        zIndexRange={[40, 40]}
        pointerEvents="none"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
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
            ref={leaderRef}
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
            ref={leaderDotRef}
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
            {...props}
            layoutSide={layoutSide}
            onInspectionFieldChange={handleInspectionFieldChange}
          />
        </div>
      </Html>
    </group>
  );
}
