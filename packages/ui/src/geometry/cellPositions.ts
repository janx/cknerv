// Visual helpers for the cell-galaxy layer.
//
// `helixSeedFor` is the f64 form of the cell-galaxy deterministic
// position function. Single calculation path lives in `../helix.ts`
// (the byte-stable TS twin of `cknerv-core::helix`); this module just
// re-exports under the historical name + adds visual constants
// (BIRTH_DURATION_MS, etc.) that consumers of the cell layer expect.
//
// The cross-language parity contract is anchored by
// `<repo-root>/tests/fixtures/helix_seed.json` — see
// `packages/ui/__tests__/helix-parity.test.ts`.

import { helixSeedF64 } from '../helix';

/**
 * f64 form of the cell-galaxy position function. Compatibility alias for
 * the simulator-era name; new consumers should import `helixSeedF64`
 * directly from `@cknerv/ui` / `@cknerv/ui/helix`.
 */
export function helixSeedFor(id: number): [number, number, number] {
  return helixSeedF64(id);
}

/** Hard visual ceiling shared by every instanced Cell layer. The default
 * server projection uses the same live-cell cap; a short death tail can remain
 * in the browser cache without overflowing because draw ranges clamp here. */
export const INSTANCE_CAPACITY = 50_000;
export const BIRTH_DURATION_MS = 500;
export const DEATH_DURATION_MS = 600;
