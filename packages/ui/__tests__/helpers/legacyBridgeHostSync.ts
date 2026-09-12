import type {
  BridgeHostRegistry,
  BridgeHostSourceCell,
  BridgeHostSources,
} from '../../src/geometry/bridgeEdges';
import { BRIDGE_MAX_HOST_DEGREE } from '../../src/geometry/bridgeEdges';

/**
 * The host sync as it stood BEFORE 1901530d made it resumable: three passes
 * over the persistent records and no scratch map, copied verbatim from
 * `git show 1901530d~1:packages/ui/src/geometry/bridgeEdges.ts`.
 *
 * This is an ORACLE, not a library. The cursor in `bridgeEdges.ts` has to
 * agree with it host for host, degree for degree and word for word on
 * `moved`, on every block — that agreement is the whole claim that the sync's
 * cost changed and the picture did not. Never edit this file to make a test
 * green: a difference here is a difference in the drawn bridges.
 *
 * The only edits against the retired source are the two the seam forced —
 * `cells` is typed as the published `BridgeHostSources` (the retired code
 * took a `ReadonlyMap` and called `.values()` on it, which an immutable array
 * answers too) and `hostDegreeRung` is inlined, since it is module-private
 * there.
 */

/** A record's degree before it has ever been counted. */
const UNCOUNTED = -1;

function hostDegreeRung(degree: number, maxHostDegree: number): number {
  return degree > maxHostDegree ? maxHostDegree + 1 : degree;
}

export function legacySyncBridgeHosts(
  registry: BridgeHostRegistry,
  cells: BridgeHostSources,
  edges: Iterable<{ readonly from: number; readonly to: number }>,
  maxHostDegree: number = BRIDGE_MAX_HOST_DEGREE,
): boolean {
  const hosts = registry.hosts;
  const generation = registry.generation + 1;
  registry.generation = generation;
  for (const cell of cells.values() as Iterable<BridgeHostSourceCell>) {
    // A dead-but-not-yet-collected Cell contributes no fabric edge, and it
    // must contribute no bridge either — a retracting fibre that a rebuild
    // resurrects is the exact bug `buildNeighborGraph` guards against.
    if (cell.death_at_ms != null) continue;
    const host = hosts.get(cell.id);
    if (host === undefined) {
      hosts.set(cell.id, {
        id: cell.id,
        x: cell.pos_seed[0],
        y: cell.pos_seed[1],
        z: cell.pos_seed[2],
        degree: UNCOUNTED,
        next: 0,
        seen: generation,
      });
    } else {
      host.seen = generation;
    }
  }
  for (const edge of edges) {
    const from = hosts.get(edge.from);
    if (from !== undefined) from.next += 1;
    const to = hosts.get(edge.to);
    if (to !== undefined) to.next += 1;
  }
  let moved = false;
  for (const [id, host] of hosts) {
    if (host.seen !== generation) {
      // Left the stage, or died on it. Judged at the degree the last
      // selection saw: a Cell that was never a candidate takes no stroke.
      hosts.delete(id);
      if (host.degree <= maxHostDegree) moved = true;
      continue;
    }
    const next = host.next;
    host.next = 0;
    if (host.degree === UNCOUNTED) {
      if (next <= maxHostDegree) moved = true;
    } else if (
      hostDegreeRung(host.degree, maxHostDegree)
      !== hostDegreeRung(next, maxHostDegree)
    ) {
      moved = true;
    }
    host.degree = next;
  }
  return moved;
}
