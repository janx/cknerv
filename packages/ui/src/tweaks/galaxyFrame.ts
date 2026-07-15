/** Module-level mutable singleton mirroring the cells-galaxy group's live
 *  y-rotation, written once per frame by `CellGalaxy`. Sibling layers that
 *  aren't children of the rotating group (e.g. `BlockDeliveryLayer`, whose
 *  protocol carriers land at fixed WORLD positions) read this to project a world xz
 *  into the cells' rotating local frame — the same trick `simClock` uses to
 *  share the sim time without React state. There is exactly one galaxy. */
export const galaxyFrame = {
  /** `CellGalaxy` group.rotation.y as of the last rendered frame. */
  rotationY: 0,
};
