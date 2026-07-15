# Protocol Event Visual Review

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
| carrier | 1.10 s | Local handoff close-up | Warm woven carrier approaching the Cell field |
| commit | 3.40 s | Target Cell close-up | Verified write label and expanding agreement seal |
| settled | 6.20 s | Memory-latch close-up | Same Cell/content identity with persistent seal |

The clock, stars, event nonce, and camera choreography are deterministic for the
same input snapshot. The Lab never substitutes generated Cell data for chain
observations.
