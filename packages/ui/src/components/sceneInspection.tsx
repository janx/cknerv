import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HUD_COLORS } from './hud/hudTheme';

/**
 * Chassis shared by every scene-tethered inspector. A floating card is two
 * halves in two renderers — an anchor inside the R3F tree and a card in the
 * DOM beside the Canvas — and the mechanics that bind them (projection,
 * placement, connector, measurement bookkeeping) say nothing about which
 * organism is being inspected. Dialects keep their own DOM vocabulary and
 * content; where a card sits and how its connector is drawn is decided here,
 * once, so a second inspected entity costs a card and not a chassis.
 */

const INSPECTOR_GAP_PX = 42;
const INSPECTOR_EDGE_PX = 14;
const INSPECTOR_SAFE_TOP_PX = 104;

export type SceneInspectorPlacementSide = 'left' | 'right' | 'above' | 'below';

export interface SceneInspectorPlacement {
  side: SceneInspectorPlacementSide;
  x: number;
  y: number;
}

export interface InspectionCardSize {
  width: number;
  height: number;
}

/**
 * Mutable bridge between the two halves of an inspector. The anchor lives in
 * the R3F tree (it must inherit its parent group's transform to project the
 * entity), while the card is DOM outside the Canvas container. They run in
 * different renderers, so the anchor writes styles through this channel
 * instead of React state — nothing here may allocate per frame.
 */
export interface SceneInspectionHandles {
  card: HTMLDivElement | null;
  leader: HTMLSpanElement | null;
  leaderDot: HTMLSpanElement | null;
  /** Focus accent, written by the card render, read by the anchor frame. */
  accent: string;
  /** Card size from ResizeObserver; never read layout in the frame loop. */
  measured: InspectionCardSize;
  /** Size to place by until the card is measured, and the floor for a
   * zero-sized measurement — dialect cards differ by hundreds of pixels. */
  defaultSize: InspectionCardSize;
  /** Last committed frame signature — clearing forces a re-write. */
  frameKey: string;
  visible: boolean;
  layoutSide: SceneInspectorPlacementSide;
  layoutListeners: Set<() => void>;
  /** dataset keys the frame writer stamps the placement side into. Each
   * dialect owns its DOM vocabulary, so the chassis is told the words. */
  placementDataKey: string;
  connectorDataKey: string;
}

export function createSceneInspectionHandles({
  defaultSize,
  placementDataKey,
  connectorDataKey,
}: {
  defaultSize: InspectionCardSize;
  placementDataKey: string;
  connectorDataKey: string;
}): SceneInspectionHandles {
  return {
    card: null,
    leader: null,
    leaderDot: null,
    accent: HUD_COLORS.cyanWire,
    measured: { width: defaultSize.width, height: defaultSize.height },
    defaultSize,
    frameKey: '',
    visible: false,
    layoutSide: 'left',
    layoutListeners: new Set(),
    placementDataKey,
    connectorDataKey,
  };
}

/** Cache the card box for the frame loop; a card that measures as zero (never
 * laid out yet) keeps placing by the dialect default rather than collapsing. */
export function commitInspectionCardSize(
  handles: SceneInspectionHandles,
  width: number,
  height: number,
): void {
  handles.measured = {
    width: width || handles.defaultSize.width,
    height: height || handles.defaultSize.height,
  };
  handles.frameKey = '';
}

/** Release a card the dialect is unmounting, so no frame can write into it. */
export function detachInspectionCard(
  handles: SceneInspectionHandles,
  card: HTMLDivElement,
): void {
  if (handles.card === card) handles.card = null;
  handles.frameKey = '';
  handles.visible = false;
}

function setInspectionLayoutSide(
  handles: SceneInspectionHandles,
  side: SceneInspectorPlacementSide,
): void {
  if (handles.layoutSide === side) return;
  handles.layoutSide = side;
  handles.layoutListeners.forEach((listener) => listener());
}

/** The frame loop chooses the side, the card renders in React: the mutable
 * channel is the store both halves share, and it notifies only on a flip. */
export function useSceneInspectionLayoutSide(
  handles: SceneInspectionHandles,
): SceneInspectorPlacementSide {
  const subscribe = useCallback((listener: () => void) => {
    handles.layoutListeners.add(listener);
    return () => handles.layoutListeners.delete(listener);
  }, [handles]);
  const read = useCallback(() => handles.layoutSide, [handles]);
  return useSyncExternalStore(subscribe, read, read);
}

/** Treat only the rendered detail satellites as the active inspection region.
 * Gaps between them remain part of the scene and dismiss the inspection. */
export function useSceneInspectionDismiss(
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

export function sceneInspectorPlacement({
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
}): SceneInspectorPlacement {
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

  // Phone / narrow-canvas fallback: keep the entity itself unobscured and let
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
  placement: SceneInspectorPlacement,
  panelWidth: number,
  panelHeight: number,
  gap: number,
  accent: string,
  directionDataKey: string,
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
  line.dataset[directionDataKey] = placement.side;

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

/**
 * Scene half of an inspector: an empty group at the entity's position,
 * rendered inside a scene overlay so it inherits that scene's transform.
 * Each frame it projects that point and writes the card / connector styles
 * through the handles channel. It renders no geometry of its own.
 */
export function SceneInspectionAnchor({
  position,
  handles,
  onCardFrame,
  onCardHidden,
}: {
  position: [number, number, number];
  handles: SceneInspectionHandles;
  /**
   * Dialect hook for screen-space channels of its own, handed the projected
   * anchor point and the chosen placement while the entity is on screen. It
   * runs inside the frame loop and must not allocate.
   */
  onCardFrame?: (
    anchorX: number,
    anchorY: number,
    placement: SceneInspectorPlacement,
  ) => void;
  onCardHidden?: () => void;
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
    if (!visible) {
      onCardHidden?.();
      return;
    }

    // The card layer is viewport-fixed while `size` is the Canvas CSS box;
    // App keeps the Canvas full-viewport, so the two coordinate spaces match.
    const anchorX = (projected.current.x * 0.5 + 0.5) * size.width;
    const anchorY = (-projected.current.y * 0.5 + 0.5) * size.height;
    const { width, height } = handles.measured;
    const placement = sceneInspectorPlacement({
      anchorX,
      anchorY,
      panelWidth: width,
      panelHeight: height,
      viewportWidth: size.width,
      viewportHeight: size.height,
    });
    setInspectionLayoutSide(handles, placement.side);
    onCardFrame?.(anchorX, anchorY, placement);
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
    card.dataset[handles.placementDataKey] = placement.side;
    card.style.transform = `translate3d(${cardX}px, ${cardY}px, 0)`;
    updateLeader(
      leader,
      leaderDot,
      placement,
      width,
      height,
      INSPECTOR_GAP_PX,
      handles.accent,
      handles.connectorDataKey,
    );
  });

  return <group ref={anchorRef} position={position} />;
}

/** Full-viewport layer the card is translated inside: it must not capture
 * pointers, so scene clicks outside the card still reach the Canvas. */
export const INSPECTION_LAYER_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 40,
  overflow: 'hidden',
  pointerEvents: 'none',
  userSelect: 'none',
};

/** The card starts invisible: it has no honest screen position until the
 * anchor has projected the entity once. */
export const INSPECTION_CARD_STYLE: CSSProperties = {
  position: 'absolute',
  opacity: 0,
  pointerEvents: 'none',
  userSelect: 'text',
  willChange: 'transform',
  transition: 'opacity 120ms ease',
};

const INSPECTION_LEADER_STYLE: CSSProperties = {
  position: 'absolute',
  zIndex: 2,
  background: `linear-gradient(90deg,${HUD_COLORS.cyanWire}24,${HUD_COLORS.orange}bb)`,
  boxShadow: `0 0 7px ${HUD_COLORS.cyanWire}55`,
  pointerEvents: 'none',
};

function inspectionLeaderDotStyle(enterAnimation?: string): CSSProperties {
  return {
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
    animation: enterAnimation,
  };
}

/**
 * The one screen-space tie between card and entity: a line to the card edge
 * and a dot on the entity side of it. Both are pure targets for the anchor's
 * frame writer, so the dialect only supplies their DOM identity and the
 * keyframe the dot enters with.
 */
export function SceneInspectionConnector({
  handles,
  leaderAttributes,
  dotAttributes,
  dotEnterAnimation,
}: {
  handles: SceneInspectionHandles;
  leaderAttributes?: Record<string, string | boolean>;
  dotAttributes?: Record<string, string | boolean>;
  dotEnterAnimation?: string;
}) {
  return (
    <>
      <span
        ref={(node) => { handles.leader = node; }}
        aria-hidden="true"
        {...leaderAttributes}
        style={INSPECTION_LEADER_STYLE}
      />
      <span
        ref={(node) => { handles.leaderDot = node; }}
        aria-hidden="true"
        {...dotAttributes}
        style={inspectionLeaderDotStyle(dotEnterAnimation)}
      />
    </>
  );
}
