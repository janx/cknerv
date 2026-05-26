import type { Cell } from '@cknerv/types';
import type { TruncatedOctahedron } from '../geometry/truncatedOctahedron';
import { INSTANCE_CAPACITY } from '../geometry/cellPositions';

// Per-tag shell wireframe color. Matches the Gaussian-core palette in
// `CellGalaxy.tsx`'s `COLOR_BY_TAG` exactly so the shell and the cell's
// content speak the same color language. Unknown tags fall back to
// GENERIC_COLOR; the four known runtime values cover today's emitters.
const COLOR_BY_TAG: Record<string, readonly [number, number, number]> = {
  ckbloom: [0.94, 0.67, 0.99],
  dex:     [0.99, 0.83, 0.30],
  cf:      [0.99, 0.64, 0.69],
  wallet:  [0.43, 0.91, 0.72],
};
const GENERIC_COLOR: readonly [number, number, number] = [0.62, 0.78, 1.0];

// One truncated octahedron contributes 36 edges; each edge expands to 2
// LineSegments vertices. So 72 vertex slots per cell.
export const EDGES_PER_CELL = 36;
export const VERTS_PER_CELL = EDGES_PER_CELL * 2;

export interface CellShellBuffers {
  /** Local edge-endpoint xyz (canonical truncated-octahedron vertices). */
  positionArr: Float32Array;
  /** Cell-center xyz, repeated VERTS_PER_CELL times per cell. */
  posArr: Float32Array;
  /** Scene-seconds birth timestamp, per vertex. */
  bornArr: Float32Array;
  /** Scene-seconds death timestamp (`1e9` if alive), per vertex. */
  deathArr: Float32Array;
  /** Scene-seconds most-recent flash timestamp (`-1e9` if never), per vertex. */
  flashArr: Float32Array;
  /** Per-cell rotation phase offset, repeated per vertex. */
  rotPhaseArr: Float32Array;
  /** Per-cell shell size (world units of the rotated local endpoint vector). */
  sizeArr: Float32Array;
  /** Per-cell tag-derived rgb color, repeated per vertex. */
  colorArr: Float32Array;
  /** Number of vertex slots currently used. */
  vertexCount: number;
}

export function allocCellShellBuffers(capacity = INSTANCE_CAPACITY): CellShellBuffers {
  const N = capacity * VERTS_PER_CELL;
  return {
    positionArr: new Float32Array(N * 3),
    posArr: new Float32Array(N * 3),
    bornArr: new Float32Array(N),
    deathArr: new Float32Array(N),
    flashArr: new Float32Array(N),
    rotPhaseArr: new Float32Array(N),
    sizeArr: new Float32Array(N),
    colorArr: new Float32Array(N * 3),
    vertexCount: 0,
  };
}

// Knuth's multiplicative hash → uniform [0, 2π). Deterministic in cell.id;
// adjacent ids land far apart in phase, so the visible jitter looks
// uncorrelated.
const PHASE_HASH_MULTIPLIER = 2654435761;
const TWO_PI = Math.PI * 2;

export function rotPhaseFor(cellId: number): number {
  const h = (cellId * PHASE_HASH_MULTIPLIER) >>> 0;
  return (h / 0x100000000) * TWO_PI;
}

/**
 * Write per-cell, per-vertex attribute slots into the supplied targets.
 * Mutates `targets` and returns nothing — caller owns BufferAttribute
 * `needsUpdate` flags and the geometry `setDrawRange` call.
 *
 * @param blockHighlightDelayS Per-cell birth/death delay offset (seconds).
 *   Mirrors the offset applied in `CellGalaxy.tsx`'s `writeCellBuffers` so the
 *   shell ignites in sync with the Gaussian core. Pass `0` in unit tests where
 *   you want to inspect the raw timestamps; pass `BLOCK_HIGHLIGHT_DELAY_S`
 *   from `CellGalaxy.tsx`'s context (or a future shared constants module) in
 *   production.
 */
export function writeCellShellBuffers(
  cells: ReadonlyArray<Cell>,
  count: number,
  toSceneSeconds: (ms: number) => number,
  blockHighlightDelayS: number,
  flashMap: ReadonlyMap<number, number>,
  geom: TruncatedOctahedron,
  genericSize: number,
  taggedSize: number,
  targets: CellShellBuffers,
): void {
  const { vertices, edges } = geom;
  let vi = 0;
  for (let ci = 0; ci < count; ci++) {
    const c = cells[ci];
    const isTagged = c.tag !== null;
    const bornS = toSceneSeconds(c.born_at_ms) + blockHighlightDelayS;
    const deathS = c.death_at_ms === null
      ? 1e9
      : toSceneSeconds(c.death_at_ms) + blockHighlightDelayS;
    const flashS = flashMap.get(c.id) ?? -1e9;
    const rotPhase = rotPhaseFor(c.id);
    const size = isTagged ? taggedSize : genericSize;
    const color = (c.tag !== null && COLOR_BY_TAG[c.tag]) || GENERIC_COLOR;

    for (let ei = 0; ei < edges.length; ei++) {
      const [iA, iB] = edges[ei];
      const vA = vertices[iA];
      const vB = vertices[iB];

      // Endpoint A
      targets.positionArr[vi * 3 + 0] = vA[0];
      targets.positionArr[vi * 3 + 1] = vA[1];
      targets.positionArr[vi * 3 + 2] = vA[2];
      targets.posArr[vi * 3 + 0] = c.pos_seed[0];
      targets.posArr[vi * 3 + 1] = c.pos_seed[1];
      targets.posArr[vi * 3 + 2] = c.pos_seed[2];
      targets.colorArr[vi * 3 + 0] = color[0];
      targets.colorArr[vi * 3 + 1] = color[1];
      targets.colorArr[vi * 3 + 2] = color[2];
      targets.bornArr[vi] = bornS;
      targets.deathArr[vi] = deathS;
      targets.flashArr[vi] = flashS;
      targets.rotPhaseArr[vi] = rotPhase;
      targets.sizeArr[vi] = size;
      vi++;

      // Endpoint B
      targets.positionArr[vi * 3 + 0] = vB[0];
      targets.positionArr[vi * 3 + 1] = vB[1];
      targets.positionArr[vi * 3 + 2] = vB[2];
      targets.posArr[vi * 3 + 0] = c.pos_seed[0];
      targets.posArr[vi * 3 + 1] = c.pos_seed[1];
      targets.posArr[vi * 3 + 2] = c.pos_seed[2];
      targets.colorArr[vi * 3 + 0] = color[0];
      targets.colorArr[vi * 3 + 1] = color[1];
      targets.colorArr[vi * 3 + 2] = color[2];
      targets.bornArr[vi] = bornS;
      targets.deathArr[vi] = deathS;
      targets.flashArr[vi] = flashS;
      targets.rotPhaseArr[vi] = rotPhase;
      targets.sizeArr[vi] = size;
      vi++;
    }
  }
  targets.vertexCount = vi;
}

/**
 * Flash-only fast path: refresh `flashArr` for every cell from `flashMap`
 * without rewriting the static attributes. Mirrors `writeFlashSlots` in
 * CellGalaxy.tsx — used when a block-highlight or pulse-arrival event
 * mutates the flash map but cells are otherwise stable.
 */
export function writeCellShellFlashSlots(
  cells: ReadonlyArray<Cell>,
  count: number,
  flashMap: ReadonlyMap<number, number>,
  flashArr: Float32Array,
): void {
  let vi = 0;
  for (let ci = 0; ci < count; ci++) {
    const f = flashMap.get(cells[ci].id) ?? -1e9;
    for (let k = 0; k < VERTS_PER_CELL; k++) {
      flashArr[vi++] = f;
    }
  }
}
