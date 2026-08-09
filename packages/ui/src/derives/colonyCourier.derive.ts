// packages/ui/src/derives/colonyCourier.derive.ts
// Pure courier schedule: turn a colonyFlood (shortest-path predecessor tree +
// arrivals) + node positions into the node→node "throws" the courier layer
// animates. No React, no three.js — unit-tested directly.
import type { Vec3 } from '../types';
import type { ColonyFlood } from './networkFlood.derive';

/** One thrown courier: flung from a node's flood predecessor to the node. */
export interface CourierHop {
  id: string;        // the child node this courier delivers to
  from: Vec3;        // predecessor position (thrown FROM)
  to: Vec3;          // child position (arrives AT)
  launchAge: number; // s since pulse — the predecessor's flood arrival
  arriveAge: number; // s since pulse — the child's flood arrival
}

/**
 * One courier per non-origin colony node, flung from its shortest-path
 * predecessor to it, timed by the flood arrivals (launch = predecessor's
 * arrival, arrive = the node's arrival). The origin (predecessor null) gets no
 * courier — it simply lights at t0 and the cascade fans out from it. Nodes
 * missing a position (their own or their predecessor's) are skipped defensively.
 */
export function colonyCourierSchedule(cf: ColonyFlood, posById: Map<string, Vec3>): CourierHop[] {
  const out: CourierHop[] = [];
  for (const [id, arriveAge] of Object.entries(cf.colonyArrivalS)) {
    const predId = cf.colonyPredecessor[id];
    if (!predId) continue; // origin / unreachable → no courier
    const to = posById.get(id);
    const from = posById.get(predId);
    if (!to || !from) continue;
    out.push({ id, from, to, launchAge: cf.colonyArrivalS[predId] ?? 0, arriveAge });
  }
  return out;
}

/**
 * Latest arrival age across the schedule. A hop is in flight only before its
 * `arriveAge` (the MIN-visibility stretch in the layer moves a window's START
 * earlier, never its end), so past this age the pulse can never render another
 * courier and the layer may retire it. 0 for an empty schedule → retire
 * immediately. Pure.
 */
export function courierScheduleHorizon(schedule: CourierHop[]): number {
  let horizon = 0;
  for (const hop of schedule) horizon = Math.max(horizon, hop.arriveAge);
  return horizon;
}
