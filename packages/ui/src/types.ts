// Chain-generic primitive types used across the @cknerv/ui surface.
//
// The wire types (Cell, Mutation, ChainEntry, ...) live in
// `@cknerv/types`; this module holds shape helpers internal to the
// component layer (geometry vectors, graph-node shapes, animation
// hints) that are not part of the cknerv-core wire contract.

import type { Peer } from '@cknerv/types';

export type Vec3 = [number, number, number];

/**
 * Minimal graph-node shape consumed by `GlowNode` and other generic
 * topology primitives. Consumers (simulator, cknerv-cli) carry their
 * own richer per-node metadata and project it down to this shape at
 * the prop boundary.
 *
 * `kind` is an opaque string the renderer doesn't interpret — the
 * caller is responsible for mapping kind → palette/shape via the
 * `palette` / `shape` props. `cluster` is an optional grouping key for
 * future clustering visualizations.
 */
export interface GraphNode {
  id: string;
  kind: string;
  label: string;
  size: number;
  pinned?: boolean;
  cluster?: string;
}

/**
 * Animation hint a renderer may apply to a single node this frame.
 * Mirrors the shape simulator uses — chain-generic in that the visual
 * vocabulary (pulse, flash) is decoupled from any specific event-type
 * meaning.
 */
export type AnimationHint =
  | { type: 'pulse_blue' }
  | { type: 'flash_green' }
  | { type: 'flash_red' };

/**
 * Minimal graph-edge shape (kept here for parity with `GraphNode`;
 * primitive consumers may extend this when they need a richer edge
 * description).
 */
export interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

export type NodeKind = 'local' | 'measured' | 'inferred';
export type EdgeKind = 'measured' | 'inferred';

/** One node in the P2P colony. Only `measured`/`local` carry real data. */
export interface NetworkNode {
  id: string;            // real node_id (local/measured) | 'inf:<n>' (inferred)
  kind: NodeKind;
  pos: Vec3;
  peer?: Peer;           // present ONLY on measured nodes
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
