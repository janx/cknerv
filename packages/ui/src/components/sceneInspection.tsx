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
import { CELL_CLICK_MAX_POINTER_DELTA_PX } from '../derives/cellInteraction.derive';
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

/**
 * Sub-pixel the frame writer refuses to chase. The galaxy autorotates, so a
 * tethered card drifts a fraction of a pixel every frame forever; a gate finer
 * than the eye can read turns that drift into a DOM write per frame for as
 * long as the card is open. Half a pixel is under the rounding the compositor
 * applies anyway.
 */
const INSPECTOR_FRAME_QUANTUM_PX = 0.5;

/** Half-pixel bucket a screen coordinate falls in — an integer, so the frame
 * signature can be built without a `toFixed` allocation per axis per frame. */
function inspectorFrameBucket(value: number): number {
  return Math.round(value / INSPECTOR_FRAME_QUANTUM_PX);
}

export type SceneInspectorPlacementSide = 'left' | 'right' | 'above' | 'below';

export interface SceneInspectorPlacement {
  side: SceneInspectorPlacementSide;
  x: number;
  y: number;
}

/** The solver's two vocabularies: 'beside' places left/right of the anchor
 * (x is width-derived, y is the free axis), 'stacked' places above/below
 * (y is side-derived, x is the free axis). */
export type SceneInspectorPlacementFamily = 'beside' | 'stacked';

/**
 * Sticky per-selection placement offsets. A card keeps the offset it opened
 * with — content growth extends it downward instead of re-centring on every
 * height change — so the first visible solve is remembered here and replayed
 * as the pre-clamp preference until the selection changes. Offsets are
 * anchor-relative, so a locked card still tracks its entity across the
 * screen; the lock freezes the preference, never the absolute position.
 */
export interface SceneInspectorPlacementLock {
  /** Family the offsets were captured in. The two families measure
   * different free axes, so a flip between them recaptures; a flip within
   * the beside family (left↔right) keeps the same y offset. Null between
   * selections. */
  family: SceneInspectorPlacementFamily | null;
  /** Sticky vertical offset (beside family's free axis). */
  y: number | null;
  /** Sticky horizontal offset (stacked family's free axis). */
  x: number | null;
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
  /** Last committed connector *appearance* signature. The frame signature
   * moves with the card; this one only moves when what the connector looks
   * like changes, and clearing it forces the next frame to repaint the
   * connector whole (a fresh card element inherits none of it). */
  restyleKey: string;
  /** Sticky per-selection offsets, mutated in place — never reallocated in
   * the frame loop. See SceneInspectorPlacementLock. */
  placementLock: SceneInspectorPlacementLock;
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
  accent,
  placementDataKey,
  connectorDataKey,
}: {
  defaultSize: InspectionCardSize;
  /** The dialect's resting tint — what the tether is drawn in before any fact
   *  is selected, and the colour the connector is born with. Told to the
   *  chassis rather than assumed here for the same reason the dataset keys are:
   *  the chassis does not know which organism it is tethering, and a shared
   *  default is how the cell card ended up wearing the peer plane's cyan. */
  accent: string;
  placementDataKey: string;
  connectorDataKey: string;
}): SceneInspectionHandles {
  return {
    card: null,
    leader: null,
    leaderDot: null,
    accent,
    measured: { width: defaultSize.width, height: defaultSize.height },
    defaultSize,
    frameKey: '',
    restyleKey: '',
    placementLock: { family: null, y: null, x: null },
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
  handles.restyleKey = '';
}

/** Forget the sticky offsets. Called when the inspected entity changes and
 * when the card detaches, so the next selection centres itself afresh
 * instead of inheriting where the previous card happened to sit. */
export function resetInspectionPlacementLock(
  handles: SceneInspectionHandles,
): void {
  const lock = handles.placementLock;
  lock.family = null;
  lock.y = null;
  lock.x = null;
}

/** Release a card the dialect is unmounting, so no frame can write into it. */
export function detachInspectionCard(
  handles: SceneInspectionHandles,
  card: HTMLDivElement,
): void {
  if (handles.card === card) handles.card = null;
  handles.frameKey = '';
  handles.restyleKey = '';
  handles.visible = false;
  resetInspectionPlacementLock(handles);
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

/**
 * Movement a dismissing gesture is allowed and still counted as a click. The
 * same tolerance the galaxy grants a cell click, because it is the same
 * question: the camera lies under every pixel outside the card, so a press
 * that travels is the reader reframing the view, not closing the window they
 * are reframing it to read.
 */
export const SCENE_INSPECTION_DISMISS_MAX_TRAVEL_PX =
  CELL_CLICK_MAX_POINTER_DELTA_PX;

/** Screen coordinate of a pointer event, or 0 where the environment gives
 * none — a gesture with no coordinates at all has travelled nowhere. */
function pointerCoordinate(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

/**
 * Treat only the rendered detail satellites as the active inspection region.
 * Gaps between them remain part of the scene and dismiss the inspection.
 *
 * Dismissal is a CLICK outside, not a press outside: the press is remembered,
 * and only a release that is also outside the card and has stayed within
 * `SCENE_INSPECTION_DISMISS_MAX_TRAVEL_PX` of where it started closes the
 * card. That is what the close button has always promised, and it is what
 * lets a reader orbit the galaxy — a drag begins outside the card by
 * definition — while a ~96s instrument fills in front of them. Escape is
 * unconditional as before.
 */
export function useSceneInspectionDismiss(
  boundaryRef: RefObject<HTMLElement>,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    // The press that may still become a dismissal. `pressed` is the whole
    // arming state; the rest is only meaningful while it is true.
    let pressed = false;
    let pressId = 0;
    let pressX = 0;
    let pressY = 0;
    let travelled = 0;
    const outside = (target: EventTarget | null): boolean => {
      const boundary = boundaryRef.current;
      return !(boundary && target instanceof Node && boundary.contains(target));
    };
    const travelFrom = (event: PointerEvent): number => Math.hypot(
      pointerCoordinate(event.clientX) - pressX,
      pointerCoordinate(event.clientY) - pressY,
    );
    const forget = () => { pressed = false; };
    const press = (event: PointerEvent) => {
      pressed = false;
      if (event.button !== 0) return;
      if (!outside(event.target)) return;
      pressed = true;
      pressId = pointerCoordinate(event.pointerId);
      pressX = pointerCoordinate(event.clientX);
      pressY = pointerCoordinate(event.clientY);
      travelled = 0;
    };
    const travel = (event: PointerEvent) => {
      if (!pressed || pointerCoordinate(event.pointerId) !== pressId) return;
      // The furthest the gesture ever got, not where it happened to end: a
      // drag that wanders back to its origin was still a drag.
      travelled = Math.max(travelled, travelFrom(event));
    };
    const release = (event: PointerEvent) => {
      if (!pressed || pointerCoordinate(event.pointerId) !== pressId) return;
      pressed = false;
      if (!outside(event.target)) return;
      const reach = Math.max(travelled, travelFrom(event));
      if (reach > SCENE_INSPECTION_DISMISS_MAX_TRAVEL_PX) return;
      onDismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('pointermove', travel, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', forget, true);
    window.addEventListener('blur', forget);
    document.addEventListener('keydown', dismissOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('pointermove', travel, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', forget, true);
      window.removeEventListener('blur', forget);
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
  preferredY,
  preferredX,
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
  /** Sticky vertical offset for the beside family: replaces the centring
   * preference (still clamped to the viewport band, still overruled by minY
   * when the band is inverted). The stacked family ignores it — its y is
   * side-derived and already grows away from the anchor. */
  preferredY?: number;
  /** Sticky horizontal offset for the stacked family: replaces the centring
   * preference, still clamped. The beside family ignores it — its x is
   * width-derived. */
  preferredX?: number;
}): SceneInspectorPlacement {
  const roomRight = viewportWidth - edge - anchorX;
  const roomLeft = anchorX - edge;
  const canRight = roomRight >= panelWidth + gap;
  const canLeft = roomLeft >= panelWidth + gap;
  const minY = safeTop - anchorY;
  const maxY = viewportHeight - edge - panelHeight - anchorY;
  const besideY = typeof preferredY === 'number'
    ? preferredY
    : -panelHeight / 2;
  const y = minY <= maxY
    ? Math.max(minY, Math.min(maxY, besideY))
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
  const stackedX = typeof preferredX === 'number'
    ? preferredX
    : -panelWidth / 2;
  const x = Math.max(minX, Math.min(maxX, stackedX));
  const stackedY = side === 'below' ? gap : -panelHeight - gap;
  return {
    side,
    x,
    y: minY <= maxY
      ? Math.max(minY, Math.min(maxY, stackedY))
      : minY,
  };
}

/**
 * Placement under the sticky lock: solve with the remembered per-selection
 * offsets as the preference, and on the first visible solve of a family —
 * a fresh selection, or a flip between families whose offsets measure
 * different axes — commit the solved offsets as that selection's own. A
 * left↔right flip stays inside the beside family, so the y offset survives
 * it. DOM-free and mutation-only over the handles (no per-frame allocation
 * beyond the solve itself), so the frame loop calls it directly and jsdom
 * can exercise the contract without R3F.
 */
export function resolveStickyInspectorPlacement(
  handles: SceneInspectionHandles,
  anchorX: number,
  anchorY: number,
  viewportWidth: number,
  viewportHeight: number,
): SceneInspectorPlacement {
  const lock = handles.placementLock;
  const placement = sceneInspectorPlacement({
    anchorX,
    anchorY,
    panelWidth: handles.measured.width,
    panelHeight: handles.measured.height,
    viewportWidth,
    viewportHeight,
    preferredY: lock.y ?? undefined,
    preferredX: lock.x ?? undefined,
  });
  const family: SceneInspectorPlacementFamily =
    placement.side === 'left' || placement.side === 'right'
      ? 'beside'
      : 'stacked';
  if (lock.family !== family) {
    lock.family = family;
    lock.y = family === 'beside' ? placement.y : null;
    lock.x = family === 'stacked' ? placement.x : null;
  }
  return placement;
}

/**
 * What the frame writer commits when the card has merely moved: the card's own
 * translation and the connector's one free coordinate. Two properties, both
 * genuinely different every time the gate opens.
 */
export function inspectionFrameKey(
  side: SceneInspectorPlacementSide,
  cardX: number,
  cardY: number,
  width: number,
  height: number,
  accent: string,
): string {
  return `${side}:${inspectorFrameBucket(cardX)}:${inspectorFrameBucket(cardY)}`
    + `:${Math.round(width)}:${Math.round(height)}:${accent}`;
}

/**
 * What the frame writer commits when the connector has changed *character*:
 * the side it leaves the card from decides its axis, its gradient direction
 * and which four edges are cleared; the accent decides every colour it paints;
 * the card box decides the measure its free coordinate is clamped into. A card
 * that is only drifting shares all three with the frame before it, so the
 * gradients, shadows and dataset it already carries are already correct.
 */
export function inspectionConnectorRestyleKey(
  side: SceneInspectorPlacementSide,
  accent: string,
  width: number,
  height: number,
): string {
  return `${side}:${accent}:${Math.round(width)}x${Math.round(height)}`;
}

/** Everything about the connector that does not depend on where the card
 * currently sits: axis, cleared edges, gradient, glow, accent, direction. */
function restyleLeader(
  line: HTMLSpanElement,
  anchor: HTMLSpanElement,
  side: SceneInspectorPlacementSide,
  gap: number,
  accent: string,
  directionDataKey: string,
): void {
  const horizontal = side === 'left' || side === 'right';
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
  line.dataset[directionDataKey] = side;

  // Both stops are the accent: near-opaque at the entity end, `38` as it
  // reaches the card. The faint end used to be a hardcoded `cyanWire`, which
  // was invisible on the cell dialect only because the cell dialect was cyan
  // too — every other card drew a tether that changed hue halfway across for
  // no reason anyone could state. A tether belongs to one thing, so it is one
  // colour fading out, and it follows whichever dialect is doing the pointing.
  if (side === 'right') {
    line.style.background = `linear-gradient(90deg,${accent}dd,${accent}38)`;
    line.style.left = `${-gap}px`;
    anchor.style.left = `${-gap - 4}px`;
  } else if (side === 'left') {
    line.style.background = `linear-gradient(90deg,${accent}38,${accent}dd)`;
    line.style.right = `${-gap}px`;
    anchor.style.right = `${-gap - 4}px`;
  } else if (side === 'below') {
    line.style.background = `linear-gradient(180deg,${accent}dd,${accent}38)`;
    line.style.top = `${-gap}px`;
    anchor.style.top = `${-gap - 4}px`;
  } else {
    line.style.background = `linear-gradient(180deg,${accent}38,${accent}dd)`;
    line.style.bottom = `${-gap}px`;
    anchor.style.bottom = `${-gap - 4}px`;
  }
}

/** The connector's one free coordinate: where along the card's near edge the
 * line meets it. The beside family slides it vertically, the stacked family
 * horizontally, and both keep it 15px clear of the card's corners. */
function positionLeader(
  line: HTMLSpanElement,
  anchor: HTMLSpanElement,
  placement: SceneInspectorPlacement,
  panelWidth: number,
  panelHeight: number,
): void {
  if (placement.side === 'left' || placement.side === 'right') {
    const top = Math.max(15, Math.min(panelHeight - 15, -placement.y));
    line.style.top = `${top}px`;
    anchor.style.top = `${top - 4}px`;
    return;
  }
  const left = Math.max(15, Math.min(panelWidth - 15, -placement.x));
  line.style.left = `${left}px`;
  anchor.style.left = `${left - 4}px`;
}

/**
 * The whole DOM side of one frame, behind two gates. The outer gate asks
 * whether the card has moved far enough to be worth a write at all; the inner
 * one asks whether the connector would come out looking any different. A card
 * that is merely drifting under the galaxy's spin passes the first and fails
 * the second, so it costs three property writes instead of twenty-one.
 *
 * DOM-only and mutation-only over the handles, so the frame loop calls it
 * directly and jsdom can exercise the contract without R3F.
 */
export function commitInspectionFrame(
  handles: SceneInspectionHandles,
  placement: SceneInspectorPlacement,
  cardX: number,
  cardY: number,
): void {
  const card = handles.card;
  const leader = handles.leader;
  const leaderDot = handles.leaderDot;
  if (!card || !leader || !leaderDot) return;
  const { width, height } = handles.measured;
  const frameKey = inspectionFrameKey(
    placement.side,
    cardX,
    cardY,
    width,
    height,
    handles.accent,
  );
  if (frameKey === handles.frameKey) return;
  handles.frameKey = frameKey;
  // Repaint the connector only when it would come out different. A drifting
  // card keeps its gradient, its two glows, its cleared edges and both dataset
  // words; all that has actually changed is where it is.
  const restyleKey = inspectionConnectorRestyleKey(
    placement.side,
    handles.accent,
    width,
    height,
  );
  if (restyleKey !== handles.restyleKey) {
    handles.restyleKey = restyleKey;
    card.dataset[handles.placementDataKey] = placement.side;
    restyleLeader(
      leader,
      leaderDot,
      placement.side,
      INSPECTOR_GAP_PX,
      handles.accent,
      handles.connectorDataKey,
    );
  }
  card.style.transform = `translate3d(${cardX}px, ${cardY}px, 0)`;
  positionLeader(leader, leaderDot, placement, width, height);
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
    const placement = resolveStickyInspectorPlacement(
      handles,
      anchorX,
      anchorY,
      size.width,
      size.height,
    );
    setInspectionLayoutSide(handles, placement.side);
    // Ahead of the write gate on purpose: the dialect's own screen-space
    // channels are mutation-only and must see every frame the entity is on
    // screen for, gate or no gate.
    onCardFrame?.(anchorX, anchorY, placement);
    commitInspectionFrame(
      handles,
      placement,
      anchorX + placement.x,
      anchorY + placement.y,
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

/** The tether's appearance for the one frame before the anchor has projected
 *  the entity and `restyleLeader` has taken the element over. It is still the
 *  dialect's own accent: the chassis has no colour of its own, and a first
 *  frame painted in somebody else's cyan is a flash of the wrong organism. */
function inspectionLeaderStyle(accent: string): CSSProperties {
  return {
    position: 'absolute',
    zIndex: 2,
    background: `linear-gradient(90deg,${accent}24,${HUD_COLORS.orange}bb)`,
    boxShadow: `0 0 7px ${accent}55`,
    pointerEvents: 'none',
  };
}

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
        ref={(node) => {
          handles.leader = node;
          // A connector element the frame writer has never painted carries
          // none of the appearance the restyle gate assumes it kept, so the
          // next frame owes it both passes.
          handles.frameKey = '';
          handles.restyleKey = '';
        }}
        aria-hidden="true"
        {...leaderAttributes}
        style={inspectionLeaderStyle(handles.accent)}
      />
      <span
        ref={(node) => {
          handles.leaderDot = node;
          handles.frameKey = '';
          handles.restyleKey = '';
        }}
        aria-hidden="true"
        {...dotAttributes}
        style={inspectionLeaderDotStyle(dotEnterAnimation)}
      />
    </>
  );
}
