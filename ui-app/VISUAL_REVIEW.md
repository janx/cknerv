# Visual Review Labs

This file defines the deterministic capture workflow. The requirements those
captures validate live in
[`docs/canvas-rendering.md`](../docs/canvas-rendering.md).

## Startup Handoff

For production and every Lab route, first wait for `#cknerv-startup` to be
removed, then apply the route's existing ready marker. Test bundle delay,
256 KiB/s snapshot throttling, a chain-only 15 s delay, missing/encoded content
length, binary-to-JSON fallback, and request failure with browser interception.
At 8 s without activity the shell must say `STILL WAITING FOR DATA`; at 30 s it
must expose `RELOAD`. A new chunk withdraws the waiting copy. Capture widths
1440, 768, 390, and 320 px plus narrow landscape, and repeat with reduced motion.
The App must remain at its fitted camera pose across handoff and resize, while a
user-owned orbit remains unchanged after the startup layer is gone.

## Protocol Event

Use the protocol-event Lab to review the selected A visual language against a
real Cell snapshot:

```text
/?protocol-event-lab=1&stage=network
/?protocol-event-lab=1&stage=carrier
/?protocol-event-lab=1&stage=commit
/?protocol-event-lab=1&stage=settled
```

## Capture Contract

- Viewport: 1440 × 900, DPR 1, default high quality.
- Wait for `[data-review-ready="true"]` and `document.fonts.ready` before capture.
- Compare stages by clicking the four stage controls in one mounted page. A page
  reload fetches a fresh live snapshot and is not a stable cross-stage fixture.
- Record `data-review-time`, `data-review-focus`, and `data-review-writes` with
  the image. `focus` must match one of the actual written Cell ids for commit
  and settled captures.

| Stage | Time | Composition | Expected evidence |
|---|---:|---|---|
| network | 0.30 s | Distributed wide view | Propagation across independent witnesses |
| carrier | 1.10 s | Local handoff close-up | The block's last hop in flight: a courier mote with its plume, in the block's carrier hue, most of the way up the axis from the anchor (whose halo has just let its held breath go) toward the membrane — no wireframe, no streak, nothing white. Its absorption at contact and the tissue's answer (annulus front, fibre flush, plain landing flashes) release at 1.6 s, into the commit window |
| commit | 3.40 s | Target Cell close-up | Verified write label and expanding agreement seal |
| settled | 6.20 s | Memory-latch close-up | Same Cell/content identity with persistent seal |

The clock, stars, event nonce, and camera choreography are deterministic for the
same input snapshot. The Lab never substitutes generated Cell data for chain
observations.

## Cell Identity Proof Baseline

Use the identity-proof Lab to compare the production WHERE / WHAT / WHEN
renderers at fixed semantic frames:

```text
/?cell-proof-lab=1&stage=entry&quality=high
/?cell-proof-lab=1&stage=key&quality=high
/?cell-proof-lab=1&stage=late&quality=high
/?cell-proof-lab=1&stage=reduced&quality=high
```

Add `&cell=<id>` to pin a Cell from the current snapshot. The Lab preserves
that Cell's real outpoint, content hash, and birth block while normalizing only
its review pose so each proof has a stable semantic camera composition.

### Capture Contract

- Viewport: 1440 × 900, DPR 1, explicit `quality=high`.
- Wait for `[data-cell-proof-review][data-review-ready="true"]` and
  `document.fonts.ready`.
- Expect one label per proof: WHERE expands right; WHAT and WHEN expand left.
- `entry`, `key`, and `late` remain fixed animated samples. `reduced` uses the
  actual reduced-motion renderer rather than an animation paused at the end.
- Record `data-review-stage`, `data-review-quality`, and `data-review-cell`
  with the capture.

| Stage | WHERE | WHAT | WHEN | Review intent |
|---|---:|---:|---:|---|
| entry | 0.16 s | 0.17 s | 0.28 s | Geometry arrives before explanation |
| key | 0.36 s | 0.36 s | 0.72 s | Proof form and exact evidence coexist |
| late | 0.84 s | 0.88 s | 1.16 s | Resolve while evidence remains legible |
| reduced | static | static | static | Complete proof without simulated motion |

The GPU-independent golden contract lives at
`packages/ui/__tests__/fixtures/cellIdentityProofVisualBaseline.json`. It locks
the representative geometry, encoded evidence, event frame, label placement,
color, and typography tokens under ordinary `pnpm test`. Update it only with an
intentional visual-language change and a matching browser review.

## Quality-neutral Optimization Pairs

A task that claims a change is INVISIBLE owes a pair of captures of the same
pose, one per side of the change, and has to say which poses a pixel diff can
answer for and which only an eye can. Two pairs from the 2026-09-12 render-perf
pass, with the recipe each was taken with:

**Two-sided materials drawn in one pass** (`forceSinglePass` at every
`DoubleSide` declaration; the renderer otherwise draws back faces and front
faces as two passes). Three of the four affected poses are transparent
two-sided geometry whose ordering a reader could in principle see:

| Pose | Capture | Diff answers? |
|---|---|---|
| Portrait ribbon | `/?cell-relic-lab=1&cell=<id>` — the controlled matrix, reduced motion, one pinned source Cell | Yes, byte-identical across independent loads |
| Selection glyph | `/?cell-proof-lab=1&stage=key&quality=high&cell=<id>` | Yes, byte-identical across independent loads |
| Cohort lens at a close dolly | production, seven wheel notches in from the fitted pose | No — two captures of the SAME build differ by 47 % |
| Contact wave on a landing | production, four shots 220 ms apart off `__blockFrameStats().count` | No — same-build floor 22 % |

Pin a Cell that is still STAGED: the oldest staged native (the Lab's own
fallback) rotates off the stage within minutes, while a median-birth native
holds for a whole session. Both Labs report the resolved id, so record it
(`data-review-cell`, and the relic Lab's header line) with the capture. Take
two loads per side, two shots three seconds apart in each, and hash all four:
the first load after a source edit carries vite's re-transform timing and can
differ in a readout band that is not the material.

**The tier a busy machine keeps, and the frame a leader comes back on** (§13's
busy-aware down-gate and §11.3's drift-settled motion window). Neither has a
pose of its own — what changes is WHICH tier the page is in and WHEN hidden
leaders return — so both are read as a tier plus a frame count, with a capture
of the tier the eye is being asked about:

- Idle for 90 s with a load competitor beside the page and nothing else
  touched, at `/?render-stats=1` with no explicit `quality=`: record
  `data-quality-effective` and `__qualityStats()` every 5 s. AUTO must hold the
  tier it warmed at; a walk down to Low is the fault this gate refuses. Capture
  the scene at the start and the end — the same density, the same DPR, the same
  ambient counts.
- Release an orbit of about a tenth of a radian on a page with a Cell selected
  and record, per frame, `poseDriftPx`, whether any `[data-cell-leader]` is
  visible, and whether a hover answers. The leaders and picking must come back
  within about 40 frames of the release, not 120; nothing about the leader
  geometry may differ from the pose's at-rest capture.

Read both of these on a real GPU. A software rasterizer renders this scene at
about a frame a second, which is neither a frame budget nor a damping tail.

## Production Cell Inspection Layout

Review this behavior on the production dashboard route with a real snapshot;
the proof Labs do not mount the production constellation. Wait for
`#cknerv-startup` to disappear and `document.fonts.ready`, select a real Cell,
then wait for the analysis instrument's `data-cellular-scan-state="locked"`.
Record the Cell id, viewport, DPR, constellation status/template, reticle and
name-chip rectangles, each open plate rectangle, route path, route-label
rectangle, and the specimen window rectangle.

Use the viewport set `1920×1080`, `1920×920`, `1440×900`, `1280×800`,
`1180×663`, and `820×1078`. Cover a centered Cell and positions near each edge;
repeat one desktop capture at DPR 2 and the tablet shapes in Safari/WebKit when
those engines are available. The geometry must remain in CSS pixels. A valid
capture has a full-stage leader SVG, no route through a plate, name, reticle,
visible HUD remnant, or another leader, and no label over those obstacles.

For long analysis content, scroll
`[data-cell-panel-scroller="analysis"]` to the bottom and record its
`scrollTop`, `clientHeight`, and `scrollHeight`. Confirm CAPACITY, DATA, and the
provenance footer remain reachable. Close one plate and confirm the selection,
other plates, portrait, and scan clock stay mounted while the removed leader
and mask disappear. Resize the same selected Cell where possible so the test
also covers cache invalidation without changing data or camera state.

Inspect the specimen over a bright part of the galaxy: the portrait remains
visible through its transparent square, while leader underlays, glows, dots,
and labels do not enter it. HUD plates continue to dim per actual inspection
panel rectangle. The specimen window must remain
square and inside its plate at every compressed layout.

### The signals a capture reads

Read these off the DOM rather than off the picture; the screenshot illustrates
the report, it is not the report.

| Signal | Where | Says |
|---|---|---|
| `data-cell-constellation-status` | `[data-cell-inspection-overlay]` | `normal`, `compressed`, or `unavailable` — a statement about room, never about lines |
| `data-cell-constellation-leaders` | same | `clean` or `degraded` for the whole layout |
| `data-cell-constellation-template` | same | absent while `unavailable` |
| `data-cell-constellation-motion` | same | `moving` on a frame the camera gate owns; every seat journey is snapped to its end there |
| root `opacity` | same | `1` except for an off-screen anchor and the exit. A solve, a height change, or a roomless stage must never take it off `1` |
| `data-cell-panel-capped` | `[data-cell-constellation-panel="<slot>"]` | the plate is cut and scrolls |
| `style.transform` / `style.height` | same | the live seat; both change on every frame of a journey |
| `data-cell-leader-degraded` | `[data-cell-leader="<slot>"]` | `true` is the straight fallback; the sheet dashes its `[data-cell-leader-stroke="over"]` `4 3`. A journey never changes it |
| `style.visibility` | the leader group's two strokes, its endpoint circle, and `[data-cell-leader-label="<slot>"]` | `hidden` for the whole of a seat journey and during camera motion |
| `[data-cell-panel-route-label="<slot>"]` | inside the plate | the in-panel fallback label. It is not a leader and is NOT hidden by a journey |
| `window.__constellationWorkStats()` | page | `fullSolves`, `degradedRoutes`, `routeGridPoints`, `routeCapHits`, `unavailableHolds`, `refineStarts` / `refineLandings` / `refineUpgrades` / `refineDropped`, `chipRelocations`, `seatTweens`, `cursorMaxSliceMs`. `window.__constellationWorkStatsReset()` zeroes them before a scenario |

Record per capture: viewport, DPR, Cell id, anchor (the reticle rect's centre),
the four status attributes, every plate rectangle with its `capped` flag and
its scroller's `clientHeight`/`scrollHeight`, every leader's `d`, visibility and
degraded flag, the leader-label and mask rectangles, the chip rectangle, the
root opacity, which HUD rails carry `data-hud-dim="true"`, the counters, and the
console. A valid capture also has no plate overlapping another, nothing
off-stage, no route point strictly inside a plate it does not point at, no
route point inside the reticle, and no leader label over a plate.

For anything measured per frame — drift, a seat journey, a growing plate —
record from a page-side `requestAnimationFrame` loop into an array and dump it
once. A round trip per frame measures the driver.

### Capture contract

| # | Scenario | Pass criterion |
|---|---|---|
| 1 | 1920×1080 with rails; a Cell selected, then carried under a rail by an orbit or by the canopy's own turn | Every plate keeps its seat; `status` never becomes `unavailable`; the leaders under the rail are cut by the mask, not withdrawn; a fallback among them carries `data-cell-leader-degraded="true"` and is dashed; root opacity never leaves `1` |
| 2 | 1920×1080 and 1180×663 with MEMORY TRACE armed (the register's `recall causal path` control, enabled once `data-memory-identity-complete="true"`), four plates | The fourth plate is seated within 3 rAF of mounting; `cursorMaxSliceMs` ≤ 8 ms; root opacity never leaves `1` |
| 3 | 1024×600 and 800×600 | Either three seated plates or a quiet `unavailable` with the reticle and chip still tracking; at most one `fullSolves` increment per second while the Cell drifts |
| 4 | 10 s or more of canopy drift at 1440×900 and 1920×1080 with three plates and no input | Seat changes ≤ 2 per 160 px of anchor travel and `seatTweens` equal to them; each journey ~15 frames at 60 Hz; no leader visible on any frame where a plate's transform changed; `chipRelocations` counted |
| 5 | Enrichment arriving on a bare Cell, and the reader loading on a Cell with bytes | Root opacity never leaves `1`; the grown plate keeps its x and its top (or its bottom if it grew upward); no other plate moves |
| 6 | Reduced motion (`prefers-reduced-motion: reduce`), and High/Med/Low (`?quality=`, read back as `data-quality-effective`) | The same seats; under reduced motion `seatTweens` is 0 and a seat change appears between two consecutive frames with no intermediate transform |
| 7 | DPR 2, and WebKit where a build exists | The same report. Geometry stays in CSS pixels |

Two captures want a human eye rather than a predicate: 820×1078 with three
plates, where a full-height instrument is preferred to a compressed one with a
solid leader; and 1920×1080 with the rails at the 0.22 and 0.78 anchors, where
three leaders stay dashed after refinement and the register stands over the
right-hand rails after a rightward drift instead of crossing the stage.

⚠️ A headless browser on a software rasterizer renders this scene at about one
frame a second, which is not enough to resolve a 240 ms journey or to let
OrbitControls' per-frame damping tail come to rest. Record the measured frame
interval with every per-frame capture, and read the counters rather than the
frames where the two disagree.
