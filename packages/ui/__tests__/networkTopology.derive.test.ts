import { describe, it, expect } from 'vitest';
import {
  localAnchor, measuredPeerPos, COLONY_Y, LOCAL_ANCHOR_OFFSET, COLONY_ELLIPSE_X, COLONY_ELLIPSE_Z,
} from '../src/derives/networkTopology.derive';
import { latencyToRadius01, PEER_INNER_RADIUS, PEER_OUTER_RADIUS } from '../src/derives/peers.derive';
import type { Peer } from '@cknerv/types';

function peer(p: Partial<Peer>): Peer {
  return { node_id: 'Qm', addr: '1.2.3.4:8115', direction: 'outbound', version: '0.116.1', connected_ms: 0, ...p };
}

describe('networkTopology placement', () => {
  it('localAnchor is deterministic and offset from center on the chain plane', () => {
    const a = localAnchor(0xc0ffee);
    expect(a).toEqual(localAnchor(0xc0ffee));        // deterministic
    expect(a[1]).toBeCloseTo(COLONY_Y, 6);           // on the plane
    const rXZ = Math.hypot(a[0] / COLONY_ELLIPSE_X, a[2]);  // de-squash X to get base radius
    expect(rXZ).toBeGreaterThan(LOCAL_ANCHOR_OFFSET * 0.5); // genuinely offset, not centered
    expect(localAnchor(0xc0ffee)).not.toEqual(localAnchor(0xbeef)); // seed-sensitive
  });

  it('measuredPeerPos places a peer at latency-radius around the anchor', () => {
    const anchor = localAnchor(0xc0ffee);
    const p = peer({ node_id: 'A', latency_ms: 400 }); // >= cap → outer ring
    const pos = measuredPeerPos(anchor, p);
    // de-squash BOTH ellipse axes to recover the base (circular) radius r.
    const dxz = Math.hypot((pos[0] - anchor[0]) / COLONY_ELLIPSE_X, (pos[2] - anchor[2]) / COLONY_ELLIPSE_Z);
    const t = latencyToRadius01(400);
    const expectedR = PEER_INNER_RADIUS + t * (PEER_OUTER_RADIUS - PEER_INNER_RADIUS);
    expect(dxz).toBeCloseTo(expectedR, 4);
    expect(pos[1]).toBeCloseTo(COLONY_Y, 6);
  });
});
