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
