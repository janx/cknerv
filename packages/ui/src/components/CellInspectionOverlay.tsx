import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
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

function scanBracketGeometry(): THREE.BufferGeometry {
  const radius = 5.1;
  const arm = 1.15;
  const y = 2.4;
  const positions: number[] = [];
  for (const sy of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const px = sx * radius;
      const py = sy * y;
      positions.push(
        px, py, 0, px - sx * arm, py, 0,
        px, py, 0, px, py - sy * arm, 0,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Physical inspection apparatus around the canonical scene Cell. The real
 * Cell braid remains at the centre; rings, scan plane and acquisition brackets
 * are instrumentation, not a duplicate specimen or inferred chain state. */
function SelectedCellScanField({
  cell,
  focusField,
}: Pick<CellDetailPanelProps, 'cell'> & {
  focusField: CellInspectionFacet | null;
}) {
  const reduced = useReducedMotion();
  const rootRef = useRef<THREE.Group>(null);
  const orbitRef = useRef<THREE.Mesh>(null);
  const crossOrbitRef = useRef<THREE.Mesh>(null);
  const scanPlaneRef = useRef<THREE.Mesh>(null);
  const cageRef = useRef<THREE.Mesh>(null);
  const mountedAtRef = useRef<number | null>(null);
  const brackets = useMemo(scanBracketGeometry, []);
  const accent = selectedCellScanAccent({ cell }, focusField);

  useEffect(() => () => brackets.dispose(), [brackets]);

  useFrame(({ clock }, delta) => {
    const root = rootRef.current;
    const orbit = orbitRef.current;
    const crossOrbit = crossOrbitRef.current;
    const scanPlane = scanPlaneRef.current;
    const cage = cageRef.current;
    if (!root || !orbit || !crossOrbit || !scanPlane || !cage) return;
    const now = clock.elapsedTime;
    mountedAtRef.current ??= now;
    const entered = reduced
      ? 1
      : Math.min(1, (now - mountedAtRef.current) / 0.38);
    const ease = 1 - (1 - entered) ** 3;
    root.scale.setScalar(0.35 + ease * 0.65);
    root.rotation.y += reduced ? 0 : delta * 0.16;
    orbit.rotation.z += reduced ? 0 : delta * 0.38;
    crossOrbit.rotation.x += reduced ? 0 : delta * 0.22;
    cage.rotation.y -= reduced ? 0 : delta * 0.11;
    scanPlane.position.y = reduced
      ? 0
      : -2.5 + ((now - mountedAtRef.current) * 1.55 % 5);
    const planeMaterial = scanPlane.material as THREE.MeshBasicMaterial;
    planeMaterial.opacity = reduced
      ? 0.2
      : 0.11 + Math.sin(now * 4.2) * 0.035;
  });

  return (
    <group
      ref={rootRef}
      name={`cell-inspection-field-${cell.id}`}
      renderOrder={18}
    >
      <mesh ref={orbitRef} rotation={[0.34, 0.18, 0]} renderOrder={18}>
        <torusGeometry args={[4.25, 0.045, 5, 96]} />
        <meshBasicMaterial color={accent} transparent opacity={0.58} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={crossOrbitRef} rotation={[Math.PI / 2.4, 0.52, 0]} renderOrder={18}>
        <torusGeometry args={[3.25, 0.032, 4, 80]} />
        <meshBasicMaterial color={HUD_COLORS.orange} transparent opacity={0.44} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={cageRef} renderOrder={17}>
        <cylinderGeometry args={[3.75, 3.75, 5.2, 32, 3, true]} />
        <meshBasicMaterial color={accent} transparent opacity={0.045} wireframe depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={scanPlaneRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={19}>
        <ringGeometry args={[0.45, 3.65, 64]} />
        <meshBasicMaterial color={accent} transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <lineSegments geometry={brackets} renderOrder={20}>
        <lineBasicMaterial color={accent} transparent opacity={0.72} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </lineSegments>
      <mesh renderOrder={20}>
        <octahedronGeometry args={[0.62, 1]} />
        <meshBasicMaterial color={accent} transparent opacity={0.2} wireframe depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * Cell-centred inspection field. Its physical apparatus surrounds the real
 * scene Cell while the decoded evidence follows that same projected point,
 * flips around viewport edges, and stays outside both fixed HUD rails.
 */
export default function CellInspectionOverlay(props: CellDetailPanelProps) {
  const { cell, onClose, onInspectionFieldChange } = props;
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
    ].join(':');
    if (frameKey === lastFrameKeyRef.current) return;
    lastFrameKeyRef.current = frameKey;
    card.dataset.cellInspectorPlacement = placement.side;
    card.style.transform = `translate3d(${placement.x}px, ${placement.y}px, 0)`;
    updateLeader(leader, leaderDot, placement, width, height, INSPECTOR_GAP_PX);
  });

  return (
    <group ref={anchorRef} position={cell.pos_seed}>
      <SelectedCellScanField cell={cell} focusField={focusField} />
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
