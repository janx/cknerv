/** Module-level mutable singleton mirroring the P2P colony group's live
 *  y-rotation, written once per frame by `NetworkColony` — the peer plane's
 *  twin of `galaxyFrame`. The colony counter-rotates against the cell canopy
 *  (same rate knob, opposite sign), so sibling layers that stay in WORLD
 *  space while referencing colony-frame node positions — `BlockDeliveryLayer`
 *  launch points, `ColonyCourierLayer` hops, the node shockwave's origin
 *  stamp — read this to carry those positions through the live rotation
 *  (`rotYLocalToWorldXZ`). There is exactly one colony. */
export const colonyFrame = {
  /** `NetworkColony` rotation group's `rotation.y` as of the last rendered
   *  frame. 0 whenever the mounted colony has rotation disabled (labs). */
  rotationY: 0,
};
