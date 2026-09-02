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

- camera position `[110, 108, 110]`;
- target `[0, CELLS_Y, 0]`;
- FOV `50`, near `1`, and far `3000`;
- WebGL antialiasing and an opaque drawing buffer (`alpha: false`);
- scene background `#02030a`, with the same colour as CSS below the canvas for
  the window before the first frame;
- quality-limited DPR, never below CSS-pixel density; and
- damped orbit control with damping factor `0.08` and distance range `4..400`.

These are composition defaults rather than wire contracts. A change still
requires desktop and narrow-layout review because camera composition controls
Cell readability, network separation, picking density, and HUD occlusion.

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

The HUD and Cell inspection panel remain DOM siblings. A small R3F anchor
projects the selected Cell into screen space so the DOM inspector can stay
tethered without turning text and controls into scene textures.

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

Selection order preserves the field's visual identity:

1. Use a spanning forest while it fits.
2. If the forest exceeds the budget, reserve the coverage share (default
   `0.55`) for a hash-scattered forest subset. Graph-order admission that fully
   wires one region and leaves another bare is forbidden.
3. Prefer still-valid prior edges so ordinary churn changes the fabric locally.
4. Fill remaining capacity with hierarchical trunks, twigs, and deterministic
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
before the pulse walk: about 2 ms per frame (`LIVE_PLAN_BUDGET_MS` — a frame
never starts a step its previous step's cost predicts would overrun it), never
less than one step per frame, batches in arrival order; the batch's entry grid
is built as a step of its own. Pulses admitted from a
slice carry the batch's `startSec`, so departure times, pulse order, the
128-per-batch budget, the rescue pass and every stats bump are those the
one-task planner produced. A batch whose earliest departure is within
`LIVE_PLAN_DEADLINE_MARGIN_S` of now finishes in the current frame regardless
of the budget: no packet is ever admitted after it should have left, and the
worst case is the single task the planner always was. A reorg prunes queued
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
| `local receive - 0.4 s` | Gather: the worker holds still while its glyph tightens and brightens, when lead time exists |
| `local receive` | The glyph rises toward the Cell field, contracting and heating as it goes |
| `local receive + 1.0 s` | Contact: the glyph is released as a front |
| `local receive + 2.2 s` | Contact window closes and the Cell ledger acknowledgement completes |
| `local receive + 2.35 s` | One acknowledgement instant, after an additional 150 ms readability offset: the exact touched-Cell highlight, each newborn's arrival, each corpse's fade — and the median live packet's departure from the corpse it consumed |

The handoff is one idea in three beats: compression, then release. The glyph a
worker lifts and the front it releases into the field are the same interrupted
polygon — twelve sides with every fourth left open — at two scales, so the
arriving object and the spreading pressure are one shape rather than two
languages meeting at the membrane. Every measured worker releases its own
front. Latency-staggered releases compose into one interference field instead
of dozens of independent events because they share that one shape and one
speed: the Cell-field front travels at the peer plane's `SHOCKWAVE_SPEED`
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
hand-typed radius. Overlap is kept off the white rail by thin crests, a 1/r
falloff, the rim's three gaps, and that rim extinction. Reach is extinction
rather than a clamp: a clamped radius would freeze fronts mid-field and break
the shared-speed reading. A reach configured past what the contact window can
complete clamps to the completable ceiling, so the knee extinction always
finishes inside the window instead of being cut off mid-fade by the time
envelope. Crest half-width is capped as a fraction of the crest radius,
without which a young front is mostly crest and the release reads as a
soft doughnut instead of a ring leaving. The front is resolved analytically in
an instanced material drawn on an annulus rather than scaled from a sprite,
which smears the moment a front grows past a few world units; delivery count
changes instance and vertex counts, never draw-call count.

The exact touched set is derived from fresh links and bounded to 256 Cells per
block. Contact also ignites a small k-nearest neighbourhood per worker (more
for the hero, fewer per peer, bounded in total and rippled by arrival order),
and a local impact can ignite up to 128 nearby staged Cells within a
14-world-unit radius as a presentation bridge from carrier to field. Neither
radial response may be described as additional chain linkage.

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
- attested cohorts, one per recent block producer, carrying the chain's payout
  key and NO identity at all: the type they hold has no field an ID could land
  in. They lie EXACTLY on `COLONY_Y`, with no scatter in Y whatever, because a
  cohort is an opening cut into the plane and an opening off its plane is a
  disc floating beside one;
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
canopy, CKB's own spacetime; below it the one a miner draws on. Three rules
follow from that reading and settle every argument in the rest of this section.
The energy under the plane is a DIFFUSE SUBSTANCE that permeates space — a mist
with no shape of its own: not a sea, not a coast, not curtains. It is
SECONDARY, and must never take focus from the peer mesh or the Cell galaxy. And
THE INTAKE IS THE POINT: the field exists to be seen being drunk, at the default
camera, at every cohort, including the ones standing under the mesh's body.

A cohort is therefore drawn as an APERTURE rather than as a stop on the peer
brightness ladder: a cohort is where the colony plane is OPEN. `ColonyCohorts`
draws that opening THREE times, off one plan, one walk, one instance count and
one pair of instanced lanes — nothing volumetric and nothing hanging under the
slab:

- a FACE, a disc lying in the colony plane with a bright lip, 88 radial striae,
  and a WINDOW inside its hole: the throat's wall lit from below and, wherever
  the view ray reaches deeper than `COHORT_INTAKE_LEVEL`, the surface of the
  medium rising toward the lip;
- an AURA, a small camera-facing quad whose halo carries the same hole, cut by
  crossing the view ray with the colony plane; and
- an intake PATCH, one instance per cohort with its sink at its own origin,
  lying `MIST_FLOOR_DEPTH` (2.5 wu) under the membrane and lifted into a mound
  whose top is that same `COHORT_INTAKE_LEVEL`. It carries the medium's own
  texture advected along the streamlines of a SINK WITH A VORTEX — log spirals
  winding into the mouth, `r0 = sqrt(r^2 + k*tau)` and
  `theta0 = theta + s*ln(r0/r)` — brightening as it gathers, dark inside the
  rim, thinner in the wake downstream, and flaring on the block that cohort
  won.

There is NO FLOOR, NO SHEET AND NO GROUND TERM anywhere under the plane, and
that is a measurement rather than an omission. A sibling `ColonyMist` layer drew
up to two large, flat, structureless haze sheets under the whole colony until
2026-09-02, so the substance would be present everywhere and the intake would
have something to be brighter than. The live leg priced them: one sheet cost
0.90 ms of the layer's 1.06 ms of frame GPU at the app camera while its own
additive contribution peaked at 2/255 anywhere on the canvas — 0.045 of a ghost
sprite's core, with the three quality tiers indistinguishable by eye — so they
were removed. The mist's omnipresence is now stated by the CATCHMENT alone: the
patch reaches 14 wu around each mouth and shows the substance only where a
cohort is taking it. A floor comes back only on a new measurement that says a
viewer can see one.

The face draws a circle, so every ellipse a viewer sees is projection, and
because every cohort foreshortens identically that agreement is what makes the
colony plane itself legible. The mound's top and the window's surface are ONE
surface: `COHORT_INTAKE_LEVEL` has two readers and one knob, so a viewer
looking into the mouth and a viewer looking at the mist beside it cannot see the
medium at two depths.

Nothing dark is painted — the mark's own structure declines to fill its middle
(`smoothstep` up out of exactly zero on the face, the ray/plane crossing on the
aura), which is this scene's additive idiom for a hole; what light there is
inside the pupil is the window's, in a colour no other draw in the peer plane
wears. So the layer that would otherwise break it is the link mesh, and a
cohort's own links stop at the mark's OUTER EDGE (`COHORT_LINK_STOP_R` =
`COHORT_AP_R` = 3.0 wu), for two independent reasons: a link run into the disc
would be added to the one pixel the form spends itself keeping empty, and a
colony link is radial structure coplanar with a radial grain, which at low count
reads as a star.

A cohort NEVER EMITS UPWARD, at any time. A mined block goes sideways to peers
only, because peers must verify it before it legitimately enters the cell
galaxy; the later leg is `BlockDeliveryLayer`'s carrier, which launches from
MEASURED WORKERS on flood arrivals and never from a cohort. The two worlds meet
at the aperture in the plane.

And NO COLUMN, PLUME, FUNNEL OR PILLAR is ever drawn under the mouth, at any
brightness profile. Every one of them was built and rejected by eye: a shaft
gated through the hole is invisible except from directly overhead, and an
ungated one is a searchlight in miniature — up close, a saucer with a tractor
beam. Only SURFACES BEING DRAWN read as intake, which is what the window is and
what the patch is. The patch's vertex stage cannot place a vertex above its own
instance origin, so "nothing above the membrane" is a property of the form
rather than of the props handed to it.

The layer takes exactly ONE input from the block path, and it is a string. On a
block pulse increase, the mark whose `CohortMark.nodeId` equals
`ColonyFlood.entryId` — both `attested:<key>`, both built by
`attestedNodeId` — has the block's SIMULATION SECOND stamped into the shared
`aGulp` lane, and its mouth and its patch swallow together on one envelope.
Every other slot holds a far-negative sentinel, so a slot that has never won
never flares. Wins are held against the node id in a map and re-laid into the
lane under every re-plan, because a re-plan reshuffles slots and a win held by
index would hand another cohort the moment somebody else won. While backfill is
active the pulse is consumed and nothing is stamped. The shockwave and the flood
object stay out for the reason they always had: a front that crosses the whole
colony is one number every cohort reads, and it would flare all six of them on a
block one of them won.

Draw order inside the colony is composition order rather than a depth
requirement — all three of these draws are additive and depth-read-only. The
intake patch is `renderOrder` 0, the face 1 and the aura 2: the surface being
taken, the disc that opens onto it, and the glow around that. All three mount
inside the colony's rotation group, which is what makes every coordinate in the
mist a colony-frame constant: a sink that never moves in that frame needs no
per-frame rotation uniform, and the medium cannot shimmer as the plate turns.

Per-draw GPU cost is priced separately through `colony.mist.patch` beside the
existing `colony.cohort.face` and `colony.cohort.aura` (§19.5). Quality owns
NOTHING here: no cascade field reaches this layer, because what is left of the
mist is the intake itself and not ambience a tier may trim.

**Measured on 2026-09-02**, on an AMD Radeon 890M through ANGLE/Vulkan at
2560x1440, on live mainnet with six attested cohorts, load average 2.0-2.7,
min-of-N `TIME_ELAPSED` readings through the probes above. ⚠️ Every row was
taken with the haze sheets still in the layer, which is what the row marked
REMOVED settled:

| Quantity | Measured |
|---|---|
| Whole layer (four draws), app camera, Med — 1 haze sheet | +1.06 ms of frame GPU, 0.90 ms of it the haze sheet |
| Whole layer, app camera, High — 2 haze sheets | +1.44 ms |
| Whole layer, a mouth filling 40 px/wu | +2.22 ms |
| Whole layer, a mouth at 13 wu | +2.74 ms |
| ~~The haze's own brightest contribution anywhere on the canvas~~ REMOVED 2026-09-02 | 2/255, and 11/255 on the pixel it sits on — 0.045 of a ghost sprite's core. That reading is why the sheets were dropped: 85 % of the layer's app-camera cost for a picture nobody could see |
| The sink's inflow, 5-12 wu annulus, block-matched on the mound plane | 2.23:1 inward by count; median radial -0.656 wu/s against the model's -0.75 at r = 8 |
| The gulp, over six minutes of mainnet | 29 pulses, 29 stamps, 29 matching node ids, 0 mismatches |
| Saturated pixels attributed to the layer (mark on minus mark off) | +513 app / +848 overhead / +1,105 low elevation / +7,298 at the mouth, on 3,686,400 px |

The whole-layer figures are the frame bracket's on-minus-off delta, which is the
honest number: the per-draw scopes sum higher because adjacent timer queries
serialise on this driver (§19.5's negative-remainder note), so read the split as
an upper bound. The measured cost was 1.8-3x the preview's estimate, and the
attribution said where it went: the haze sheet was the app-camera cost, the
patch is the close-up cost (0.14 -> 0.63 -> 1.53 ms as the mouth fills the
screen).

The layer's cost after the removal is not known yet, and no number is claimed
for it here. What is measured: +1.06 ms WITH the sheet at the app camera, and
the same frame with the layer's four amplitudes at 0 — every draw still issued —
at +0.11 ms, so the expected cost of the three draws that remain is of that
order. To be re-measured on the next live leg.

**One open finding from the same session**: thinning the slab tightened a
cohort's clearance. The nearest non-cohort node measured 1.274 wu from a
cohort — inside
`COHORT_HIT_RADIUS` (1.5 wu) and inside the drawn hole (1.6 wu) — where R19
measured 2.99 wu at the old thickness. Every cohort still opens its own card and
every clickable neighbour still opens its own, but at the two closest peers'
projected centres the HOVER readout names the cohort while the CLICK resolves to
the peer: the cursor names one target and the click opens another. One cohort
also failed its own hole from one azimuth, where a peer 4.6 wu away stood in
front of the mark along that ray, and recovered 90 degrees round. Judge any
hit-radius change against 1.274 wu, not against `COLONY_MIN_SPACING`, which
bounds only the inferred scatter and not the sighted placements.

### 10.2 Block flood and delivery

For each block pulse, a deterministic nonce selects a non-local origin biased
away from the local node. Dijkstra arrival times over the presentation graph
are normalized into a two-second flood. Colony edges and nodes show the wave;
couriers show hop-level glints; measured arrivals can launch protocol carriers;
and the local carrier hands the event to the Cell field.

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

Semantic memory keeps a minimum 24 CSS-pixel core at every preset. Lower
presets compensate for reduced sampling with controlled line-width and energy
changes; they do not drop focused evidence.

The following remain identical across High, Med, and Low:

- AUTO staged membership and its ordering;
- the passive nerve budget and selection rules;
- four passive samples per edge;
- passive curve geometry, width baseline, hierarchy, and animation cadence;
- route planning and deterministic timing for every admitted pulse;
- every POW cohort's intake patch — no cascade field reaches it, because what
  is left of the mist is the feature itself and not ambience (§10.1); and
- selection, inspection evidence, and canonical counters.

The particle multiplier can lower simultaneous active-pulse admission under
saturation. It may omit bounded transient work, but it cannot reroute an
admitted pulse or change canonical state.

Before the first Canvas mount, AUTO estimates the drawing-buffer load High
would request. It begins at High below 8 million pixels, Med from 8 million,
and Low from 20 million. Thus 4K at DPR 1 and 1080p at DPR 2 begin at Med
instead of spending the calibration window in a tier already measured at the
vsync boundary. Deterministic review Labs retain High unless their URL opts
into `adaptive-quality=1`. An explicit High/Med/Low query or control remains
authoritative.

AUTO then samples 750 ms windows, uses a 1,500 ms exponential average, begins
with a 4,000 ms warmup, and waits 6,000 ms after a switch. Sustained slow
evidence may move it down one adjacent preset; it never moves up during the
page lifetime. Hidden tabs, delayed callbacks, debugger pauses,
backfill/replay windows, and motion windows are rejected as performance
evidence. Manual High/Med/Low takes ownership immediately.

Three kinds of frame are never evidence — in calibration and after the lock
alike, since the sampler outlives the lock — and all three take the same
exit: the partial 750 ms window is dropped, the frames before it with it, and
the next admitted frame primes a fresh one. They are a hidden tab's frames, a
backfill/replay storm's frames (which alone also re-arm the warmup, because
the seconds after a replay are not trustworthy either), and the frames of a
**motion window**. A frame is inside a motion window when a pointer gesture is
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
| Recent evidence links | 2,048 by default | `@cknerv/cache` `cellsReducer.ts` |
| Live pulse-link ring | 128 by default | `@cknerv/cache` `cellsReducer.ts` |
| Canonical rewrite echo | up to 50,000 records in one point draw | `components/CanonicalRewriteEcho.tsx` |
| Exact touched Cells per block | 256 | `ui/topologyConstants.ts` |
| Local impact ignitions | 128 | `ui/topologyConstants.ts` |
| Contact ignitions per block | 300 across all workers | `tweaks/tweakSchema.ts` |
| Contact front scale | peer-plane wave / `CONTACT_WAVE_SCALE` | `materials/contactWaveMaterial.ts` |
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
- Live route planning is sliced across frames (§9.1): a link batch opens the
  instant its delta arrives and its searches run from a FIFO queue at about
  2 ms a frame on an epoch-stamped typed-array scratch, with a batch near its
  departure finishing in the frame regardless.
- The bridge layer's host registry decides whether a build changed anything
  its selection reads: an unchanged host set runs no selection, and a changed
  one writes only the strokes that moved — a birth into a parked hole or the
  end of the prefix, a death retracting in its own span — with the full walk
  kept for the knob repaint and an allocation overflow.
- Near-identity admission runs behind a bounding-sphere gate (§7.4): while
  the whole field is beyond the admission radius no spatial index is built or
  refreshed, and inside it a flat typed grid is rebuilt lazily per field
  version.
- High-frequency state stays in refs and reusable scratch objects: the pulse
  walk writes every hop through one scratch record and resolves its curve
  through a numeric two-level edge index rather than a key string, the warm
  overlay's render records are a pool, and birth admission ranks its k
  nearest with parallel scalars rather than a record per candidate.
- Peer topology excludes rapidly changing height from its memo signature.
- Picking rebuilds only when an input it bakes changes — field version, draw
  count, pick-size epoch, detail epoch, viewport, projection — allocates
  nothing when it does, budgets camera drift against its own envelope, and
  suspends hover probes while the camera is in motion: a drag, the damping
  tail, or a route flight (§7.5, §11.1).
- Adaptive quality never samples a motion window: frames inside a held
  gesture, the damping tail or a route flight are dropped from the sample the
  way hidden-tab and replay frames are (§13).
- Diagnostics cost nothing when off: every probe site is a boolean gate and
  the always-on counters are integer increments (§19.5).

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
- Fragments that are provably dark discard before the expensive body: a
  cohort's face discards its square quad's corners outside the mark's own
  radius — roughly 21.5 % of the quad — and its aura discards outside the halo
  radius, both before any profile is evaluated; then both faces discard again
  once the accumulated shape falls under 0.0018. Its intake patch discards the
  same corner share of its own square, outside `MIST_REACH`, before either
  spiral back-trace runs. The face's grain is also prefiltered against its own
  screen footprint, so a mark that is small on screen stops paying for structure
  it could not resolve.
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
`__colonyStats()`, `__uploadStats()`, `__pulseStats()`, and inside the
package the modules behind them (§21). A change that silently re-enables the
work then fails a test rather than a review.

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
  `__colonyStats()`, `__cellPickStats()`, `__pulseStats()` — so a saving is
  attributed to a skip that actually happened, not inferred from a frame
  time.
- Prefer multiple steady samples or medians.
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
  `colony.edges`, `colony.cohort.face`, `colony.cohort.aura`,
  `colony.mist.patch`,
  `colony.courier.plume`, `colony.courier.bloom`. Delivery: `delivery.body`,
  `delivery.core`, `delivery.trail`, `delivery.wave`. Backdrop: `stars`. A draw
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
  `cpu.bridge.select` (only builds whose hosts moved — two labels because a
  mean over both populations would describe neither), `cpu.colony.topology`
  and `cpu.colony.flood` (the App memos). Every span is a
  `beginCpuProbe`/`endCpuProbe` pair or a `measureCpuProbe` around the real
  call site; nothing is sampled on a substitute path.

#### Counters beside the probe

Always-on integer counters on `window`, each with a `…Reset()`; read them
around a window the way the probe is read. `__fabricStats().bridge` (host-
registry skips, strokes moved, uploads) and `__fabricStats().topology`
(patched vs whole applies, the `unchainedApplies` and `staleResends` chain
breaks, worker fallbacks); `__uploadStats()` (bufferSubData bytes by lane,
the cell attributes included); `__colonyStats()` (`topologyBuilds` against
`scaffoldMisses`, `floods`, `edgeGeometryBuilds`, `courierSchedules`,
`deliveryPlans`); `__cellPickStats()` (raycasts, `suspendedSkips`, `reuses`,
`rebuilds`, and `rebuildReasons`, which counts every gate open at a rebuild
and so sums to more than `rebuilds`); `__pulseStats()`,
`__producerOriginStats()` and `__qualityStats()` as before. Under a
development StrictMode mount the colony's memo-driven counters read double;
production is exact.

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
11. Were deterministic idle and active frames reviewed at affected presets?
12. Were constants, tests, and this document updated together when a contract
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
| Screen-space hit index, drift envelope, and camera-motion gate | `packages/ui/src/geometry/screenSpaceHitIndex.ts`, `packages/ui/src/geometry/cellPickDriftEnvelope.ts`, `ui-app/src/orbit-gesture-state.ts`, `packages/ui/src/nerve/ConsensusRouteCamera.tsx` |
| Staged population and stage census tallies | `packages/cache/src/cellsStats.ts`, `packages/ui/src/derives/cellPopulationField.derive.ts` |
| Cell visual descriptors and shaders | `packages/ui/src/derives/cellVisual.derive.ts`, `packages/ui/src/materials/cellHybridMaterial.ts`, `packages/ui/src/materials/cellFlareMaterial.ts` |
| Batched near identity, far-field gate and local LOD index | `packages/ui/src/components/CellNucleus.tsx`, `packages/ui/src/derives/cellNucleusFarField.derive.ts`, `packages/ui/src/derives/cellNucleusSpatialLod.derive.ts` |
| One staged neighbor topology | `packages/ui/src/geometry/neighborGraph.ts` |
| Worker, wire protocol, and topology journal | `packages/ui/src/geometry/neighborGraphBuilder.ts`, `packages/ui/src/geometry/neighborGraphWorkerProtocol.ts`, `packages/ui/src/geometry/neighborGraph.worker.ts`, `packages/ui/src/geometry/topologyJournal.ts` |
| Eager living mesh and its undo log | `packages/ui/src/nerve/incrementalGraph.ts`, `packages/ui/src/nerve/livingMeshDriver.ts` |
| Passive edge selection | `packages/ui/src/geometry/passiveNeighborGraph.ts` |
| Shared edge curve and route search | `packages/ui/src/geometry/edgeBezier.ts`, `packages/ui/src/geometry/pathRouter.ts` |
| Neural orchestration and pulse state | `packages/ui/src/nerve/NeuralNetwork.tsx` |
| Pulse planning, frame slicing, and batch bounds | `packages/ui/src/nerve/pulseRunner.ts`, `packages/ui/src/nerve/pulseBatch.ts`, `packages/ui/src/nerve/livePulseQueue.ts` |
| Memory routes and context damping | `packages/ui/src/nerve/consensusMemoryTrace.ts`, `packages/ui/src/nerve/contextDamp.ts` |
| Persistent and active nerve rendering | `packages/ui/src/nerve/NeuralFabric.tsx`, `packages/ui/src/nerve/recallApertureIndex.ts`, `packages/ui/src/nerve/activeHopCurve.ts`, `packages/ui/src/nerve/fabricOrder.ts` |
| Secondary nerves (bridges) and their host registry | `packages/ui/src/nerve/CellBridgeNerves.tsx`, `packages/ui/src/geometry/bridgeEdges.ts`, `packages/ui/src/nerve/bridgeStroke.ts` |
| Nerve allocation classes | `packages/ui/src/nerve/fabricCapacity.ts` |
| Fixed-slot layout and the upload cost model | `packages/ui/src/nerve/fabricSlots.ts`, `packages/ui/src/nerve/fabricLifecycleSlots.ts` |
| Screen-space capsule geometry | `packages/ui/src/geometry/screenSpaceCapsuleLine.ts` |
| Peer topology and block flood | `packages/ui/src/derives/networkTopology.derive.ts`, `packages/ui/src/derives/networkFlood.derive.ts` |
| Peer render layers and Cell delivery | `packages/ui/src/components/NetworkColony.tsx`, `packages/ui/src/components/BlockDeliveryLayer.tsx` |
| POW cohort apertures, their intake patch, and the link stop at their outer edge | `packages/ui/src/components/ColonyCohorts.tsx`, `packages/ui/src/materials/colonyCohort.ts`, `packages/ui/src/components/ColonyEdges.tsx` |
| The mist the cohorts drink: the intake patch and its noise tile | `packages/ui/src/materials/colonyMist.ts` |
| Carrier glyph and contact front | `packages/ui/src/geometry/protocolCarrier.ts`, `packages/ui/src/materials/contactWaveMaterial.ts` |
| Canonical rewrite echo | `packages/ui/src/components/CanonicalRewriteEcho.tsx` |
| Simulation clock | `packages/ui/src/tweaks/simClock.ts`, `packages/ui/src/tweaks/SimClockTicker.tsx`, `packages/ui/src/tweaks/useSimFrame.ts` |
| Portrait scissor pass | `packages/ui/src/components/hud/CellPortraitInset.tsx` |
| HUD wall clock | `packages/ui/src/components/hud/hudClock.tsx` |
| Render diagnostics | `packages/ui/src/tweaks/RenderStatsSampler.tsx`, `packages/ui/src/tweaks/performanceProbeStore.ts`, `packages/ui/src/tweaks/gpuTimerQuery.ts`, `packages/ui/src/tweaks/nonEmptyGpuProbeCallbacks.ts`, `packages/ui/src/tweaks/gpuUploadLedger.ts`, `packages/ui/src/components/hud/RenderStatsPanel.tsx` |
| Always-on churn counters and their window hook | `packages/ui/src/nerve/fabricStats.ts`, `packages/ui/src/nerve/bridgeStats.ts`, `packages/ui/src/geometry/neighborGraphBuilderStats.ts`, `packages/ui/src/derives/colonyStats.ts`, `packages/ui/src/geometry/cellPickStats.ts`, `packages/ui/src/derives/producerOriginStats.ts`, `packages/ui/src/nerve/pulseStats.ts`, `ui-app/src/pulse-stats-hook.ts` |
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
