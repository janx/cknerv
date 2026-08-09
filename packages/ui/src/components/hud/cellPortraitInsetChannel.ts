import {
  type MutableRefObject,
  type ReactNode,
  useSyncExternalStore,
} from 'react';

/**
 * Singleton channel joining the three parties of the portrait inset:
 * the DOM square inside the detail card (registers its element and measures
 * itself), the card anchor (writes where the card sits on the canvas each
 * frame), and CellPortraitInset in the main R3F tree (renders the braid into
 * that rectangle with the main WebGL context).
 *
 * One selection exists at a time, so one channel exists at module scope —
 * the same pattern as the LIVE tuning store. The element and scene content
 * are the reactive part (React re-renders subscribe through the revision);
 * offset and card origin are frame-path data, mutated in place and read by
 * the render pass without notifications or allocations.
 */
export interface CellPortraitOffset {
  /** Portrait square's offset inside the card, CSS px (transform-invariant). */
  dx: number;
  dy: number;
  width: number;
  height: number;
}

interface CellPortraitInsetChannel {
  element: HTMLDivElement | null;
  content: ReactNode;
  revision: number;
  offset: CellPortraitOffset | null;
  cardOriginX: number;
  cardOriginY: number;
  cardOriginValid: boolean;
  listeners: Set<() => void>;
}

export const CELL_PORTRAIT_INSET: CellPortraitInsetChannel = {
  element: null,
  content: null,
  revision: 0,
  offset: null,
  cardOriginX: 0,
  cardOriginY: 0,
  cardOriginValid: false,
  listeners: new Set(),
};

/** drei Html labels inside the braid portal render into the portrait square
 * itself, so their coordinates stay square-relative and their stacking stays
 * inside the card. Falls back to drei's default parent while unset. */
export const CELL_PORTRAIT_LABEL_PORTAL: MutableRefObject<HTMLElement | null> = {
  current: null,
};

function notifyPortraitChannel(): void {
  CELL_PORTRAIT_INSET.revision += 1;
  CELL_PORTRAIT_INSET.listeners.forEach((listener) => listener());
}

export function registerCellPortraitElement(
  element: HTMLDivElement | null,
): void {
  if (CELL_PORTRAIT_INSET.element === element) return;
  CELL_PORTRAIT_INSET.element = element;
  CELL_PORTRAIT_LABEL_PORTAL.current = element;
  if (element === null) CELL_PORTRAIT_INSET.offset = null;
  notifyPortraitChannel();
}

export function setCellPortraitContent(content: ReactNode): void {
  if (CELL_PORTRAIT_INSET.content === content) return;
  CELL_PORTRAIT_INSET.content = content;
  notifyPortraitChannel();
}

export function setCellPortraitOffset(
  offset: CellPortraitOffset | null,
): void {
  CELL_PORTRAIT_INSET.offset = offset;
}

export function setCellPortraitCardOrigin(x: number, y: number): void {
  CELL_PORTRAIT_INSET.cardOriginX = x;
  CELL_PORTRAIT_INSET.cardOriginY = y;
  CELL_PORTRAIT_INSET.cardOriginValid = true;
}

export function clearCellPortraitCardOrigin(): void {
  CELL_PORTRAIT_INSET.cardOriginValid = false;
}

export function useCellPortraitRevision(): number {
  return useSyncExternalStore(
    subscribePortraitChannel,
    readPortraitRevision,
    readPortraitRevision,
  );
}

function subscribePortraitChannel(listener: () => void): () => void {
  CELL_PORTRAIT_INSET.listeners.add(listener);
  return () => CELL_PORTRAIT_INSET.listeners.delete(listener);
}

function readPortraitRevision(): number {
  return CELL_PORTRAIT_INSET.revision;
}

export interface CellPortraitScissorRect {
  x: number;
  /** GL scissor origin is bottom-left; y is already flipped, CSS px. */
  y: number;
  width: number;
  height: number;
}

/** Compose the braid viewport from the frame-path channel data. Pure so the
 * flip/compose arithmetic is testable without a renderer. */
export function cellPortraitScissorRect(
  offset: CellPortraitOffset | null,
  cardOriginValid: boolean,
  cardOriginX: number,
  cardOriginY: number,
  canvasCssHeight: number,
  out: CellPortraitScissorRect,
): boolean {
  if (!offset || !cardOriginValid) return false;
  if (offset.width < 2 || offset.height < 2) return false;
  out.x = cardOriginX + offset.dx;
  out.width = offset.width;
  out.height = offset.height;
  out.y = canvasCssHeight - (cardOriginY + offset.dy) - offset.height;
  return true;
}
