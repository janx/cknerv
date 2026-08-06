import { useEffect, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import CellDetailPanel, {
  type CellDetailPanelProps,
} from './hud/CellDetailPanel';
import { HUD_COLORS } from './hud/hudTheme';

const INSPECTOR_GAP_PX = 42;
const INSPECTOR_EDGE_PX = 14;
const INSPECTOR_SAFE_TOP_PX = 104;
const DEFAULT_PANEL_WIDTH_PX = 500;
const DEFAULT_PANEL_HEIGHT_PX = 360;

export type CellInspectorPlacementSide = 'left' | 'right' | 'above' | 'below';

export interface CellInspectorPlacement {
  side: CellInspectorPlacementSide;
  x: number;
  y: number;
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
  dot: HTMLSpanElement,
  placement: CellInspectorPlacement,
  panelWidth: number,
  panelHeight: number,
  gap: number,
): void {
  const horizontal = placement.side === 'left' || placement.side === 'right';
  line.style.width = horizontal ? `${gap}px` : '1px';
  line.style.height = horizontal ? '1px' : `${gap}px`;
  line.style.left = '';
  line.style.right = '';
  line.style.top = '';
  line.style.bottom = '';
  dot.style.left = '';
  dot.style.right = '';
  dot.style.top = '';
  dot.style.bottom = '';

  if (placement.side === 'right') {
    line.style.background = `linear-gradient(90deg,${HUD_COLORS.orange}bb,${HUD_COLORS.cyanWire}24)`;
    const top = Math.max(15, Math.min(panelHeight - 15, -placement.y));
    line.style.left = `${-gap}px`;
    line.style.top = `${top}px`;
    dot.style.left = `${-gap - 2}px`;
    dot.style.top = `${top - 2}px`;
  } else if (placement.side === 'left') {
    line.style.background = `linear-gradient(90deg,${HUD_COLORS.cyanWire}24,${HUD_COLORS.orange}bb)`;
    const top = Math.max(15, Math.min(panelHeight - 15, -placement.y));
    line.style.right = `${-gap}px`;
    line.style.top = `${top}px`;
    dot.style.right = `${-gap - 2}px`;
    dot.style.top = `${top - 2}px`;
  } else if (placement.side === 'below') {
    line.style.background = `linear-gradient(180deg,${HUD_COLORS.orange}bb,${HUD_COLORS.cyanWire}24)`;
    const left = Math.max(15, Math.min(panelWidth - 15, -placement.x));
    line.style.left = `${left}px`;
    line.style.top = `${-gap}px`;
    dot.style.left = `${left - 2}px`;
    dot.style.top = `${-gap - 2}px`;
  } else {
    line.style.background = `linear-gradient(180deg,${HUD_COLORS.cyanWire}24,${HUD_COLORS.orange}bb)`;
    const left = Math.max(15, Math.min(panelWidth - 15, -placement.x));
    line.style.left = `${left}px`;
    line.style.bottom = `${-gap}px`;
    dot.style.left = `${left - 2}px`;
    dot.style.bottom = `${-gap - 2}px`;
  }
}

/**
 * Screen-space inspector tethered to the selected Cell's real scene position.
 * It follows galaxy rotation and camera motion, flips around viewport edges,
 * and never participates in either fixed HUD rail.
 */
export default function CellInspectionOverlay(props: CellDetailPanelProps) {
  const { cell } = props;
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
    card.style.pointerEvents = visible ? 'auto' : 'none';
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
    const frameKey = [
      placement.side,
      placement.x.toFixed(1),
      placement.y.toFixed(1),
      width,
      height,
    ].join(':');
    if (frameKey === lastFrameKeyRef.current) return;
    lastFrameKeyRef.current = frameKey;
    card.dataset.cellInspectorPlacement = placement.side;
    card.style.transform = `translate3d(${placement.x}px, ${placement.y}px, 0)`;
    updateLeader(leader, leaderDot, placement, width, height, INSPECTOR_GAP_PX);
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
          data-cell-id={cell.id}
          style={{
            position: 'absolute',
            opacity: 0,
            pointerEvents: 'auto',
            userSelect: 'text',
            willChange: 'transform',
            transition: 'opacity 120ms ease',
          }}
        >
          <span
            ref={leaderRef}
            aria-hidden="true"
            data-cell-inspector-leader
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
            style={{
              position: 'absolute',
              zIndex: 2,
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: HUD_COLORS.orange,
              boxShadow: `0 0 9px ${HUD_COLORS.orange}`,
              pointerEvents: 'none',
            }}
          />
          <CellDetailPanel {...props} />
        </div>
      </Html>
    </group>
  );
}
