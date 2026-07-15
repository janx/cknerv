// Data-derived silicon architectures for the Cell nucleus.
//
// The historical phylum identifiers stay stable because the detail HUD and
// tests consume them, but their geometry is deliberately non-biological:
// straight buses, chiplet grids, clock stacks, recursive FPGA routing, and a
// polygonal checksum loop. content_hash chooses the exact orientation,
// topology, omissions, and port layout without introducing runtime randomness.
import {
  type PhylumGeometry,
  type PhylumOpts,
  type NucNode,
  type Vec3,
  TAU,
  add,
  scale,
  len,
  dist,
  cross,
  seededRng,
  hashToBytes,
  randDir,
  randPerp,
} from './specimenKit';

type Frame = readonly [Vec3, Vec3, Vec3];

function makeFrame(r: () => number): Frame {
  const x = randDir(r);
  const y = randPerp(r, x);
  const z = cross(x, y);
  return [x, y, z];
}

function inFrame(frame: Frame, x: number, y: number, z: number): Vec3 {
  return add(add(scale(frame[0], x), scale(frame[1], y)), scale(frame[2], z));
}

function segment(out: number[], a: Vec3, b: Vec3): void {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
}

function route(out: number[], points: Vec3[]): void {
  for (let i = 1; i < points.length; i += 1) segment(out, points[i - 1], points[i]);
}

function node(p: Vec3, s: number, a = 0.92): NucNode {
  return { x: p[0], y: p[1], z: p[2], s, a };
}

/**
 * RADIOLARIAN / native — radial I/O backplane.
 *
 * Hash-addressed ports sit on three discrete layers. Each signal reaches its
 * port through two hard routing elbows, while a polygonal perimeter bus joins
 * the ports into one consensus plane.
 */
export function genRadiolarian(seedHash: string, opts: PhylumOpts): PhylumGeometry {
  const r = seededRng(hashToBytes(seedHash), 0x5101);
  const frame = makeFrame(r);
  const count = 10 + Math.floor(r() * 5);
  const reach = (0.66 + r() * 0.12) * (0.82 + opts.maturity * 0.18);
  const phase = r() * TAU;
  const segments: number[] = [];
  const nodes: NucNode[] = [];
  const ports: Vec3[] = [];

  for (let i = 0; i < count; i += 1) {
    const angle = phase + (i / count) * TAU;
    const layer = ((i + Math.floor(r() * 3)) % 3 - 1) * 0.18;
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);
    const inner = inFrame(frame, cx * 0.24, 0, cz * 0.24);
    const elbow = inFrame(frame, cx * 0.50, layer, cz * 0.50);
    const port = inFrame(frame, cx * reach, layer, cz * reach);
    route(segments, [[0, 0, 0], inner, elbow, port]);
    ports.push(port);
    nodes.push(node(port, 0.043 + r() * 0.012));
  }

  for (let i = 0; i < ports.length; i += 1) {
    segment(segments, ports[i], ports[(i + 1) % ports.length]);
  }
  nodes.push(node([0, 0, 0], 0.12, 1));

  let outer = ports[0];
  for (const port of ports) if (len(port) > len(outer)) outer = port;
  return {
    segments,
    nodes,
    membraneR: 0.31,
    landmarks: {
      core: [0, 0, 0],
      species: ports[0],
      membrane: ports[Math.floor(ports.length / 3)],
      outer,
    },
  };
}

/**
 * COLONY / sUDT+xUDT — chiplet array.
 *
 * Token cells resolve to deterministic positions on a 3×3×3 substrate grid.
 * Their nearest-earlier connection is routed Manhattan-style through the
 * package instead of using soft necks.
 */
export function genColony(seedHash: string, opts: PhylumOpts): PhylumGeometry {
  const r = seededRng(hashToBytes(seedHash), 0xc41f);
  const frame = makeFrame(r);
  const count = 8 + Math.floor(r() * 5);
  const grid = 0.27 * (0.86 + opts.maturity * 0.14);
  const occupied = new Set<string>(['0,0,0']);
  const local: Vec3[] = [[0, 0, 0]];

  while (local.length < count) {
    const x = Math.floor(r() * 5) - 2;
    const y = Math.floor(r() * 3) - 1;
    const z = Math.floor(r() * 5) - 2;
    if (x === 0 && y === 0 && z === 0) continue;
    const key = `${x},${y},${z}`;
    if (occupied.has(key)) continue;
    occupied.add(key);
    local.push([x * grid, y * grid * 0.62, z * grid]);
  }

  const points = local.map((p) => inFrame(frame, p[0], p[1], p[2]));
  const segments: number[] = [];
  const nodes: NucNode[] = points.map((p, i) => node(p, i === 0 ? 0.13 : 0.065 + r() * 0.025, i === 0 ? 1 : 0.92));
  let firstBus: Vec3 = [0, 0, 0];

  for (let i = 1; i < local.length; i += 1) {
    let parent = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let j = 0; j < i; j += 1) {
      const d = dist(local[i], local[j]);
      if (d < best) {
        best = d;
        parent = j;
      }
    }
    const a = local[parent];
    const b = local[i];
    const elbowA = inFrame(frame, b[0], a[1], a[2]);
    const elbowB = inFrame(frame, b[0], b[1], a[2]);
    route(segments, [points[parent], elbowA, elbowB, points[i]]);
    if (i === 1) firstBus = elbowB;
  }

  let outer = points[0];
  for (const p of points) if (len(p) > len(outer)) outer = p;
  return {
    segments,
    nodes,
    membraneR: 0.36,
    landmarks: { core: points[0], species: points[1], membrane: firstBus, outer },
  };
}

/**
 * HELIX / DAO — block-height clock stack.
 *
 * DAO time is expressed as a sequence of rigid hexagonal timing planes with
 * vertical vias. There are no helical strands: maturity changes the height of
 * the stack, while the hash selects phase and via omissions.
 */
export function genHelix(seedHash: string, opts: PhylumOpts): PhylumGeometry {
  const r = seededRng(hashToBytes(seedHash), 0xda0c);
  const frame = makeFrame(r);
  const levels = 7 + Math.floor(r() * 3);
  const sides = 6;
  const radius = 0.30 + r() * 0.07;
  const height = 1.35 * (0.78 + opts.maturity * 0.22);
  const phase = r() * (TAU / sides);
  const layers: Vec3[][] = [];
  const segments: number[] = [];
  const nodes: NucNode[] = [];

  for (let level = 0; level < levels; level += 1) {
    const y = -height * 0.5 + (height * level) / (levels - 1);
    const twist = phase + (level % 2) * (TAU / sides) * 0.5;
    const ring: Vec3[] = [];
    for (let side = 0; side < sides; side += 1) {
      const angle = twist + (side / sides) * TAU;
      ring.push(inFrame(frame, Math.cos(angle) * radius, y, Math.sin(angle) * radius));
    }
    for (let side = 0; side < sides; side += 1) {
      segment(segments, ring[side], ring[(side + 1) % sides]);
    }
    layers.push(ring);
    if (level === 0 || level === levels - 1 || level % 2 === 0) {
      for (let side = 0; side < sides; side += 2) nodes.push(node(ring[side], 0.045));
    }
  }

  for (let level = 1; level < levels; level += 1) {
    for (let side = 0; side < sides; side += 1) {
      if ((side + level) % 3 !== 0 || r() > 0.35) {
        segment(segments, layers[level - 1][side], layers[level][side]);
      }
    }
  }
  nodes.push(node([0, 0, 0], 0.105, 1));

  return {
    segments,
    nodes,
    membraneR: null,
    landmarks: {
      core: [0, 0, 0],
      species: layers[0][0],
      membrane: layers[Math.floor(levels / 2)][2],
      outer: layers[levels - 1][3],
    },
  };
}

/**
 * ARBOR / Spore — recursive FPGA routing tree.
 *
 * Spore's composability remains visible as a hierarchy, but every branch is a
 * right-angle clock/data route on alternating silicon planes.
 */
export function genArbor(seedHash: string, opts: PhylumOpts): PhylumGeometry {
  const r = seededRng(hashToBytes(seedHash), 0x5f07);
  const frame = makeFrame(r);
  const depth = 3 + (r() > 0.58 ? 1 : 0);
  const segments: number[] = [];
  const nodes: NucNode[] = [node([0, 0, 0], 0.11, 1)];
  type Branch = { local: Vec3; world: Vec3; heading: 1 | -1 };
  let frontier: Branch[] = [{ local: [0, 0, 0], world: [0, 0, 0], heading: r() > 0.5 ? 1 : -1 }];
  let species: Vec3 = [0, 0, 0];
  let outer: Vec3 = [0, 0, 0];

  for (let level = 0; level < depth; level += 1) {
    const next: Branch[] = [];
    const advance = (0.24 - level * 0.026) * (0.82 + opts.maturity * 0.18);
    const spread = 0.22 - level * 0.025;
    for (const branch of frontier) {
      const axis = level % 3;
      const trunkLocal: Vec3 = [...branch.local];
      trunkLocal[axis] += advance * branch.heading;
      const trunk = inFrame(frame, trunkLocal[0], trunkLocal[1], trunkLocal[2]);
      segment(segments, branch.world, trunk);

      const splitAxis = (axis + 1 + (r() > 0.72 ? 1 : 0)) % 3;
      for (const side of [-1, 1] as const) {
        const childLocal: Vec3 = [...trunkLocal];
        childLocal[splitAxis] += spread * side;
        const child = inFrame(frame, childLocal[0], childLocal[1], childLocal[2]);
        segment(segments, trunk, child);
        nodes.push(node(child, 0.042 + (depth - level) * 0.005));
        next.push({ local: childLocal, world: child, heading: side });
        if (species[0] === 0 && species[1] === 0 && species[2] === 0) species = child;
        if (len(child) > len(outer)) outer = child;
      }
    }
    frontier = next;
  }

  return {
    segments,
    nodes,
    membraneR: null,
    landmarks: {
      core: [0, 0, 0],
      species,
      membrane: frontier[Math.floor(frontier.length / 2)]?.world ?? outer,
      outer,
    },
  };
}

/**
 * PLASMID / unknown — incomplete polygonal checksum bus.
 *
 * Unknown scripts are shown honestly as a partially decoded pair of hard
 * checksum loops. Hash bits decide missing edges, vias, and observation pads.
 */
export function genPlasmid(seedHash: string, _opts: PhylumOpts): PhylumGeometry {
  const r = seededRng(hashToBytes(seedHash), 0xb17f);
  const frame = makeFrame(r);
  const sides = 12 + Math.floor(r() * 5);
  const phase = r() * (TAU / sides);
  const outerRing: Vec3[] = [];
  const innerRing: Vec3[] = [];
  const segments: number[] = [];
  const nodes: NucNode[] = [node([0, 0, 0], 0.09, 0.9)];

  for (let i = 0; i < sides; i += 1) {
    const angle = phase + (i / sides) * TAU;
    const quantizedLayer = ((i % 4) - 1.5) * 0.055;
    outerRing.push(inFrame(frame, Math.cos(angle) * 0.68, quantizedLayer, Math.sin(angle) * 0.68));
    innerRing.push(inFrame(frame, Math.cos(angle) * 0.42, -quantizedLayer * 0.55, Math.sin(angle) * 0.42));
  }

  for (let i = 0; i < sides; i += 1) {
    const next = (i + 1) % sides;
    const bit = r();
    if (bit > 0.14) segment(segments, outerRing[i], outerRing[next]);
    if (bit < 0.88) segment(segments, innerRing[i], innerRing[next]);
    if (i % 3 === 0 || r() > 0.74) {
      segment(segments, innerRing[i], outerRing[i]);
      nodes.push(node(outerRing[i], 0.045));
    }
  }

  let outer = outerRing[0];
  for (const p of outerRing) if (len(p) > len(outer)) outer = p;
  return {
    segments,
    nodes,
    membraneR: null,
    landmarks: {
      core: [0, 0, 0],
      species: innerRing[1],
      membrane: outerRing[Math.floor(sides / 2)],
      outer,
    },
  };
}
