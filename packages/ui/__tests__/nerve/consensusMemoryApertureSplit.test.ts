// T8 equality oracle — SAME PIXELS is the bar.
//
// The recall aperture used to re-run the whole scale computation — bucket
// lookup, projection, distance falloff AND the temporal envelope — for every
// sample of every near-route slot, every frame. T8 splits the invariant spatial
// half (bucket + projection + falloff) from the temporal half so a recall bakes
// the spatial half ONCE and re-evaluates only the temporal envelope per frame.
//
// GOLDEN below is a captured sweep of the PRE-CHANGE `consensusMemoryAperture
// Scale` over a real bent six-hop route: (x, z, strength, now, scale), now=null
// meaning "no clock" (pure spatial dim). It is the frozen oracle. Both the
// refactored monolith and the split path must reproduce every value BIT FOR BIT
// (Object.is). This is the falsification anchor: perturb either half's
// arithmetic and the golden rows go red. The second test proves the split's
// defining property — spatial terms built ONCE and reused across the whole
// clock sweep equal the monolith that rebuilds them per call.
import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  consensusMemoryApertureScale,
  consensusMemoryApertureScaleFromSpatialTerms,
  consensusMemoryApertureSpatialTermsInto,
  deriveConsensusMemoryAperture,
  type ConsensusMemoryAperture,
  type ConsensusMemoryApertureSpatialTerm,
} from '../../src/nerve/consensusMemoryAperture';
import type {
  ConsensusMemoryTraceFocus,
  ConsensusMemoryTraceFocusSource,
  ConsensusMemoryTraceRoute,
} from '../../src/nerve/consensusMemoryTrace';

function cell(id: number, x: number, z: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [x, 0, z],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${String(id).padStart(64, '0')}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

function route(
  targetId: number,
  path: number[],
  startsAtSec: number,
  hopMs: number,
): ConsensusMemoryTraceRoute {
  return {
    targetId,
    path,
    color: [1, 0.7, 0.3],
    hopCount: path.length - 1,
    hopMs,
    startsAtSec,
    arrivesAtSec: startsAtSec + (path.length - 1) * hopMs / 1_000,
  };
}

function source(
  id: number,
  routes: ConsensusMemoryTraceRoute[],
): ConsensusMemoryTraceFocusSource {
  return {
    id,
    contentHash: `0x${String(id).padStart(64, '0')}`,
    outPoint: { tx_hash: `0x${id}`, index: 0 },
    birthBlock: 1,
    startsAtSec: Math.min(...routes.map((r) => r.startsAtSec)),
    arrivesAtSec: Math.min(...routes.map((r) => r.arrivesAtSec)),
    routes,
  };
}

function focus(
  sources: ConsensusMemoryTraceFocusSource[],
  targetIds: number[],
): ConsensusMemoryTraceFocus {
  return {
    key: 'trace:split',
    linkSeq: 1,
    linkBlock: 1,
    sourceKind: 'input',
    sources,
    consumedInputs: [],
    routedSourceCount: sources.length,
    targetIds,
    startedAtSec: 0,
    endsAtSec: 100,
    evidenceFocusSourceId: null,
    routeHopFocus: null,
  };
}

/** The exact field the golden was captured from: a bent, six-cell route whose
 *  segments run in several directions, so the corridor is non-trivial and
 *  buckets carry a handful of segments each. */
function bentField(): ConsensusMemoryAperture {
  const cells = new Map<number, Cell>([
    [1, cell(1, 0, 0)],
    [2, cell(2, 14, 3)],
    [3, cell(3, 26, -5)],
    [4, cell(4, 40, 6)],
    [5, cell(5, 55, -2)],
    [6, cell(6, 70, 8)],
  ]);
  const field = deriveConsensusMemoryAperture(
    focus([source(1, [route(6, [1, 2, 3, 4, 5, 6], 10, 300)])], [6]),
    cells,
  );
  if (!field) throw new Error('bent field was null');
  return field;
}

/** [x, z, strength, now (null = undefined), scale], captured from the
 *  pre-change monolithic scale. Do not edit by hand — regenerate if the
 *  aperture maths deliberately change. */
const GOLDEN: ReadonlyArray<
  readonly [number, number, number, number | null, number]
> = [
  [-2, 0, 1, 10.264, 0.19999999999999996],
  [4, 2, 1, 11.232, 0.19999999999999996],
  [12, 0, 1, 11.76, 0.19999999999999996],
  [18, -2, 1, 10.616, 0.19999999999999996],
  [24, -4, 1, 11.496, 0.19999999999999996],
  [30, 0, 1, 10.968, 0.19999999999999996],
  [36, 6, 1, 11.232, 0.19999999999999996],
  [44, 4, 1, 12.288, 0.19999999999999996],
  [52, 0, 1, 12.288, 0.19999999999999996],
  [60, 2, 1, 12.904, 0.19999999999999996],
  [68, 6, 1, 12.64, 0.19999999999999996],
  [66, 0, 1, 12.2, 0.20075791054247605],
  [10, 4, 1, 12.2, 0.20393226065860737],
  [22, -6, 1, 10.704, 0.21091060054433375],
  [66, 6, 1, 13.08, 0.22336891054915264],
  [46, 6, 1, 11.936, 0.24750092629888676],
  [16, 6, 1, 11.408, 0.2615566525998658],
  [30, -6, 1, 10.879999999999999, 0.2854164396655783],
  [0, 4, 1, 10.704, 0.30814747382794716],
  [56, -6, 1, 11.496, 0.3247378039744826],
  [34, -2, 1, 11.76, 0.3422030508413475],
  [-4, -2, 1, 11.847999999999999, 0.37624384633612706],
  [54, -4, 1, 11.32, 0.3848527753338157],
  [64, 8, 1, 12.991999999999999, 0.4131208609627789],
  [14, 8, 1, 11.672, 0.4639963586709148],
  [12, -4, 1, 11.672, 0.5053159581103157],
  [2, 0, 0.6, 10.264, 0.52],
  [8, 0, 0.6, 10.616, 0.52],
  [14, 4, 0.6, 11.232, 0.52],
  [20, -2, 0.6, 11.936, 0.52],
  [28, -6, 0.6, 11.232, 0.52],
  [34, 2, 0.6, 11.056, 0.52],
  [40, 8, 0.6, 11.76, 0.52],
  [48, 2, 0.6, 11.408, 0.52],
  [56, 0, 0.6, 11.76, 0.52],
  [64, 4, 0.6, 12.64, 0.52],
  [72, 8, 0.6, 12.815999999999999, 0.52],
  [10, -2, 0.6, 10.968, 0.5210943817582054],
  [-2, 2, 0.6, 10.528, 0.5235524879322573],
  [14, 6, 0.6, 12.2, 0.5280837505689576],
  [16, 8, 1, 12.112, 0.5329287347416751],
  [48, 0, 0.6, 11.232, 0.5404406828760911],
  [8, 6, 1, 11.232, 0.5490257471136573],
  [8, 4, 0.6, 11.144, 0.5568992638701009],
  [42, 0, 0.6, 12.376, 0.5660933506968178],
  [30, 6, 1, 10.879999999999999, 0.5783005966991104],
  [0, 4, 0.6, 11.232, 0.5848884842967683],
  [16, -4, 0.6, 11.232, 0.5936880385612768],
  [28, 6, 1, 11.584, 0.6002169070452896],
  [22, 2, 0.6, 10.616, 0.6091415343616919],
  [44, -2, 0.6, 12.2, 0.6248355363570841],
  [-2, -4, 0.6, 10.176, 0.6262925436432387],
  [10, -4, 0.6, 11.672, 0.6414828226024205],
  [0, 6, 1, 11.672, 0.6460628129267183],
  [56, -8, 1, 12.904, 0.6615003540173852],
  [64, -4, 0.6, 12.552, 0.6753300523174643],
  [48, -6, 1, 12.112, 0.688534522912096],
  [34, 0, 0.6, 12.728, 0.7012765639335279],
  [68, 14, 1, 11.936, 0.7049667178955941],
  [52, 6, 1, 12.815999999999999, 0.7114947331905566],
  [28, -10, 0.6, 11.496, 0.7197572408450051],
  [56, 4, 0.6, 11.936, 0.732512081815295],
  [-4, -4, 0.6, 11.76, 0.7496851418788816],
  [38, -2, 1, 11.847999999999999, 0.7576525148787017],
  [4, -2, 0.3, 11.76, 0.76],
  [10, 0, 0.3, 12.112, 0.76],
  [16, 2, 0.3, 10.792, 0.76],
  [22, -2, 0.3, 11.584, 0.76],
  [28, 0, 0.3, 11.144, 0.76],
  [36, 2, 0.3, 11.232, 0.76],
  [42, 6, 0.3, 12.112, 0.76],
  [50, 2, 0.3, 11.936, 0.76],
  [60, -2, 0.3, 12.463999999999999, 0.76],
  [68, 2, 0.3, 12.112, 0.76],
  [28, 6, 0.6, 11.847999999999999, 0.7601301442271737],
  [6, -6, 0.6, 10.616, 0.7606953439595713],
  [72, 10, 0.3, 12.376, 0.7617762439661286],
  [26, -8, 0.3, 11.847999999999999, 0.7640418752844789],
  [64, -2, 0.3, 12.463999999999999, 0.7676955734914251],
  [36, 8, 0.3, 12.2, 0.7719755184299975],
  [66, -4, 0.6, 12.64, 0.7761175543857648],
  [28, -8, 0.3, 11.936, 0.7784669957799597],
  [14, -2, 0.3, 11.496, 0.784285097136138],
  [0, 6, 0.6, 10.704, 0.7876376877560309],
  [0, -4, 0.3, 10.879999999999999, 0.7920766842809361],
  [4, 4, 0.6, 12.288, 0.7961934711032899],
  [26, 2, 0.3, 11.936, 0.797852439494851],
  [8, -4, 0.3, 11.936, 0.801410530986338],
  [66, 10, 0.3, 12.288, 0.8084748484547796],
  [-2, 4, 0.3, 10.352, 0.8128731539008381],
  [68, -4, 1, 12.64, 0.8145160535298774],
  [72, 6, 0.6, 13.256, 0.8189999506160587],
  [-6, 2, 0.6, 11.144, 0.8229800307373565],
  [18, -8, 0.6, 12.024, 0.8233449856433865],
  [52, -6, 0.3, 12.64, 0.8292278111290335],
  [22, -6, 0.3, 10.616, 0.8346619813090687],
  [22, -2, 0.3, 12.552, 0.8411714681264719],
  [64, 12, 1, 11.936, 0.8479479785361129],
  [-4, -6, 1, 10.704, 0.8515692025947037],
  [32, -8, 0.6, 11.232, 0.8534223906196142],
  [20, -8, 0.3, 11.408, 0.8586426814780633],
  [12, 10, 1, 12.024, 0.8616106084541324],
  [8, 6, 0.3, 10.44, 0.8647077241340971],
  [40, 0, 0.3, 11.056, 0.8685514838063999],
  [30, -4, 0.3, 10.704, 0.8752671233099582],
  [14, -6, 0.6, 10.968, 0.8803839997798355],
  [2, -6, 0.3, 10.528, 0.8854901619870914],
  [14, 10, 0.6, 10.528, 0.8916340464269458],
  [0, 6, 0.3, 10.44, 0.8938188438780155],
  [54, -8, 0.3, 12.815999999999999, 0.8983655220036096],
  [70, 8, 0.3, 13.256, 0.9028630012528048],
  [48, 8, 0.3, 11.672, 0.9071214721379056],
  [-6, -4, 0.6, 10.528, 0.9109415215568222],
  [-6, -2, 0.3, 11.408, 0.9114900153686782],
  [72, 0, 1, 11.496, 0.9118220301092297],
  [30, -10, 0.3, 11.056, 0.9156860799799627],
  [68, 10, 0.6, 11.496, 0.9188949699175978],
  [60, 8, 0.6, 12.991999999999999, 0.9246188445603356],
  [56, 6, 0.6, 11.936, 0.9291812220292777],
  [34, 12, 1, 12.288, 0.9326309359429651],
  [48, 10, 1, 12.112, 0.9373574999130009],
  [12, 8, 0.6, 10.352, 0.9433486763633021],
  [66, -6, 0.6, 12.288, 0.9478543270397141],
  [62, -8, 0.6, 11.936, 0.9491811864340756],
  [6, -8, 0.6, 10.352, 0.9522936347782502],
  [24, -6, 1, 10.528, 0.9544128129261265],
  [-4, 6, 0.3, 11.408, 0.9554707607784111],
  [32, -10, 0.6, 11.76, 0.9576426034780341],
  [34, 12, 0.6, 12.376, 0.959578561565779],
  [60, 8, 0.3, 12.112, 0.9623094222801678],
  [72, 10, 1, 11.496, 0.9651491173935212],
  [34, -8, 1, 11.76, 0.9688114588721193],
  [-2, 8, 1, 11.936, 0.970219313894416],
  [44, -6, 1, 12.904, 0.972327554530538],
  [54, 2, 0.3, 11.144, 0.9740205365718271],
  [2, 8, 0.6, 10.879999999999999, 0.9758876026393958],
  [46, 12, 1, 12.728, 0.9784456666589888],
  [48, 10, 0.3, 12.64, 0.9812072499739003],
  [24, 6, 0.6, 11.76, 0.9824467483047168],
  [0, -8, 0.3, 10.792, 0.9841620210446846],
  [-6, -6, 1, 11.32, 0.9857449149565812],
  [30, -12, 0.3, 11.936, 0.9864557385824752],
  [66, 10, 0.3, 13.344, 0.9878676983959919],
  [14, 10, 0.3, 10.352, 0.9890468629313075],
  [34, -8, 0.3, 11.672, 0.9906434376616358],
  [4, 8, 0.3, 12.024, 0.9912608953751157],
  [38, -4, 0.3, 12.2, 0.9920398182059901],
  [14, -8, 0.6, 11.672, 0.9933238914081746],
  [76, 2, 0.3, 11.672, 0.9947738151411241],
  [64, -8, 1, 13.08, 0.9956967649961268],
  [10, -8, 1, 12.376, 0.9963904256266664],
  [72, 6, 1, 13.431999999999999, 0.9970948444051512],
  [62, 12, 0.6, 11.847999999999999, 0.9979852449255928],
  [28, 8, 0.3, 12.815999999999999, 0.9988012529691179],
  [68, -4, 0.3, 13.256, 0.99937427584765],
  [26, 4, 0.3, 12.815999999999999, 0.9996583766829749],
  [-4, -8, 1, 11.056, 0.9998245944112828],
  [-4, -8, 0.6, 11.32, 0.9998947566467696],
  [-4, -8, 0.3, 10.704, 0.9999473783233849],
  [4, -6, 0.3, 12.463999999999999, 0.999987168291644],
  [-6, -12, 0.3, 9.5, 1],
  [-6, 12, 1, 12.112, 1],
  [-4, 12, 1, 13.168, 1],
  [-2, 14, 0.3, 11.76, 1],
  [0, 14, 0.6, 10.616, 1],
  [2, 14, 1, 11.32, 1],
  [6, -12, 0.3, 12.024, 1],
  [8, -12, 0.6, 11.232, 1],
  [10, -12, 1, 10.616, 1],
  [12, -10, 1, 10.088, 1],
  [14, -6, 0.6, 13.256, 1],
  [16, 0, 0.3, 13.256, 1],
  [18, 8, 0.3, 13.08, 1],
  [20, 12, 0.6, 13.08, 1],
  [22, 14, 0.6, 11.056, 1],
  [26, -12, 0.6, 10.264, 1],
  [28, -6, 0.6, 10.176, 1],
  [30, 2, 1, 14.02, 1],
  [32, 8, 0.6, 10.352, 1],
  [34, 12, 0.6, 10.704, 1],
  [36, 14, 0.3, 13.168, 1],
  [38, 14, 1, 10.176, 1],
  [40, 14, 1, 12.904, 1],
  [44, -12, 0.6, 12.728, 1],
  [46, -10, 0.3, 11.76, 1],
  [48, -10, 1, 11.056, 1],
  [50, -10, 1, 12.64, 1],
  [52, -6, 0.3, 10.264, 1],
  [54, -6, 0.3, 10.528, 1],
  [56, -8, 1, 13.256, 1],
  [58, -10, 1, 13.256, 1],
  [60, -10, 0.6, 10.704, 1],
  [62, -10, 0.6, 10.704, 1],
  [64, -10, 1, 12.463999999999999, 1],
  [66, -8, 1, 12.288, 1],
  [68, -6, 1, 9.5, 1],
  [70, -6, 1, 10.704, 1],
  [72, -6, 0.6, 12.904, 1],
  [74, -8, 1, 12.815999999999999, 1],
  [76, -10, 1, 10.704, 1],
  [-2, 0, 1, null, 0.19999999999999996],
  [8, 0, 1, null, 0.19999999999999996],
  [18, -2, 1, null, 0.19999999999999996],
  [28, -6, 1, null, 0.19999999999999996],
  [36, 4, 1, null, 0.19999999999999996],
  [46, 2, 1, null, 0.19999999999999996],
  [56, 0, 1, null, 0.19999999999999996],
  [66, 6, 1, null, 0.19999999999999996],
  [66, 0, 1, null, 0.20075791054247605],
  [68, 10, 1, null, 0.20592081322042866],
  [64, -2, 1, null, 0.22565191163808374],
  [24, 0, 1, null, 0.2590940195543717],
  [68, 0, 1, null, 0.29501844424019685],
  [54, -6, 1, null, 0.3247378039744826],
  [38, 10, 1, null, 0.3744964125519673],
  [52, 4, 1, null, 0.3862767172364471],
  [14, 8, 1, null, 0.4639963586709148],
  [12, 8, 1, null, 0.5329287347416751],
  [74, 4, 1, null, 0.5759219271181889],
  [66, -4, 1, null, 0.6268625906429413],
  [2, 6, 1, null, 0.6685119559077886],
  [42, 12, 1, null, 0.7049667178955941],
  [38, -2, 1, null, 0.7576525148787017],
  [34, -6, 1, null, 0.8267069259506308],
  [-4, 6, 1, null, 0.8515692025947037],
  [56, 6, 1, null, 0.8819687033821294],
  [6, 8, 1, null, 0.9426349977678586],
  [74, 0, 1, null, 0.9586558520346232],
  [46, 12, 1, null, 0.9784456666589888],
  [68, -6, 1, null, 0.9916525022039193],
  [-6, -12, 1, null, 1],
  [-2, 14, 1, null, 1],
  [6, -10, 1, null, 1],
  [12, 14, 1, null, 1],
  [22, 12, 1, null, 1],
  [34, 14, 1, null, 1],
  [44, -10, 1, null, 1],
  [54, -12, 1, null, 1],
  [60, 14, 1, null, 1],
  [72, -10, 1, null, 1],
];

describe('consensus memory aperture — spatial/temporal split equality (T8)', () => {
  it('the monolith and the split reproduce the pre-change golden bit-for-bit', () => {
    const field = bentField();
    const terms: ConsensusMemoryApertureSpatialTerm[] = [];
    let dimmed = 0;
    for (const [x, z, strength, now, expected] of GOLDEN) {
      const nowArg = now === null ? undefined : now;
      const mono = consensusMemoryApertureScale(field, x, z, strength, nowArg);
      expect(
        Object.is(mono, expected),
        `mono x=${x} z=${z} s=${strength} now=${now}: ${mono} != ${expected}`,
      ).toBe(true);
      consensusMemoryApertureSpatialTermsInto(field, x, z, terms);
      const split = consensusMemoryApertureScaleFromSpatialTerms(
        terms, strength, nowArg,
      );
      expect(
        Object.is(split, expected),
        `split x=${x} z=${z} s=${strength} now=${now}: ${split} != ${expected}`,
      ).toBe(true);
      if (expected < 1) dimmed += 1;
    }
    // The oracle must actually exercise dimming, not a wall of 1s.
    expect(dimmed).toBeGreaterThan(150);
  });

  it('spatial terms built once equal the monolith across a full clock sweep', () => {
    const field = bentField();
    const t0 = field.temporalStartsAtSec;
    const t1 = field.temporalEndsAtSec;
    const nows: number[] = [t0 - 0.5, t1 + 0.5];
    for (let i = 0; i <= 48; i += 1) nows.push(t0 + (t1 - t0) * (i / 48));

    const strengths = [0.25, 0.6, 1];
    const flashes = [0, 0.4, 1];
    const terms: ConsensusMemoryApertureSpatialTerm[] = [];

    let compared = 0;
    let dimmedSeen = 0;
    for (let x = -6; x <= 76; x += 1.5) {
      for (let z = -12; z <= 14; z += 1.5) {
        // The defining property of the split: the spatial terms are built ONCE
        // per sample and reused across the entire clock sweep and every
        // strength / flash.
        consensusMemoryApertureSpatialTermsInto(field, x, z, terms);
        for (const strength of strengths) {
          for (const now of nows) {
            for (const flash of flashes) {
              const mono = consensusMemoryApertureScale(
                field, x, z, strength, now, flash,
              );
              const split = consensusMemoryApertureScaleFromSpatialTerms(
                terms, strength, now, flash,
              );
              expect(
                Object.is(split, mono),
                `x=${x} z=${z} s=${strength} now=${now} flash=${flash}: `
                  + `split=${split} mono=${mono}`,
              ).toBe(true);
              compared += 1;
              if (mono < 1) dimmedSeen += 1;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(50_000);
    expect(dimmedSeen).toBeGreaterThan(1_000);
  });

  it('both halves return exactly 1 off the field and for a dead strength', () => {
    const field = bentField();
    const terms: ConsensusMemoryApertureSpatialTerm[] = [];

    consensusMemoryApertureSpatialTermsInto(field, 500, 500, terms);
    expect(terms).toHaveLength(0);
    expect(consensusMemoryApertureScaleFromSpatialTerms(terms, 1, 20)).toBe(1);
    expect(consensusMemoryApertureScale(field, 500, 500, 1, 20)).toBe(1);

    consensusMemoryApertureSpatialTermsInto(field, 0, 0, terms);
    expect(terms.length).toBeGreaterThan(0);
    for (const bad of [0, -1, Number.NaN]) {
      expect(consensusMemoryApertureScaleFromSpatialTerms(terms, bad, 20))
        .toBe(1);
      expect(consensusMemoryApertureScale(field, 0, 0, bad, 20)).toBe(1);
    }
    expect(consensusMemoryApertureScaleFromSpatialTerms(terms, 1, Number.NaN))
      .toBe(1);
    expect(consensusMemoryApertureScale(field, 0, 0, 1, Number.NaN)).toBe(1);
  });
});
