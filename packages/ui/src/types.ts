// Chain-generic primitive types used across the @cknerv/ui surface.
//
// The wire types (Cell, Mutation, ChainEntry, ...) live in
// `@cknerv/types`; this module holds shape helpers internal to the
// component layer (geometry vectors, cell lookups, the colony's node and
// edge shapes) that are not part of the cknerv-core wire contract.

import type { Cell, Peer, RosterNode } from '@cknerv/types';
import type { ProducerStanding } from './derives/blockProducers.derive';

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

/** The colony's honesty ladder. EVERY NAME HERE SAYS HOW THE FACT WAS
 *  OBTAINED, never what the node does: we measured it / somebody sighted it /
 *  the chain attests it / we inferred it. That is the axis, and a rung earns a
 *  name on it only by answering "how do we know this node exists".
 *
 *  `local`/`measured` are nodes we hold a live link to. `sighted` are nodes a
 *  crawler named for us — real identity, no link of ours. `inferred` are the
 *  anonymous scatter that keeps the network's shape plausible.
 *
 *  ⭐ `attested` is the EXACT INVERSE of the faintest named rung. Where
 *  `advertised_unverified` is hearsay about a node with a total identity — a
 *  real base58 id at a real address that nobody has ever had an answer out of —
 *  an attested node's existence is CERTAIN and its identity is ZERO: the chain
 *  proves something made these blocks and says nothing whatsoever about which
 *  machine that is. It is strictly stronger than a ghost and it is not a tier
 *  above `sighted`; the two rungs answer the same question from opposite ends.
 *
 *  ⚠️ Mining is NOT on this axis. "What does this node do" is a second,
 *  orthogonal question, and an attested node is a producer only because that is
 *  the evidence it was created from — see `ProducerStanding.role`, which has no
 *  union with the candidacy a NAMED peer may carry. */
export type NodeKind = 'local' | 'measured' | 'inferred' | 'sighted' | 'attested';
export type EdgeKind = 'measured' | 'inferred';

/** One node in the P2P colony. `measured`/`local` carry real data and a real
 *  link; `sighted` carries a real identity on a placement we invented;
 *  `attested` carries a chain fact and NO identity at all. */
export interface NetworkNode {
  /** real node_id (local/measured/sighted) | 'inf:<n>' (inferred) |
   *  'attested:<producer key>' (attested). The namespaced forms are what keep
   *  the graph's keying safe: `buildAdjacency`, the flood and the hit meshes
   *  all key on this string, so two tiers sharing one id would merge their
   *  edges and double-book one target. */
  id: string;
  kind: NodeKind;
  pos: Vec3;
  peer?: Peer;           // present ONLY on measured nodes
  sighted?: RosterNode;  // present ONLY on sighted nodes
  /** Present ONLY on attested nodes.
   *
   *  ⭐ THIS IS WHERE §9.1 IS STRUCTURAL. An attested node must never carry an
   *  id, an address, a country, an ASN or a client version, and the guarantee
   *  is not that this file remembers to leave them out — it is that
   *  `ProducerStanding` HAS NO FIELD ONE COULD LAND IN. A later edit meaning
   *  well has nowhere to put a `node_id` here without first widening a type
   *  whose doc comment says why it is narrow. The only identity on it is the
   *  payout key the chain actually attests.
   *
   *  Its `fan` does reach real roster rows, and that is the point rather than a
   *  leak: a fan is a statement about OTHER nodes — which crawled peers run
   *  this build — and the type refuses to hand out a set small enough to read
   *  as a name. Nothing on the attested node itself is an identity. */
  attested?: ProducerStanding;
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
