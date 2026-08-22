import type {
  CellIdentityEchoState,
} from '../derives/cellIdentityProof.derive';
import {
  cellIdentityProofLabelFrame,
  deriveCellIdentityProofLabelPlacement,
} from '../derives/cellIdentityProofLabel.derive';
import {
  frameDatasetBind,
  frameDatasetWrite,
  frameDatasetWriteNumber,
  frameLedgerMarkNumber,
  frameStyleWrite,
  frameStyleWriteNumber,
  makeFrameDatasetLedger,
  type FrameDatasetLedger,
} from '../nerve/frameDatasetLedger';

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

/**
 * Apply the marker's canonical event frame without scheduling a second clock.
 *
 * Hand in the marker's `ledger` and only real changes reach the element. An
 * echo runs for seconds, and for most of them the label holds still — same
 * side, same gap, same evidence — while four of the values below are
 * attributes a stylesheet selects on. Republishing them every frame is style
 * work for a picture that did not move. Called without a ledger every write
 * lands, which is what a one-shot caller wants.
 *
 * Only the element's identity voids the records: every value published here
 * is a literal constant in `CellIdentityProofLabel`'s markup, so a re-render
 * can overwrite one of them only by mounting a new node.
 */
export function presentCellIdentityProofLabel(
  node: HTMLDivElement | null,
  presentation: CellIdentityProofLabelPresentation,
  ledger?: FrameDatasetLedger,
): void {
  if (!node) return;
  const book = ledger ?? makeFrameDatasetLedger();
  frameDatasetBind(book, node);
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
  // The transform template and the lit edge cost more to BUILD than to
  // compare, so build them only once their inputs move. The comparison is
  // exact rather than quantized: this is where the label IS, and a frame that
  // shifted it by a hundredth of a pixel is still a frame that shifted it.
  const anchorCode = (placement.horizontal === 'left' ? 1 : 0)
    + (placement.vertical === 'above' ? 2 : 0);
  const gapMoved = frameLedgerMarkNumber(book, 'gapPx', settledGap);
  const offsetMoved = frameLedgerMarkNumber(book, 'yPx', placement.yPx);
  const anchorMoved = frameLedgerMarkNumber(book, 'anchor', anchorCode);
  if (gapMoved || offsetMoved || anchorMoved) {
    const translateX = placement.horizontal === 'left'
      ? `calc(-100% - ${settledGap.toFixed(2)}px)`
      : `${settledGap.toFixed(2)}px`;
    const translateY = placement.vertical === 'above'
      ? `calc(-100% + ${placement.yPx.toFixed(2)}px)`
      : `${placement.yPx.toFixed(2)}px`;
    frameStyleWrite(
      book,
      node.style,
      'transform',
      `translate3d(${translateX}, ${translateY}, 0)`,
    );
  }
  if (anchorMoved) {
    // The tag's lit border faces the proof it belongs to. Only a side flip
    // can move it, and reading the colour back off the element is itself a
    // DOM read worth spending once per flip instead of once per frame.
    const edgeColor = node.dataset.memoryIdentityProofLabelColor
      ?? 'currentColor';
    frameStyleWrite(
      book,
      node.style,
      'transform-origin',
      placement.horizontal === 'left' ? 'right center' : 'left center',
    );
    frameStyleWrite(
      book,
      node.style,
      'border-left-color',
      placement.horizontal === 'right' ? edgeColor : 'transparent',
    );
    frameStyleWrite(
      book,
      node.style,
      'border-right-color',
      placement.horizontal === 'left' ? edgeColor : 'transparent',
    );
  }
  // The visible opacity compares on the precision it publishes, so the guard
  // can only ever skip a write that would have produced the same string.
  frameStyleWriteNumber(book, node.style, 'opacity', frame.opacity, 3, 0.001);
  const data = node.dataset;
  frameDatasetWrite(
    book,
    data,
    'memoryIdentityProofLabelState',
    presentation.state,
  );
  frameDatasetWrite(
    book,
    data,
    'memoryIdentityProofLabelSide',
    placement.horizontal,
  );
  frameDatasetWrite(
    book,
    data,
    'memoryIdentityProofLabelVertical',
    placement.vertical,
  );
  frameDatasetWriteNumber(
    book,
    data,
    'memoryIdentityProofLabelOpacity',
    frame.opacity,
    3,
    0.01,
  );
}
