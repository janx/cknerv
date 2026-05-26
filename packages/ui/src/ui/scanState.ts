import type { Grid } from '../cellLife/gameOfLife';

/**
 * Ref-backed snapshot of the 3D sub-scene state, read once per HUD
 * frame to update text/bracket overlays. The sub-scene mutates the
 * fields directly each useFrame tick; the HUD overlay reads them via
 * a setInterval (~100ms) to avoid React re-render storms.
 */
export interface ScanStateRef {
  /** Latest GoL grid snapshot. Mutated in place by the stepper. */
  grid: Grid;
  /** Generation counter, incremented each stepGrid call. */
  generation: number;
}
