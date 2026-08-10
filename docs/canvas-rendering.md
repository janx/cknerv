# Canvas Rendering Design

This document is the normative rendering contract for the production cknerv
Canvas in `ui-app/src/App.tsx` and the reusable scene layers in `packages/ui/`.
It defines what the visualization must communicate, which costs a quality
preset may reduce, and how a rendering change is accepted.

The deterministic capture procedure is documented separately in
[`ui-app/VISUAL_REVIEW.md`](../ui-app/VISUAL_REVIEW.md). This document owns the
requirements; the review guide owns the browser workflow.

## Goals

The Canvas must:

- make CKB's Cell model visible as a living Cell galaxy;
- make canonical relationships visible as a dense neural fabric, not isolated
  points or an unrelated network diagram;
- distinguish the warm Cell data plane from the cool peer/network data plane;
- make real births, deaths, writes, routes, recalls, and canonical corrections
  legible without inventing chain events;
- remain responsive on a local dashboard while preserving the visual and
  semantic invariants below; and
- provide deterministic review scenes for intentional visual changes.

Performance is a requirement, but it is not permission to silently remove the
visual structure that explains the chain.

## Sources of Truth

The browser renders derived views over canonical cache state:

```text
CKB node -> mutations/snapshots -> @cknerv/cache
                                  |-- complete Cell and routing state
                                  `-- bounded visible Cell set
                                        |-- Cell bodies
                                        |-- passive nerve fabric
                                        `-- active routes and inspection
```

The following rules are non-negotiable:

- A displayed Cell, endpoint, route, pulse, or canonical-rewrite witness must
  derive from observed chain data. Review normalization may change a camera or
  pose, but must not substitute generated Cell records.
- `pos_seed` and the Rust/TypeScript helix contract own deterministic Cell
  position. A renderer must not introduce a second positioning calculation.
- The complete neighbor graph owns causal route planning. The bounded passive
  graph is a visual selection of that graph and cannot create new adjacency.
- Optional enrichment may select and classify node-revalidated Cells, but it
  cannot create, spend, or replace canonical Cells.
- A quality transition is presentation state. It must not mutate cache state,
  chain counters, Cell identity, or event ordering.

## Visual Language

| Layer | Required reading | Data owner | Rendering constraint |
|---|---|---|---|
| Background and stars | Deep field and scale | Ambient only | May scale with quality; must not carry chain meaning |
| Peer network | Cool cyan synthetic data plane | Chain/peer entity view | Must remain visually distinct from Cell nerves |
| Cell bodies | Warm rose living records | Visible canonical Cell set | Stable identity and position; lifecycle and selection accents may animate |
| Passive Cell nerves | Crimson/rose neural tissue | Passive selection of the canonical neighbor graph | Abundant and obvious at every quality preset |
| Warm routes | Recently used consensus paths | Observed route usage | Must ride the same curve as the passive nerve |
| Active writes | Bright packet wavefronts and terminal response | Real pulse/link events | May reduce transient sampling by preset, never disappear semantically |
| Memory routes | Explicit historical recall | Retained canonical evidence | Separate screen-weighted layer; must remain identifiable at distance |
| Rewrite echo | Fractured invalidated suffix | Canonical prune witness | Must never be presented as a synthetic replacement fork |
| HUD | State, controls, and evidence | DOM outside the main Canvas | Must not be baked into scene textures solely for convenience |

The warm Cell palette lives in `packages/ui/src/visualPalette.ts`. Resting Cell
nerves stay inside the crimson/rose family; peer scaffolding stays cyan. A
change that collapses those two planes into the same color family is a visual
language change and requires browser review.

## Cell Galaxy Contract

### Visible membership

- Instanced Cell layers have a hard capacity of 50,000 records.
- AUTO resolves its structural budget from the effective quality tier
  (explicit product decision, 2026-08-10): High 50,000, Med 20,000,
  Low 6,000 — or every Cell when the retained field is smaller. Low
  preserves the historical single stable budget, so the weakest hardware
  keeps its long-proven behavior.
- Tier membership is nested and deterministic: a lower tier's visible set is
  a subset of a higher tier's, resolved by the same selection rules from the
  same retained cache. A tier change is one canonical render-set rebuild —
  exactly the path a manual budget change already takes.
- Tier changes ride the adaptive-quality hysteresis (evidence windows plus
  switch cooldown). The density feedback loop that previously justified a
  single fixed budget is bounded by that hysteresis and by the journal-driven
  O(churn) rebuild economics.
- Quality-driven reveal/conceal is not a biological event. Cells entering the
  visible set render in their time-parametric lifecycle state (typically
  settled — born long ago); they must not fire birth or death choreography,
  and HUD counters keep reporting the retained totals, never the display
  budget.
- Manual Cell count remains independent from render quality and may request up
  to the 50,000-Cell renderer ceiling.
- The selected Cell, its bounded inspection neighborhood, and current activity
  endpoints are pinned into the visible prefix when required. A visible nerve
  must never terminate at a quality-hidden Cell.

### Passive nervous system

The Cell galaxy must read as a neural network in every quality mode, including
when no new block is arriving.

- The passive budget is `round(visible_cells * 4 / 3)`, bounded only by the
  full-field ceiling of 66,667 edges (50,000 Cells x 4/3). The nerve budget
  follows the visible Cell count at every quality tier (explicit product
  decision, 2026-08-10): the tiers render 8,000 / 26,667 / 66,667 resting
  nerves for their 6,000 / 20,000 / 50,000 Cell fields, so the
  nerves-per-Cell ratio - the visual identity of the nervous system - stays
  constant and a denser field never reads bald.
- GPU buffer allocation quantizes to one class per tier budget
  (`fabricAllocationEdges`); the fabric remounts through one canonical
  rebuild when the display budget crosses a class boundary, so a machine
  that settles on the Low tier never holds High-tier buffers.
- A deterministic spanning forest is selected first. In the default AUTO
  field this keeps every connected visible Cell attached to the rendered
  nervous system.
- Still-valid prior edges are considered next so ordinary churn preserves
  local continuity. Hierarchical trunks, twigs, and deterministic cross-links
  fill the remaining budget.
- Every passive quadratic Bezier uses four samples at every quality preset.
- Passive lifecycle and mask transitions render at the normal animation
  cadence. They must not acquire a quality-dependent FPS limiter.
- Passive lines use bounded screen accumulation so dense overlap approaches a
  ceiling instead of clipping to a uniform white mass. Active paths remain in
  separate additive layers and retain visual headroom.

Manual fields derive their nerve budget by the same ratio and quantize into
the same allocation classes. Coverage stays first: the spanning forest of any
tier-scale field now fits its own budget, so every connected visible Cell
remains attached to the rendered nervous system at every tier.

Current presentation defaults are a 2.5 CSS-pixel passive width, `0.15` fabric
energy, a `0.44` midpoint taper floor, and a `0.34` weak-twig floor. These are
art-direction baselines, not performance controls. Reducing them requires a
visual-language review rather than a performance-only change.

### Routing and lifecycle

- The active pulse, warm reinforcement, memory trace, and passive nerve for
  the same edge must use the same deterministic Bezier control point.
- Birth, death, retraction, flash, and route timing advance on simulation time.
  A slow frame may advance animation state; it must not drop the semantic
  event or select a different route.
- New edges grow and removed edges decay through persistent keyed lifecycle
  state. A graph refresh must not wipe and redraw the entire fabric as an
  unrelated shape.
- Reorg pruning removes orphan routes and queued visual events before canonical
  replacement events arrive. Only real replacement births use the normal
  re-entry animation.

## Canvas and Clock Contract

The production Canvas currently uses:

- camera position `[110, 108, 110]`, FOV `50`, near `1`, far `3000`;
- WebGL antialiasing and an alpha-capable renderer;
- CSS background `#02030a`; and
- device DPR clamped by the effective quality preset, never below CSS-pixel
  density.

Camera values are composition defaults, not wire contracts, but changes must
be reviewed at desktop and narrow layouts because they affect Cell/nerve
readability and HUD occlusion.

`SimClockTicker` advances the selected simulation clock at frame priority
`-1000`. Simulation consumers use `useSimFrame`; camera input, billboarding,
and performance sampling use raw `useFrame` because they must remain responsive
while simulation is paused.

- Production mounts one clock ticker under the R3F context.
- Pause and time scale apply consistently to every simulation animation.
- A review scene may use a scoped clock, fixed delta, and exact stop boundary.
- A paused review Canvas may use demand rendering. Production remains live.
- Reduced motion is an explicit complete renderer state, not an animation
  paused on an arbitrary incomplete frame.

## Quality Presets

Quality owns raster density, ambience, and bounded transient detail. It does
not own Cell membership or the passive nervous system.

| Setting | High | Med | Low | Allowed meaning |
|---|---:|---:|---:|---|
| Maximum DPR | 2.0 | 1.5 | 1.0 | Raster cost |
| Stars | 2,000 | 600 | 200 | Ambient density |
| Particle capacity multiplier | 1.0 | 0.5 | 0.25 | Transient particles |
| Discharge arms | 3 | 2 | 1 | Transient write decoration |
| Active samples per hop | 12 | 10 | 8 | Moving wavefront tessellation |
| Expanded nearby Cell identities | 12 | 8 | 4 | Non-focused near-detail concurrency |

Semantic memory retains a 24 CSS-pixel minimum core at all presets. Lower
presets compensate reduced sampling with controlled line-width/filter changes;
they must not drop checksum lanes or the focused record.

The following remain identical across High, Med, and Low:

- the visible-membership selection rules and ordering (the per-tier budgets
  above change how many Cells render, never which rules pick them);
- the passive selection rules and the 4/3 nerves-per-Cell ratio (per-tier
  budgets change how many nerves render, never how they are chosen);
- four passive samples per edge;
- passive curve shape, width baseline, energy hierarchy, and animation cadence;
- event identity, route, start/end times, and terminal response; and
- inspection focus, selected Cell, and canonical evidence.

AUTO quality samples raw frame time with warmup, hysteresis, and cooldown.
Hidden tabs, debugger pauses, and delayed callbacks are not renderer evidence
and must not trigger a quality change. Manual High/Med/Low takes ownership
immediately.

## Reference Budgets

| Budget | Current value | Owner |
|---|---:|---|
| Instanced Cell capacity | 50,000 | `geometry/cellPositions.ts` |
| AUTO visible Cells | High 50,000 / Med 20,000 / Low 6,000 | `tweaks/cellDisplay.ts` |
| Passive nerves | visible Cells x 4/3 (High 66,667 / Med 26,667 / Low 8,000) | `geometry/passiveNeighborGraph.ts` |
| Passive curve samples | 4 per edge | `nerve/fabricCapacity.ts` |
| Passive lifecycle generations | 3 | `nerve/fabricCapacity.ts` |
| Passive segment allocation | per class: edges x 3 x 4 (ceiling 800,004) | `nerve/fabricCapacity.ts` |
| Sparse warm-route allocation | per class: edges x 4 (ceiling 266,668) | `nerve/fabricCapacity.ts` |
| Live active-route allocation | 6,000 segments | `nerve/NeuralFabric.tsx` |
| Memory-route allocation | 6,000 segments | `nerve/NeuralFabric.tsx` |
| Cell birth envelope | 500 ms | `geometry/cellPositions.ts` |
| Cell death envelope | 600 ms | `geometry/cellPositions.ts` |

These values are implementation limits with visual consequences. If one
changes, update its unit tests and this table in the same change.

## Performance Constraints

### Preferred optimization order

Optimize work that cannot affect a visible result before changing visible
budgets:

1. Eliminate redundant CPU calculation and per-frame allocation.
2. Move per-object invariants out of fragment hot paths when interpolation is
   visually equivalent.
3. Upload only dirty/populated buffer ranges.
4. Separate position and color dirtiness when topology is unchanged.
5. Draw only primitives that can produce a fragment, while keeping the exact
   shader gate as the authority.
6. Move topology construction to workers and keep latest-only cancellation.
7. Reduce equivalent geometry, such as the two-triangle screen-space capsule,
   only after proving the silhouette, width, cap, and color interpolation.
8. Use the quality-owned transient controls in the table above.

Examples already following this order include shared Cell attributes, sparse
flash indices, dirty-range uploads, color-only passive-fabric updates, worker
neighbor builds, and screen-space capsule nerves.

### Forbidden performance shortcuts

A performance-only change must not:

- introduce quality-dependent passive edge caps, passive samples, or passive
  animation FPS;
- shrink a tier's visible membership below its sanctioned AUTO budget, change
  the selection rules per tier, or add membership rungs outside the Visible
  membership section (the tiered budgets themselves are a signed product
  decision, not a precedent for further quality-driven trimming);
- shorten, skip, or coalesce a semantic animation so that an observed event is
  no longer visible;
- replace a real route with a cheaper synthetic route;
- lower passive width/energy until the resting nervous system stops reading;
- rebuild the Cell set or topology in response to adaptive quality alone
  (a tier change's single canonical render-set rebuild is the sanctioned
  exception);
- remove focused identity/evidence or make it sub-pixel; or
- claim a gain from a hidden/throttled browser tab.

If a target cannot be met without one of these changes, treat it as an explicit
product/art-direction decision, not an implementation optimization.

### Hot-path discipline

- Reuse typed arrays and scratch vectors; avoid object/array creation inside
  Cell, edge, and pulse loops.
- Keep high-frequency state in refs or external stores instead of publishing
  React state every frame.
- Preserve shared BufferAttributes where layers consume the same Cell data.
- Mark only populated prefixes or exact dirty ranges for GPU upload.
- Keep stable topology buffers untouched during color-only transitions.
- Bound all persistent, transient, and afterimage pools. Under saturation,
  clip low-priority afterimages before current canonical structure.
- Keep picking work out of orbit-drag frames and avoid full-field projection
  scans when the pointer action cannot select a Cell.

Transparent overdraw remains the dominant large-field GPU risk. Draw calls,
triangle counts, and upload bytes are useful diagnostics, but none alone proves
visual equivalence or user-perceived smoothness.

## Interaction Constraints

- Orbit movement suspends expensive Cell picking once actual camera movement
  begins; a click without movement must still select correctly.
- The nested Cell Scan owns its pointer gesture until release. It rotates its
  inspection camera without moving the Galaxy camera.
- Pointer miss and Escape clear inspection only when another gesture does not
  own the action.
- Camera damping, projected labels, and close-view fabric weighting remain
  responsive while simulation is paused.
- Selected and inspected Cells retain bounded priority in rendering and picking
  at every quality preset.

## Acceptance

### Automated checks

For Canvas behavior changes, run at minimum:

```bash
pnpm test
pnpm typecheck
pnpm -F cknerv-ui-app build
```

When validating the embedded production SPA, also run:

```bash
cargo build --release -p cknerv-cli
```

Tests should pin semantic invariants and budget ownership, not merely search
for an implementation spelling when a pure behavior test is practical.

### Browser matrix

Use a fresh visible browser context for each explicit preset. Reusing a page
after freezing its lifecycle can leave it hidden and produce false zero-draw or
default-size Canvas results.

| Scenario | Required checks |
|---|---|
| Main Canvas, High/Med/Low | Same AUTO Cell membership, passive nerve count/topology, curve shape, and obvious neural reading; expected DPR/transient differences only |
| Idle field | Nerves remain abundant without live traffic |
| Protocol network/commit/settled | Active route rides passive curve; terminal write and memory evidence remain legible |
| Selection and orbit | Correct pick, no accidental deselect after drag, focused neighborhood stays visible |
| Recall and reorg | Exact evidence route; orphan visuals prune before replacement |
| Reduced motion | Complete static semantic state without fake or half-finished motion |

For deterministic captures, use a 1440 × 900 viewport, an explicit quality,
the readiness markers in `ui-app/VISUAL_REVIEW.md`, and record CSS size,
framebuffer size, DPR, review time, and relevant scene identifiers.

### Quality-neutral optimization proof

When a change claims no visual difference:

- compare the same deterministic input, clock time, camera, viewport, DPR, and
  quality before and after;
- require an exact pixel match where the scene is designed to be deterministic
  (RMSE `0` and changed-pixel count `0`);
- inspect at least one active animation frame in addition to an idle frame; and
- verify shader compilation on the supported WebGL path, not only source-level
  tests.

When an intentional visual improvement cannot be pixel-identical, keep the
before/after captures, state the changed invariant, and verify every quality
preset.

### Performance comparison

- Use the same browser, GPU path, viewport, DPR, quality, data snapshot, and
  warmup for before/after runs.
- Measure idle and pointer/camera interaction separately.
- Record draw calls, triangles, geometries, textures, and programs alongside
  frame and main-thread samples.
- Prefer multiple steady samples or medians; software-GPU frame times are
  useful for relative comparison but are not production FPS promises.
- Report a deliberate visual-budget increase, such as additional nerves,
  separately from implementation overhead.

## Change Checklist

Before merging a Canvas change, answer:

1. Does every visual record still derive from canonical or explicitly scoped
   retained evidence?
2. Are AUTO Cell membership and passive nerves unchanged across quality modes?
3. Is the resting Cell galaxy still visibly a neural network?
4. Do active, memory, and passive layers use the same route geometry?
5. Does simulation time still own semantic animation while raw frame time owns
   input and performance measurement?
6. Are buffer, pool, and draw bounds explicit under worst-case Cell churn?
7. Were deterministic idle and active frames reviewed at all affected presets?
8. Were tests, this document, and the source-of-truth constants updated
   together when a contract changed?

## Implementation Map

| Concern | Primary implementation |
|---|---|
| Production Canvas assembly | `ui-app/src/App.tsx` |
| DPR/query quality resolution | `ui-app/src/render-quality.ts` |
| Quality ownership and preset values | `packages/ui/src/tweaks/qualityPresets.ts` |
| Adaptive hysteresis | `packages/ui/src/tweaks/adaptiveQuality.ts` |
| Stable Cell display budget | `packages/ui/src/tweaks/cellDisplay.ts` |
| Cell body, flash, inspection buffers | `packages/ui/src/components/CellGalaxy.tsx` |
| Visible Cell selection/pinning | `packages/ui/src/geometry/cellRenderSet.ts` |
| Complete neighbor topology | `packages/ui/src/geometry/neighborGraph.ts` |
| Passive nerve selection | `packages/ui/src/geometry/passiveNeighborGraph.ts` |
| Persistent/active nerve rendering | `packages/ui/src/nerve/NeuralFabric.tsx` |
| Nerve buffer capacities | `packages/ui/src/nerve/fabricCapacity.ts` |
| Optimized fat-line silhouette | `packages/ui/src/geometry/screenSpaceCapsuleLine.ts` |
| Cell and peer color families | `packages/ui/src/visualPalette.ts` |
| Simulation clock and frame wrapper | `packages/ui/src/tweaks/SimClockTicker.tsx`, `useSimFrame.ts` |
| Render counters | `packages/ui/src/tweaks/RenderStatsSampler.tsx` |
| Deterministic browser review | `ui-app/VISUAL_REVIEW.md`, `ui-app/src/ProtocolEventLab.tsx` |

## Out of Scope

This document does not define server retention, wire formats, persistence, HUD
content hierarchy, or a future WebGPU renderer. Those systems may constrain the
Canvas, but changes to them follow their own contracts in `README.md`,
`AGENTS.md`, and the relevant package tests.
