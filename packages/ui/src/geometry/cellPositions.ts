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

// Stage enter/exit are VIEW events — the camera resolving a record that
// already existed, or letting an alive one go — so they read as quieter and
// flatter than the record's own birth/death and must never be mistaken for
// them. Both windows are deliberately longer than the chain gestures above.

/** Stage ENTER fade: alpha 0→1 with a small scale lift, no overshoot. */
export const ENTER_FADE_MS = 900;
/** Stage EXIT fade: alpha →0 with a small scale loss. A departing cell keeps
 * its GPU slot for exactly this long, which is why the slot budget below
 * exists at all. */
export const EXIT_FADE_MS = 900;
/** GPU slots reserved for exits that are still fading. Per-block stage churn
 * at the AUTO budget is a few hundred cells; past this ceiling the OLDEST
 * fades complete instantly rather than letting the drawn list grow without
 * bound (one hidden stretch's worth of churn arrives as a single batch). */
export const EXIT_HOLD_MAX = 768;
