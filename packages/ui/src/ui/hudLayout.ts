export interface RightColumnInput {
  h: number;
  margin: number;
  gap: number;
  openTxH: number;
  detailH: number;
}

export interface RightColumnLayout {
  openTxY: number;
  showOpenTx: boolean;
}

export function computeRightColumnLayout(i: RightColumnInput): RightColumnLayout {
  const openTxY = i.h / 2 - i.margin;

  // Floor = top edge of DetailHud + gap. DetailHud is bottom-anchored at
  // `-h/2 + margin + detailH`, so the OpenTx panel above must keep its bottom
  // edge above that line (plus one GAP for breathing room) to avoid overlap.
  const detailTop = -i.h / 2 + i.margin + i.detailH;
  const floor = detailTop + i.gap;
  const openTxBottom = openTxY - i.openTxH;

  return { openTxY, showOpenTx: openTxBottom > floor };
}
