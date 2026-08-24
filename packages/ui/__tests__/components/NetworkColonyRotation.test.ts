import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), `src/components/${file}`), 'utf8');
}

// The colony counter-rotates against the cell canopy. The frame contract has
// three parts, and each is easy to lose silently in a refactor: the structural
// body (edges + nodes + anchors) rides ONE rotating group; the two world-space
// layers (courier glints, delivery carriers) stay OUTSIDE it and carry
// colony-frame positions through `colonyFrame.rotationY` themselves; and the
// per-block shockwave origin is stamped in world, not colony, coordinates.
describe('NetworkColony counter-rotation frame contract', () => {
  it('turns the structural body opposite the canopy, at the canopy rate knob', () => {
    const network = source('NetworkColony.tsx');

    expect(network).toContain('rotationGroupRef');
    // Opposite sign of CellGalaxy's `rotation.y +=` — the counter-rotation.
    expect(network).toContain(
      'rotationGroup.rotation.y -= LIVE.galaxy.rotationRate',
    );
    // Peer/sighted inspection eases the colony to the canopy's tempo.
    expect(network).toContain('networkColonyRotationScaleTarget(selectedId)');
    expect(network).toContain('dampCellGalaxyRotationScale(');
    // The shared frame mirror the world-space layers read.
    expect(network).toContain(
      'colonyFrame.rotationY = rotationGroup.rotation.y',
    );
    // Review labs can hold the colony still (off-axis local anchors).
    expect(network).toContain('rotationEnabled = true');
  });

  it('rotates edges, nodes and the inspection overlay; leaves courier + delivery in world space', () => {
    const network = source('NetworkColony.tsx');

    const rotatingOpen = network.indexOf('<group ref={rotationGroupRef}>');
    const edges = network.indexOf('<ColonyEdges');
    const nodes = network.indexOf('<ColonyNodes');
    const overlay = network.indexOf('{overlay}');
    const rotatingClose = network.indexOf('</group>', rotatingOpen);
    const courier = network.indexOf('<ColonyCourierLayer');
    const delivery = network.indexOf('<BlockDeliveryLayer');

    expect(rotatingOpen).toBeGreaterThan(-1);
    // Inside the rotating group…
    expect(edges).toBeGreaterThan(rotatingOpen);
    expect(nodes).toBeGreaterThan(rotatingOpen);
    expect(overlay).toBeGreaterThan(rotatingOpen);
    expect(edges).toBeLessThan(rotatingClose);
    expect(nodes).toBeLessThan(rotatingClose);
    expect(overlay).toBeLessThan(rotatingClose);
    // …and outside it.
    expect(courier).toBeGreaterThan(rotatingClose);
    expect(delivery).toBeGreaterThan(rotatingClose);
  });

  it('the courier carries hop points and flight axes through the live rotation', () => {
    const courier = source('ColonyCourierLayer.tsx');

    expect(courier).toContain('colonyFrame.rotationY');
    // Rotated sample point feeds both the transform and the view vector.
    expect(courier).toContain('_position.set(wx, hy, wz)');
    expect(courier).toContain('_camPos.x - wx');
    // The plume's axis turns with the edge it rides.
    expect(courier).toContain(
      '_dir.set(dx * rotC + dz * rotS, dy, -dx * rotS + dz * rotC)',
    );
  });

  it('the delivery layer pins the landing at plan time and glues the launch live', () => {
    const delivery = source('BlockDeliveryLayer.tsx');

    // Plan-time pin for the world landing…
    expect(delivery).toContain('colonyFrame.rotationY,');
    // …and the per-frame launch glue (gather + lob read the rotated launch).
    expect(delivery).toContain('const colonyRotC = Math.cos(colonyFrame.rotationY)');
    expect(delivery).toContain('_position.set(fromX, fromY, fromZ)');
    expect(delivery).toContain('fromX + (delivery.to[0] - fromX) * progress');
  });

  it('stamps the node shockwave origin in world coordinates', () => {
    const nodes = source('ColonyNodes.tsx');

    expect(nodes).toContain(
      'rotYLocalToWorldXZ(origin.pos[0], origin.pos[2], colonyFrame.rotationY)',
    );
  });
});
