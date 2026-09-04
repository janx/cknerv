/** CPU side of the landing layer's geometry: a fixed ring of flash slots
 *  whose typed arrays ARE the GPU attribute stores (`LandingFlashLayer` binds
 *  them by reference and never reallocates them). Pure bookkeeping, so the
 *  recycling and the resting state can be tested without a frame loop.
 *
 *  A slot is one flash: where (galaxy-local), when it begins, how big its
 *  Cell is, and its onset colour with an amplitude. The shader age-gates
 *  every slot, so a slot is never "cleared" — it is simply ended, and an
 *  ended slot is the one the allocator hands out next. */

/** Slots in the ring. A mainnet block schedules at most `landingMax` (300)
 *  flashes, each alive for one window (0.45 s) spread over the crest's
 *  travel (≤ 1.2 s); two blocks' worth fit with room to spare. */
export const LANDING_FLASH_CAPACITY = 512;
/** "No flash." Sim seconds: the shader's age gate clips it, and the allocator
 *  treats it as long ended — the same sentinel idiom `aFlashAt` uses. */
export const LANDING_FLASH_SENTINEL = -1e9;

export interface LandingFlashRing {
  readonly capacity: number;
  /** Galaxy-local position per slot, packed xyz. */
  readonly position: Float32Array;
  /** Flash onset per slot (sim seconds); the sentinel means empty. */
  readonly at: Float32Array;
  /** The Cell's presentation size per slot (world units). */
  readonly size: Float32Array;
  /** Onset colour + amplitude per slot, packed rgba. */
  readonly color: Float32Array;
  /** The next slot the allocator tries. */
  cursor: number;
  /** Draw prefix: every slot at or past it is empty. */
  high: number;
  /** The latest onset written; the ring is at rest once every flash has
   *  ended, i.e. `now ≥ latestAt + dur`. */
  latestAt: number;
  /** Slots written since the last upload, as an inclusive range;
   *  `dirtyLo > dirtyHi` means none. */
  dirtyLo: number;
  dirtyHi: number;
}

export function createLandingFlashRing(
  capacity = LANDING_FLASH_CAPACITY,
): LandingFlashRing {
  return {
    capacity,
    position: new Float32Array(capacity * 3),
    at: new Float32Array(capacity).fill(LANDING_FLASH_SENTINEL),
    size: new Float32Array(capacity),
    color: new Float32Array(capacity * 4),
    cursor: 0,
    high: 0,
    latestAt: LANDING_FLASH_SENTINEL,
    dirtyLo: capacity,
    dirtyHi: -1,
  };
}

/** Pick the slot for a new flash: the first slot at or past the cursor whose
 *  flash has ENDED by `nowS` (an empty slot has), else — every slot alive at
 *  once, which takes more than the capacity inside one window — the slot
 *  whose flash is OLDEST, so what is lost is what has been on screen longest.
 *  Recycled by age, never by position alone: a flash still to come is never
 *  overwritten by one that happens to be pushed later. */
export function allocateLandingFlashSlot(
  ring: LandingFlashRing,
  nowS: number,
  durS: number,
): number {
  const { capacity, at } = ring;
  for (let step = 0; step < capacity; step += 1) {
    const slot = (ring.cursor + step) % capacity;
    if (at[slot] + durS <= nowS) {
      ring.cursor = (slot + 1) % capacity;
      return slot;
    }
  }
  let oldest = 0;
  for (let slot = 1; slot < capacity; slot += 1) {
    if (at[slot] < at[oldest]) oldest = slot;
  }
  ring.cursor = (oldest + 1) % capacity;
  return oldest;
}

/** Write one flash into the ring and return its slot. */
export function writeLandingFlash(
  ring: LandingFlashRing,
  nowS: number,
  durS: number,
  x: number,
  y: number,
  z: number,
  atS: number,
  size: number,
  r: number,
  g: number,
  b: number,
  amp: number,
): number {
  const slot = allocateLandingFlashSlot(ring, nowS, durS);
  ring.position[slot * 3] = x;
  ring.position[slot * 3 + 1] = y;
  ring.position[slot * 3 + 2] = z;
  ring.at[slot] = atS;
  ring.size[slot] = size;
  ring.color[slot * 4] = r;
  ring.color[slot * 4 + 1] = g;
  ring.color[slot * 4 + 2] = b;
  ring.color[slot * 4 + 3] = amp;
  if (slot + 1 > ring.high) ring.high = slot + 1;
  if (atS > ring.latestAt) ring.latestAt = atS;
  if (slot < ring.dirtyLo) ring.dirtyLo = slot;
  if (slot > ring.dirtyHi) ring.dirtyHi = slot;
  return slot;
}

export interface LandingFlashUpload {
  /** First slot to re-read. */
  start: number;
  /** Slots to re-read (scale both by each attribute's item size). */
  count: number;
}

/** The slots the GPU must re-read since the last take, or null when nothing
 *  was written. Resets the journal. A wrap-around inside one frame widens
 *  this to the whole ring, which is still a few kilobytes. */
export function takeLandingFlashUpload(
  ring: LandingFlashRing,
): LandingFlashUpload | null {
  if (ring.dirtyLo > ring.dirtyHi) return null;
  const upload = { start: ring.dirtyLo, count: ring.dirtyHi - ring.dirtyLo + 1 };
  ring.dirtyLo = ring.capacity;
  ring.dirtyHi = -1;
  return upload;
}

/** How many slots to draw this frame: the high-water prefix while any flash
 *  can still be on screen, and exactly 0 once the newest has ended — at which
 *  point the ring rewinds, so the next pulse fills from slot 0 and its draw
 *  prefix is as short as its flash count. Inside the prefix the shader
 *  age-gates every slot, so a long-ended slot under a live one costs one
 *  clipped vertex and no fragment; at rest the layer draws nothing at all. */
export function landingFlashDrawCount(
  ring: LandingFlashRing,
  nowS: number,
  durS: number,
): number {
  if (ring.high === 0) return 0;
  if (nowS >= ring.latestAt + durS) {
    ring.high = 0;
    ring.cursor = 0;
    ring.latestAt = LANDING_FLASH_SENTINEL;
    return 0;
  }
  return ring.high;
}
