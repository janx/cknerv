// Chain-generic primitive types used across the @cknerv/ui surface.
//
// The wire types (Cell, Mutation, ChainEntry, ...) live in
// `@cknerv/types`; this module holds shape helpers internal to the
// component layer (geometry vectors, cell lookups, the colony's node and
// edge shapes) that are not part of the cknerv-core wire contract.

import type { Cell, Peer, RosterNode } from '@cknerv/types';

export type Vec3 = [number, number, number];

/**
 * Read side of a cell lookup. Satisfied structurally by
 * `ReadonlyMap<number, Cell>` AND by cheap single-record overlays — the
 * detail panel splices the inspected display resident over the canonical
 * map without cloning ~12K entries per churned block.
 */
export interface CellById {
  get(id: number): Cell | undefined;
}

/** The colony's honesty ladder, in descending order of what we actually know:
 *  `local`/`measured` are nodes we hold a live link to, `sighted` are nodes a
 *  crawler named for us (real identity, no link of ours), and `inferred` are
 *  the anonymous scatter that keeps the network's shape plausible. */
export type NodeKind = 'local' | 'measured' | 'inferred' | 'sighted';
export type EdgeKind = 'measured' | 'inferred';

/** One node in the P2P colony. `measured`/`local` carry real data and a real
 *  link; `sighted` carries a real identity on a placement we invented. */
export interface NetworkNode {
  id: string;            // real node_id (local/measured/sighted) | 'inf:<n>' (inferred)
  kind: NodeKind;
  pos: Vec3;
  peer?: Peer;           // present ONLY on measured nodes
  sighted?: RosterNode;  // present ONLY on sighted nodes
}

/** One colony edge. Only local↔peer edges are truly observed (`measured`). */
export interface NetworkEdge {
  a: string;
  b: string;
  kind: EdgeKind;
  weight: number;        // traversal cost for the flood (∝ geometric distance)
}

export interface NetworkTopology {
  provenance: 'inferred' | 'measured';
  localId: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  adjacency: Map<string, { to: string; weight: number }[]>;
}
