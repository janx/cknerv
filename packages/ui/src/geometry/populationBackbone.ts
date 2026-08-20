// Which halo strands are drawn WIDE — the backbone selection.
//
// ## The mechanism this class exists for
//
// The halo fibre is `gl.LINES`, and a GL line is rasterized at exactly ONE
// DEVICE PIXEL. It is the only element in the scene with no DPR compensation:
// the point sprite carries `uPixelRatio`, the fabric and the bridges are
// screen-space capsules whose width is stated in CSS pixels and expanded
// against `resolution`, and the fibre material has neither. So every other
// stroke in the frame holds its apparent width as pixels get smaller, and this
// one does not — on a 4K panel the same strand draws twice as long, still one
// pixel wide, for half the physical width and half the physical area it had on
// the 1080p display the alpha was calibrated on.
//
// Live review on 7f38f0d at 4K: *the outermost band still shows beads with no
// visible nerves, and the mixed band's strands do not read as nerves either.*
// A headless probe against that running instance found all 96,609 segments
// drawn and `fibreEmission` at 0.579 — the 0.8 alpha raise was live and had
// not fixed it. It could not have. Outside the rim the field is in the
// ISOLATED-DEPOSIT regime (about one deposit per covered pixel), where the
// bounded-screen blend lays down `a * a` rather than converging to `a`, and
// **alpha cannot buy width**: it lifts every deposit's intensity and leaves
// the mark the same size, while the bead beside it stays several times more
// intense per pixel because it concentrates its light into a clamped Gaussian.
// That asymmetry is the entire complaint, and only the mark's size answers it.
//
// ⭐ The general shape of the bug, for the next one: a constant carried a UNIT
// — "one pixel" — that stopped meaning what it meant when the display changed
// underneath it. Its siblings all state their width in a unit that survives
// the change; this one stated it in the rasterizer's.
//
// So the fix is the design's reserved fifth width rung: promote a SUBSET of
// the strands to the same DPR-aware capsule class every other nerve in the
// frame already uses, at the same per-deposit alpha, the same hue and the same
// taper. Wider, not brighter — width is the visibility channel, and
// per-deposit alpha is what chroma retention is a function of, so raising the
// second to buy the first spends the chroma the taper was installed to
// recover.
//
// ⚠️ Width alone did not settle it. Live review on `539cd41`, at the promoted
// 1.4 device px, still reported the terminal strands as not reading — because
// the promoted stroke was the SAME `tissueRose` the beads emit, so a wider
// mark was a wider pink one and no nerve percept was available at any width.
// The rung is now 1.6 px and the whole stroke class emits the vein hue
// (`POPULATION_STROKE_COLOR`); this file's selection is unchanged by either,
// which is the point of it reading positions and indices and nothing else.
//
// ## The selection law
//
//   1. **Whole runs, never scattered segments.** Promotion is decided per
//      CONNECTED COMPONENT of the drawn fibre graph and applied to every
//      segment of it. A dashed promotion — every third segment wide — is the
//      bead failure in a new costume: it puts a periodic emphasis along a
//      strand, which is exactly the "node with edges radiating from it" the
//      symbolic register forbids.
//   2. **Per-band quotas, not a global size ranking.** Component size alone
//      ranks the mid-band giants to the top and starves the outermost shells,
//      which is where the complaint is. Each band gets its own quota and its
//      own ranking, so the fringe keeps a skeleton it could never win on size.
//   3. **The quota rises outward.** The inner bands are crossing-rich and
//      already read as tissue; the outer shells have almost no crossings and
//      the skeleton has to carry the read alone.
//   4. **A strand, not dust and not a region.** Promotable components sit in
//      a size WINDOW. Under it a component is a fragment and a wide fragment
//      is a bead; over it — after P4's joins percolate components together —
//      it is a region rather than a strand, and promoting one as a unit spends
//      a whole band's quota in one place.
//
// ## Joins are promoted with their component, deliberately
//
// A join (anastomosis) is a segment that closes one filament onto another, so
// after P4 a "component" is a small plexus rather than a single filament, and
// its joins are inside it. They go wide with it. Drawing the two arms of a
// closed loop wide and the link that closes it thin would put a visible seam
// at precisely the junction the join exists to make invisible, and a width
// step at a junction IS endpoint emphasis. The run-length instruments skip
// joins by construction, so including them moves no recorded run statistic.
//
// ## What this module does NOT do
//
// It does not place, walk, taper, or colour anything. It reads the finished
// placement buffers and returns a PARTITION of the segment index buffer into
// two subsequences. Partition and not overlay: a promoted segment leaves the
// line index, because bounded screen accumulation would otherwise deposit the
// same stroke twice and the backbone would read as brighter rather than as
// wider (P5's law). Both halves are subsequences of a buffer that is monotone
// non-decreasing in max-endpoint, and a subsequence of a monotone sequence is
// monotone, so `populationSegmentsForPointPrefix` keeps working on each of
// them and no quality preset can leave a promoted segment dangling past the
// points it names.

import { FIELD_HALF_X, FIELD_HALF_Z } from '../helix';

/**
 * Total promoted segments.
 *
 * Swept over 8K/12K/16K/20K against the shipped placement (105,000 points,
 * 96,609 segments, 14,419 filaments, 1,670 joins), reading the promoted share
 * of each elliptical band and, beside it, how many of the 24 angular sectors
 * of each band received any backbone at all — a share can be met by one thick
 * rope through a quarter of the field, and the complaint is about the parts
 * with nothing in them. `populationBackbone.test.ts` re-derives the shares:
 *
 * | budget | pre-rim | mixed | 1.15–1.40 | 1.40–1.55 | fringe | strands | sectors covered |
 * |---:|---:|---:|---:|---:|---:|---:|---|
 * |  8,000 |  4.5% |  7.6% | 12.0% | 12.7% | 21.9% | 229 | 23/24 24/24 24/24 17/21 6/7 |
 * | 12,000 |  6.8% | 11.3% | 17.7% | 20.7% | 28.0% | 370 | 23/24 24/24 24/24 18/21 7/7 |
 * | 16,000 |  8.9% | 15.3% | 23.5% | 28.6% | 36.0% | 531 | 23/24 24/24 24/24 19/21 7/7 |
 * | 20,000 | 11.1% | 19.2% | 29.3% | 35.9% | 43.6% | 720 | 24/24 24/24 24/24 20/21 7/7 |
 *
 * 16,000 is the smallest budget at which every band gets a skeleton rather
 * than a sample. At 12,000 the two outermost shells fall to roughly one strand
 * in five and the 1.40–1.55 shell loses three of its twenty-one occupied
 * sectors — a hole in the second-outermost shell is exactly the ground the
 * complaint is about. 20,000 buys another six points out there and pays for
 * them in the crossing-rich inner bands, where a wider stroke makes wider
 * crossings and retention is a function of deposits per pixel.
 *
 * ## The GPU price, in primitives
 *
 * The halo is primitive-bound — halving its primitives measured 0.43–0.45x of
 * its draw time — so primitives price this honestly without a timer. A
 * screen-space capsule is TWO triangles per segment
 * ({@link SCREEN_CAPSULE_TRIANGLES_PER_SEGMENT}), so 16,000 promoted segments
 * are **32,000 triangles**. The point pass rasterizes 105,000 point
 * primitives, each of which the driver expands to a screen quad — about
 * **210,000 triangle-equivalents** — so the whole new pass is **15.2%** of the
 * point draw. And because this is a partition rather than an overlay, the
 * fibre pass gives up the same 16,000 line primitives it gained: 96,609 lines
 * become 80,621.
 */
export const POPULATION_BACKBONE_BUDGET = 16_000;

/**
 * Elliptical-radius edges of the bands the quota is rationed across.
 *
 * The same bins the fibre taper's post-P3/P4 table is reported in, so a share
 * measured here reads directly against the taper measured there. Radius is
 * `hypot(x / FIELD_HALF_X, z / FIELD_HALF_Z)` — the placement's own
 * coordinate, taken at a segment's midpoint.
 *
 * ⚠️ These are REPORTING bands, and they are the only place in the halo where
 * a radius is a key at all. The placement itself keys on `density` and
 * `resolvedCoverage` and never on a circle, and it stays that way: nothing
 * downstream of this file learns a radius. A band here rations a budget; it
 * does not decide how anything is drawn.
 */
export const POPULATION_BACKBONE_BAND_EDGES: readonly number[] = [
  0.95, 1.15, 1.40, 1.55,
];

/** Bands, counting the open outer shell past the last edge. */
export const POPULATION_BACKBONE_BAND_COUNT =
  POPULATION_BACKBONE_BAND_EDGES.length + 1;

/**
 * Relative promoted share per band, rising outward.
 *
 * Not a share of the budget — a share of each band's OWN promotable stock,
 * normalized so the whole thing sums to the budget. A flat vector would hand
 * the pre-rim band a quarter of the budget for its 25,741 segments and the
 * fringe 0.2% for its 187, which is proportional representation of a
 * population and precisely the bias the complaint is about: the fringe's
 * problem is not that it has few strands, it is that every one of the few is
 * under threshold.
 *
 * The ramp measures 8.9% / 15.3% / 23.5% / 28.6% / 36.0% at the shipped
 * budget — a fourfold span from the centre to the rim. Inside the rim the
 * fabric's own 2.5 px nerves are already in frame and the halo is dense enough
 * to read from accumulation, so a light skeleton is all the inner bands need;
 * but they do need one, because a backbone class that STOPPED at the rim would
 * draw a seam there, which is the failure `1c44c79` and `ba38aa5` were spent
 * on.
 */
export const POPULATION_BACKBONE_BAND_WEIGHTS: readonly number[] = [
  0.50, 0.90, 1.37, 1.81, 2.09,
];

/**
 * The window, in segments, a component must fall inside to be promoted.
 *
 * **The floor** is the halo's own dust floor — the guard the placement's
 * run-length work is bounded by is `components >= 8` — read in the one unit
 * that matters here: below it a component is a fragment, and a fragment drawn
 * at the backbone width is a dash. Measured, it barely moves anything (the fringe share
 * reads 40.0% / 38.0% / 36.0% / 36.5% at floors 4 / 6 / 8 / 12), which is
 * itself worth recording so nobody goes looking for an effect: the ranking is
 * size-descending, so the floor only bites where a band's quota outruns its
 * stock of real strands.
 *
 * **The ceiling is the one that earns its keep, and it is a P4 consequence.**
 * After anastomosis a connected component is no longer a filament: a join
 * merges two of them, and the merged pieces percolate. Measured over the whole
 * buffer there are 6,672 components with p50 **6** segments, p90 33, p99 108 —
 * and a maximum of **1,735**. With no ceiling, 16,000 promoted segments are
 * spent on **99** components averaging 161 segments each: a few thick ropes,
 * with the rest of every band left exactly as bare as the complaint found it.
 * That is the mid-band-giant bias one level down, inside a band instead of
 * across them. Capping candidates at 40 — the component-size p90, rounded —
 * buys **531** distinct strands for the same budget, at a mean run of 30
 * segments, and lifts sector coverage from 20/22/22/18/6 to 23/24/24/19/7.
 *
 * | ceiling | strands | mean run | pre-rim | mixed | 1.15–1.40 | 1.40–1.55 | fringe |
 * |---:|---:|---:|---:|---:|---:|---:|---:|
 * |  30 | 711 | 22 |  9.8% | 15.9% | 22.1% | 28.3% | 29.5% |
 * |  40 | 531 | 30 |  8.9% | 15.3% | 23.5% | 28.6% | 36.0% |
 * |  60 | 347 | 46 |  7.7% | 15.3% | 23.8% | 32.3% | 49.0% |
 * | none |  99 | 161 | 12.5% | 14.5% | 20.2% | 30.0% | 42.1% |
 *
 * The percolated components stay hairline, and that is the right place for
 * them: they are the densest, most crossing-rich tissue in the layer, which is
 * the tissue that already reads from accumulation alone.
 */
export const POPULATION_BACKBONE_MIN_RUN = 8;

/** Largest component, in segments, that may be promoted — see
 *  {@link POPULATION_BACKBONE_MIN_RUN} for why a ceiling exists at all. */
export const POPULATION_BACKBONE_MAX_RUN = 40;

/** The placement buffers this module reads. Nothing here is written. */
export interface PopulationBackboneInput {
  positions: Float32Array;
  segments: Uint32Array;
  count: number;
  segmentCount: number;
}

/**
 * The segment index buffer, split in two.
 *
 * Both halves hold index PAIRS in the source buffer's own order, so both are
 * subsequences of it and both inherit its monotone max-endpoint. Their union
 * is the source and their intersection is empty — the partition is exact, and
 * the test asserts it rather than trusting the loop.
 */
export interface PopulationBackbonePartition {
  /** Promoted segments, drawn as capsules. */
  backbone: Uint32Array<ArrayBuffer>;
  backboneCount: number;
  /** Everything else, still drawn as one-device-pixel lines. */
  residual: Uint32Array<ArrayBuffer>;
  residualCount: number;
  /** Components promoted — strands, not segments. */
  components: number;
}

/** Which reporting band an elliptical radius falls in. */
export function populationBackboneBandOf(radial: number): number {
  for (let band = 0; band < POPULATION_BACKBONE_BAND_EDGES.length; band += 1) {
    if (radial < POPULATION_BACKBONE_BAND_EDGES[band]) return band;
  }
  return POPULATION_BACKBONE_BAND_EDGES.length;
}

/** The placement's own radial coordinate, at a segment's midpoint. */
function segmentBandRadius(
  positions: Float32Array,
  a: number,
  b: number,
): number {
  const x = (positions[a * 3] + positions[b * 3]) * 0.5;
  const z = (positions[a * 3 + 2] + positions[b * 3 + 2]) * 0.5;
  const nx = x / FIELD_HALF_X;
  const nz = z / FIELD_HALF_Z;
  return Math.sqrt(nx * nx + nz * nz);
}

/**
 * Connected components of the drawn fibre graph, as a root per point.
 *
 * Path-halving find, union by size — the same technique `bridgeEdges.ts` uses
 * for its anchor prefix, re-derived here rather than shared because that one
 * is deliberately restricted to the lowest preset's prefix and answers with
 * SIZES. A backbone is chosen over the whole buffer (a preset trims a prefix
 * of the result afterwards, which cannot split a component's promotion — it
 * can only shorten it), and it needs the root itself so a segment can be
 * tested against a promoted set.
 */
function componentRoots(
  segments: Uint32Array,
  count: number,
  segmentCount: number,
): Int32Array {
  const parent = new Int32Array(count);
  const size = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    parent[i] = i;
    size[i] = 1;
  }
  const find = (start: number): number => {
    let node = start;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]];
      node = parent[node];
    }
    return node;
  };
  for (let s = 0; s < segmentCount; s += 1) {
    const a = segments[s * 2];
    const b = segments[s * 2 + 1];
    if (a >= count || b >= count) continue;
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) continue;
    if (size[rootA] >= size[rootB]) {
      parent[rootB] = rootA;
      size[rootA] += size[rootB];
    } else {
      parent[rootA] = rootB;
      size[rootB] += size[rootA];
    }
  }
  const roots = new Int32Array(count);
  for (let i = 0; i < count; i += 1) roots[i] = find(i);
  return roots;
}

interface BackboneCandidate {
  root: number;
  segments: number;
  band: number;
}

/**
 * Partition the placement's segments into a promoted backbone and the residual
 * grain.
 *
 * Pure and deterministic in the buffers alone: the same placement produces the
 * same partition, byte for byte, on every reload and in every universe — the
 * halo's whole point. The ranking's tie-break is the component root, an index
 * into a buffer written by a deterministic walk, so no sort stability is
 * relied on.
 */
export function selectPopulationBackbone(
  input: PopulationBackboneInput,
  budget: number = POPULATION_BACKBONE_BUDGET,
): PopulationBackbonePartition {
  const { positions, segments } = input;
  const count = Math.max(0, Math.min(
    input.count,
    Math.floor(positions.length / 3),
  ));
  const total = Math.max(0, Math.min(
    input.segmentCount,
    Math.floor(segments.length / 2),
  ));
  if (count <= 0 || total <= 0 || budget <= 0) {
    return {
      backbone: new Uint32Array(0),
      backboneCount: 0,
      residual: segments.slice(0, total * 2) as Uint32Array<ArrayBuffer>,
      residualCount: total,
      components: 0,
    };
  }

  const roots = componentRoots(segments, count, total);
  // Per-component tallies, indexed by root. Two typed arrays over the point
  // space rather than a Map: the roots are point indices, and 105,000 slots of
  // each is cheaper than the Map this would otherwise build and throw away.
  const componentSegments = new Int32Array(count);
  const componentRadiusSum = new Float64Array(count);
  for (let s = 0; s < total; s += 1) {
    const a = segments[s * 2];
    const b = segments[s * 2 + 1];
    if (a >= count || b >= count) continue;
    const root = roots[a];
    componentSegments[root] += 1;
    componentRadiusSum[root] += segmentBandRadius(positions, a, b);
  }

  // A component's home band is the band of its MEAN segment midpoint. A long
  // corridor strand crosses bands — the placement's own run tables say so, and
  // say why — so it is charged to one quota and drawn wherever it goes. That
  // is the whole-run rule costing the quotas some precision, and the achieved
  // per-band shares are measured rather than assumed for exactly that reason.
  const candidates: BackboneCandidate[] = [];
  const bandStock = new Float64Array(POPULATION_BACKBONE_BAND_COUNT);
  for (let root = 0; root < count; root += 1) {
    const size = componentSegments[root];
    if (
      size < POPULATION_BACKBONE_MIN_RUN
      || size > POPULATION_BACKBONE_MAX_RUN
    ) continue;
    const band = populationBackboneBandOf(componentRadiusSum[root] / size);
    bandStock[band] += size;
    candidates.push({ root, segments: size, band });
  }

  // Quotas: each band's weight applied to its own stock, normalized to the
  // budget. A band with no promotable stock contributes nothing and its share
  // flows to the others through the normalization.
  let weighted = 0;
  for (let band = 0; band < POPULATION_BACKBONE_BAND_COUNT; band += 1) {
    weighted += bandStock[band] * POPULATION_BACKBONE_BAND_WEIGHTS[band];
  }
  const quota = new Float64Array(POPULATION_BACKBONE_BAND_COUNT);
  if (weighted > 0) {
    const scale = Math.min(budget, total) / weighted;
    for (let band = 0; band < POPULATION_BACKBONE_BAND_COUNT; band += 1) {
      quota[band] = bandStock[band]
        * POPULATION_BACKBONE_BAND_WEIGHTS[band]
        * scale;
    }
  }

  // Size-descending inside a band, first fit under the quota: the longest
  // strands become the skeleton and the smaller ones fill the tail, so a band
  // spends its quota rather than stopping at the first component that does not
  // fit. Total order, so the result never depends on sort stability.
  candidates.sort((left, right) => (
    left.band !== right.band
      ? left.band - right.band
      : right.segments !== left.segments
        ? right.segments - left.segments
        : left.root - right.root
  ));

  const promoted = new Uint8Array(count);
  const spent = new Float64Array(POPULATION_BACKBONE_BAND_COUNT);
  let backboneSegments = 0;
  let components = 0;
  for (const candidate of candidates) {
    if (spent[candidate.band] + candidate.segments > quota[candidate.band]) {
      continue;
    }
    spent[candidate.band] += candidate.segments;
    promoted[candidate.root] = 1;
    backboneSegments += candidate.segments;
    components += 1;
  }

  // Emit in the source buffer's order, so both halves stay monotone in
  // max-endpoint and both stay prefix-trimmable.
  const backbone = new Uint32Array(backboneSegments * 2);
  const residual = new Uint32Array((total - backboneSegments) * 2);
  let backboneCount = 0;
  let residualCount = 0;
  for (let s = 0; s < total; s += 1) {
    const a = segments[s * 2];
    const b = segments[s * 2 + 1];
    const wide = a < count && b < count && promoted[roots[a]] === 1;
    if (wide) {
      backbone[backboneCount * 2] = a;
      backbone[backboneCount * 2 + 1] = b;
      backboneCount += 1;
    } else {
      residual[residualCount * 2] = a;
      residual[residualCount * 2 + 1] = b;
      residualCount += 1;
    }
  }

  return {
    backbone: backbone as Uint32Array<ArrayBuffer>,
    backboneCount,
    residual: residual as Uint32Array<ArrayBuffer>,
    residualCount,
    components,
  };
}

/** One reporting band's promoted share. */
export interface PopulationBackboneBandShare {
  segments: number;
  promoted: number;
  share: number;
}

/**
 * The promoted share of every band, measured on a finished partition.
 *
 * The instrument the budget was chosen with, kept in the tree because the
 * numbers it produces are the ones the constants above are justified by. It
 * bins by the same midpoint radius the selection does, but over the DRAWN
 * segments rather than over components, so it reports what the eye gets rather
 * than what the quota intended.
 */
export function populationBackboneBandShares(
  input: PopulationBackboneInput,
  partition: PopulationBackbonePartition,
): PopulationBackboneBandShare[] {
  const bands: PopulationBackboneBandShare[] = [];
  for (let band = 0; band < POPULATION_BACKBONE_BAND_COUNT; band += 1) {
    bands.push({ segments: 0, promoted: 0, share: 0 });
  }
  const tally = (
    segments: Uint32Array,
    segmentCount: number,
    wide: boolean,
  ): void => {
    for (let s = 0; s < segmentCount; s += 1) {
      const a = segments[s * 2];
      const b = segments[s * 2 + 1];
      const band = populationBackboneBandOf(
        segmentBandRadius(input.positions, a, b),
      );
      bands[band].segments += 1;
      if (wide) bands[band].promoted += 1;
    }
  };
  tally(partition.backbone, partition.backboneCount, true);
  tally(partition.residual, partition.residualCount, false);
  for (const band of bands) {
    band.share = band.segments > 0 ? band.promoted / band.segments : 0;
  }
  return bands;
}
