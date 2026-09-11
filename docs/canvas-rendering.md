# Canvas Design and Rendering Architecture

This document is the normative design and architecture contract for the
production cknerv Canvas assembled in `ui-app/src/App.tsx` and for the reusable
rendering layers in `packages/ui/`. It explains the complete browser-side path
from projection state to pixels, including scene ownership, visual semantics,
topology, event choreography, interaction, performance budgets, and review
requirements.

The broader process, Rust/TypeScript boundary, server API, and persistence
model are described in [System Architecture](architecture.md). The deterministic
capture procedure is described in
[Visual Review](../ui-app/VISUAL_REVIEW.md). This document owns Canvas
requirements; the review guide owns the browser workflow.

## 1. Scope

The Canvas is the spatial explanation layer of the dashboard. It consumes
already-reduced browser state and turns it into three related views:

- the warm Cell field, where canonical Cells have stable identities and
  positions;
- the Cell nervous system, where deterministic display topology carries
  transaction-triggered activity, inspection, and memory traces; and
- the cool CKB peer colony, which gives block arrival and local-node context.

DOM HUDs and inspectors are part of the same user experience but are not drawn
into the main WebGL color buffer. This document covers their ownership and
coordination with the Canvas, not their full information hierarchy.

This document does not define the server retention algorithm, wire encoding,
on-disk persistence, or a future WebGPU implementation. It does define the
renderer-facing invariants those systems must preserve.

## 2. Product Goals and Non-goals

### Goals

The Canvas must:

- make CKB's Cell model tangible as a living field of records;
- make the resting field read as connected neural tissue rather than unrelated
  points;
- distinguish the warm Cell data plane from the cool peer/network plane;
- make real births, deaths, transaction links, block arrivals, recalls, and
  canonical corrections legible without inventing chain events;
- preserve stable identity and deterministic geometry through normal updates;
- remain responsive on a local dashboard with explicit, bounded CPU and GPU
  work; and
- support deterministic review scenes for intentional visual changes.

Performance is a product requirement, but it is not permission to erase the
structure that explains the chain.

### Non-goals

The Canvas is not:

- a direct CKB JSON-RPC client;
- a transaction-submission surface;
- an on-chain proof that spatially neighboring Cells are directly related; or
- a second source of canonical chain state.

Browser packages consume `@cknerv/types` and `@cknerv/cache`. CKB-specific RPC
logic remains in the Rust adapter.

## 3. Truth, Derivation, and Presentation

Every visual feature belongs to one of four provenance classes. Keeping these
classes explicit prevents a visually useful model from being mistaken for
chain evidence.

| Class | Examples | Contract |
|---|---|---|
| Canonical chain evidence | Cells, lifecycle heights and times, out points, transaction links, immutable link endpoint anchors, canonical prune witnesses | Comes from snapshots or ordered deltas; the renderer may style it but may not replace it |
| Observed local-node state | Local CKB node identity, connected peers, peer latency, stream health | Comes from server entities or runtime state; absence remains absence |
| Deterministic renderer derivation | Helix positions supplied as `pos_seed`, spatial neighbor graph, passive edge selection, Bezier controls, inspection hops | Reproducible from authoritative inputs; communicates structure but does not become new chain evidence |
| Presentation simulation | Stars, inferred peer scaffold, illustrative flood paths, easing, particles, glints, shockwaves | Adds legibility and atmosphere; must never be labeled as directly observed topology or traffic |

The following rules are non-negotiable:

- A displayed canonical record or endpoint must resolve from retained or
  explicitly scoped chain evidence.
- `pos_seed` owns Cell placement. It is produced by the shared deterministic
  Rust/TypeScript helix contract; the renderer must not introduce another Cell
  positioning calculation.
- Cell-neighbor edges are a deterministic spatial rendering topology, not
  literal on-chain links. A real `CellLink` starts an active visualization;
  intermediate hops are conduits through that display topology.
- The active pulse, warm reinforcement, memory trace, and passive nerve for a
  given display edge use the same deterministic quadratic Bezier.
- The single display graph is built over the exact staged Cell subset. Both
  live and recalled routes use that graph. If an endpoint is not staged or no
  path exists, the route is omitted rather than synthesized off-stage.
- Optional enrichment may rank or classify node-revalidated Cells, but it may
  not create, spend, or replace canonical Cells.
- Quality is presentation state. It must not mutate cache state, Cell identity,
  event order, staged membership, or route choice.

## 4. End-to-end Architecture

```text
Read-only CKB node
        |
        v
Rust adapter -> chain-generic mutations -> server projections
                                           | HTTP snapshots
                                           | WebSocket deltas
                                           v
ui-app bootstrap --------------------> @cknerv/cache reducers
                                           |
                    +----------------------+---------------------+
                    |                      |                     |
                    v                      v                     v
              chain/entity cache     CellGalaxyCache      semantic fetches
                    |                      |
                    |              display-change journal
                    |                      |
                    v                +-----+-----------------------+
             peer topology          |                             |
             + block flood          v                             v
                    |          CellGalaxy cursor             NeuralNetwork cursor
                    |          + overlay pool                (staged set only)
                    |                 |                             |
                    |                 v                             v
                    |        stable GPU Cell slots          topology worker
                    |        bodies / nuclei / pick         + eager delta bridge
                    |                                               |
                    |                                  one staged display graph
                    |                                      |              |
                    |                                      v              v
                    |                               passive selector   route planner
                    |                                      |          live / memory
                    |                                      +-------+------+
                    |                                              |
                    +--------------------+-------------------------+
                                         v
                                  React Three Fiber Canvas
                                         |
                                         +--> DOM HUD and inspectors
```

There are deliberately two render-set cursors, one owned by `CellGalaxy` and
one by `NeuralNetwork`. Both advance from the same cache/display journals and
must resolve the same staged membership. This avoids coupling GPU Cell slots to
topology-worker state while preserving a single shared data contract.

### 4.1 Bootstrap and stream recovery

`ui-app/src/main.tsx` resolves review and quality query state, then fetches the
chain snapshot and Cell projection snapshot in parallel before mounting the
application. The Cell bootstrap prefers the compact binary snapshot endpoint
and falls back to JSON if binary loading or decoding fails.

The static startup layer is outside `#root` and remains over the mounted App
until the current Canvas's scene/camera/renderer tuple reaches the scene's
post-render callback. Context creation and pre-render frame callbacks are not
presentation evidence. The handoff accepts a real populated draw or a rendered
legal empty state and does not depend on the `first_light` smooth-frame gate,
fabric rest, stream readiness, or optional enrichment. Review Lab Canvases use
the same post-render signal; a Lab with no source Cell uses its committed DOM
empty state as the equivalent presentation proof because it mounts no Canvas.

After bootstrap, projection streams connect from the current revision.
Incoming deltas are grouped at the next animation frame, with a short timer
fallback when a frame is unavailable. A server `lagged` notification discards
pending work, resets the cursor, and forces snapshot-based resynchronization;
visual code does not guess across a missing canonical interval.

Historical snapshot links populate bounded recall history but do not enter the
live pulse queue. During backfill, link cursors and block cursors advance while
transient pulse, flood, and carrier animation is suppressed. Catch-up traffic
therefore cannot masquerade as live activity or poison adaptive-quality
measurements.

### 4.2 Browser state ownership

`CellGalaxyCache` is the renderer's canonical browser input. It contains:

- canonical `cells` and their copy-on-write change journal — seeded from a
  snapshot that carries only the staged rows, then grown by streamed births;
- bounded `recentLinks` for evidence and recall;
- `pulseLinks`, containing only newly observed live links;
- an ordered `linkPrune` witness for canonical rewrites;
- chain-wide totals, plus statistics seeded from the snapshot's aggregate
  segment (which covers the whole retained set) and maintained incrementally,
  including the script census the client cannot derive from staged rows;
- backfill state; and
- the server-owned display plane: members, residents, budget, provenance, and
  a display-change journal.

The reducer remains pure and owns ordering semantics. Components may derive
GPU-ready state but must not repeat domain reduction.

Every stream connector (`packages/cache/src/projectionStream.ts`,
`entityStream.ts`) coalesces a frame's deltas into one reducer apply and
publishes the result to React once. A batch whose deltas all reduced to no-ops
— a replayed birth the cache already retains, an enrichment refresh
re-delivering retained records, an unchanged poll re-broadcast — moves only the
reconnect cursor. The connector keeps that cursor in its own copy of the cache
and skips the publish; the decision comes from a predicate defined beside each
reducer out of its own copy-on-write rules (`cellsCacheRevisionOnly`,
`semanticsCacheRevisionOnly`), never from the connector guessing at the shape.

`ui-app/src/cell-field-hook.ts` currently maintains a mutable structure-of-
arrays mirror and parity diagnostics. It is a verified migration seam, not yet
the production Canvas read path: current Canvas consumers still read the
Map-backed `CellGalaxyCache`. Documentation and performance claims must not
describe that mirror as authoritative until consumers actually migrate.

### 4.3 Application and component ownership

`App` owns cross-layer state: caches and stream connections, Cell and network
selection, lazy semantic evidence, identity proof, memory recall, causal-route
navigation, stream health, peer topology, and the current block-event clock.
It passes already-scoped data into the rendering package.

The production scene is conceptually assembled as follows:

```text
App
|-- DOM: tweaks, HUD, jukebox, render statistics, Cell inspection panel
`-- CellGalaxyProvider
    `-- Canvas
        |-- SimClockTicker
        |-- detail/selection trackers and camera controllers
        |-- adaptive quality and render-stat samplers
        |-- Stars
        |-- CellGalaxy
        |   |-- Cell body and sparse flare passes
        |   |-- batched CellNucleus near-detail passes
        |   |-- custom CellPicker
        |   `-- rotating overlay group
        |       |-- inspection anchor and semantic orbit
        |       |-- causal lens and write seal
        |       |-- plain block-landing flashes (LandingFlashLayer)
        |       `-- NeuralNetwork -> NeuralFabric
        |-- NetworkColony
        |-- optional CellPortraitInset scissor pass
        `-- OrbitControls
```

`CellGalaxyProvider` exposes the same cache to nested enhancement layers and
fails fast when a required consumer is mounted without it. Optional consumers
use the nullable variant when absence is a supported embedding mode.

High-frequency animation state lives in refs, typed arrays, and Three.js
objects. React state is reserved for structural or user-visible transitions;
publishing thousands of per-frame objects through React is outside the design.

## 5. Scene Space, Camera, and Render Passes

### 5.1 Coordinate system

The scene uses a vertically layered world:

| Plane | World Y | Meaning |
|---|---:|---|
| Satellite applications | `-26` | Lowest contextual layer |
| CKBloom | `0` | Application/ecosystem ring |
| Chain and peer colony | `22` | Local CKB node, peers, inferred network context |
| Cell field origin | `38` | Folded Cell tissue and neural fabric |

Cell `pos_seed` values are local to the Cell-field group. The group is
translated to `CELLS_Y` and slowly rotates around Y; Cell overlays and nerves
live inside the same group so they inherit the exact transform. World-space
anchors, labels, carrier impacts, and inspection panels use the published
galaxy frame to apply the same rotation rather than recomputing positions.

Chain-node placement accepts a shared universe seed so every consumer agrees
on the same anchor positions. The current `App` assembly uses
`UNIVERSE_SEED_FALLBACK` (`0xc0ffee`); the layout API is ready for a persisted
profile seed, but the production bootstrap does not yet wire one through.

### 5.2 Production camera and renderer

The production Canvas uses:

- camera position and target fitted to the HUD's horizontal rail reservation
  before the first Canvas mount, using `fitCameraToHole` (the default view ray
  remains `(110, 70, 110)` above `CELLS_Y`);
- FOV `50`, near `1`, and far `3000`;
- WebGL antialiasing and an opaque drawing buffer (`alpha: false`);
- scene background `#02030a`, with the same colour as CSS below the canvas for
  the window before the first frame;
- quality-limited DPR, never below CSS-pixel density; and
- damped orbit control with damping factor `0.08` and distance range `4..400`.

These are composition defaults rather than wire contracts. A change still
requires desktop and narrow-layout review because camera composition controls
Cell readability, network separation, picking density, and HUD occlusion.

`HudOverlay` publishes a measured `HudCameraFrame` in its layout phase. A
missing measurement holds the Canvas mount; deliberately disabled rails leave
a valid full-width stage. Both the camera and OrbitControls start from the
same fitted pose, without a temporary default or a dependency on boot/data
readiness. Only viewport dimensions and user-selected panel layouts can update
that frame. Boot banners, panel reveals, fonts, and enrichment arrival do not
reposition the camera. Inspection still uses live occlusion rectangles to
place its cards. A user orbit or a memory-route flight takes camera ownership
for the session, including after the gesture or flight has ended.

The startup layer covers rather than hides the App, and `#root` is inert until
the layer finishes its 400 ms fade (or is removed immediately for reduced
motion). Canvas measurement and rendering therefore run at final geometry.
The handoff does not replace the Canvas or camera, and it cannot reset a pose.

Regression checks must compare camera position, orientation, and projection
from the first visible frame through boot completion at desktop and narrow
widths, then verify resize/panel fitting and preservation of a user-owned pose.
This is browser-only state; no persistence purge is required.

### 5.3 Pass ownership and compositing

The main Canvas renders the ambient field, Cell layers, neural layers, and peer
colony. Warm Cell layers and cool peer layers remain separable by palette and
depth even when their projected silhouettes overlap.

The Cell body uses bounded screen-style accumulation so a dense field tends
toward a ceiling instead of becoming a uniformly clipped white disc. Resting
fibres use the same bounded accumulation family. Short-lived active writes,
memory traces, lock acknowledgements, flares, and near nuclei use additive
layers and therefore retain headroom above the passive field.

The selected Cell portrait does not create a second WebGL context. It renders a
portal scene through the existing renderer after the main scene, using a
scissor rectangle and its own camera. This preserves the renderer's program
cache and avoids the resource and compatibility costs of a second Canvas.

The HUD and Cell inspection instruments remain DOM siblings. A small R3F
anchor projects the selected Cell into screen space so the DOM inspector can
stay tethered without turning text and controls into scene textures. Selection
does not move the camera.

`CELL SCAN`, `SCAN·01`, `SCAN·02`, and the optional `SCAN·03` are independent
plates with independent measured heights and close controls. A bounded pure
geometry solve places the open set as one constellation, using side columns or
folded shelves. It rejects candidates that cross the stage edge, another
plate, the selection reticle, or the clamped Cell name chip. Scrollable text
plates may receive a finite height; the specimen plate always preserves its
full square window.

The same result owns orthogonal leader paths, route labels, and the SVG mask.
Leaders use ordered reticle outlets, avoid visible HUD remnants and all plate
interiors, and do not cross each other outside the reticle. A label uses a
clear route segment or appears once in its plate heading. The full-stage SVG
draws leaders below the plates and masks every plate, the name chip, and
visible HUD rectangles; this includes the transparent specimen window, so a
line cannot show through the main-Canvas portrait.

The frame writer locks valid plate coordinates while the projected Cell drifts
and updates only the reticle, chip, routes, and portrait scissor origin. Stage,
font or content measurements, open slots, and HUD geometry versions invalidate
the relevant cached output. Closing one plate removes only its slot, mask, and
leader; changing the selected Cell resets those per-Cell closures. The portrait
continues to use the existing renderer, portal scene, scissor pass, and pointer
capture path.

## 6. Visual Language

| Layer | Required reading | Provenance | Rendering rule |
|---|---|---|---|
| Background and stars | Deep field and scale | Ambient presentation | May scale with quality; carries no chain meaning |
| Peer colony scaffold | Cool cyan network context | Explicitly inferred presentation topology | Must never be presented as an observed Internet map |
| Local node and measured peers | Cool local-node context | Observed entity state | Measured and inferred nodes remain visually distinguishable |
| Cell bodies | Warm rose living records | Canonical staged Cells plus bounded inspection overlays | Identity and position are stable; lifecycle and focus accents may animate |
| Near Cell nuclei | Expanded A-braid identity | Canonical Cell identity, renderer-derived detail | Batched and distance-limited; focused evidence wins admission |
| Passive Cell nerves | Crimson/rose neural tissue | Deterministic graph over staged Cells | Abundant at rest and stable through ordinary churn |
| Warm reinforcement | Recently used display conduits | Real link event plus derived graph route | Uses the same edge curve as the passive fibre |
| Active writes | Bright packet wavefront and terminal response | Real live `CellLink`, derived route | Quality may reduce sampling and bounded concurrency, but not route derivation |
| Block landing | Plain warm flash resolving to rose on the Cells a released front passes | Real block arrival on presentation timing (crest passage) | Own point geometry inside the Cell group; never the write seal |
| Memory route | Explicit historical recall | Retained link evidence, derived route | Separate screen-weighted layer and readable at distance |
| Rewrite echo | Fractured invalidated suffix | Canonical prune witness | Must not imply a replacement fork that was not observed |
| HUD and inspectors | State, controls, provenance, evidence | DOM application state | Kept outside the main scene color buffer |

The warm Cell palette is centralized in `packages/ui/src/visualPalette.ts`:
rose, crimson, amber, ember, warm white, and violet. Peer scaffolding stays in
the cyan, ice, blue, violet, and cold-white family. Collapsing those planes into
one color family is a visual-language change, not a local styling adjustment.

## 7. Cell Field Architecture

### 7.1 Staged membership

The renderer distinguishes three populations:

1. The canonical Cells in `cells`. This is **not** the server's retained
   reservoir: a snapshot carries only the rows the display plane staged, and the
   map grows afterwards through streamed births. Its size is therefore neither
   the retained-set size nor a guaranteed superset of the stage, and nothing may
   use it as a proxy for either — galaxy-wide numbers come from the snapshot's
   statistics segment instead.
2. The server-owned display plane in `displayMembers` and `displayResidents`.
   Residents can preserve displayable records even when they are no longer in
   the canonical live Map.
3. A client-only overlay holding the selected Cell while it sits off-stage.

AUTO uses the server display budget when one is streamed and otherwise uses a
fixed 12,000-Cell compatibility budget. High, Med, and Low render the same AUTO
membership. Manual mode is a presentation clamp over the staged order and may
request up to the 50,000-record renderer ceiling, but it cannot display records
the server did not send.

With a display plane, `displayChanges` incrementally append entries, remove by
swap-from-tail, and patch updated residents. A skipped journal, reset, token
mismatch, structural budget change, or active manual clamp uses one canonical
rebuild. Against an older server without a display plane, the compatibility
path maintains the canonical insertion-order prefix through `cellChanges`.

The overlay is appended after the staged list and holds one record: the
selected Cell, resolved canonical-first and skipped when it is already staged
(`cellRenderOverlay`). Buffer allocations reserve a 256-slot pool past the
display budget for it. An overlay entry is visible and pickable but never
enters shared display membership, passive topology, live routing, or memory
routing.

This separation is intentional: interaction can reveal a retained record
without silently changing the topology seen by every other renderer.

### 7.2 Stable GPU slots

List position is not GPU identity. `syncCellSlots` maintains an ID-to-slot map:

- a retained visible Cell keeps its slot;
- removals create holes or swap a tail entry into a freed slot;
- additions fill reusable slots; and
- only affected ranges become dirty.

This keeps ordinary update cost proportional to churn instead of field size
and prevents list reordering from making the whole galaxy flicker or upload.
Dirty intervals are bridged under the shared upload cost model (`fabricSlots`):
a parked gap is uploaded only while its bytes cost less than the bufferSubData
calls it saves (4 KB a call, six calls a range for the six static attributes),
so a fragmented block can at worst reach the dirty set's hull — never the
populated prefix beyond it. The bytes every lane flags are summed in
`gpuUploadLedger` and shown on GL·08 as UPLD.

### 7.3 Cell GPU representation

Shared, preallocated attributes encode the field at a hard capacity of 50,000
records. The important attribute families are:

- position and deterministic position seed;
- body color, size, birth time, death time, and flash time;
- stage enter and exit time (a view event, kept distinct from the record's
  own birth and death);
- identity/memory seed and focus or recall state;
- the sparse flare index; and
- the near-detail level `CellNucleus` writes each frame.

Presentation descriptors are deterministic functions of Cell data. Capacity
uses logarithmic compression for perceptual mass, payload density influences
form, and content hashes seed identity detail. Invalid optional hash input
falls back deterministically; it does not introduce a random layout.

The far-field body is one shared point pass using the Cell hybrid material.
Exact active flashes are drawn through a separate sparse indexed point pass so
inactive slots do not produce transparent fragments; with no slot in its window
that pass is an invisible object rather than a zero-vertex draw, and the
near-identity braid passes and node points follow their committed counts the
same way (three binds program, material and VAO before its zero-count
early-out; the boot precompile walks with `traverse`, so a hidden pass is still
linked at first light). Birth and death envelopes are evaluated in shader time,
while CPU writes only changed records.

### 7.4 Near identity LOD

`CellNucleus` expands nearby Cells into a batched A-braid identity using two
line draws and a point draw. It does not mount one React object per Cell.
Distance and quality limit concurrent expanded identities; focused Cells sort
ahead of the cap and remain legible at every preset. LOD admission is refreshed
at a controlled cadence, and sparse ranges are updated without rebuilding the
far body.

Camera-distance admission runs behind a bounding-sphere gate over the drawn
prefix (cached per field version): when the whole field is beyond the
admission radius — every pose short of a hand dolly — no spatial index is
built or refreshed and only focus / hover / recall / route-hop ids are
resolved. Inside the field a flat typed bucket grid is rebuilt lazily for the
current field version and the buckets around the camera are walked.

### 7.5 Picking

`CellPicker` provides a custom `Object3D.raycast` path backed by a screen-space
hit index (`geometry/screenSpaceHitIndex.ts`, typed arrays and a reused bucket
grid). It projects the drawn Cell slots into one index and answers every
pointer event from it; the projection loop reads only typed per-slot lanes
plus `pos_seed` and allocates nothing.

The index is keyed on the inputs it bakes, never on the drawn list's identity:
the field version (`cellSlotAssignment`'s `positionsChanged`), the draw count,
the pick-size epoch (`writeCellBuffers` reports slots whose point size or
capacity-derived braid presence changed), the expanded-detail epoch, the
viewport, and the projection matrix. A payload-only delta — an enrichment
refresh, a death — republishes the list and rebuilds nothing.

A detail-epoch bump does not rebuild. The detail lane reaches the index across
one threshold and nowhere else, and the near set that crosses it is capped at
twelve identities, so the picker diffs the live lane against the side of the
line each entry was baked on — one byte a slot — and re-projects only the slots
that crossed, through the index's OWN snapshot, writing their new radius into
the bucket their centre already put them in (`ScreenSpaceHitIndex.patchEntry`).
A repair that would MOVE an entry (a centre that is not the indexed one, a
radius that flips the admit verdict) or a diff past
`CELL_PICK_DETAIL_PATCH_LIMIT` hands the raycast back to a rebuild. A patched
disc under one of the two focus pads re-resolves them, because a pad may only
ever grow the disc the index holds.

Camera motion is budgeted (1.5 px) against the index's own drift envelope
(`geometry/cellPickDriftEnvelope.ts`): the image-plane box of the admitted
entries, over which the exact maximum of the projective drift — centre
displacement plus radius change — is evaluated in closed form per query. It is
a sound bound measured from the index, replacing the viewport-corner analytic
bound (kept as the fallback for an index with no admitted entry). Galaxy spin
keeps its exact per-cell bound.

While the camera is being moved — by a drag, by OrbitControls' damping tail
after a release, or by a `ConsensusRouteCamera` flight — the picker skips
hover probes (pointer moves) and rebuilds once, lazily, on the first probe
after the motion settles. Pointer-down, click, double-click and context-menu
raycasts are answered throughout, pointer-down from a precise snapshot, so a
click during motion selects what it hit and never reads as a miss (see §11).
Selection and inspection eligibility are applied at index construction so
hidden or non-navigable records cannot win a hit by accident.

Inside the MOTION WINDOW — `cameraMotionActiveRef`, the same once-a-frame
verdict `AdaptiveQualityController` reads, which is the picking suspension
widened by the un-moved press — a stale camera POSE (`camera`, `spin`) marks
the index without re-projecting it, and the first at-rest raycast pays for it
once; the gates are re-read from live state every raycast, so nothing is
remembered and nothing is forgotten. Three families never take that trade, and
`cellPickRebuildDecision` is the table: MEMBERSHIP (`fieldVersion`,
`sizeEpoch`, `count`) would answer with ids that moved; the COORDINATE SYSTEM
(`viewport`, `projection`) is the space `find` is asked in, and a stale one is
not the previous frame's truth but a different frame of reference; and
`pointerdown`, because the press exemption above exists precisely so a click
during motion lands on the cell under it — and deferring it would buy nothing
at the gesture start, since the sentinel settles once a frame and the press
that opens a drag is therefore seen at rest.

## 8. Display Topology and Neural Fabric

### 8.1 One graph over the exact staged set

`NeuralNetwork` owns one neighbor graph over the exact staged display subset.
The client-only inspection overlay is excluded. All downstream neural behavior
reads this graph:

- passive-fibre selection;
- live pulse planning;
- warm route reinforcement; and
- memory recall.

This is a correctness boundary. A live or recalled packet cannot traverse an
edge that has no corresponding display graph edge, and it cannot route to an
off-stage endpoint. There is no second canonical-reservoir routing graph.

Only living staged Cells participate. The pure builder uses a numeric
spatial-hash grid and symmetric k-nearest-neighbor candidates (default `k=4`),
drops ordinary candidates longer than 25 world units, gives isolated Cells a
lifeline, and stitches disconnected components with the minimum sparse long
links needed for reachability. A 14-seed arbor forest assigns visual trunk
weights; those weights affect presentation, not route connectivity.

The builder is a pure function of the Cell *set*, not of Map-insertion order:
it sorts its working Cell list by id before the k-nearest, lifeline,
component-stitch and skeleton passes, so a full-pack rebuild and a delta-patched
worker session grow the identical tree — the same skeleton partition, the same
edge sequence, and the same arbor weights. That equivalence is the precondition
for §8.2's in-place patch and, on a supersession, for making the recovery a
small diff instead of a whole-fabric replacement.

Cell IDs stay numeric end to end. Worker transport uses `Float64Array` for IDs
because composition-derived IDs are not constrained to 32-bit integers.

### 8.2 Incremental worker pipeline

Topology construction runs in a long-lived worker once the staged set reaches
the worker threshold (512 records). The main thread sends packed minimal Cell
data and a generation number. After bootstrap it sends display-journal deltas
when possible rather than recloning complete Cell payloads.

The pipeline is latest-only:

- superseded requests are ignored;
- stale worker generations trigger a safe full resend;
- the display graph crosses the wire as adjacency only (a CSR of node ids and
  neighbour runs in Set order — never an edge list, which nothing on the main
  thread reads), and, in the steady state, as a *patch*: the request names the
  generation the main thread holds, and a session whose previous build is that
  generation answers with only the nodes whose neighbour run changed (new
  nodes included) plus the ids that left. The main thread applies the patch to
  the graph it holds, in place, replacing exactly those nodes' Sets and
  restoring every node the eager mesh had touched since the last apply from
  the eager log (the worker compared against its previous build, which is
  that graph *before* the eager edits). Any generation gap — a superseded,
  dropped or failed build, a fresh worker, a caller that cannot patch — makes
  the response carry the whole adjacency, rebuilt into a new Map with the
  previous Sets reused wherever a run is order-identical;
- the passive graph crosses the wire as its drawn edge list only (`[from, to,
  distance, arbor weight]` per edge, in canonical `from`-then-`to` order —
  never an adjacency: the fabric diff and its trunk tier, the bridges' host
  degrees, the stray prune and the continuity preference all read edges, and
  nothing on the main thread reads a passive adjacency, so none is built
  there), and in the steady state as a *patch* too, under exactly the
  condition the display patch rides: the edges that entered, the keys of
  those that left, and the values (`[distance, weight]`) of the whole merged
  list, against the selection the request named. The values ride whole
  because they are not stable while the keys are — an arbor weight is
  `sqrt(subtreeSize / maxSubtreeSize)` over the forest, so one birth or death
  in the largest tree rescales every weight, and the trunk tier reads every
  edge's weight on every build. The main thread merges the patch into the
  list it holds, in place and in order (O(edges + churn), no Map or Set
  built), replacing only the records whose values moved (records are values:
  the fabric's deferred cohorts hold them across builds); the same merge
  yields the selection delta the fabric grows and kills from, `removed` being
  the very records the list dropped. Any generation gap sends the whole list;
  and
- worker creation or execution failure falls back to the same synchronous pure
  builder and records the fallback in diagnostics
  (`neighborGraphBuilderStats` also counts patched, whole, unchained applies
  and stale resends, and the passive selection's patched and whole applies).

A topology supersession — two generations requested inside one worker build, as
a block burst can cause — takes the same safe path as any broken generation
chain: the superseded request is dropped, the next build resends the whole
adjacency and passive list, and the main thread applies them in place. Because
the builder is id-ordered (§8.1), that whole resend reproduces the neighbour
runs the main thread already holds, so the Set reuse above makes the apply a
small diff rather than the whole-fabric flush it once was (it drove a ~3 MB
`setFabric` per burst before the id-order fix). Retaining the superseded build's
patch-base generation so the recovery is a single chained patch with no resend
at all was considered and deferred: the id-order fix already removed the
resend's cost, and chaining across a supersession would trade the whole-re-pack
safety net (every failure path funnels through the generation check into a full
re-pack) for reliance on the topology journal's `valid` flag holding across the
supersession window — a correctness risk not worth a saving seen only on the
occasional burst.

While a worker build is pending, an eager living mesh applies same-frame births
and removals to the currently published graph, replacing — never editing — the
adjacency Sets it touches and logging the displaced instance on a node's first
touch. The request-time Cell map also closes the gap for links arriving in the
same frame. The worker result remains authoritative once published: a patch
lands node for node on the worker's build (a death retracted while a build was
in flight comes back until the next build learns of it, exactly as the whole
rebuild brought it back); periodic cleanup removes eager fabric edges that are
no longer part of the resolved selection.

### 8.3 Passive selection

The complete staged graph is generally denser than the resting visual budget.
`buildPassiveNeighborGraph` chooses a deterministic subset without inventing
adjacency.

The budget is:

```text
min(live screen budget, round(staged Cell count * 4 / 3))
```

The effective screen budget comes from the server's
`displayBudget.nerveEdges` when present, otherwise the shipped 8,000-edge
fallback. Moving the live tuning control away from its default explicitly
overrides the server value. Server and tuning values are bounded to
`6,000..20,000`. The result is fixed across High, Med, and Low and across AUTO
and manual Cell display modes.

Selection order preserves the field's visual identity, and admits continuity
first so an ordinary block changes the fabric only where membership did:

1. Re-admit still-valid previously-drawn edges before anything else competes for
   slots. A birth or death then frees only the dead edges' slots instead of
   reshuffling the whole coverage forest — the forest is a queue-order BFS
   skeleton, whose parent assignment shifts a large fraction of its edges when
   membership moves even ~1 %, so taking coverage first evicted and regrew
   roughly an eighth of the drawn edges every block. A cold build (no prior
   edges) is a no-op here, so coverage below still fills everything as before.
2. Then coverage: use a spanning forest while it fits; if the forest exceeds the
   budget, reserve the coverage share (default `0.55`) for a hash-scattered
   forest subset, ranked by a stable per-edge hash so an edge keeps its rank
   while it lives. Graph-order admission that fully wires one region and leaves
   another bare is forbidden.
3. Fill remaining capacity with hierarchical trunks, twigs, and deterministic
   cross-links (default trunk and twig shares `0.72` and `0.18`).

Every passive quadratic curve uses four samples at every quality preset. Dense
manual fields intentionally become airier per Cell: the preserved quantity is
the screen composition, not full per-Cell coverage.

### 8.4 Persistent fibre lifecycle

`NeuralFabric` keeps keyed edge state by canonical `minId:maxId`. An edge
captures its endpoints and deterministic control point when born, so a dying
fibre can retract after its Cell record has left the current graph. A numeric
two-level index (`lo → hi → state`) mirrors that map for the one reader that
runs per hop per frame — the active-hop curve lookup — so the frame loop never
builds a key string; every writer of the map writes both.

The GPU lifecycle layer binds a one-instance dummy to the stock
`instanceStart/End` and `instanceColorStart/End` lanes that its patched program
strips (three uploads every geometry attribute at the first draw whether or not
the program reads it); its capacity comes from the static records, and the
fabric mesh, like its wide pass, answers no raycast.

Graph diffs grow new edges, preserve surviving slots, and mark removed edges
for decay. GPU lifecycle uniforms advance growth, death, warmth, masks, and
recall without rewriting every position each frame. Normal topology churn uses
slot-level dirty uploads; full walks are reserved for global or structural
changes.

Slot order is spatially random (id-sorted boot order over hashed positions,
LIFO hole reuse), so a clustered dirty set is uniformly scattered in slot space
and the range merge decides the upload. Each lane carries an upload policy
derived from what a slot costs it — the event flush marks three buffers at
384 B a slot, the recall-aperture bake the colour records alone at 128 B —
and `mergeFabricSlotRanges` bridges a parked gap only while its bytes cost less
than the calls it saves (measured on the review machine: one call ≈ 0.5–0.9 µs
main thread plus 1.2–1.9 µs GPU process; one byte ≈ 0.1–0.5 ns). A range cap
bounds calls per commit and, when it binds, bridges the smallest gaps first;
the worst case is the dirty set's hull, never the populated prefix.

The same vertex stage carries the tissue flush: a landed block's contact front
(§9.2) is sampled per capsule endpoint from a 16-slot ring the delivery layer
stamps once per contact, through a template-injected twin of the front's radius
function, and folded into the fabric's reclaim path so a landing at the galaxy
core lifts fibres out of the centre-dim floor. With no live slot the shader's
output is unchanged.

Real Cell death produces retraction and an energy response. Quiet graph garbage
collection fades without implying a canonical spend. This difference must not
be collapsed into one generic removal animation.

### 8.5 Neural render layers

All neural layers share the same Bezier calculation but use separate buffers
and compositing roles:

1. Passive fabric: bounded screen accumulation, persistent lifecycle.
2. Sparse warm reinforcement: bounded screen accumulation over recently used
   real display edges.
3. Live packet wavefronts: additive and rebuilt from the bounded active pool.
4. Memory traces: additive and independently bounded.
5. Route-hop acknowledgement: a short additive lock/inspection pulse.

Each sampled nerve segment is rendered as a two-triangle screen-space capsule.
Width, cap shape, and color interpolation therefore remain stable in CSS space
without the heavier generic line geometry. The shader patch fails loudly if an
upstream shader layout no longer matches; silently falling back to a different
silhouette is not acceptable.

A layer whose committed count is zero is an invisible object, not an empty draw
call: each commit flips the mesh's `visible` from the count it publishes, so
the render walk never binds a program or runs a before-render hook for a layer
with nothing in it (the hooks are per-draw uniform syncs that the first showing
frame runs again). The bridge class keeps its own commit path and the default.

## 9. Live Transactions, Recall, and Canonical Rewrite

### 9.1 Live pulse planning

Only `pulseLinks` newer than the local cursor are eligible for live animation.
For each link, the planner:

1. takes the link's input-side endpoint anchors — every anchor whose id is not
   one of this transaction's newborns — in the server's wire order, at most two
   per link;
2. carries each origin BY VALUE, as the consumed cell's own world address, and
   asks the per-batch entry index which live staged node that address enters
   the fabric at (the anchor's own surviving adjacency answers first, when the
   graph still holds a corpse it has not pruned);
3. uses the link's real `to_ids` as destinations;
4. performs one breadth-first search per origin over the staged display graph;
5. rejects missing, disconnected, or longer-than-80-hop paths
   (`DEFAULT_MAX_HOPS`, also the runtime `[galaxy.topology] max_hops`
   default; the review Labs plan with 24); and
6. emits at most six pulses per link and 128 planned pulses per batch.

Timing is deterministic per transaction/consumed anchor/destination — the entry
node is deliberately excluded, since it follows stage churn and the same spend
must not re-time itself between two clients. Base traversal is 33 ms per hop
(`HOP_MS_BASE`), scaled into `0.7..1.4` of that value, with up to 300 ms of
start jitter.

The planning itself is sliced across frames. When a link delta arrives the
batch is *opened* at once — the link cursor advances and the batch's departure
clock (`startSec`) is stamped — and the display pair (staged map and display
graph) it will plan against is captured then, at request time, by reference. A
chained worker build patches that graph's adjacency in place and the staged
map is patched the same way, so a slice that runs after a build lands searches
the landed graph: its routes are made of live edges and never of one the build
just removed; only a whole rebuild replaces the object, and a batch opened
before it keeps the graph it captured (the frame loop validates every hop
against the live graph either way). The searches run from a FIFO queue on the raw frame,
before the pulse walk, under a wall-relative budget (`livePlanBudgetMs` — 12 %
of the last frame interval, floored at `LIVE_PLAN_BUDGET_MS` 2 ms — and a frame
never starts a step its previous step's cost predicts would overrun it), never
less than one step per frame, batches in arrival order. A STEP IS ONE ROUTE
SEARCH — the smallest work the planner cannot subdivide, 2–7 ms warm over a
12,000-node stage and ~9 ms on the first traversal of a freshly published graph,
since the router's per-node neighbour cache is built as it walks. The budget is
only ever spent between steps and a slice must always take at least one, so a
planning frame costs the budget plus exactly one grain: a link is planned one
ORIGIN per step (a link may carry `MAX_ORIGINS_PER_LINK` of them), and a block
boundary's rescue pass is one CANDIDATE per step (a dark block may hold
`MAX_RESCUE_ATTEMPTS`, each paying a scored search of its own). The batch's entry
grid is the exception that is not a search at all — a stage-wide walk that looks
every graph key up in the staged map — and it was the biggest grain of the lot
(18 ms in a burst, 47 ms in a trough over a 12,000-node stage, against ~9 ms for
a cold search), so it is BUILT ACROSS STEPS too: `ORIGIN_ENTRY_BUILD_QUANTUM`
nodes a step, collected into preallocated typed arrays rather than four doubling
`number[]`s. Nothing plans and nothing reads the grid until the build finishes —
`index()` is the only way to a queryable one and it drains what is left first, so
a reader never sees a partial grid and the batch simply waits a few more frames
out of its 2.2 s of departure slack. Each slice also reports WHICH of those its longest
step was (`maxStepKind`: `link` / `rescue` / `grid` / `other`) and whether the
router walked it cold (`maxStepCold` — the neighbour cache empty when it began,
or emptied by a slot-registry compaction while it ran), so an outlier grain on
a release build names its own cause instead of leaving three open. Pulses admitted from a slice carry the batch's `startSec`, so
departure times, pulse order, the 128-per-batch budget, the rescue pass and
every stats bump are those the one-task planner produced. A batch whose earliest
departure is within `LIVE_PLAN_DEADLINE_MARGIN_S` of now is planned under
departure pressure — flagged for the probe (`forcedByDeadline`) — but it does
not bypass the budget: its remainder defers to the next slice like any other, so
a batch that has fallen far behind (a long stall leaving a whole batch urgent at
once) finishes over a few budgeted frames instead of one long synchronous drain,
and no pulse is dropped. A reorg prunes queued
links at or above the rewrite boundary before they can be admitted, the way it
prunes packets already in flight. The searches themselves run over an
epoch-stamped typed-array scratch with a per-node neighbour cache keyed on the
adjacency `Set` instance — which is why an adjacency `Set` is never mutated in
place anywhere in the system: a change replaces the instance.

A packet's first leg is a ghost: it leaves the consumed cell's address, which
no fabric edge reaches and no display map holds, and lands on the entry node.
Its duration is one hop time scaled by the leg's length in median fabric edges
(1.89 world units), clamped to one-to-four hops so a far derived origin
launches rather than crawls; every later hop boundary shifts by it, including
the terminal arrival the write seal is stamped from. Both of the ghost's ends
are values, which is what makes it the one leg the live graph cannot
extinguish — the real hops keep the fibre check unchanged. A route whose entry
node IS its destination therefore still carries a packet, on the ghost alone.

Departure is phase-locked to the origin's own fade: the base delay is the
corpse-fade onset minus the jitter's midpoint, so the median packet leaves the
instant the cell it consumed begins to dim, and the jitter band straddles that
moment instead of trailing it. The default active population is 256 pulses before the quality particle
multiplier, backed by a 1,024-entry spike pool. Saturation drops bounded visual
work; it never manufactures a cheaper route.

When a packet crosses an edge, that same edge is reinforced. Terminal arrival
flashes the target Cell and stamps the consensus write seal. Memory-mode
packets do not reinforce the live field, flash a live write, or stamp a new
seal.

### 9.2 Shared block choreography

A real block pulse anchors the presentation timeline. The peer flood and Cell
delivery sequence are illustrative timing over observed block arrival, not a
claim about actual unobserved peers.

| Relative time | Visual event |
|---:|---|
| `0` | Deterministic two-second peer-colony flood begins |
| `0.3..1.7 s` | Local receive point, clamped into the flood's hero band |
| `local receive - 0.4 s` | Gather: the worker's own halo draws in — extent contracting, light concentrating — when lead time exists; the delivery layer draws nothing for it |
| `local receive` | The block leaves as a courier hop — the propagation tree's last hop, mote and plume in the block's carrier hue — and the halo lets go |
| `local receive + 1.0 s` | Contact: the mote is absorbed at the membrane and the tissue answers on one radius function through three media — the soft annulus front, the fibre flush, and plain landing flashes timed by crest passage |
| `local receive + 2.2 s` | Contact window closes and the Cell ledger acknowledgement completes |
| `local receive + 2.35 s` | One acknowledgement instant, after an additional 150 ms readability offset: the exact touched-Cell highlight, each newborn's arrival, each corpse's fade — and the median live packet's departure from the corpse it consumed |

The handoff is one idea in three beats: compression, then release — expressed
in the two dialects the scene already has, with nothing invented for it.

The compression is the light that is already there. Over the 0.4 s before its
hop leaves, a delivering node's own halo — the instanced measured halo, or the
local anchor's — draws in and concentrates rather than dims (extent to 0.55 of
rest, intensity ×1.8, short of light conservation so it never pops white), then
lets go over 0.25 s after the launch. One pure envelope (`peerCompression`)
drives both halo shaders through a template-injected GLSL twin. Only nodes that
deliver breathe: measured peers and the local node; ghost, sighted and attested
nodes do not, because compression means "about to deliver".

The crossing is the propagation tree's last hop, drawn in the courier
vocabulary: the same mote-and-plume construction the colony's glints use,
shared by construction through one helper (`components/courierGlyph.ts`) so
the two layers cannot fork, thrown with the same ease-out every courier hop
has, at a higher weight because this hop is the block's climax, and in the
block's own carrier hue — the colour the surge, the glint and the peer-plane
shockwave already carry. The mote shrinks to nothing at the membrane: contact
is absorption, not a pop. The delivery paints nothing white and draws no
wireframe and no streak; warm white belongs to the tissue's own landing
flashes, and the protocol write seal is reserved for writes.

At contact the tissue answers in its own vocabulary, and everything it does is
one expanding wave with one radius function (`contactFrontState`): crest
radius from real seconds at the shared speed, a knee extinction at the reach,
a 1/r falloff. Three media read it. The annulus front draws the crest between
the Cells — a soft bloom, crest half-width 3.2 / `CONTACT_WAVE_SCALE`, a 0.45
wake, three gaps at 0.3 depth — resolving from the carrier hue into tissue
rose over the contact window. The fibre flush brightens the nerve fibres the
crest crosses: a template-injected GLSL twin of the same function in the
fabric lifecycle shader, fed by a 16-slot ring the delivery layer stamps once
per contact, sampled per capsule endpoint rather than per fragment — a fabric
edge is four capsules, so a razor crest would flicker segment to segment,
while a 0.9-world-unit crest with a wake of about 2.9 interpolates cleanly —
and folded into the fabric's reclaim path so a landing at the galaxy core
lifts fibres out of the centre-dim floor instead of multiplying a small
number. The landing flashes fire on the Cells within the front's reach, each
at the instant the crest passes it, as loud as the crest is there. Hero and
peer differ only in reach and a scalar punch, never in shape, and the three
gaps are the agreement motif the write seal's loops also carry.

Every measured worker releases its own front (about a dozen on mainnet today,
so fronts read as isolated releases rather than an interference field), all at
one speed: the Cell-field front travels at the peer plane's `SHOCKWAVE_SPEED`
divided by `CONTACT_WAVE_SCALE`, so both planes read as sections of the same
event while the released ring stays a local ripple in the tissue. Every spatial
constant of the front — speed, reach, start radius, crest width, falloff
reference — is divided by that one scale, which is what makes the size change a
pure spatial scale that leaves the front's shape and pacing untouched. The
crest's widening rate is the exception by design: it is a dimensionless
per-second rate multiplying the already-scaled width, so it self-scales and
dividing it too would stiffen the small ring into a rigid decal.

Because the ring is local, it must be released on tissue: a worker sitting
past the field's rim (the chain annulus runs wider than the tissue on x) has
its landing pulled radially onto the footprint ellipse, and the front's
extinction band is that same ellipse — exported by the helix module and
projected through the galaxy's live rotation — rather than a second
hand-typed radius. Overlap is kept off the white rail by the 1/r falloff, the
rim's three gaps, and that rim extinction. Reach is extinction
rather than a clamp: a clamped radius would freeze fronts mid-field and break
the shared-speed reading. A reach configured past what the contact window can
complete clamps to the completable ceiling, so the knee extinction always
finishes inside the window instead of being cut off mid-fade by the time
envelope. Crest half-width is capped as a fraction of the crest radius (half,
now that the front is a soft bloom), without which a young front is mostly
crest and the release reads as a soft doughnut instead of a ring leaving. The
front is resolved analytically in an instanced material drawn on an annulus
rather than scaled from a sprite, which smears the moment a front grows past a
few world units; delivery count changes instance and vertex counts, never
draw-call count.

The exact touched set is derived from fresh links and bounded to 256 Cells per
block, and it — with live packet arrivals and canonical rewrite arrivals — is
the only thing that stamps the write seal (`aFlashAt`, `cellFlareMaterial`). A
landing is not a write. The Cells a released front passes flash plainly
instead: a warm-white bloom resolving into rose on the landing layer's own
point geometry inside the Cell group (the shared Cell geometry gains no
attribute), each scheduled nearest-first at the instant the crest reaches it,
never before contact and never beyond the reach, bounded to 128 for the hero
front, 24 per peer front and 300 per block. No radial response may be
described as additional chain linkage.

So that the tissue's exhale is the loudest beat of a block, the measured
halos' event response under the peer-plane shockwave is trimmed
(`MEASURED_EVENT_SCALE` 0.6, on the measured material only; the ghost and
sighted clouds keep their tuning). The intended loudness order inside one
block window is: real write pulses ≥ the hero exhale > peer exhales > surge
band > measured halo flare > glint. The timing anchors — 0.4 s gather, 1.0 s
hop, 1.2 s contact window, 2.2 s commit, 2.35 s acknowledgement — did not
move.

Backfill consumes block and link cursors without firing this choreography.

### 9.3 Memory recall and inspection routes

Recall starts only from retained evidence and resolves against the current
staged display graph. The memory layer has separate energy, width, and aperture
rules so it reads as recalled evidence rather than a new write. If the retained
link endpoint is unavailable or the current graph cannot connect it, the UI
reports or displays the available evidence without inventing a substitute
path.

Selecting a Cell neither dims the field around it nor expands a graph-hop
neighbourhood: the graph-hop inspection field and its hop masks were removed
(1d0d7c0, 2026-08-21), every lit Cell answers a click, and the navigation
targets are the selected record and the causal lens's real endpoints below.
The context damping left in the scene is the camera-proximity recede of the
Cell close view (`nerve/contextDamp.ts`, one rate and snap for every layer so
node, link and fibre context settle together) and the memory layer's recall
aperture (§8.4); neither changes membership or topology.

The causal lens uses immutable link endpoint anchors and bounded real input and
sibling sets. Missing retained positions remain missing; it never fabricates a
complete family around incomplete evidence.

Recall answers two separate questions and must keep them separate. *What the
transaction consumed* comes from the link's own resolved `endpoint_anchors`,
which captured every endpoint's identity at the moment the transaction landed
and therefore cannot be taken away by a Cell ageing out of view — measured on
mainnet, only about 0.3% of retained links still resolve even one input through
the Cell map. An anchor marked `resolved: false` is identity-only: the server
derived it from the outpoint alone for an input the retained window never held,
so it carries an exact id and position but an empty `content_hash`. It names a
place a pulse may depart from, never evidence of what was spent, and the
consumed-evidence surfaces exclude it. *Where a pulse can depart from* remains
a question about the current graph, answered as before, with the
surviving-sibling route kept honestly labelled as a lineage witness. The panel
names the spent inputs no route departs from above the ledger of what carried
the transaction, and says nothing when the routed evidence already is the
inputs. A live pulse does depart from the anchor's own position: the origin is a world
address carried by value rather than an id, and the per-batch entry index says
which live staged node that address enters the fabric at, so every path node
remains a live staged cell. Recall is unchanged — it routes between retained
Cells by id, and an identity-only anchor still names a place a packet may leave
from, never evidence of what was spent.

### 9.4 Reorg ordering

Canonical prune processing happens before replacement deltas. On receipt:

- queued and active pulses at or above the prune height are removed;
- recalled routes that depend on invalidated links are cleared;
- the compact rewrite witness is captured for `CanonicalRewriteEcho`; and
- dying Cell/fibre lifecycle proceeds from the last known real geometry.

Only replacement Cells actually received from the new canonical branch run the
normal birth/re-entry animation. The rewrite echo visualizes invalidated
evidence; it must not draw a speculative alternative branch.

## 10. Peer Colony Architecture

The peer colony is a cool contextual data-flow layer on the chain plane. It is
separate from the Cell topology even when both respond to the same block.

### 10.1 Measured and inferred topology

The topology contains:

- one local CKB node, aligned with the shared chain-node anchor;
- measured peers positioned deterministically by peer ID and reported latency;
- sighted peers — roster identities the crawler names but the local node has no
  link to — on placements we invented, so a real identity is never drawn as if
  it were an observed connection;
- a KEEP-OUT around every cohort, `COHORT_KEEP_OUT_R` = 3.5 wu in XZ, applied to
  the ghosts and to both staged tiers and to nothing else. A cohort is a hole in
  the membrane and the hole has to be empty, so a ghost or a sighted peer inside
  the disc is pushed radially out to its rim at its own height; the local node
  and the measured belt are exempt, because a measured peer's radius IS its
  latency and moving it would print a measurement nobody took. The scatter
  itself is untouched and still seed-only, so peer churn still moves nobody —
  what moves a node is a producer KEY appearing over it, which is the intended
  behaviour: the hole opens and the peer steps aside. 3.5 is
  `COHORT_LINK_STOP_R` (3.0, where a cohort's own links end) plus the half unit
  a displaced peer's own link needs to still be drawn as a line;
- attested cohorts, one per block producer in the UNION OF TWO WINDOWS —
  the 240 attributed blocks the local node holds, which is recency, and the
  indexer's seven complete days, which is size — carrying the chain's payout
  key and NO identity at all: the type they hold has no field an ID could land
  in. The union is what keeps a hole open: a cohort used to exist only while it
  held a block in the ring, so its mark vanished on a reorg, on a rebuild and
  through the first minute of a boot, while the week is warm on the first frame.
  A key is a key in either window, so the two sets simply add; the ring is
  capped upstream and the week at 16 rows, and `COHORT_MARK_CAP` (64) still
  bounds what is drawn. They lie EXACTLY on `COLONY_Y`, with no scatter in Y
  whatever, because a cohort is a mass lying IN the membrane whose shadow is the
  hole, and a mass off that plane is a disc floating beside one;
- a seed-only inferred scaffold of roughly `240 +/- 30` nodes in an elliptical
  disc, scattered through `COLONY_Y_THICKNESS` — 6 world units, +/- 3 either
  side, the depth at which the colony reads as a MEMBRANE with marks cut into
  it rather than as a volume the marks float inside; and
- inferred k-nearest, small-world, and component-bridge edges.

The inferred scaffold is independent of the measured peer list, so peer churn
does not reshuffle the ambient colony. It is memoized by universe seed. Edges
from measured peers into the scaffold remain classified as inferred because
the node did not observe those Internet links.

The colony plane is the boundary between two universes: above it the cell
canopy, CKB's own spacetime; below it the one a miner draws on. Four rules follow
and settle every argument in the rest of this section. The plane IS a MEMBRANE,
and a POW cohort is a mass lying in it whose shadow is the hole. The energy under
the plane is a DIFFUSE SUBSTANCE that permeates space — a mist with no shape of
its own: not a sea, not a coast, not curtains — and it is SECONDARY, never taking
focus from the peer mesh or the Cell galaxy. THE INTAKE IS THE POINT: the
substance exists to be seen being drunk, at the default camera, at every cohort,
including the ones standing under the mesh's body. And A COHORT NEVER EMITS
UPWARD, which the block-path paragraph below states in full.

A cohort's mark is COMPUTED and no longer composed. Until 2026-09-03 this layer
drew one three times — a disc in the plane with a bright lip and 88 radial
striae, a camera-facing aura carrying the same hole, and a patch of mist under
the plane that the hole was drinking. Seven rounds of that hand-built form
reached a ceiling, for a reason that is structural rather than a matter of
tuning: the image of a black hole is a CONSEQUENCE of light bending around a
mass, and a stack of independently mapped parts cannot converge on shapes it does
not contain. So the layer computes the image instead, in TWO draws off one plan,
one walk, one instance count and one set of lanes:

- the LENS, one camera-facing quad per cohort (`materials/colonyLens.ts`), 32 wu
  of half-extent so the near disc cannot be cut off by its own domain. For every
  pixel the light ray is traced BACKWARD around a Schwarzschild mass — the Binet
  equation `u'' = -u + 3Mu^2`, in RK4 over the orbital angle at 0.055 rad a step
  — and reported where it ends: in the horizon (black, and it hides what is
  behind it), on the colony plane (the intake's own substance, sampled where the
  bent ray crosses, with a fainter second image where it crosses twice), or in
  the void. The shadow, the photon ring, the far side of the disc folded over the
  top, the front crossing, the beaming and the redshift are not drawn: they
  FOLLOW from that one trace, at every camera angle. EVERY ray is bent — a guard
  test refuses a straight-ray shortcut, because at a handoff radius of ten
  horizons the deflection is still 0.2 rad and the seam showed as a hard dome cut
  across the disc — and that is affordable because the step is stretched by
  `clamp(impact / 2.5 rs, 1, 6)`: a ray passing at 30 horizons leaves in nine
  steps, and the step count binds only for the thin annulus that lingers near the
  photon sphere, which is what a photon ring IS. The disc's texture, its spiral
  back-trace and its colour ramp are the mist library's own GLSL, so the
  substance in the picture and the substance a mote falls through are one thing.
  The SHADOW's alpha is the closeness, which is what makes the hole an occluder
  up close and nothing at all at the default camera, and a glow the program
  paints itself stands in for the bloom this scene has no post-process for;
- the MOTES, 96 points per cohort (`materials/colonyMotes.ts`), each living
  exactly ONE fall: born out in the void, carried in along the same sink's
  streamline the disc's texture is advected on, gone at the shadow's edge, reborn
  elsewhere. A two-dimensional sink of strength `k` obeys `d(r^2)/dt = -k`, so
  the trajectory is closed-form and every mote is a pure function of its seed and
  the clock — no simulation, no buffer of positions, no readback. They exist
  because a field alone cannot state a RATE: a texture at rest and a texture
  flowing at two world units a second look identical in a still.

THE WHOLE IMAGE FOLDS WITH THE CAMERA, on one number. `uPxScale` is written once
a frame — `0.5 * drawingBufferHeight * projectionMatrix[1][1]`, so it is
DPR-aware for free — and each program divides it by its own distance to a cohort
to get PIXELS PER WORLD UNIT at that mark. Closeness is that quantity
smoothstepped over 20 -> 50 px/wu, and it drives everything:

| Folded quantity | Far, at or below 20 px/wu | Near, at or above 50 px/wu |
|---|---:|---:|
| Horizon `rs` | 0.08 wu | 0.77 wu |
| Shadow, `3*sqrt(3)/2` horizons | 0.21 wu | 2.00 wu |
| Disc inner edge, the ISCO at 3 horizons | 0.24 wu | 2.31 wu |
| Disc outer edge | 14 wu (the far form's catchment) | 28 wu |
| Shadow opacity | 0, and 0 until closeness 0.35; 1 from 0.85 (`lensHoleGate`) | 1 |
| Beaming | 0 | 0.45 |
| Traced image's weight | 0 (no ray is integrated) | 1 |
| Far form's weight | 1 | 0 |
| Motes | born within 14 wu, x0.2 | born at 8-27 wu, full |

Every length in that table is the FULL-SIZE cohort's, and each is multiplied by
the mass factor `m` of the cohort it belongs to (below); the closeness that
indexes the two columns is measured on `pxPerWu * m` rather than on `pxPerWu`,
so a cohort at the 0.45 floor holds the far column up to 44 px/wu and reaches
the near one at 111.

THE BAND AND THE FAR FORM WERE BOTH CUT ON 2026-09-03, on the user's judgement
of the live frames: the far view was right, but at the MID range - 14 to 20
px/wu - the cohort was far too big, and at that range the whole mark should be
about the size of a SIGHTED PEER, whose sprites are 1.5 and 2.0 world units
across. So the fold's far edge moved 6 -> 20 px/wu (14 px/wu used to be 0.26
unfolded, which is a `mix(6, 28, 0.26)` = 11.7 wu disc, 23 units across against
that 2.0), its near edge 30 -> 50 so the band keeps its width, the far disc
6 -> 3 wu and the far halo's Gaussian radius 1.0 -> 0.7 wu.

FAR AWAY THE MARK IS THE INTAKE, NOT A TRACED IMAGE (2026-09-03, the round after
the cut above). The user judged the 3 wu skirt on the live frames: at the app
camera a cohort still read as "a small eye", and what was missing was "the
atmosphere of energy being drawn in". The eye was structural: even a 0.08 wu
mass captures every ray aimed within 2.6 horizons of the centre, so the centre is
the one place the disc is never sampled, and the ring of disc around it is
brighter than it. So below the band NO RAY IS INTEGRATED. The fragment sends the
unbent ray straight to the colony plane (`lensFarSample`) and reads the intake
there: ONE hyperbolic law `0.3 * (1 / (rho + 1))^1` - a sink's own 1/r density,
half its peak by 1 wu, a third at 2, a sixth at 4, a twentieth at 8 - under the
mist's catchment weight `(1 - (rho/14)^2)^2` so it is exactly nothing at 14 wu,
modulated everywhere by the mist's own medium advected along the sink's spiral
streamlines, read at 0.6 of its grain and wound a further 2.4 turns per e-fold so
the arms are legible at six pixels a unit. Over it a round, camera-facing NUCLEUS
- a 0.7 wu Gaussian with a brighter core, a sighted peer's own shape and the
brightest thing in the far form - which is what keeps a dark lane from printing a
pupil on the centre and is the OBJECT a viewer sees; the in-plane arms are its
atmosphere. The far form wears the MESH'S HUE, `scaffold` toward the disc's cyan,
white only inside the nucleus, and the block's gulp rides on top.

THE SECOND JUDGEMENT THAT SHAPED IT (2026-09-03, on the round before this one, a
5 wu form of two skirts coloured with the near disc's ramp): "not in harmony with
the peer mesh, jarring", and "the intake not fused with the cohort; the vortex not
reaching far enough; the periphery too bright and falling too slowly". Measured
on that form, ON minus hidden: its central light was three to four times a
sighted peer's own, its lit radius five to seven times a peer's, its periphery
BLUE at two and a half times its green where the scaffold is cyan - over the rose
canopy that composited to violet - and its shape a flat foreshortened ellipse in
a mesh of round points. The hyperbolic law, the mesh's hue and the nucleus are
the three answers, and the knob for the periphery is `cohortFarFall`, the
exponent: up, and the tail dies faster. Through the band the traced image fades
in OVER that far form at the closeness, and the hole's dark alone waits: a
captured ray paints `smoothstep(0.35, 0.85, closeness)`, so a cohort at 30 px/wu
is a lit whirlpool with a lens forming in it, at 35 the hole is translucent, at
40 it is the film's hole. Near, it is the
hole with a 28 wu vortex around it. The fold must be measured on the DRAWING
BUFFER's height and never the CSS height, because a tier that lowers the DPR
changes how many pixels a world unit covers, and a mark folded on CSS pixels
would unfold into the near form exactly when the machine had said it could not
afford one.

A COHORT DRINKS AT ITS OWN RATE, and both draws read it. Each mark carries its
share of whatever window it was measured over — the indexer's week when the
ledger names that producer, else the 240-block ring, never a blend of the two,
because each standing carries its own denominator. `mistShareFactor` turns it
into ONE per-instance factor, `mix(0.35, 1, share / shareMax)`, that scales the
sink's `k` and the pile the arriving medium leaves at the lip; the motes take the
SAME factor, evaluated on the CPU into their `aStrength`, so the specks fall at
exactly the speed the streamlines behind them run at. Those are one quantity said
twice, since `d(r^2)/dt = -k` is the speed the streamlines carry and the pile is
what arriving at that speed leaves behind. The factor is 1 at the largest share
and below 1 everywhere else, so it only ever turns cohorts down. NOTHING ELSE
reads the share — not the colour, not the amplitude, not the gulp, because one
block is one block whoever won it. The implied hashrate the cohort card prints
beside that share is a HUD FACT AND NOT A SCENE ONE: `networkHashRateHs` divides
the chain's own difficulty by the mean of the block intervals this session
observed, and nothing in the colony reads the result.

THE MASS IS THE WEEK, and it is the only thing one mark says that another does
not (2026-09-04). Every form parameter above is a GLOBAL uniform — one horizon,
one disc, one palette, one band — so until this lane existed seven cohorts were
seven copies of one picture, and the share moved only a RATE, which needs
seconds of watching against a reference and cannot be read in a still. Each mark
now carries a fourth lane, `aMass`, holding one factor `m = clamp(cbrt(weekShare
/ 0.6), 0.45, 1)` read off `ProducerStanding.ledger.share`, and that factor
multiplies EVERY length in both programs: the horizon and so the shadow and the
ISCO, the disc's outer edge near and far, the far form's catchment and its
nucleus, the motes' birth and death radii, and the quad the whole image is drawn
on. Four rules hold it there, each one a ruling already on record. THE CEILING
IS TODAY'S FORM — `m` is 1 at and above the anchor share, so the cohort holding
62 % of the week keeps the far form judged on 2026-09-03 exactly and every other
folds DOWN, and the colony gets quieter and never louder, which is how the mark
stays secondary to the mesh and the canopy by construction rather than by a
taste that can drift. THE WEEK ONLY, ABSOLUTE, AND NEVER THE 240-BLOCK RING — a
size is read at a glance and compared across days and against the peers standing
beside it, so it must not pulse once a block (the ring moves on every block,
empties on every reorg and is empty for the first minute of a boot) and must not
depend on who else happens to be staged; no ledger means every mass is 1 and the
picture is the one this layer drew before the lane existed, byte for byte, while
a key inside the ring and outside the seven days takes the floor, which is a
reading ("small this week") and not a missing value. THE FOLD IS MEASURED IN
PIXELS PER SHADOW AND NOT PER WORLD UNIT — both programs take their closeness
from `uPxScale * m / distance`, so every cohort's hole opens at the SAME
on-screen size, the only arrangement in which a small cohort at the mid range is
not "a small eye", a form the user refused twice. And NOTHING THE TOPOLOGY READS
MOVES — the hit sphere 2.0, the link stop 3.0 and the keep-out 3.5 are sized for
the maximum and stay constant, the placement is still a pure hash of the key,
the lane is written in place and no geometry is rebuilt on a tally. A 1.5-second
ease covers the two events that move every mass at once — the ledger ARRIVING
after the cohorts are already standing, and an indexer outage CLEARING it — since
a week share drifting by under a tenth of a percent between two 120-second
refreshes is invisible with or without one; a cohort seen for the first time
starts AT its target, because growth is for a size that changed and not for a
mark that arrived. The lane's SIGN carries a second fact in the same float:
`cohortHandedness` is +1 where the cohort's own seed — `fnv1a(payout key)` over
2^32, the seed the phase already comes from — is below 0.5 and -1 above, and
both programs spend it by mirroring the local frame they hand the mist library,
so that cohort's spiral winds the other way round. That is IDENTITY and not
data, and it is what separates the middling cohorts the week makes the same
size.

FOUR CHANNELS ARE DELIBERATELY NOT ENCODED, each refused on a ruling rather than
on taste. HUE: the far form wears the mesh's own cyan (the violet of the round
before it came from ONE off-palette periphery), two cohorts' discs are one
substance taken at two rates and not two textures, and the only per-cohort
string that could colour a mark is the SELF-DECLARED build, which is a claim and
would be drawn as a fact. BRIGHTNESS: additive marks clip — the peer tiers
measured rest brightness going as the square of the dim and every tier clipping
to the same white-cyan — and the centre pixel of every mark is saturated in the
composite anyway, so that axis belongs to the EXISTENCE tiers (ghost, sighted,
measured) and not to mining. POSITION: hash-placed for churn stability, and a
centroid placement was already rejected in the block-producers round. HOLDINGS:
read live on 2026-09-03 through ckbadger's `addresses/{lock_hash}`, the 12.8 %
cohort held MORE CKB than the 62 % one, because pools sweep their payouts — so a
size by balance would contradict a size by share, and the harvest stays on the
card.

**First look, measured 2026-09-04** at the app camera on the layer's own light
(the frame minus the same frame with the layer hidden), the floor knob at 0.45
against the same page at 1: the 62 % cohort is IDENTICAL either way in every
0.5 wu bin — the ceiling holding, measured rather than asserted — and the lit
radius, the mean radius of the 8/255 ring, is 3.25 wu for it, 1.5-1.75 wu for
the three middling cohorts at `m` 0.54-0.59 and 1.0-1.25 wu for the three at the
floor: monotone in `m`. Every centre pixel reads the same 244/255 whatever the
mass, which is the composite clipping and the reason a far mark is judged on the
difference and never on the composite's peak. The full live leg — the sizes at
the mid range, the dolly on the smallest cohort, the paired cost A/B, the
clicks, the fallback in both directions and the handedness strip — is recorded
in this file when it lands.

There is NO FLOOR, NO SHEET AND NO GROUND TERM anywhere under the plane, and that
is a measurement rather than an omission. A sibling `ColonyMist` layer drew up to
two flat, structureless haze sheets under the whole colony until 2026-09-02, when
a live leg priced one at 0.90 ms of the layer's 1.06 ms of frame GPU at the app
camera against a contribution peaking at 2/255 anywhere on the canvas — 0.045 of
a ghost sprite's core — and they were removed. The omnipresence is now stated by
the CATCHMENT alone: the back-trace reaches 30 wu around each mouth, and the
substance is shown only inside the image that cohort's own mass makes of it. A
floor comes back only on a new measurement that says a viewer can see one. For
the same reason `colonyMist.ts` draws nothing at all now — it is a GLSL LIBRARY
(the medium, the back-trace, the filaments, the colour ramp, the share factor)
plus one 256-square noise tile, and the lens compiles it. Two draws of one
substance, one computed and one painted beside it, would disagree the first time
either was tuned.

The layer takes exactly ONE input from the block path, and it is a string. On a
block pulse increase, the mark whose `CohortMark.nodeId` equals
`ColonyFlood.entryId` — both `attested:<key>`, both built by `attestedNodeId` —
has the block's SIMULATION SECOND stamped into its gulp lane, and its disc piles
and its specks flare together on one envelope. Every other slot holds a
far-negative sentinel, so a slot that has never won never flares, and a zero
would read as "won at t = 0" and flare the whole colony on load. Wins are held
against the node id and re-laid under every re-plan, because a re-plan reshuffles
slots and a win held by index would hand another cohort the moment somebody else
won. While backfill is active the pulse is consumed and nothing is stamped. The
shockwave and the flood object stay out for the reason they always had: a front
that crosses the whole colony is one number every cohort reads, and it would
flare all seven of them on a block one of them won.

THE TWO DRAWS DO NOT SHARE ONE LANE OBJECT. The lens is an `InstancedMesh` and
reads one value per instance, so its seed, gulp, share and mass lanes are
`InstancedBufferAttribute`s; the motes are a `THREE.Points` draw with one vertex
per MOTE, so the same gulp has to be 96 copies wide per cohort. Handing that
geometry the instanced wrapper would read one cohort's stamp for the first
ninety-sixth of the colony's motes and garbage after it. Same VALUES, two widths,
written by the same two walks — the plan's and the pulse's. The motes' geometry
is allocated once at `COHORT_MARK_CAP` (6,144 points) and never rebuilt, since a
rebuild would drop every live stamp; a retired cohort is a strength of zero
written over its slots, and an unwritten slot draws nothing by arithmetic.

RENDER ORDER IS PART OF THE DESIGN HERE, and this is the only layer in the colony
where it is. The lens is NORMALLY blended with premultiplied alpha, because a
shadow is a place where light is REMOVED and an additive draw can only fail to
add. So the mark occludes BY DRAW ORDER AND NOT BY DEPTH: it darkens everything
drawn before it and nothing drawn after. Three consequences, each pinned by test.
`ColonyCohorts` mounts AFTER `ColonyEdges` and `ColonyNodes` inside the rotation
group, and before the courier and delivery layers, which fly above the plane and
must not be darkened by a hole they pass over. The lens carries `renderOrder` 1
against those layers' 0, and the motes 2. And those orders are NOT redundant with
the mount order: three sorts transparent objects by (groupOrder, renderOrder, z),
so at an equal renderOrder the mount order decides nothing and DEPTH does — and
the edges and the ghost cloud are each ONE draw with one z for the whole colony,
so a tie would let the cloud draw after the shadow whenever its bounding centre
happened to sit nearer than a cohort. 2 over 1 keeps the specks off the wrong
side of a disc alpha that reaches 0.85. The courier (1, 2) and the delivery (1-4)
tie or exceed, which is right: where they tie, three's depth sort decides, so a
carrier passing behind a hole is darkened and one in front is not. Both draws sit
inside the colony's rotation group, which is what lets every coordinate in the
mist be a colony-frame constant: a sink that never moves in that frame needs no
per-frame rotation uniform, and the medium cannot stream past its own mouth as
the plate turns.

A COHORT NEVER EMITS UPWARD, at any time. A mined block goes sideways to peers
only, because peers must verify it before it legitimately enters the cell galaxy;
the later leg is `BlockDeliveryLayer`'s carrier, which launches from MEASURED
WORKERS on flood arrivals and never from a cohort. The arc over the top of the
shadow is disc light bent by the mass, not something emitted, and a mote's offset
from its seat has y = 0 exactly. NO COLUMN, PLUME, FUNNEL OR PILLAR is ever drawn
under the mouth, at any brightness profile: each was built and rejected by eye,
because a shaft gated through the hole is invisible except from directly overhead
and an ungated one is a searchlight in miniature. Only SURFACES BEING DRAWN read
as intake, and the lensed disc — its far side folded over the top of the shadow,
moving — is such a surface.

FOUR RADII, IN ONE ORDER, PINNED IN ONE TEST. `COHORT_HIT_RADIUS` 2.0 wu is the
pick target, and it is the SHADOW at the near end of the fold: derived as
`3*sqrt(3)/2` horizons rather than typed (2.0005 at the shipped mass), so a
retune of the mass moves the target with the picture. It is the same sphere at
every distance, deliberately — the drawn form folds, but the hit sphere lives in
the TOPOLOGY, which does not know where the camera is, and a pick radius that
folded would be a target that moved under the cursor as the user dollied; the far
halo is explicitly NOT a hit target. `COHORT_DISC_IN` 2.31 wu is the ISCO.
`COHORT_LINK_STOP_R` 3.0 wu is where `ColonyEdges` ends every link incident on a
cohort — outside the ISCO, so no link ends on the bright ring the trace computes
there, and inside the keep-out, so a displaced peer still has half a world unit
of its own link left to draw. A link run further in would be a straight bright
segment laid across the one region of the scene that is saying "light does not go
straight here". `COHORT_KEEP_OUT_R` 3.5 wu is the placement rule above.
`HIT 2.0 < DISC_IN 2.31 < LINK_STOP 3.0 < KEEP_OUT 3.5` is asserted in one line
of `__tests__/materials/cohortKeepOut.test.ts`, because a pure data derive may
not import a `ShaderMaterial` to read one float.

EVERY NOISE FETCH IN A RAY-MARCHED PROGRAM IS `textureLod` WITH AN EXPLICIT
LEVEL. A `texture2D` inside a ray march picks its mip level from screen-space
derivatives, and those explode between neighbouring rays that end in different
places: the medium came back as dashed radial stripes. The mist library's
snippets call a `mistNoise(vec2, int)` wrapper the compiling program declares for
itself, so the lens's is a `textureLod` and the guard that no `texture2D` reaches
this program is STRUCTURAL rather than a claim that a regex ran. That also makes
the lens GLSL ES 3.00 only, which the shader validator is told rather than left
to discover.

Per-draw GPU cost is priced through `colony.cohort.lens` and
`colony.cohort.motes` (§19.5); `colony.cohort.face`, `colony.cohort.aura` and
`colony.mist.patch` retired with the draws they timed. Quality owns exactly one
field here, `cohortLensSteps` (§13) — the RK4 step count, 96 / 64 / 40 — and it
is a PRECISION field and never a presence one: no tier drops the mark, the motes
or the shadow's occlusion, because a cohort at 40 steps is the same cohort with a
coarser photon ring while a cohort that is not drawn is a producer the scene is
lying about. What those three values should be is an OPEN QUESTION rather than a
settled one. The table below measures the tiers single-digit percent apart at
every camera, for a reason that is in the program and not in the measurement: the
loop carries four early exits (escaped, captured, the disc crossing driving the
transmittance under 0.04, and the plane test), so the cap binds only for the
pixels that linger near the photon sphere. If a tier must buy something here it
has to be the pixels the quad covers — `COHORT_LENS_QUAD_R` 32 wu,
`COHORT_DISC_OUT` 28 wu — or a resolution scale, and no tier touches either.

Nineteen live knobs in the `peer` folder, each a fact about the mass or about the
substance around it and never a PART of a picture, since a knob that moved a part
would be the composed aperture creeping back in through the panel:
`cohortHorizon` (the Schwarzschild radius at the near end of the fold, and the
one to reach for first — every other radius is a multiple of it), `cohortDiscOut`
(how far the intake reaches), `cohortDiscAmp` (the near disc's own brightness),
`cohortBeam` (how much brighter the approaching side is), `cohortFarAmp` (the far
form's in-plane weight), `cohortFarFall` (how fast the far form dies with radius:
the exponent of its hyperbolic law), `cohortFarStreak` (the far arms' contrast;
0 is a plain halo with no intake in it, 1 the ceiling), `cohortFarSwirl` (the
far arms' extra winding, in turns per e-fold on top of `cohortSwirl`),
`cohortGlow` (the bloom stand-in), `cohortWarmth` (0 the
mesh's cyan disc, 1 the film's orange one, moving the disc and the specks in it
together), `cohortUnfold` (the near end of the fold band, 50, on a 10-80 range;
the far end, 20, is the layer's rule and not a knob), `cohortSteps` (RK4 steps
per ray, which overrides the quality tier the moment it moves), `cohortIntake`
(the sink's `k`), `cohortSwirl` (how far a streamline winds before it arrives), `cohortOrbit` (the
specks' swing near the mouth) and `cohortMotes` (how bright the specks are).
The last three are the only per-cohort ones in the folder: `cohortMassAnchor`
(0.6, the share of the week at which a cohort is full size), `cohortMassFloor`
(0.45, the smallest a cohort may be drawn as a fraction of that — and 1 is the
OFF switch, since every mass is clamped into that range and the colony then
draws exactly what it drew before the lane was written) and `cohortHand` (1,
whether each cohort winds its own way off its key or the whole colony winds
one). Fifteen knobs retired with the composed form, and no knob here can clip
the mark:
the disc's alpha is clamped in the fragment and the shadow's is the closeness,
so every amplitude scales a quantity that is bounded after it.

**Measured on 2026-09-03**, on an AMD Radeon 890M through ANGLE/Vulkan at
2560x1440 DPR 1, on live mainnet with seven attested cohorts, quality forced to
`high`, min-of-N `TIME_ELAPSED` readings through the probes above. The colony's
rotation was frozen and the page paused so a sweep compares one picture, and the
step counts were INTERLEAVED in 1.8-second windows rather than given one long
window each: this machine's background load drifts threefold on a ten-second
scale, and three earlier attempts at the cost table came back non-monotone
because of it. Load average 3.0-6.0.

| Quantity | Measured |
|---|---|
| `colony.cohort.lens`, app camera (4.6-22.6 px/wu over seven marks) | 0.455 ms |
| ...at 14 / 20 / 40 / 90 px/wu on one mark | 0.838 / 0.998 / 1.890 / 2.386 ms |
| ...at 90 px/wu with a second mark 9.6 wu away | 4.584 ms |
| `colony.cohort.motes`, every camera | 0.10-0.14 ms |
| Whole layer, frame bracket (layer on minus hidden) | +0.30 ms at the app camera to +4.85 ms at a crowded 90 px/wu hole |
| 96 -> 40 steps, at every camera | -4 % to -17 %, inside the +/-17 % cross-run noise the app-camera control establishes: single-digit percent |
| The far form's own brightest pixel at the app camera | 77/255 — 0.40 of a ghost sprite's core, 0.34 of a measured peer's, over 0.40 % of the canvas |
| The unfold: 29 frames from 6 to 62 px/wu, each resampled to the same 24 wu of world | largest per-frame change 1.15x the median, at 20 px/wu: no pop |
| Occlusion inside half the shadow at 40 px/wu | exactly 0/255 on all 5,025 pixels, where the layer hidden shows a ghost, a peer and ten link crossings |
| The intake reads: 5-12 wu radial flow, block-matched at 40 px/wu | 1.79:1 inward on the top cohort; the same cohort with its share factor moved from the floor to 1 ran 3.25x faster |
| The gulp, over 310 s of mainnet | 28 pulses, 28 stamps, 28 matching node ids, 0 mismatches, all 96 mote copies agreeing every time |
| Clickability, 7 cohorts x 2 azimuths | 14/14 holes opened their own card and 7/7 nearest clickable neighbours theirs; minimum XZ clearance exactly 3.500 wu |
| Saturated pixels attributed to the layer (on minus amplitudes at zero) | -26 at the app camera; +658,491 at a 40 px/wu hole, on 3,686,400 px |
| `Time.paused` A/A control, 0.3 s apart | 1 pixel |
| Console, program info logs, NaN sweep of both programs | clean |

⚠️ EVERY ROW ABOVE WAS MEASURED AT THE 6 -> 30 px/wu BAND AND THE 6 wu FAR DISC
that shipped that day. The band is 20 -> 50 since, and the far form is the
untraced intake over a 14 wu catchment (see above), so every row taken inside
the old band - the app camera at 4.6-22.6 px/wu, the 14 and
20 px/wu columns, the far form's own 77/255, and the whole 29-frame unfold strip
- describes a form the app no longer draws there and is owed a re-measure. The
costs and the brightnesses can only have come down (a smaller disc covers fewer
pixels and terminates rays sooner); the unfold strip's claim - that a smoothstep
on this quantity does not pop - is about the law and not about these two edges.

Three of those rows settle a rule. At the app camera the whole layer costs +0.30
to +0.55 ms across two runs and all three step counts, inside the budget the form
was approved against, so 96 is affordable as the default tier and the cascade is
currently choosing between three nearly identical pictures at three nearly
identical prices. The far form REMOVES 26 saturated pixels at the app camera
rather than adding any — against the retired mist patch's +513 — so the lensed
mark is the first version of this layer that is not a source of clipping at the
default camera at all, and at a third of a measured peer's core it is secondary
by measurement and not by assertion. And the shadow is a hole exactly: its inner
half reads 0/255 on every one of 5,025 pixels where the layer hidden shows a
ghost, a peer and ten link crossings, the motes-only frame is pixel-identical to
neither-drawn, and at the app camera that same shadow does not occlude at all —
the closeness doing what it claims.

One defect was found in that session and fixed before the table was taken, and it
is the shape a bug on this layer takes. The ray march's escape test read
`phi > 0.6 && r > r0 * 1.2`, with `r0` the camera's distance to the mass — and
"heading away and already further out than it started" only means "the ray has
left" while the disc is inside `1.2 * r0`. Past the point where the camera came
closer to a mark than `discOut / 1.2` (23.3 wu at the shipped 28 wu disc, about
66 px/wu) a ray bent over the top was terminated before it reached the far side
of the disc, and because the cut landed wherever the adaptive step happened to
sample it was a hard quantised boundary and not a fade: a row of straight-sided
black wedges bitten out of the outer disc at close cameras. The escape radius is
`max(r0, discOut) * 1.2` now. It was attributed BEFORE the shader was touched, by
walking `uDiscOut` down at one paused camera where `1.2 * r0` was 18.21 wu —
wedges at 28 and 22, none at 18, 15 or 12 — which is the method any close-camera
artefact here should get, because the two halves of a shader A/B are different
page sessions with a different `uTime` and a pixel diff across them says nothing.

**The clearance finding of 2026-09-02, and what closed it.** Thinning the slab
tightened a cohort's clearance: the nearest non-cohort node measured 1.274 wu
from a cohort — inside the pick radius of the day (1.5 wu) and inside the drawn
hole — where R19 measured 2.99 wu at the old thickness. Every mark still opened
its own card, but at the two closest peers' projected centres the HOVER readout
named the cohort while the CLICK resolved to the peer, and one cohort failed its
own hole from one azimuth because a peer 4.6 wu away stood in front of it along
that ray. The fix is PLACEMENT rather than pick radius, and it is the
`COHORT_KEEP_OUT_R` disc described above: nobody may stand in the hole, so the
ambiguity has nowhere to occur. Two neighbours stepped aside, four were already
clear, and the minimum XZ distance over all 258 staged nodes became exactly
3.500. Re-measured on 2026-09-03 with the lensed mark, seven cohorts and the pick
radius grown to the shadow's 2.0 wu, that minimum is still exactly 3.500 wu — the
keep-out is what binds, on two cohorts and on the seventh the ledger added — so
the pick radius leaves 1.50 wu of daylight at the tightest and still sits inside
the ISCO. Judge any hit-radius change against the keep-out and against 1.274 wu,
never against `COLONY_MIN_SPACING`, which bounds only the inferred scatter and
not the sighted placements.

### 10.2 Block flood and delivery

For each block pulse, a deterministic nonce selects a non-local origin biased
away from the local node. Dijkstra arrival times over the presentation graph
are normalized into a two-second flood. Colony edges and nodes show the wave;
couriers show hop-level glints; each measured arrival, and the local node,
throws the block's last hop — a courier — into the Cell field, where the
tissue answers with its contact front (§9.2).

This sequence communicates propagation and local receipt. Only the block event,
local node, measured peers, and measured metadata are observations. The origin,
unmeasured hops, and shortest path through inferred nodes are explicitly a
presentation model.

Peer topology is memoized from a stable content signature that excludes the
continuously changing best-known block height. A new height drives event state,
not an expensive topology rebuild.

## 11. Interaction Architecture

### 11.1 Ownership rules

- Main `OrbitControls` owns background orbit gestures.
- `CellPicker` owns Cell click resolution but suspends its hover probes while
  the camera is in motion — a drag, the damping tail OrbitControls runs after
  a release (`change` keeps firing every frame after `end`, for ~1–1.8 s at
  `dampingFactor 0.08`), or a route-camera flight. Design note: the hover
  affordance (cursor, focus envelope) is therefore absent while the scene is
  still moving after a fling and returns on the first pointer move after it
  settles. Presses and clicks are never suspended: R3F takes a click's target
  from the pointer-down raycast and reports a click that hit nothing as a
  miss, so a click on a Cell during motion still selects it and
  `onPointerMissed` behaves exactly as at rest.
- Motion is detected in `App`, not inferred from the camera: `changeOrbit-
  Interaction` latches "camera changed" (`noteOrbitCameraChange`),
  `CameraMotionSentinel` settles the latch once per frame after the controls'
  update (`settleOrbitCameraFrame`), and `ConsensusRouteCamera` publishes
  `automationActiveRef` while a transition, release hold, or queued
  transition is live. The picker consumes the OR of the three
  (`orbitPickingSuspendedRef`); the adaptive-quality sampler consumes the
  same OR widened by the un-moved press (`orbitInMotion` →
  `cameraMotionActiveRef`) and drops those frames from its sample (§13).
- The scissored Cell portrait owns pointer input within its DOM rectangle and
  disables main Galaxy controls until release.
- Pointer miss and Escape clear inspection only when no other gesture owns the
  action.
- Cell and peer selection are mutually exclusive in `App`.

Opening or switching a Cell is camera-passive. The camera moves only for an
explicit consensus-route action; `ConsensusRouteCamera` then frames required
real endpoints while keeping presentation-only carriers in view when useful.

### 11.2 Selected-Cell flow

```text
CellPicker hit
    -> App selectedCellId
       |-> overlay pool guarantees bounded body visibility
       |-> R3F anchor projects to DOM inspection panel
       |-> optional portrait scissor pass
       |-> lazy semantic/identity evidence request
       `-> causal navigation or explicit memory recall
```

Selection identity is an ID, not a GPU slot. Slot churn, display-list order,
and quality transitions must not change the selected record.

### 11.3 Pause and responsiveness

Camera damping, pointer interaction, projected DOM anchors, and performance
sampling use raw frame time so they remain responsive while semantic animation
is paused. Scene-semantic transitions use simulation time.

## 12. Clock and Determinism

`SimClockTicker` advances the selected simulation clock at frame priority
`-1000`. Semantic consumers use `useSimFrame`; input, camera, billboarding, and
performance measurement use raw `useFrame`.

- Production mounts one ticker under the R3F context.
- The production singleton survives ordinary remounts so timeline identity is
  not reset accidentally.
- Pause and time scale apply to every semantic animation.
- Review scenes may install a scoped clock, fixed delta, and exact stop
  boundary.
- A paused review Canvas may use demand rendering; production remains live.
- Reduced motion is a deliberately completed semantic state, not a random
  half-finished frame.

Determinism depends on more than a seeded layout. A valid comparison fixes the
input snapshot, event nonce, simulation time, camera, viewport, DPR, quality,
and review route.

## 13. Quality and Adaptive Control

Quality owns raster density, ambience, and bounded transient detail. It does
not own staged Cell membership or the resting nervous system.

| Setting | High | Med | Low | Allowed effect |
|---|---:|---:|---:|---|
| Maximum DPR | 2.0 | 1.5 | 1.0 | Raster cost |
| Stars | 2,000 | 600 | 200 | Ambient density |
| Unresolved-population sample | 1.0 | 0.5 | 0.25 | Static halo primitive density |
| Particle capacity multiplier | 1.0 | 0.5 | 0.25 | Transient concurrency |
| Discharge arms | 3 | 2 | 1 | Transient write decoration |
| Active samples per hop | 12 | 10 | 8 | Moving wavefront tessellation |
| Expanded nearby Cell identities | 12 | 8 | 4 | Non-focused near-detail concurrency |
| POW cohort ray-march steps (`cohortLensSteps`) | 96 | 64 | 40 | Lensed-mark precision, never its presence |

Semantic memory keeps a minimum 24 CSS-pixel core at every preset. Lower
presets compensate for reduced sampling with controlled line-width and energy
changes; they do not drop focused evidence.

The following remain identical across High, Med, and Low:

- AUTO staged membership and its ordering;
- the passive nerve budget and selection rules;
- four passive samples per edge;
- passive curve geometry, width baseline, hierarchy, and animation cadence;
- route planning and deterministic timing for every admitted pulse;
- the PRESENCE of every POW cohort's mark, the specks falling into it, and the
  occlusion its shadow performs. `cohortLensSteps` is the one field that reaches
  that layer and it buys precision only: a cohort at 40 steps is the same cohort
  with a coarser photon ring, while a cohort that is not drawn is a producer the
  scene is lying about (§10.1). Measured 2026-09-03, the three values are within
  single-digit percent of each other in cost at every camera, so what they should
  hold is still open; and
- selection, inspection evidence, and canonical counters.

The particle multiplier can lower simultaneous active-pulse admission under
saturation. It may omit bounded transient work, but it cannot reroute an
admitted pulse or change canonical state.

Several raster passes carry a ceiling — on a footprint in device pixels, or on
a count — so a high-DPR buffer or a close pose cannot spend fill without bound.
Each is byte-identical at its reference point, so the reference-DPR (1×) look
and the overview pose are unchanged:

- the population halo sizes its beads and backbone width at a reference-DPR
  fill budget (`populationFieldFillPixelRatio`, reference DPR 1), so High at
  DPR 2 spends no more point and capsule fill than High at DPR 1. The one-pixel
  residual-hairline pass writes no footprint for that budget to cap — a
  `gl.LINES` stroke is one device pixel by construction — so it takes a COUNT
  ceiling instead: above the reference DPR it draws the first half of the point
  prefix (`populationHairlinePrefix`, `POPULATION_HAIRLINE_DENSE_PREFIX` 0.5),
  while the beads and the capsule backbone keep the whole of it. That prefix is
  a sub-prefix of the point prefix, so no strand hangs off an undrawn bead, and
  a dense buffer spends filament density rather than reach or level;
- the same halo folds the POINT prefix itself toward the detail camera
  (`populationClosePosePrefixMul`, `POPULATION_CLOSE_POSE_PREFIX_FLOOR` 0.4,
  tagged `⟨close pose⟩` in `qualityPresets.ts` — `⟨D-3⟩` in that file is the
  earlier review's fill budget). The multiplier is exactly 1 at the overview
  pose and travels the straight line to the floor as `cellDetailViewFocus`
  saturates — the smoothstep of camera-to-target distance between 148 and 82
  world units that ⟨D-10 · knob b⟩ already reads — so a dolly travels along the
  curve rather than stepping onto a level, and an unwired or non-finite focus
  is the overview. A closer pose adds no bead and magnifies every one that is
  there, so what the fold spends is grain: the field keeps its whole envelope
  (a prefix of the placement is a complete thinner field), and sprite size,
  taper, emission and the knob's own thread level are untouched — the sprite
  still rides the tier cap alone. Measured 2026-09-06, the halo was 5.0 of the
  7.6 ms scoped pass at the default pose and 8–10 ms at a dolly (k 16–17 ms·GHz,
  43 fps at 1 GHz). **The halo's three cost laws multiply on one axis in a fixed
  order** — tier (`populationCapMul`), then pose, then the dense-buffer hairline
  prefix — and each stage is a prefix of the one before it, so the hairlines are
  a sub-prefix of the folded bead prefix and are never folded twice;
- the Cell body sprite caps at `CELL_BODY_MAX_POINT_PX` (256 device px), the
  halo points conserve light on both sides of their existing CSS-pixel ceiling,
  and a measured peer's halo rolls its angular size off below
  `MEASURED_HALO_NEAR_DEPTH` (32 world units) — each dims the light it clamps so
  the resting quantity is conserved, and each binds only past a threshold
  distance, never at the default pose; and
- the POW cohort lens folds on a reference DPR (`COHORT_FOLD_REFERENCE_DPR` 1)
  rather than raw device pixels, so one CSS framing marches the same on a 1×
  and a 2× buffer and a tier's `maxDpr` step leaves the fold unchanged; its
  march decision (whether a mark lenses at all) is therefore display-independent.

These are ceilings on quality-owned raster, not membership or nerve changes.
A ceiling that clamps a SIZE dims the light it clamps, so the resting quantity
is conserved; a ceiling that clamps a COUNT — the halo's prefix chain — spends
density inside an unchanged envelope instead, which is why every stage of it is
a prefix and none is a threshold, a cull or a level. None of them touches AUTO
membership, the passive edge budget, or the four-sample curve geometry (§15.4),
and the halo's prefix chain is the one place where a quality lever, the camera
and the buffer meet — they meet by multiplying, never by overriding.

Before the first Canvas mount, AUTO estimates the drawing-buffer load High
would request. It begins at High below 8 million pixels, Med from 8 million,
and Low from 20 million. Thus 4K at DPR 1 and 1080p at DPR 2 begin at Med
instead of spending the calibration window in a tier already measured at the
vsync boundary. Deterministic review Labs retain High unless their URL opts
into `adaptive-quality=1`. An explicit High/Med/Low query or control remains
authoritative.

Multisample antialiasing is decided once at that same mount, from two readings
of the same buffer. `antialias` is a context attribute fixed at Canvas creation
and cannot follow the runtime tier, so both readings happen before the first
frame. **Density first:** a buffer at 1.5 device pixels per CSS pixel or denser
gets no MSAA at any area, because such a buffer already anti-aliases
geometrically while the resolve multiplies precisely this scene's thin passes.
On the 890M at 1920×960 CSS @2× the MSAA context cost 2.2× the scene GPU time
of the same page without it — residual fibres 2.5 → 6.5 ms, fabric base
0.46 → 1.5, bridge 0.22 → 1.0, cell bodies 0.55 → 1.9 — for edges that a 2×
buffer had already softened. The density read is the buffer's, not the
display's: the browser's ratio is first clamped to High's own DPR ceiling, so an
invalid or sub-one reading is not dense and a dense display whose viewport
geometry is unusable gets no MSAA, which is the cheaper failure. **Then the area
class,** for everything below that density: the MSAA resolve is a per-frame cost
proportional to drawing-buffer pixels — largest at or above the 8-million-pixel
class, exactly where the DPR lever is already inert. So a buffer that opens at
Med or Low (≥ 8 million pixels) turns MSAA off, while a High-class buffer
(< 8 million pixels) on a 1×-ish display keeps it on for the hard edges it helps
(capsule line segments, couriers, icosahedra). The softer hard edges above the
class are the accepted cost; the passes that read as a nervous system are
screen-space capsules whose own shader owns their caps.

One 2× 4K display produces two window classes of the same page: fullscreen is
1920×1080 CSS → 8.29 million pixels, 3.7 % above the boundary, and opens at Med;
the maximized window is 1920×~960 → 7.37 million, 8 % below it, and opens at
High. The class still decides that opening tier and the two windows still differ
in it. MSAA no longer differs between them: both are 2× buffers, so both open
without one, and the maximized window is measured on the same cost curve as
fullscreen instead of carrying a multisampled context for the life of the page.

AUTO then samples 750 ms windows, uses a 1,500 ms exponential average, begins
with a 4,000 ms warmup, and waits 6,000 ms after a switch. Sustained slow
evidence may move it down one adjacent preset; it never moves up during the
page lifetime. Hidden tabs, delayed callbacks, debugger pauses,
backfill/replay windows, and motion windows are rejected as performance
evidence. Manual High/Med/Low takes ownership immediately.

Four kinds of frame are never evidence — in calibration and after the lock
alike, since the sampler outlives the lock — and all four take the same
exit: the partial 750 ms window is dropped, the frames before it with it, and
the next admitted frame primes a fresh one. They are a hidden tab's frames, a
backfill/replay storm's frames (which alone also re-arm the warmup, because
the seconds after a replay are not trustworthy either), the frames of a
**post-block window** (~1,500 ms after a block lands, `recentBlockActiveRef`
settled once a frame by a sentinel keyed on `lastPulseAtMs` advancing), and the
frames of a **motion window**. The post-block window is excluded for the reason
the motion window is: a block's main-thread burst (the pulse reducer, colony
reflow, delivery and courier arming) feeds the rAF wall-time sampler, but the
tier cascade only lowers GPU cost, so a step-down bought on a main-thread cost
buys nothing back and the next block pays it again. A frame is inside a motion
window when a pointer gesture is
held (`OrbitControls` `start` to `end`, an un-moved press included), the
camera moved during the last settled frame (a drag, or the damping tail after
a release), or a route-camera flight owns the camera. `App` settles the OR of
the three once per frame (`CameraMotionSentinel` → `cameraMotionActiveRef`,
§11.1) and hands it to `AdaptiveQualityController` as `motionActiveRef`, the
same way replay hands it `hydrationActiveRef`. Rationale, measured
2026-08-28: a 4 s orbit drag at 35 fps, counted, stepped a settled page
MED → LOW and the page stayed there. A moving camera re-projects the field
and rebuilds LOD and hit indexes, ends when the hand or the flight does, and
says nothing about the steady state the tier is chosen for.

There is no settle constant after a motion window and no restart, on purpose.
The sentinel writes the flag after the controller has read it in the same
frame, so the controller sees each verdict one frame late: the first at-rest
frame is still dropped, the second only primes, and the first interval
averaged runs from the second at-rest frame to the third — two frames of
pipeline drain absorbed structurally, past which the 1,500 ms average and
the 5–12 s holds with 2× decay make a single slow frame invisible (one 30 ms
frame moves a 45-frame window's mean by 0.3 ms). A restart — the replay rule
— would zero stability and evidence on every drag: a hand on the camera every
few seconds could then never lock during calibration, and after the lock
could shield a tier the machine cannot carry for as long as it kept moving.
Motion windows are bounded by construction: the damping tail ends ~100–130
frames after a release of any strength (`dampingFactor` 0.08 against
OrbitControls' 1e-3 change threshold), and a route flight settles within
~1.4 s plus a 0.32 s release hold and at most a 0.52 s queued entry delay.
Only a hand that never lets go keeps the sampler waiting, which is that
user's choice and not a fault to time out — the page simply keeps the tier it
has.

## 14. Capacity and Resource Budgets

| Budget | Shipped value | Owner |
|---|---:|---|
| Cell GPU slots | 50,000 total | `geometry/cellPositions.ts` |
| AUTO staged Cells | server budget or 12,000 fallback, quality-independent | `tweaks/cellDisplay.ts` |
| Selected-Cell overlay pool | 256 slots reserved past the display budget; holds the selected Cell while it is off-stage | `geometry/cellRenderSet.ts` |
| Passive nerves | `min(effective server/tuned screen budget, staged Cells * 4/3)`; 8,000 fallback, 20,000 ceiling | `geometry/passiveNeighborGraph.ts` |
| Passive curve samples | 4 per edge | `nerve/fabricCapacity.ts` |
| Passive lifecycle generations | 3 | `nerve/fabricCapacity.ts` |
| Passive segment allocation | 96,000 default; 240,000 ceiling | `nerve/fabricCapacity.ts` |
| Warm segment allocation | 32,000 default; 80,000 ceiling | `nerve/fabricCapacity.ts` |
| Live active-route segments | 6,000 | `nerve/NeuralFabric.tsx` |
| Memory-route segments | 6,000 | `nerve/NeuralFabric.tsx` |
| Route-hop acknowledgement | 48 segments | `nerve/NeuralFabric.tsx` |
| Default active pulses | 256 before quality multiplier | `nerve/NeuralNetwork.tsx` |
| Spike object pool | 1,024 | `nerve/NeuralNetwork.tsx` |
| Planned pulses per link / batch | 6 / 128 | `nerve/pulseRunner.ts`, `nerve/pulseBatch.ts` |
| Heavy main-thread work per frame | 12 ms shared by the plan slice, the fabric drain and one bridge step, charged per precedence, at most 3 consecutive deferrals | `nerve/frameBudget.ts` |
| Live-plan slice | 12 % of the last frame interval, 2 ms floor, at least one step | `nerve/livePulseQueue.ts` |
| Fabric landing drain | 25 % of the last frame interval, 3 ms floor, 256-edge grow chunks | `nerve/fabricLandingQueue.ts` |
| Origin entry grid build | 2,048 graph nodes a step | `geometry/originEntry.ts` |
| Block-frame gauge ring | 32 landings, with the maxima kept past it | `nerve/blockFrameStats.ts` |
| Recent evidence links | 2,048 by default | `@cknerv/cache` `cellsReducer.ts` |
| Live pulse-link ring | 128 by default | `@cknerv/cache` `cellsReducer.ts` |
| Canonical rewrite echo | up to 50,000 records in one point draw | `components/CanonicalRewriteEcho.tsx` |
| Exact touched Cells per block | 256 | `ui/topologyConstants.ts` |
| Landing flashes per front | 128 hero / 24 peer (`landingHero` / `landingPeer`) | `tweaks/tweakSchema.ts` |
| Landing flashes per block | 300 across all fronts (`landingMax`) | `tweaks/tweakSchema.ts` |
| Landing flash slots | 512 (`LANDING_FLASH_CAPACITY`) | `components/landingFlashRing.ts` |
| Tissue flush slots | 16 (`TISSUE_FLUSH_SLOTS`) | `tweaks/tissueFlush.ts` |
| Contact front scale | peer-plane wave / `CONTACT_WAVE_SCALE` | `ui/topologyConstants.ts` |
| Cell birth / death envelope | 1,200 ms / 1,800 ms (`BIRTH_DURATION_MS` / `DEATH_DURATION_MS`); the death rite — `BLOCK_HIGHLIGHT_DELAY_S` (2.35 s) plus the envelope, 4,150 ms — is pinned under the server's 4,500 ms corpse hold by `tests/fixtures/death_rite.json` | `geometry/cellPositions.ts`, `ui/topologyConstants.ts` |
| Stage enter / exit fade | 900 ms / 900 ms, a departing Cell keeping its slot for the exit; 768 exit-hold slots, past which the oldest fades complete at once | `geometry/cellPositions.ts` |

Passive and warm allocations quantize to the 8,000-edge default class or the
20,000-edge ceiling class. Raising the live tuning budget across the class
boundary intentionally remounts those buffers through one canonical rebuild.

All persistent and transient pools are bounded. Under adversarial churn,
superseded passive afterimages and low-priority transient work clip before the
current staged structure.

## 15. Performance Architecture

### 15.1 Main-thread strategy

- Pure reducers publish immutable state and compact journals, and keep the
  aggregates the HUD reads: the staged population (alive members by home and
  by census class, `stagePopulation`) is tallied per touched id in the same
  reducer pass as the stage script census, so the population field reads
  five integers instead of walking the 12,000-member stage per block.
- A stream batch that advances only the reconnect revision is never published:
  the cursor moves, the React commit does not.
- A display write copies only the structure it touches: the staged member Set
  and the resident payload Map are owned by separate flags, so a canonical enter
  or exit copies the ~12 K member Set alone and a resident payload write copies
  the ~10 K resident Map alone, instead of cloning both on every display batch;
  a bounded link list is trimmed once at finalize rather than front-shifted on
  every append.
- The HUD's 1 Hz clock is a store with leaf subscribers (`hudClock`): the
  uptime, freshness and silence readouts re-render per tick, while the overlay
  root and its memoized panels render on data changes only. Producer standings
  reach the colony by reference and are read once a frame by identity, so a
  block moves one instanced lane without a React render in the colony.
- Render-set cursors turn adjacent journals into slot-local changes.
- The Cell source index for a link batch scans the staged Cell Map once, not
  once per link.
- Topology construction moves to a worker for non-trivial fields, and a build
  comes back as a patch applied in place (§8.2): the display graph as the
  adjacency runs that changed plus the ids that left, the passive selection
  as the edges that entered, the keys that left and the merged list's values.
  A whole rebuild is the fallback for a broken generation chain, not the
  steady state.
- **A block lands as three bounded pieces, never as one task.** A landing used
  to swap the graph AND apply every fabric stroke that swap implied inside one
  worker-response microtask, while the bridge class re-selected its hosts inside
  the React commit that published the new version: measured over 30 blocks on a
  12,000-member stage, a 34.5 ms landing task beside a 33.3 ms commit, inside a
  50–83 ms block frame. The three pieces are:
  1. **the landing task** — the graph swap and the topology commit alone (the
     worker response applied in place, the version bump, the passive selection,
     one trunk-tier threshold for the whole selection). It calls no fabric
     handle and translates no edge key, so it is O(the patch): `landingMs` max
     34.5 → 11.2 ms on a quiet window, 31–46 → 18–20 under a throttle trough;
  2. **the fabric landing queue** (`nerve/fabricLandingQueue.ts`) — every kill,
     grow, stray prune and full reconcile the build implies. The landing
     enqueues ONE O(1) item holding references; later frames drain it in strict
     FIFO order under a per-frame wall budget (`fabricLandingBudgetMs`: a
     quarter of the last frame interval, `FABRIC_LANDING_BUDGET_MS` 3 ms floor,
     always at least one step), kills before grows within a build so a grow
     cannot revive a dying edge, grows in `FABRIC_LANDING_GROW_CHUNK` 256-edge
     chunks. The edge-key translation runs at DRAIN time, not at landing time,
     so a stroke's `bornAt` is the clock of the frame it enters on rather than a
     clock already in the past. The queue publishes `fabricLandedVersionRef`
     only when an item COMPLETES, and a remount drops what is queued, because
     every queued delta patches a base the rehydrate has replaced;
  3. **the bridge frame** (`nerve/bridgeSchedule.ts`) — the React commit arms a
     slot (two ref writes) and the body runs on a frame, and only on the first
     frame where the fabric of its own build has landed (`bridgeRunDecision`:
     `landedVersion >= pending.version`). The class picks hosts by DRAWN fabric
     degree, so selecting inside the commit that publishes the version read a
     fabric that was provably behind. The slot carries an arm SERIAL rather than
     a version, because a re-anchored halo placement re-selects at the same
     version and would otherwise look like a build that had already run; a
     superseded arm is replaced, not queued, and loses nothing, since the body
     reads the registry and the drawn fabric at RUN time.
- **The bridge body is itself three steps, one a frame** — host sync, selection,
  stroke reconcile (`BRIDGE_STEP_ESTIMATE_MS` 6 / 15 / 3) — because moving a
  33 ms body out of the React commit and into one frame is not moving it out of
  the frame: measured as a frame body it was p50 19.7 / max 33.2 ms, and as
  steps `bridgeStepMaxMs` max 20.7–27.3. The anchor a build selected against is
  written by the RECONCILE step, not the selection, so a sequence a newer arm
  replaces between the two cannot make the next build's host-sync skip fire
  against a selection that never reached a stroke; the strokes the reconcile
  moves still reach the admission pass on that same frame. A restart carries the
  spend, so the build that finishes owns what the class paid getting there.
- The bridge layer's host registry decides whether a build changed anything
  its selection reads: an unchanged host set runs no selection, and a changed
  one writes only the strokes that moved — a birth into a parked hole or the
  end of the prefix, a death retracting in its own span — with the full walk
  kept for the knob repaint and an allocation overflow.
- **One heavy-work ledger a frame arbitrates what survives that split**
  (`nerve/frameBudget.ts`). The owner's priority −1 frame opens it
  (`beginFrameBudget`); the fabric drain, a bridge step and the live-plan slice
  each ask before starting and report what they spent, against
  `FRAME_HEAVY_BUDGET_MS` 12 — a vsync less the frame's ordinary work. The
  charge is per PRECEDENCE and not one running total: the plan slice ranks
  first because it alone carries a departure deadline, the drain second, a
  bridge step last, and a consumer is charged against its own rank and every
  rank above it. The three do not ASK in that order — the drain rides the
  owner's priority −1 frame and asks first, a bridge step rides a child's sim
  frame, the plan slice asks last — so one running total would have let the
  drain and the bridge spend the plan out of its own frame and raise
  `forcedByDeadline`. The first heavy grain of a frame always starts whatever it
  costs (the selection's own estimate exceeds the budget), and a consumer held
  `MAX_DEFER_FRAMES` 3 frames in a row runs on the fourth: a deferral means
  "not on a frame that is already busy", never "never". In practice the bridge
  step is the only one that yields. The ledger is a module singleton with no
  owner-independent reset, so any scene mounting a consumer without
  `NeuralNetwork`'s priority −1 frame must call `beginFrameBudget` once a frame
  or that consumer reads one endless frame and holds itself.
- Live route planning is sliced across frames (§9.1): a link batch opens the
  instant its delta arrives and its searches run from a FIFO queue on an
  epoch-stamped typed-array scratch under a wall-relative budget (12 % of the
  last frame interval, a 2 ms floor), at least one step a frame. A batch past
  its departure margin is planned under pressure but still yields to the budget,
  deferring its remainder to the next slice rather than draining a whole batch
  in one frame — no pulse is dropped. A budget spent BETWEEN steps costs the
  budget plus exactly one grain, so the grain is the tail: a link plans one
  ORIGIN a step and a dark block rescues one CANDIDATE a step, and the batch's
  stage-wide entry grid — the one grain that is not a route search — is built at
  `ORIGIN_ENTRY_BUILD_QUANTUM` nodes a step, with no reader ever handed a
  partial grid. That last split is a live reading rather than a guess: the pair
  `maxStepKind` / `maxStepCold` named the 34–47 ms tail `grid`, never cold, with
  `routeCompactions` 0 over every window — so it was neither the router's
  neighbour cache nor a route search, and the grid was the piece to chunk.
- Near-identity admission runs behind a bounding-sphere gate (§7.4): while
  the whole field is beyond the admission radius no spatial index is built or
  refreshed, and inside it a flat typed grid is rebuilt lazily per field
  version.
- High-frequency state stays in refs and reusable scratch objects: the pulse
  walk writes every hop through one scratch record and resolves its curve
  through a numeric two-level edge index rather than a key string, the warm
  overlay's render records are a pool, and birth admission answers each birth
  from a bucketed neighbourhood rebuilt once per generation — not a scan of the
  whole Cell map per birth — and ranks its k nearest with parallel scalars
  rather than a record per candidate. The per-block emit and bridge walk
  allocate nothing per edge or per stroke either: the fabric's resting route
  colours are computed into one reused scratch, the bridge render state into one
  `EdgeRender` consumed synchronously per stroke (the ~6.5 MB-per-block stroke
  garbage removed), the recall-aperture index's grid ranges into reused
  instances with pre-sized buckets, and the trunk-tier ranking into one growing
  `Float64Array` reused across builds. The `gpuProbeFrame` test pins that
  emit/draw path at zero per-frame allocation.
- A held memory recall bakes the aperture's spatial half — bucket lookup,
  projection, distance prefilter and spatial falloff — once per aperture
  identity and slot-index revision, and per frame evaluates only the temporal
  envelope over the near-route slots, uploading only their colour lanes, instead
  of re-querying the index and re-running the full scale for every candidate
  every frame. The split shares one arithmetic definition with the monolithic
  scale, so its values are unchanged.
- Peer topology excludes rapidly changing height from its memo signature.
- Picking rebuilds only when an input it bakes changes — field version, draw
  count, pick-size epoch, detail epoch, viewport, projection — allocates
  nothing when it does, budgets camera drift against its own envelope, and
  suspends hover probes while the camera is in motion: a drag, the damping
  tail, or a route flight (§7.5, §11.1). Two of those inputs no longer cost a
  whole re-projection. A DETAIL-epoch bump patches instead: the near set that
  crosses the detail line is capped at twelve identities, so the picker diffs
  one byte a slot, re-projects only the crossed slots through the index's own
  snapshot and writes their radius into the bucket their centre already put
  them in — a repair that would MOVE an entry, or a diff past
  `CELL_PICK_DETAIL_PATCH_LIMIT`, still hands the raycast back to a rebuild.
  And a stale camera POSE (`camera`, `spin`) inside the motion window marks the
  index without re-projecting it, the first at-rest raycast paying for it once,
  because the drift envelope already bounds that error in pixels. Membership,
  the coordinate system and `pointerdown` never take that trade (§7.5). Live, a
  3 s hover tail over the dense core fell from 28 rebuilds to 1 rebuild and 31
  patches, with no long task left in the tail. The gesture-start press is
  unchanged by design and still costs its rebuild.
- Adaptive quality never samples a motion window: frames inside a held
  gesture, the damping tail or a route flight are dropped from the sample the
  way hidden-tab and replay frames are (§13).
- Diagnostics cost nothing when off: every probe site is a boolean gate and
  the always-on counters are integer increments (§19.5). The set includes the
  selection-churn gauges `selectionChurn` and `weightedSelectionEdges` (beside
  `trunkTierEdges` on `__fabricStats()`) and the live-plan gauges
  `forcedByDeadline`, `maxStepMs`, `maxStepKind` and `maxStepCold` (on
  `__pulseStats()`), which name the block-churn root and the plan tail — and
  which grain the tail is — without a profiler attached. It also includes the
  block-frame gauge `__blockFrameStats()`: the three pieces of a landing are
  main-thread tasks a release build otherwise gives no reading of at all, and
  the landing split, the bridge steps and the frame ledger above were each
  decided against a number this gauge published rather than against a profile
  taken by hand.

### 15.2 GPU strategy

- Cell attributes are shared across body, flare, nucleus, and picking
  consumers where their semantics match.
- Only populated prefixes or dirty ranges upload; each lane prices its own
  ranges from what a slot costs it (bytes a slot × calls a range), a range
  merge bridges a parked gap only where its bytes cost less than the
  bufferSubData calls it saves, and never past the dirty set's hull. The
  bytes every lane flags are summed in `gpuUploadLedger` — GL·08 `UPLD`,
  `__uploadStats()` — so upload traffic is a reading, not an estimate.
- Sparse indexed passes avoid transparent work for inactive effects, and a
  pass or layer with nothing committed is an invisible object, never a
  zero-count draw.
- A program that strips a stock attribute lane carries no populated buffer
  for it: the fabric's lifecycle layer binds a one-instance dummy to the
  stripped `instanceStart/End` and colour lanes instead of two capacity-sized
  buffers nothing reads (2 × 2.3 MB of RAM and as much VRAM at the
  8,000-edge class).
- Fragments that are provably dark discard before the expensive body, and a
  ray-marched program leaves early instead. A cohort's lens cannot discard on
  geometry — its quad IS the domain of the trace, and a ray that is not launched
  draws nothing — so the saving is in the march: four early exits (the ray
  escaped, the ray was captured, the disc crossing drove the transmittance under
  0.04, and the plane test) end most rays long before the step cap, a ray passing
  at 30 horizons in nine steps, and the fragment discards outright once the
  accumulated colour and alpha are both empty. The motes discard outside the
  point's own disc and under a brightness floor.
- Passive topology and color/mask updates have separate dirty paths.
- Screen-space capsule nerves use two triangles per sampled segment.
- Shader time advances lifecycle without per-frame full-buffer rewrites.
- Draw and pool bounds are explicit at worst-case staged size.

Transparent overdraw remains the dominant large-field GPU risk. Draw calls,
triangles, upload bytes, program counts and the timer-query readings (GL·08
`GPU` and `OTHER`, §19.5) are useful diagnostics, but none of them alone
proves visual equivalence or perceived smoothness.

### 15.3 Preferred optimization order

Optimize invisible work before changing a visible contract:

1. Remove redundant calculation and per-frame allocation.
2. Move invariant work out of fragment and frame hot paths.
3. Upload only changed or populated ranges.
4. Separate topology, position, color, mask, and timing dirtiness.
5. Draw only primitives capable of producing a fragment.
6. Move pure construction to workers with latest-only cancellation.
7. Reduce equivalent geometry only after proving silhouette and interpolation.
8. Use quality-owned raster, ambience, and transient controls.

### 15.4 Forbidden shortcuts

A performance-only change must not:

- vary AUTO membership or passive edge count by quality;
- add quality-dependent passive samples or passive animation cadence;
- shorten, skip, or coalesce an observed semantic event until it disappears;
- replace a missing real endpoint or display route with a synthetic one;
- lower passive width or energy until the resting field no longer reads as a
  nervous system;
- rebuild membership or topology in response to adaptive quality alone;
- remove focused identity/evidence or make it sub-pixel; or
- claim a gain from a hidden or throttled tab.

If a target cannot be met without one of those changes, it is an explicit
product or art-direction decision and requires contract review.

## 16. Failure and Degradation Behavior

The Canvas favors visible, diagnosable degradation over invented continuity.

| Condition | Required behavior |
|---|---|
| Binary Cell snapshot fails | Fall back to the JSON snapshot path |
| Required bootstrap request has no activity | Keep the request alive; show waiting copy after 8 s and manual reload after 30 s |
| Initial React render or WebGL setup fails | Keep the static startup layer, show the safe error text and a keyboard-operable reload |
| First-light smoothness is delayed or the stage is empty | Hand off after the actual main-scene draw; retain the diagnostic phase independently |
| Server reports a lagged stream | Discard pending deltas, reset the cursor, and resynchronize from a snapshot |
| Display journal is skipped or reset | Rebuild the staged cursor from authoritative cache state |
| Topology worker is unavailable or fails | Use the same synchronous pure builder and expose diagnostics |
| Worker result is stale | Ignore it and request current state; never publish stale topology |
| Route endpoint or path is missing | Drop that visual route and record the reason |
| Pool or segment budget saturates | Clip lower-priority transient/afterimage work before current structure |
| Historical backfill is active | Advance cursors, suppress live choreography, restart quality warmup |
| Canonical prune arrives | Remove invalid pulses/recalls before rendering replacements |
| Optional semantic evidence fails | Keep canonical Cell rendering; do not fabricate enrichment |

Runtime diagnostics and tests should distinguish these cases. Silent fallback
chains inside projection or route logic make provenance impossible to audit and
are not acceptable.

## 17. Accessibility and Reduced Motion

Reduced motion preserves the complete semantic result:

- a born or replaced Cell appears in its resolved final state;
- a death or prune does not freeze mid-retraction;
- selected and recalled evidence remains visible;
- input and camera response remain live; and
- no extra event is generated to compensate for removed motion.

The startup mark and ambient breath stop under `prefers-reduced-motion`, and a
successful view handoff removes the startup layer without a fade.

Color is reinforced by geometry, timing, labels, and focus state. Warm versus
cool palette separation is important, but provenance and selection must not be
communicated by hue alone. DOM evidence remains the authoritative readable
surface for exact identifiers and values.

## 18. Extension Rules

When adding a Canvas feature:

1. Classify its source as canonical, observed, deterministic derivation, or
   presentation simulation.
2. Add wire/cache state only through the shared type and reducer boundaries;
   never call node RPC from a UI package.
3. Prefer a pure derive module before React or Three.js wiring.
4. Choose the correct coordinate space and share the Cell group's transform if
   the feature attaches to Cells.
5. Choose simulation time for semantic animation and raw frame time only for
   input, camera, projection, or measurement.
6. Declare CPU, GPU, pool, and draw bounds before mounting the feature at full
   field size.
7. State whether quality may reduce it. Canonical identity and evidence are not
   quality-owned.
8. Define missing-data, resync, backfill, and reorg behavior.
9. Add pure tests for derivation and lifecycle, Canvas tests where practical,
   and deterministic browser review for the final pixels.

If Cell positioning changes, update the Rust and TypeScript helix
implementations and their parity tests together. A renderer-local correction is
not an acceptable substitute.

## 19. Verification and Acceptance

### 19.1 Automated checks

For Canvas behavior changes, run at minimum:

```bash
pnpm test
pnpm typecheck
pnpm -F cknerv-ui-app build
```

When validating the SPA embedded in the release CLI, also run:

```bash
cargo build --release -p cknerv-cli
```

For documentation-only changes, the repository minimum is:

```bash
git diff --check
```

Tests should pin semantic invariants and budget ownership, not merely search
for a particular implementation spelling when a pure behavior test is
possible.

A quality-neutral optimization ships with two kinds of test: an equivalence
test (the old output against the new on realistic input — the same pixels,
picks, routes and selections) and a gate test that reads the counter proving
the skipped work was skipped. The counters are the ones the runbook reads
(§19.5): `__fabricStats().bridge` and `.topology`, `__cellPickStats()`,
`__colonyStats()`, `__uploadStats()`, `__pulseStats()`, `__blockFrameStats()`,
and inside the package the modules behind them (§21). A change that silently
re-enables the work then fails a test rather than a review. Where the win is
main-thread time rather than skipped work, the gate reads a gauge and not a
profile: a task that must not exceed a bound is a number a release build
publishes, so the equivalence test pins the ORDER and the counts and the gauge
pins the cost.

### 19.2 Browser matrix

Use a fresh visible browser context for each explicit preset. A page left
hidden after lifecycle manipulation can report false zero-draw or default-size
Canvas results.

| Scenario | Required checks |
|---|---|
| Main Canvas, High/Med/Low | Same AUTO membership, display graph, passive selection, curve shape, and neural reading; only documented DPR/ambient/transient differences |
| Idle field | Resting nerves remain abundant without new blocks |
| Network, carrier, commit, settled stages | Flood, carrier handoff, active route, terminal write, and retained evidence remain legible and correctly ordered |
| Selection and orbit | Correct pick, no accidental deselect after drag, overlay visibility, stable nested portrait controls |
| Memory and causal inspection | Exact retained endpoints, graph-bounded route, readable DOM evidence |
| Reorg | Invalid pulses and recall disappear before real replacement births; echo shows only the prune witness |
| Backfill | No live pulse storm and no adaptive-quality downgrade caused by replay |
| Reduced motion | Complete static semantic state without fake or half-finished motion |

For deterministic captures, use a 1440 x 900 viewport, explicit quality, the
readiness markers in `ui-app/VISUAL_REVIEW.md`, and record CSS size, framebuffer
size, DPR, simulation time, and scene identifier.

### 19.3 Quality-neutral optimization proof

When a change claims no visual difference:

- compare the same input, event nonce, clock time, camera, viewport, DPR, and
  quality;
- require an exact pixel match where the review scene is deterministic (RMSE
  `0` and changed-pixel count `0`);
- inspect at least one active frame as well as an idle frame; and
- verify shader compilation on the supported WebGL path, not only source-level
  string tests.

When an intentional improvement cannot be pixel-identical, retain before/after
captures, name the changed invariant, and verify every affected quality preset.

### 19.4 Performance comparison

- Use the same browser, GPU path, viewport, DPR, quality, data snapshot, and
  warmup.
- Measure idle and pointer/camera interaction separately. An interaction
  window is a motion window (§13): its frames are excluded from adaptive
  sampling and its hover probes are suspended, so read `__cellPickStats()`
  (`suspendedSkips`, `rebuilds`) and `__qualityStats()` beside the frame
  times to know what the window actually exercised.
- Record every GL·08 row — `DRAW`, `TRIS`, `GEO`, `TEX`, `PROG`, `UPLD`
  (bufferSubData bytes per frame across the fabric, bridge and Cell lanes),
  `GPU` and `OTHER` (GPU ms per frame for the whole scene pass and the part
  of it no scoped draw accounts for; both print `—`, never zero, without the
  timer-query extension or before the first bracket frame resolves) — plus
  the probe's frame and main-thread samples (§19.5).
- Read the always-on counters around the same window — `__fabricStats()`
  with its `.bridge` and `.topology` blocks, `__uploadStats()`,
  `__colonyStats()`, `__cellPickStats()`, `__pulseStats()` and
  `__blockFrameStats()` — so a saving is attributed to a skip that actually
  happened, not inferred from a frame time.
- Prefer multiple steady samples or medians, and on a machine whose GPU clock
  throttles compare `k` in ms·GHz rather than fps, from a mean clock joined
  over the window (§19.5). Two legs at different points of a power cycle are
  not a comparison.
- Treat software-GPU frame times as relative comparisons, not production FPS
  promises.
- Report deliberate visual-budget increases separately from implementation
  overhead.

### 19.5 Performance sampling runbook

1. Open the production page or a review Lab with `render-stats=1`; add an
   explicit `quality=high`, `quality=med`, or `quality=low` when comparing
   runs. Opening the GL·08 panel also enables sampling for that panel's mounted
   lifetime, but the query switch is the reproducible automation path.
2. Keep the tab visible, wait for boot/readiness and shader warmup, then run
   `window.__renderPerformanceStatsReset()` in DevTools immediately before the
   measured interval.
3. Read the bounded snapshot with `window.__renderPerformanceStats()`. Export
   its versioned JSON (`schemaVersion` 2) with
   `window.__renderPerformanceStatsJson()`; Chromium DevTools can place it on
   the clipboard with `copy(window.__renderPerformanceStatsJson())`.
4. Let at least two visible frames elapse after a transient before exporting,
   because GPU timer queries resolve asynchronously. `pendingQueries` names
   still-in-flight samples and those samples are not included in percentiles.

Use the same snapshot and capture settings for these minimum scenarios:

- **Idle:** `/?render-stats=1&quality=high`; after warmup, measure at least ten
  seconds with no selection, pointer motion, or camera input.
- **Active route:**
  `/?protocol-event-lab=1&render-stats=1&quality=high`; reset, restart, and let
  one complete eight-second protocol cycle play.
- **Recall:**
  `/?protocol-event-lab=1&memory-trace=1&render-stats=1&quality=high`; wait for
  `[data-review-ready="true"]`, reset, and capture a complete cycle including
  the memory trace after the settled write.

#### What the snapshot contains

- `gpu.metrics`: one entry per PHYSICAL DRAW, so a mean is a draw mean and Σ
  over the map is the scoped total. Halo: `population.points`,
  `population.residual-fibres`, `population.backbone-capsules`. Cells:
  `cell.body`, `cell.flare`, `cell.nucleus.glow`, `cell.nucleus.core`,
  `cell.nucleus.nodes`. Nerves: `nerve.passive-fabric.base`,
  `nerve.passive-fabric.trunk`, `nerve.active-route`, `nerve.memory-route`,
  `nerve.bridge`. Colony: `colony.cloud.haze`, `colony.cloud.advertised`,
  `colony.cloud.remembered`, `colony.cloud.reached`, `colony.measured-halos`,
  `colony.edges`, `colony.cohort.lens`, `colony.cohort.motes`,
  `colony.courier.plume`, `colony.courier.bloom`. Delivery: `delivery.mote`,
  `delivery.plume`, `delivery.wave`. Backdrop: `stars`. A draw
  that would submit nothing — zero instances, an empty draw range, a hidden
  object — takes no sample, so a label that only sometimes draws (a courier,
  a contact front) has a count below the frame count: that is its draw count,
  not a drop. Unscoped on purpose, and therefore part of the remainder below:
  the chain anchor's three small draws, the selection reticles, the
  canonical-rewrite echo, and the portrait inset's own braid `Scene`.
- `frame.gpu` (in `frame`, beside `frame.interval`): the WHOLE scene pass, one
  `TIME_ELAPSED` query opened by the pass's first probed draw and closed by
  the scene's `onAfterRender` — at the first draw command rather than at the
  render-list build ahead of it, where an idle GPU would wait inside the
  query and read as draw cost; the unprobed draws three may sort ahead of the
  first probed one fall outside both streams. WebGL allows one query of that
  target at a time, so the bracket cannot coexist with the draw scopes: every
  `GPU_FRAME_BRACKET_PERIOD`th (second) sampled frame is a bracket frame, on
  which the draw scopes stand down, and the frames between are scope frames,
  on which no bracket is taken. Both streams sample the same steady state on
  interleaved frames; neither can nest in the other, so
  `droppedByReason.overlap` stays a genuine fault. `gpu.frameLedger` carries
  the running totals: `bracketMs / bracketFrames` is GPU ms per bracket
  frame, `scopedMs / scopeFrames` is GPU ms per scope frame (Σ of that
  frame's scopes, divided by frames so an intermittent draw weighs exactly as
  often as it drew), and the difference is the unscoped remainder — what
  GL·08 prints as `GPU` and `OTHER`. A negative remainder is a reading, not
  noise to clamp: the scopes summed to more than the frame, i.e. the driver
  serialised adjacent queries (the open Mesa/ANGLE question), and the per-draw
  figures should then be read as upper bounds. The bracket covers the main
  pass only: the portrait inset re-renders the main scene through the same
  hooks (one pass, counted once) and then its own braid `Scene`, which has no
  hooks and is in neither stream.
- `cpu`: `cpu.cell-field.ingest` (the columnar mirror, every generation),
  `cpu.cells-cache.apply-deltas` (the reducer behind every cells batch),
  `cpu.topology.commit` (the builder applying a worker response on the main
  thread; the worker's own time is not in it), `cpu.neural-network.sync-
  display-fabric` (per cache generation: journal feed, eager mesh diff,
  render-set sync, build request), `cpu.neural-network.fabric-commit` (the
  fabric's half of a landed build: graph swap, delta grow/kill or full
  reconcile), `cpu.neural-network.live-plan-slice` (per planning frame; frames
  that plan nothing take no sample), `cpu.neural-network.active-pulse-frame`,
  `cpu.neural-fabric.emit`, `cpu.neural-fabric.recall-aperture`,
  `cpu.cell-nucleus.lod`, `cpu.bridge.sync-hosts` (every build) and
  `cpu.bridge.select` (the selection alone, on the builds whose hosts moved —
  two labels because a mean over both populations would describe neither, and
  the stroke reconcile is a frame of its own with the block gauge for a
  reading), `cpu.colony.topology`
  and `cpu.colony.flood` (the App memos). Every span is a
  `beginCpuProbe`/`endCpuProbe` pair or a `measureCpuProbe` around the real
  call site; nothing is sampled on a substitute path.
- `gpu.state`: facts about the CONTEXT rather than about a measured window, so
  `__renderPerformanceStatsReset()` deliberately leaves them alone.
  `availability` and `reason` say whether timer queries exist at all;
  `samples` is the drawing buffer's multisample count, read once off the live
  context at Canvas creation (`gl.SAMPLES`) and `null` until one mounts. That
  one integer decides whether this page's per-draw scopes can be believed
  (below), and it is also the cheapest probe-free confirmation of what §13's
  density rule chose on a given window: 4 on a multisampled context, 0 on a
  buffer that resolved without one.

#### Counters beside the probe

Always-on integer counters on `window`, each with a `…Reset()`; read them
around a window the way the probe is read. `__fabricStats()` (the selection
gauges `selectionChurn` and `weightedSelectionEdges` beside `trunkTierEdges`),
its `.bridge` block (host-registry skips, strokes moved, uploads) and its
`.topology` block (patched vs whole applies, the `unchainedApplies` and
`staleResends` chain breaks, worker fallbacks); `__uploadStats()` (bufferSubData bytes by lane,
the cell attributes included); `__colonyStats()` (`topologyBuilds` against
`scaffoldMisses`, `floods`, `edgeGeometryBuilds`, `courierSchedules`,
`deliveryPlans`); `__cellPickStats()` (raycasts, `suspendedSkips`, `reuses`,
`rebuilds`, `patches`, `deferredRebuilds`, and `rebuildReasons`, which counts
every gate open at a rebuild and so sums to more than `rebuilds`; the four
outcomes partition the answered raycasts); `__pulseStats()` (admitted and dropped-by-
reason plus the live-plan gauges `forcedByDeadline`, `maxStepMs` and the pair
that names it, `maxStepKind` / `maxStepCold`, beside `routeCompactions` — the
router's own cache-cliff count, which the pulse reset deliberately leaves alone),
`__producerOriginStats()` and `__qualityStats()` as before. Under a
development StrictMode mount the colony's memo-driven counters read double;
production is exact.

`__blockFrameStats()` is the exception to "integer counters": a bounded ring of
32 wall-clock readings, one per landed topology build, plus the all-time maxima
that outlive the ring. An entry carries `landingMs` (the worker landing task —
graph swap and topology commit), `bridgeMs` (the SUM of the bridge build's
three steps, which is what the class costs a block) and `bridgeStepMaxMs` (its
longest single step), and `frameGapMs`, the interval between the frames AROUND
the landing — what a block costs the frame loop, as against what it costs one
task. Read `bridgeMs` and `bridgeStepMaxMs` together: a sum above 25 ms made of
three bounded steps is not a long task, and only the second number says whether
a step is one. `count` and `bridgeCount` should track each other; a gap means
builds are being armed and not run. This gauge is the only reading of §15.1's
three pieces a RELEASE build gives, and it costs one `performance.now()` a
frame with nothing allocated.

#### The off path

With sampling off — no GL·08 panel, no `render-stats=1` — every probe site
is a boolean gate: `beginCpuProbe`/`beginGpuProbe` return `null` before any
clock read, GL call or allocation, the draw callbacks read one count and
return, the scene bracket is not installed at all, and the counters above are
plain integer increments. `packages/ui/__tests__/tweaks/gpuProbeFrame.test.ts`
pins a full frame of every scoped draw against a spied clock, a spied
timer-query context and V8's new-space growth. When sampling is on, query
objects are pooled: a steady-state frame creates and deletes none.

`gpu.state.availability: "unsupported"` means WebGL2 timer queries or
`EXT_disjoint_timer_query_webgl2` are unavailable; missing GPU metrics are
then unknown, not zero, and CPU/frame results remain usable. A non-zero
`disjointEvents` or `droppedByReason.disjoint` means the GPU clock became
discontinuous and affected queries were deliberately discarded; repeat the
window on a stable visible context. Likewise, an absent metric key means its
scope was not exercised or is not installed, never that the pass cost zero.

#### Timer queries on a multisampled context

The probe is not free where the drawing buffer is multisampled, and it is not
free in a way that reads as a scene cost. WebGL allows one `TIME_ELAPSED` query
at a time, so each scoped draw's query is a pass boundary; on a multisampled
buffer a pass boundary resolves the colour attachment and reloads it, so EVERY
scoped draw pays attachment traffic it does not pay unprobed — the stars and
the nucleus glow along with the fibres. On the 890M at 1920×960 CSS @2× with
MSAA the ten cheapest programs measured 0.80–0.87 ms per draw, against
0.05–0.07 ms for the same programs on the fullscreen window's larger but
non-multisampled 1920×1080 @2× buffer — a 14× floor across a 12 % difference in
area, so it is not the area — and 21 scoped draws a frame turn that floor into
the whole frame. The page ran **28.6 fps with `render-stats=1` against 58
without it, at the same 2.1–2.2 GHz GPU clock**. Neither number is wrong; they are two different pages.
So the rule: **never judge a page whose `gpu.state.samples` is non-zero by its
scopes.** Read the shape of the profile if you like — the ranking survives —
but take the frame rate from a probe-free leg, the same URL without
`render-stats=1` and with GL·08 closed, and treat `GPU`, `OTHER` and every
`gpu.metrics` mean as upper bounds. GL·08 states this itself: with a
multisampled context it prints `MSAA ×n · SCOPES SPLIT THE PASS · READ FPS`
under its two GPU rows. Since MSAA became a density decision (§13) the only
contexts that still reach it are 1×-ish buffers below the 8-million-pixel
class; every dense buffer is now unsampled, which is what makes the per-draw
scopes readable at face value on the maximized 2× window at all.

#### A throttling machine, and the two window classes

On a mobile APU the frame rate reads the GPU clock at least as much as it reads
the scene. The 890M in the development laptop cycles its package power on its
own — 40–75 s bursts at 28–30 W against 42–46 s troughs at 14–15 W, a ~2-minute
period already running before the browser opened — and scene GPU time is very
nearly proportional to 1/clock (600–2,300 MHz while rendering here). An
unpaired before/after therefore measures the throttle phase, not the change.
Two rules follow, and the performance figures quoted in this document were read
under them.

- **Normalise, or pair at equal clock.** Sample the machine at 1 Hz beside the
  page — GPU `sclk`, package power, `Tctl`, GPU busy and CPU MHz off sysfs —
  join the series to the measured window, and report `k = bracket ms × mean
  clock` in ms·GHz rather than fps. `k` is stable across the cycle where fps is
  not: fullscreen HIGH at the default pose is ≈ 10 ms·GHz whether it renders
  3.5 ms at 2.9 GHz or 17 ms at 600 MHz. A leg with no bracket (a probe-free
  leg has none) cannot be normalised, so run its pair back to back and reject
  the window when the two mean clocks differ.
- **Take the clock as a MEAN over the window, never at its endpoints.** Two
  samples, one at each end, can land on the same phase of a cycle that swung
  600–2,300 MHz in between, and will then certify a stable clock for a window
  that had none. The joined 1 Hz series is what makes the mean; the fraction of
  seconds under 900 MHz is worth reporting beside it, since that is the band the
  hitches come from.

The window class is the other half of the recipe, because one 2× 4K monitor
produces two windows that are two different pages (§13). Reproduce both without
touching the monitor by driving device metrics over CDP: **1920×1080 @2×** is
the fullscreen class (8.29 million pixels, opens at Med) and **1920×960 @2×**
is the maximized class (7.37 million, opens at High). A gate that names neither
geometry is not reproducible on this display.

Some legs must also be **probe-free** — the same URL without `render-stats=1`
and with GL·08 closed — and the frame rate always comes from one of those. The
scopes distort the page they measure wherever the buffer is multisampled
(above), and a probe-free leg is likewise the only honest rate for a gesture,
where the sampler's own work lands in the very frames under test. Read the
shape of a profile from the probed leg and the rate from the probe-free one.

#### Costs no on-page probe sees

The scene GPU bracket covers the WebGL main pass only (`frame.gpu` above), so
two real costs fall outside every on-page probe: the compositor's own work in
the browser's GPU process, and anything resolved after `Scene.onAfterRender`
(the MSAA resolve, §13). The DOM HUD is painted by the GPU-process compositor,
not the WebGL context — an open card's `filter` drop-shadow surface and the
overlay's scanline layer paint there — so no `render-stats` reading includes
them. Measure them with a Chrome per-thread trace of the GPU process (the review
kit's `run-trace.mjs` / `run-trace-ab.mjs`, reading GpuMain per frame): trace
with the surface present and again with it gone (`display:none` the HUD, or a
card open versus closed) and read the GpuMain delta. Compare only at equal GPU
clock — the AMD 890M throttles its DPM clock (600–2,900 MHz) under load, so an
unpaired before/after is dominated by clock swing, not by the surface; run the
two legs back to back and reject unequal-clock windows (above).

For a live gate against production data without occupying the embedded server,
run the isolated-backend recipe: the user's node binary on a spare port
(`:7001`) and a Vite dev/verify config whose `server.proxy` forwards `/api` and
`/runtime-config.js` to it (`ui-app/vite.config.ts`), so the harness renders the
SAME galaxy config production injects rather than the bundled defaults. Drive it
headless over CDP; the AUTO sampler needs focus emulation
(`setFocusEmulationEnabled` + `setWebLifecycleState active`) or it never samples
(`document.hidden`), and every A/B is paired at equal clock as above.

A hidden-tab or frozen-tab return is its own gate (`run-hidden.mjs` /
`run-bg.mjs`, the frozen variant via `setWebLifecycleState frozen`): background
the tab for a long absence, then confirm on return that the chain caught up
through patched applies with no full render-set rebuild (`__fabricStats().topology`
shows 0 full/unchained/stale) — the real cost of a long absence is one large
catch-up flush, not a rebuild storm.

## 20. Change Checklist

Before merging a Canvas change, answer:

1. Is every visual element classified by provenance, and does canonical
   evidence still resolve from cache state?
2. Are `pos_seed`, Cell IDs, and selected identity still stable?
3. Do Cell bodies and `NeuralNetwork` resolve the same staged membership?
4. Do live and memory routes use the one staged display graph, with no
   off-stage synthetic route?
5. Are AUTO membership and passive nerves unchanged across quality modes?
6. Is the idle Cell field still visibly a nervous system?
7. Do active, warm, memory, and passive layers use the same edge geometry?
8. Does simulation time own semantic animation while raw time owns input and
   measurement?
9. Are buffer, pool, upload, and draw bounds explicit under worst-case churn?
10. Are backfill, missing-data, worker-failure, and reorg paths tested?
11. Were deterministic idle and active frames reviewed at affected presets,
    and was every rate claim read from paired or clock-normalised legs on a
    named window geometry (§19.5)?
12. Does new per-block or per-gesture main-thread work take a rank in the one
    frame ledger rather than a private budget, and does it stay a bounded grain
    a budget can stop between (§15.1)?
13. Were constants, tests, and this document updated together when a contract
    changed?

## 21. Implementation Map

| Concern | Primary implementation |
|---|---|
| Browser bootstrap and initial snapshots | `ui-app/src/main.tsx`, `ui-app/src/connect.ts` |
| Projection stream batching and recovery | `packages/cache/src/projectionStream.ts` |
| Cell cache, link rings, display journal | `packages/cache/src/cellsReducer.ts` |
| Application orchestration and Canvas assembly | `ui-app/src/App.tsx` |
| Transitional Cell SoA mirror | `ui-app/src/cell-field-hook.ts` |
| Cache context | `packages/ui/src/hooks/cellGalaxyContext.tsx` |
| Scene planes and chain anchors | `packages/ui/src/layout.ts` |
| DPR and query quality resolution | `ui-app/src/render-quality.ts` |
| Quality presets and adaptive state | `packages/ui/src/tweaks/qualityPresets.ts`, `packages/ui/src/tweaks/adaptiveQuality.ts`, `packages/ui/src/tweaks/AdaptiveQualityController.tsx` |
| Stable Cell display budget | `packages/ui/src/tweaks/cellDisplay.ts` |
| Cell body, lifecycle, flash, and picking | `packages/ui/src/components/CellGalaxy.tsx` |
| Staged render cursor and inspection overlay | `packages/ui/src/geometry/cellRenderSet.ts` |
| Stable Cell GPU slot assignment | `packages/ui/src/geometry/cellSlotAssignment.ts` |
| Screen-space hit index, its detail patch, drift envelope, and camera-motion gate | `packages/ui/src/geometry/screenSpaceHitIndex.ts`, `packages/ui/src/derives/cellInteraction.derive.ts`, `packages/ui/src/geometry/cellPickDriftEnvelope.ts`, `ui-app/src/orbit-gesture-state.ts`, `packages/ui/src/nerve/ConsensusRouteCamera.tsx` |
| Staged population and stage census tallies | `packages/cache/src/cellsStats.ts`, `packages/ui/src/derives/cellPopulationField.derive.ts` |
| Cell visual descriptors and shaders | `packages/ui/src/derives/cellVisual.derive.ts`, `packages/ui/src/materials/cellHybridMaterial.ts`, `packages/ui/src/materials/cellFlareMaterial.ts` |
| Batched near identity, far-field gate and local LOD index | `packages/ui/src/components/CellNucleus.tsx`, `packages/ui/src/derives/cellNucleusFarField.derive.ts`, `packages/ui/src/derives/cellNucleusSpatialLod.derive.ts` |
| One staged neighbor topology | `packages/ui/src/geometry/neighborGraph.ts` |
| Worker, wire protocol, and topology journal | `packages/ui/src/geometry/neighborGraphBuilder.ts`, `packages/ui/src/geometry/neighborGraphWorkerProtocol.ts`, `packages/ui/src/geometry/neighborGraph.worker.ts`, `packages/ui/src/geometry/topologyJournal.ts` |
| Eager living mesh and its undo log | `packages/ui/src/nerve/incrementalGraph.ts`, `packages/ui/src/nerve/livingMeshDriver.ts` |
| Passive edge selection | `packages/ui/src/geometry/passiveNeighborGraph.ts` |
| Shared edge curve and route search | `packages/ui/src/geometry/edgeBezier.ts`, `packages/ui/src/geometry/pathRouter.ts` |
| Neural orchestration and pulse state | `packages/ui/src/nerve/NeuralNetwork.tsx` |
| The block landing in three pieces, and the frame that arbitrates them | `packages/ui/src/nerve/fabricLandingQueue.ts`, `packages/ui/src/nerve/bridgeSchedule.ts`, `packages/ui/src/nerve/frameBudget.ts` |
| Pulse planning, frame slicing, and batch bounds | `packages/ui/src/nerve/pulseRunner.ts`, `packages/ui/src/nerve/pulseBatch.ts`, `packages/ui/src/nerve/livePulseQueue.ts`, `packages/ui/src/geometry/originEntry.ts` |
| Memory routes and context damping | `packages/ui/src/nerve/consensusMemoryTrace.ts`, `packages/ui/src/nerve/contextDamp.ts` |
| Persistent and active nerve rendering | `packages/ui/src/nerve/NeuralFabric.tsx`, `packages/ui/src/nerve/recallApertureIndex.ts`, `packages/ui/src/nerve/activeHopCurve.ts`, `packages/ui/src/nerve/fabricOrder.ts` |
| Secondary nerves (bridges) and their host registry | `packages/ui/src/nerve/CellBridgeNerves.tsx`, `packages/ui/src/geometry/bridgeEdges.ts`, `packages/ui/src/nerve/bridgeStroke.ts` |
| Nerve allocation classes | `packages/ui/src/nerve/fabricCapacity.ts` |
| Fixed-slot layout and the upload cost model | `packages/ui/src/nerve/fabricSlots.ts`, `packages/ui/src/nerve/fabricLifecycleSlots.ts` |
| Screen-space capsule geometry | `packages/ui/src/geometry/screenSpaceCapsuleLine.ts` |
| Peer topology and block flood | `packages/ui/src/derives/networkTopology.derive.ts`, `packages/ui/src/derives/networkFlood.derive.ts` |
| Peer render layers and Cell delivery | `packages/ui/src/components/NetworkColony.tsx`, `packages/ui/src/components/BlockDeliveryLayer.tsx` |
| Who made the blocks, over both windows, and the rate the card implies from it | `packages/ui/src/derives/blockProducers.derive.ts`, `packages/ui/src/derives/networkHashRate.derive.ts`, `packages/ui/src/components/hud/producerReadout.ts`, `packages/ui/src/components/hud/MinerNodeCard.tsx` |
| POW cohort marks: the plan, the lanes, the two draws, and the link stop outside the disc | `packages/ui/src/components/ColonyCohorts.tsx`, `packages/ui/src/components/ColonyEdges.tsx` |
| The lensed mark: the ray march, the fold, the mass, the per-cohort mass lane that scales it, and every radius read off it | `packages/ui/src/materials/colonyLens.ts` |
| The specks falling into it, and their geometry helpers | `packages/ui/src/materials/colonyMotes.ts` |
| The substance they are made of: the GLSL library and its noise tile | `packages/ui/src/materials/colonyMist.ts` |
| What every cohort program agrees about: the gulp envelope and the proximity exemption | `packages/ui/src/materials/colonyCohort.ts` |
| Held breath (halo compression) | `packages/ui/src/derives/peers.derive.ts`, `packages/ui/src/materials/peerNodeMaterial.ts`, `packages/ui/src/components/GlowNode.tsx` |
| Courier vocabulary and contact front | `packages/ui/src/components/courierGlyph.ts`, `packages/ui/src/materials/contactWaveMaterial.ts` |
| Fibre flush | `packages/ui/src/tweaks/tissueFlush.ts`, `packages/ui/src/nerve/fabricLifecycleShader.ts` |
| Plain landing flashes | `packages/ui/src/components/LandingFlashLayer.tsx`, `packages/ui/src/materials/landingFlashMaterial.ts`, `packages/ui/src/components/landingFlashRing.ts`, `packages/ui/src/components/landingFlashQueue.ts` |
| Canonical rewrite echo | `packages/ui/src/components/CanonicalRewriteEcho.tsx` |
| Simulation clock | `packages/ui/src/tweaks/simClock.ts`, `packages/ui/src/tweaks/SimClockTicker.tsx`, `packages/ui/src/tweaks/useSimFrame.ts` |
| Portrait scissor pass | `packages/ui/src/components/hud/CellPortraitInset.tsx` |
| HUD wall clock | `packages/ui/src/components/hud/hudClock.tsx` |
| Render diagnostics | `packages/ui/src/tweaks/RenderStatsSampler.tsx`, `packages/ui/src/tweaks/performanceProbeStore.ts`, `packages/ui/src/tweaks/gpuTimerQuery.ts`, `packages/ui/src/tweaks/nonEmptyGpuProbeCallbacks.ts`, `packages/ui/src/tweaks/gpuUploadLedger.ts`, `packages/ui/src/components/hud/RenderStatsPanel.tsx` |
| Always-on churn counters and their window hook | `packages/ui/src/nerve/fabricStats.ts`, `packages/ui/src/nerve/blockFrameStats.ts`, `packages/ui/src/nerve/bridgeStats.ts`, `packages/ui/src/geometry/neighborGraphBuilderStats.ts`, `packages/ui/src/derives/colonyStats.ts`, `packages/ui/src/geometry/cellPickStats.ts`, `packages/ui/src/derives/producerOriginStats.ts`, `packages/ui/src/nerve/pulseStats.ts`, `ui-app/src/pulse-stats-hook.ts` |
| Deterministic browser review | `ui-app/VISUAL_REVIEW.md`, `ui-app/src/ProtocolEventLab.tsx` |

## 22. Glossary

| Term | Meaning in this document |
|---|---|
| Canonical reservoir | The browser's retained canonical Cell Map, independent of display membership |
| Display plane | Server-owned bounded membership and resident records for visualization |
| Staged Cell | A Cell admitted by the resolved display plane and current presentation clamp |
| Overlay Cell | A selected/inspection Cell drawn client-side outside staged membership |
| Display graph | The one deterministic neighbor graph over living staged Cells |
| Passive graph | The bounded visual edge selection from the display graph, not a second routing graph |
| Active pulse | A transient route triggered by a newly observed `CellLink` |
| Warm reinforcement | Persistent short-lived emphasis on display edges crossed by live pulses |
| Memory route | An explicit route visualization derived from retained historical evidence |
| Rewrite echo | A compact visual witness of the invalidated canonical suffix |
| Measured peer | A peer present in observed local-node entity state |
| Inferred peer | A seeded presentation node used to make propagation context legible |
| Motion window | The frames of a held pointer gesture, the orbit damping tail, or a route-camera flight; excluded from adaptive sampling, with hover picking suspended |
| Topology patch | A worker response carrying only what changed against the generation the main thread named — adjacency runs for the display graph, edges for the passive selection — applied in place |
| Simulation time | The controlled semantic animation timeline, distinct from raw render-frame time |
| Last hop | The block's crossing from a delivering node into the Cell field, drawn as a courier mote and plume in the block's carrier hue |
| Contact front | The one expanding wave a landed block releases in the tissue, read through three media: the annulus, the fibre flush, and the landing flashes |
| Landing flash | A plain warm flash on a Cell the contact front passes; presentation, never the write seal |
| Write seal | The protocol glyph a real write stamps on a Cell (`aFlashAt`, `cellFlareMaterial`); no landing may fire it |
