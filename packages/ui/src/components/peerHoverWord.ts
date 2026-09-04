/**
 * The scene's ONE hover word for a network node — and, beside it, the tier the
 * node belongs to.
 *
 * Three layers publish this word onto the canvas: the measured peers and the
 * staged tiers in `ColonyNodes`, and the labeled chain anchor in `CellGalaxy`.
 * They share it deliberately (one word, one cursor arbitration,
 * `cellCanvasCursor`) — but a shared word with three writers is a word that can
 * lose half of itself, so the pair is written and retracted through one owner
 * rather than by three hands writing two dataset properties each.
 *
 * ⚠️ The tier is not decoration. `data-peer-node-hover` carries a node id, and
 * a measured peer's id and a sighted node's id are both `Qm…` — so a raster of
 * the hover oracle could tell you that 72 marks are hoverable and could not
 * tell you whether the twelve peers we actually hold were among them. That
 * exact question was left unanswered by the 2026-09-04 census. One word more
 * and it is answerable from a raster, with no clicking and no card to read.
 */

/** Which rung of the colony a hovered mark belongs to. `cohort` is a block
 *  producer's mark (the graph calls the kind `cohort`; the selection dialect
 *  calls it a miner), `local` is this node's own chain anchor. */
export type PeerNodeTier = 'measured' | 'sighted' | 'cohort' | 'local';

/** The pointer entered a mark: publish its id and its tier together. */
export function markPeerNodeHover(
  canvas: HTMLElement,
  id: string,
  tier: PeerNodeTier,
): void {
  canvas.dataset.peerNodeHover = id;
  canvas.dataset.peerNodeTier = tier;
}

/**
 * Retract the word — but only ours.
 *
 * Every caller here is guarding the same hazard from a different side: r3f v8
 * cancels the stale instance BEFORE it enters the new one, churn can unmount a
 * hovered node with no pointer-out at all, and a layer's own unmount has to
 * clean up after a pointer that is still on the canvas. All of them mean the
 * same thing — retract this word if it is still the one we wrote. Passing no
 * `id` clears whatever is there, which is what a layer that has already
 * established ownership does.
 *
 * Returns whether anything was retracted, so a caller can skip the cursor
 * resync it would otherwise do for nothing.
 */
export function clearPeerNodeHover(canvas: HTMLElement, id?: string): boolean {
  if (canvas.dataset.peerNodeHover === undefined) return false;
  if (id !== undefined && canvas.dataset.peerNodeHover !== id) return false;
  delete canvas.dataset.peerNodeHover;
  delete canvas.dataset.peerNodeTier;
  return true;
}

/** Whether some layer is currently advertising a network mark under the
 *  pointer. The one read the cursor arbitration takes. */
export function peerNodeHovered(canvas: HTMLElement): boolean {
  return canvas.dataset.peerNodeHover !== undefined;
}

/** Which mark, if any. Read by the layers that have to decide whether the word
 *  on the canvas is still one of theirs. */
export function peerNodeHoverId(canvas: HTMLElement): string | undefined {
  return canvas.dataset.peerNodeHover;
}

/**
 * …and which rung it belongs to.
 *
 * The measured belt's halos are ONE instanced draw, so the layer that lights a
 * hovered peer has to answer "is the word on the canvas a measured peer's?"
 * before it can look one up — and a measured peer's id and a sighted node's id
 * are both `Qm…`. The tier is what separates them, and it is read here because
 * the fence gives this module both dataset properties: a reader outside it
 * would be a second module that knows how the pair is spelled.
 */
export function peerNodeHoverTier(canvas: HTMLElement): PeerNodeTier | undefined {
  return canvas.dataset.peerNodeTier as PeerNodeTier | undefined;
}
