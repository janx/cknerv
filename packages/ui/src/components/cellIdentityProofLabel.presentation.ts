import type {
  CellIdentityEchoState,
} from '../derives/cellIdentityProof.derive';
import {
  cellIdentityProofLabelFrame,
  deriveCellIdentityProofLabelPlacement,
} from '../derives/cellIdentityProofLabel.derive';

export const CELL_IDENTITY_PROOF_LABEL_VISUAL_TOKENS = {
  zIndex: 4,
  gapPx: 4,
  padding: '2px 5px 2px 6px',
  glowRadiusPx: 12,
  codeFontSizePx: 7.4,
  codeLetterSpacingPx: 1.05,
  separatorFontSizePx: 6.4,
  detailFontSizePx: 7.2,
  detailLetterSpacingPx: 0.45,
} as const;

export interface CellIdentityProofLabelPresentation {
  state: CellIdentityEchoState;
  progress: number;
  strength: number;
  reducedMotion: boolean;
  screenX: number;
  screenY: number;
  viewportWidth: number;
  viewportHeight: number;
  radiusPx: number;
}

/** Apply the marker's canonical event frame without scheduling a second clock. */
export function presentCellIdentityProofLabel(
  node: HTMLDivElement | null,
  presentation: CellIdentityProofLabelPresentation,
): void {
  if (!node) return;
  const frame = cellIdentityProofLabelFrame(
    presentation.progress,
    presentation.strength,
    presentation.reducedMotion,
  );
  const placement = deriveCellIdentityProofLabelPlacement({
    screenX: presentation.screenX,
    screenY: presentation.screenY,
    viewportWidth: presentation.viewportWidth,
    viewportHeight: presentation.viewportHeight,
    radiusPx: presentation.radiusPx,
  });
  const settledGap = Math.max(0, placement.gapPx - frame.driftPx);
  const translateX = placement.horizontal === 'left'
    ? `calc(-100% - ${settledGap.toFixed(2)}px)`
    : `${settledGap.toFixed(2)}px`;
  const translateY = placement.vertical === 'above'
    ? `calc(-100% + ${placement.yPx.toFixed(2)}px)`
    : `${placement.yPx.toFixed(2)}px`;
  node.style.opacity = frame.opacity.toFixed(3);
  node.style.transform = `translate3d(${translateX}, ${translateY}, 0)`;
  node.style.transformOrigin = placement.horizontal === 'left'
    ? 'right center'
    : 'left center';
  node.style.borderLeftColor = placement.horizontal === 'right'
    ? node.dataset.memoryIdentityProofLabelColor ?? 'currentColor'
    : 'transparent';
  node.style.borderRightColor = placement.horizontal === 'left'
    ? node.dataset.memoryIdentityProofLabelColor ?? 'currentColor'
    : 'transparent';
  node.dataset.memoryIdentityProofLabelState = presentation.state;
  node.dataset.memoryIdentityProofLabelSide = placement.horizontal;
  node.dataset.memoryIdentityProofLabelVertical = placement.vertical;
  node.dataset.memoryIdentityProofLabelOpacity = frame.opacity.toFixed(3);
}
