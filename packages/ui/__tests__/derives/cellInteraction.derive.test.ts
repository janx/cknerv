import { describe, expect, it } from 'vitest';
import {
  CELL_HOVER_FOCUS,
  CELL_EXPANDED_DETAIL_THRESHOLD,
  CELL_EXPANDED_PICK_MIN_RADIUS_PX,
  CELL_EXPANDED_PICK_PADDING_PX,
  CELL_INSPECTION_GALAXY_ROTATION_SCALE,
  CELL_NUCLEUS_LOD_REFRESH_INTERVAL_S,
  CELL_SELECTED_FOCUS,
  CONSENSUS_BRAID_BASE_SCALE,
  cellGalaxyRotationScaleTarget,
  cellCanvasCursor,
  cellFocusTarget,
  cellPickRadiusPx,
  cellNucleusLodRefreshDue,
  consensusBraidRenderScale,
  NETWORK_PEER_PICK_FLAG,
  networkColonyRotationScaleTarget,
  pointerRayOwnedByNetworkPeer,
  dampCellGalaxyRotationScale,
  dampCellFocus,
  focusedBraidScale,
  selectedCellNumericId,
} from '../../src/derives/cellInteraction.derive';

describe('cell interaction derivation', () => {
  it('decodes only valid cell selection ids', () => {
    expect(selectedCellNumericId('cell:42')).toBe(42);
    expect(selectedCellNumericId('ckb:local')).toBeNull();
    expect(selectedCellNumericId('cell:')).toBeNull();
    expect(selectedCellNumericId('cell:-1')).toBeNull();
    expect(selectedCellNumericId('cell:nope')).toBeNull();
    expect(selectedCellNumericId(null)).toBeNull();
  });

  it('gives selection precedence over hover', () => {
    expect(cellFocusTarget(7, null, 7)).toBe(CELL_HOVER_FOCUS);
    expect(cellFocusTarget(7, 7, 7)).toBe(CELL_SELECTED_FOCUS);
    expect(cellFocusTarget(7, 8, 9)).toBe(0);
  });

  it('does not clear a nearer causal endpoint cursor', () => {
    expect(cellCanvasCursor(false, false, false)).toBe('');
    expect(cellCanvasCursor(true, false, false)).toBe('pointer');
    expect(cellCanvasCursor(false, true, false)).toBe('pointer');
    expect(cellCanvasCursor(true, true, false)).toBe('pointer');
  });

  it('keeps the hand while a measured peer owns the hover', () => {
    expect(cellCanvasCursor(false, false, true)).toBe('pointer');
    expect(cellCanvasCursor(true, false, true)).toBe('pointer');
  });

  it('yields the pointer ray only to flagged peer hit meshes', () => {
    const cell = { object: { userData: {} } };
    const peer = { object: { userData: { [NETWORK_PEER_PICK_FLAG]: true } } };
    const impostor = { object: { userData: { [NETWORK_PEER_PICK_FLAG]: 1 } } };
    const bare = { object: {} };
    expect(pointerRayOwnedByNetworkPeer([])).toBe(false);
    expect(pointerRayOwnedByNetworkPeer([cell, bare])).toBe(false);
    expect(pointerRayOwnedByNetworkPeer([cell, peer])).toBe(true);
    expect(pointerRayOwnedByNetworkPeer([peer])).toBe(true);
    // Non-boolean truthy values do not count: the flag is a contract, not a bag.
    expect(pointerRayOwnedByNetworkPeer([impostor])).toBe(false);
  });

  it('yields the ray to the labeled chain anchor on that same one flag', () => {
    // The labeled local anchor IS the local network node, so it stamps the
    // peers' flag rather than opening a second arbitration path — and the
    // yield must not depend on where the node lands in the distance sort.
    const nearCell = { object: { userData: {} } };
    const farCell = { object: { userData: { someOtherLayer: true } } };
    const anchor = { object: { userData: { [NETWORK_PEER_PICK_FLAG]: true } } };
    expect(pointerRayOwnedByNetworkPeer([nearCell, anchor, farCell])).toBe(true);
    expect(pointerRayOwnedByNetworkPeer([anchor, nearCell])).toBe(true);
    expect(pointerRayOwnedByNetworkPeer([nearCell, farCell])).toBe(false);
  });

  it('adds bounded acquisition room only after the real braid expands', () => {
    expect(cellPickRadiusPx(4, 6, 0)).toBe(6);
    expect(cellPickRadiusPx(4, 6, CELL_EXPANDED_DETAIL_THRESHOLD)).toBe(6);
    expect(cellPickRadiusPx(
      4,
      6,
      CELL_EXPANDED_DETAIL_THRESHOLD + 0.001,
    )).toBe(
      CELL_EXPANDED_PICK_MIN_RADIUS_PX,
    );
    expect(cellPickRadiusPx(4, 18, 1)).toBe(
      18 + CELL_EXPANDED_PICK_PADDING_PX,
    );
    expect(cellPickRadiusPx(Number.NaN, -4, 1)).toBe(
      CELL_EXPANDED_PICK_MIN_RADIUS_PX,
    );
  });

  it('reads detail as one line, never as a magnitude', () => {
    // The whole licence for the picker's crossing epoch: an easing envelope
    // moves a slot's detail on every frame of its 0.3–0.7 s run, and NONE of
    // that motion is a new pick answer — only the frame that changes sides is.
    // If a continuous term ever enters this function, the epoch under-rebuilds
    // and this test is the thing that says so.
    const eased = [0.03, 0.08, 0.1755, 0.24, 0.3128, 0.46, 0.72, 1];
    const wide = new Set(eased.map((detail) => cellPickRadiusPx(4, 6, detail)));
    expect(wide.size).toBe(1);
    expect([...wide]).toEqual([CELL_EXPANDED_PICK_MIN_RADIUS_PX]);

    const collapsing = [0.0199, 0.011, 0.004, 0.0009, 0];
    const narrow = new Set(
      collapsing.map((detail) => cellPickRadiusPx(4, 6, detail)),
    );
    expect(narrow.size).toBe(1);
    expect([...narrow]).toEqual([6]);

    // Teeth on the line itself, in the float32 the attribute actually stores:
    // at the line the disc is the exact visible footprint, a hair over it the
    // padded target — and `Math.fround` of the constant lands just UNDER the
    // double it is compared against, which the crossing test must agree with
    // because both read the same stored value.
    const stored = Math.fround(CELL_EXPANDED_DETAIL_THRESHOLD);
    expect(stored > CELL_EXPANDED_DETAIL_THRESHOLD).toBe(false);
    expect(cellPickRadiusPx(4, 18, stored)).toBe(18);
    expect(cellPickRadiusPx(4, 18, Math.fround(0.0201))).toBe(
      18 + CELL_EXPANDED_PICK_PADDING_PX,
    );
  });

  it('eases the galaxy into a slower inspection tempo and back out', () => {
    expect(cellGalaxyRotationScaleTarget(null)).toBe(1);
    expect(cellGalaxyRotationScaleTarget(7))
      .toBe(CELL_INSPECTION_GALAXY_ROTATION_SCALE);

    const entering = dampCellGalaxyRotationScale(
      1,
      cellGalaxyRotationScaleTarget(7),
      1 / 60,
    );
    const leaving = dampCellGalaxyRotationScale(
      CELL_INSPECTION_GALAXY_ROTATION_SCALE,
      cellGalaxyRotationScaleTarget(null),
      1 / 60,
    );
    expect(entering).toBeLessThan(1);
    expect(entering).toBeGreaterThan(CELL_INSPECTION_GALAXY_ROTATION_SCALE);
    expect(leaving).toBeGreaterThan(CELL_INSPECTION_GALAXY_ROTATION_SCALE);
    expect(dampCellGalaxyRotationScale(Number.NaN, 3, -1)).toBe(1);
  });

  it('slows the colony only for selections anchored inside its rotating group', () => {
    // peer:/sighted:/miner: cards tether to colony-frame nodes — inspection
    // tempo. A producer stands in the same rotating group the other two do, so
    // the counter-rotation carries it out from under the pointer at the same
    // rate; the reticle alone is reason enough, card or no card.
    expect(networkColonyRotationScaleTarget('peer:QmAbc'))
      .toBe(CELL_INSPECTION_GALAXY_ROTATION_SCALE);
    expect(networkColonyRotationScaleTarget('sighted:QmDef'))
      .toBe(CELL_INSPECTION_GALAXY_ROTATION_SCALE);
    expect(networkColonyRotationScaleTarget(`miner:0x${'ab'.repeat(32)}`))
      .toBe(CELL_INSPECTION_GALAXY_ROTATION_SCALE);
    // The chain anchor's card tethers to a world-mounted icosahedron the
    // rotation never moves; no selection at all is full speed too.
    expect(networkColonyRotationScaleTarget('ckb:local')).toBe(1);
    expect(networkColonyRotationScaleTarget(null)).toBe(1);
  });

  it('eases focus in faster than it releases', () => {
    const attack = dampCellFocus(0, 1, 1 / 60);
    const release = 1 - dampCellFocus(1, 0, 1 / 60);

    expect(attack).toBeGreaterThan(release);
    expect(attack).toBeGreaterThan(0);
    expect(dampCellFocus(0.9999, 1, 1 / 60)).toBe(1);
  });

  it('retains physical scale nearby and screen-compensates distant focus', () => {
    expect(focusedBraidScale(3, 1000, 2.1, 1)).toBe(CONSENSUS_BRAID_BASE_SCALE);
    expect(focusedBraidScale(150, 1000, 2.1, 0)).toBe(CONSENSUS_BRAID_BASE_SCALE);
    expect(focusedBraidScale(150, 1000, 2.1, 1)).toBeGreaterThan(3);
    expect(focusedBraidScale(10_000, 100, 0.1, 1)).toBeLessThanOrEqual(6);
  });

  it('applies the same capacity presence multiplier to render and hit scale', () => {
    const base = focusedBraidScale(3, 1000, 2.1, 1);

    expect(consensusBraidRenderScale(3, 1000, 2.1, 1, 1.12)).toBeCloseTo(
      base * 1.12,
    );
    expect(consensusBraidRenderScale(3, 1000, 2.1, 1, -1)).toBe(0);
  });

  it('samples passive nucleus LOD at 12 Hz but refreshes semantic changes immediately', () => {
    expect(cellNucleusLodRefreshDue(
      CELL_NUCLEUS_LOD_REFRESH_INTERVAL_S * 0.99,
      false,
      false,
    )).toBe(false);
    expect(cellNucleusLodRefreshDue(
      CELL_NUCLEUS_LOD_REFRESH_INTERVAL_S,
      false,
      false,
    )).toBe(true);
    expect(cellNucleusLodRefreshDue(0, true, false)).toBe(true);
    expect(cellNucleusLodRefreshDue(0, false, true)).toBe(true);
  });
});
