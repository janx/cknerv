// Visual constants for the cell-galaxy layer (BIRTH_DURATION_MS, etc.) that
// consumers of the cell layer expect. Positions themselves come from
// `../helix.ts` — the byte-stable TS twin of `cknerv-core::helix` — whose
// cross-language parity contract is anchored by
// `<repo-root>/tests/fixtures/helix_seed.json`; see
// `packages/ui/__tests__/helix-parity.test.ts`.

/** Hard visual ceiling shared by every instanced Cell layer. The default
 * server projection uses the same live-cell cap; a short death tail can remain
 * in the browser cache without overflowing because draw ranges clamp here. */
export const INSTANCE_CAPACITY = 50_000;
export const BIRTH_DURATION_MS = 500;
export const DEATH_DURATION_MS = 600;
