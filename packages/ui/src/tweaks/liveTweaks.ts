// Mutable live values for the backtick tuning panel. `TweakSync` writes here
// from leva; frame-loop consumers read `LIVE.<folder>.<key>` each frame. The
// singleton and its folder objects are allocated once and mutated in place —
// never reallocated — so reads in hot loops never chase a moving reference and
// no per-frame garbage is produced.
import {
  galaxySchema, deliverySchema, peerSchema, cellSchema, type FolderSchema,
} from './tweakSchema';

export function defaultsFrom(schema: FolderSchema): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(schema)) out[key] = schema[key].value;
  return out;
}

export type GalaxyLive = { [K in keyof typeof galaxySchema]: number };
export type DeliveryLive = { [K in keyof typeof deliverySchema]: number };
export type PeerLive = { [K in keyof typeof peerSchema]: number };
export type CellLive = { [K in keyof typeof cellSchema]: number };

export interface LiveTweaks {
  galaxy: GalaxyLive;
  delivery: DeliveryLive;
  peer: PeerLive;
  cell: CellLive;
}
export type PartialLive = { [F in keyof LiveTweaks]?: Partial<LiveTweaks[F]> };

export const LIVE: LiveTweaks = {
  galaxy: defaultsFrom(galaxySchema) as GalaxyLive,
  delivery: defaultsFrom(deliverySchema) as DeliveryLive,
  peer: defaultsFrom(peerSchema) as PeerLive,
  cell: defaultsFrom(cellSchema) as CellLive,
};

export function applyTweaks(live: LiveTweaks, values: PartialLive): void {
  if (values.galaxy) Object.assign(live.galaxy, values.galaxy);
  if (values.delivery) Object.assign(live.delivery, values.delivery);
  if (values.peer) Object.assign(live.peer, values.peer);
  if (values.cell) Object.assign(live.cell, values.cell);
}
