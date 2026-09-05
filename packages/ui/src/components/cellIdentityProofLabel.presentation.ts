import type {
  CellIdentityEchoState,
} from '../derives/cellIdentityProof.derive';
import {
  cellIdentityProofLabelFrame,
  deriveCellIdentityProofLabelPlacement,
} from '../derives/cellIdentityProofLabel.derive';
import { HUD_TYPE } from './hud/hudTheme';
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

/**
 * ⭐ THE TAG'S THREE SIZES ARE TWO RUNGS OF THE DOM LADDER.
 *
 * They were 7.4 / 6.4 / 7.2 — three numbers, none of them on the scale, none
 * of them more than a pixel apart, and one of them under the legibility floor.
 * They lived under `hudTheme`'s exemption for "the in-scene label dialect",
 * which was keyed on a file importing `three` and reasoned from ADDITIVE
 * MATERIAL under a camera. This tag is a drei `Html` div: DOM, composited over
 * the canvas, in the same medium as every panel. So it takes the ladder.
 *
 * `nav` over `micro` and not three flat: the code (WHERE / WHAT / WHEN, 700,
 * letter-spaced) is the tag's NAME and the detail beside it is its evidence,
 * which is the one distinction the three numbers were really making. The
 * separator joins the detail rather than staying quietest of all, because
 * there is nothing under `micro` to be quiet at — and it never needed a size
 * for it: it is drawn in `dimColor` while both its neighbours are at full.
 */
export const CELL_IDENTITY_PROOF_LABEL_VISUAL_TOKENS = {
  zIndex: 4,
  gapPx: 4,
  padding: '2px 5px 2px 6px',
  glowRadiusPx: 12,
  codeFontSizePx: HUD_TYPE.nav,
  codeLetterSpacingPx: 1.05,
  separatorFontSizePx: HUD_TYPE.micro,
  detailFontSizePx: HUD_TYPE.micro,
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
