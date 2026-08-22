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
// Chain birth/death belong to the RECORD, and both are processes: a cell is
// built, and a cell decays. Their curves (`birthEase` / `deathEase` in
// materials/cellEnvelope.glsl.ts) fill these windows; the windows only decide
// how long the eye is given to read them. The old half-second windows read as
// two pops beside the fabric's own 1200/1500 ms growth and decay, which is why
// fibres kept outliving the dots they hang from.

/** Chain BIRTH: slow emergence, an overshoot past resting size, a settle. */
export const BIRTH_DURATION_MS = 1200;
/** Chain DEATH: the body cools and gutters at size, then crumbles. The
 * withering starts at `death + BLOCK_HIGHLIGHT_DELAY_S` and runs this long,
 * so the server's dead-cell retention tail
 * (`CORPSE_HOLD_MS` in `crates/cknerv-core/src/projection/cells.rs`) must
 * dominate their SUM — a corpse gc'd before the rite ends vanishes
 * mid-wither. The two are pinned against each other in the shared fixture
 * `tests/fixtures/death_rite.json`: moving this number (or
 * `BLOCK_HIGHLIGHT_DELAY_S`) fails
 * `packages/ui/__tests__/geometry/deathRiteFixture.test.ts` until the
 * fixture — and then the Rust hold — follow. */
export const DEATH_DURATION_MS = 1800;

// Stage enter/exit are VIEW events — the camera resolving a record that
// already existed, or letting an alive one go — so they read as quieter and
// flatter than the record's own birth/death and must never be mistaken for
// them: no overshoot, no colour change, and a span that now sits INSIDE both
// chain windows, so a view change can never claim the weight of a record
// being created or consumed.

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
