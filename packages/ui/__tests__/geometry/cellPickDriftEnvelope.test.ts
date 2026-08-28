import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CellPickDriftEnvelope } from '../../src/geometry/cellPickDriftEnvelope';
import { cellPickCameraDriftPx } from '../../src/components/CellGalaxy';

// ---------------------------------------------------------------------------
// The envelope claims a bound: no indexed disc moves or resizes by more than
// it says. That is checked the only way a bound can be — against the exact
// per-cell answer, over fields and camera moves it never saw while being
// derived. Poses are the app's: an orbit about a target, a dolly, a pan, the
// small tail/flight steps the picker actually rides, and free rotations.
// ---------------------------------------------------------------------------

const WIDTH = 1600;
const HEIGHT = 900;
const HALF_W = WIDTH * 0.5;
const HALF_H = HEIGHT * 0.5;

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Field {
  positions: Float64Array;
  radii: Float64Array;
  count: number;
}

/** A flattened disc of cells, like the galaxy, plus a few stragglers well
 *  above and below it so depth is not a function of screen position. */
function field(seed: number, count: number): Field {
  const rnd = lcg(seed);
  const positions = new Float64Array(count * 3);
  const radii = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd());
    const straggler = rnd() < 0.03;
    positions[i * 3] = Math.cos(angle) * r * 60;
    positions[i * 3 + 1] = straggler ? (rnd() - 0.5) * 80 : (rnd() - 0.5) * 10;
    positions[i * 3 + 2] = Math.sin(angle) * r * 54;
    // World-unit sprite size; px radius is this over depth, like the picker's.
    radii[i] = 0.6 + rnd() * 3;
  }
  return { positions, radii, count };
}

interface Projected {
  x: Float64Array;
  y: Float64Array;
  r: Float64Array;
  visible: Uint8Array;
}

function project(
  f: Field,
  camera: THREE.PerspectiveCamera,
  envelope?: CellPickDriftEnvelope,
): Projected {
  const out: Projected = {
    x: new Float64Array(f.count),
    y: new Float64Array(f.count),
    r: new Float64Array(f.count),
    visible: new Uint8Array(f.count),
  };
  const view = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const projectionScaleY = camera.projectionMatrix.elements[5];
  for (let i = 0; i < f.count; i += 1) {
    view.set(f.positions[i * 3], f.positions[i * 3 + 1], f.positions[i * 3 + 2])
      .applyMatrix4(camera.matrixWorldInverse);
    const viewZ = -view.z;
    if (viewZ <= 0) continue;
    ndc.copy(view).applyMatrix4(camera.projectionMatrix);
    if (ndc.z < -1 || ndc.z > 1) continue;
    const sx = (ndc.x + 1) * HALF_W;
    const sy = (1 - ndc.y) * HALF_H;
    const radius = (f.radii[i] * projectionScaleY * HALF_H) / viewZ;
    // The same admission the hit index applies: on screen within its radius.
    if (sx + radius < 0 || sx - radius > WIDTH || sy + radius < 0 || sy - radius > HEIGHT) continue;
    out.x[i] = sx;
    out.y[i] = sy;
    out.r[i] = radius;
    out.visible[i] = 1;
    envelope?.include(view.x, view.y, viewZ);
  }
  return out;
}

/** Exact worst case over the indexed cells: centre displacement plus radius
 *  change, the quantity the envelope claims to bound. */
function exactDrift(indexed: Projected, live: Projected): number {
  let worst = 0;
  for (let i = 0; i < indexed.visible.length; i += 1) {
    if (!indexed.visible[i]) continue;
    // A cell that left the frustum entirely is not measured: the index's
    // contract has always been about the entries it holds.
    if (!live.visible[i]) continue;
    const drift = Math.hypot(indexed.x[i] - live.x[i], indexed.y[i] - live.y[i])
      + Math.abs(indexed.r[i] - live.r[i]);
    if (drift > worst) worst = drift;
  }
  return worst;
}

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 1, 3000);
  camera.position.set(110, 108, 110);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

type Move = (camera: THREE.PerspectiveCamera, rnd: () => number) => void;

const target = new THREE.Vector3(0, 0, 0);

/** Orbit about the target by small angles, the damping tail's motion. */
const orbit = (scale: number): Move => (camera, rnd) => {
  const spherical = new THREE.Spherical().setFromVector3(
    camera.position.clone().sub(target),
  );
  spherical.theta += (rnd() - 0.5) * scale;
  spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi + (rnd() - 0.5) * scale));
  camera.position.setFromSpherical(spherical).add(target);
  camera.lookAt(target);
};
const dolly = (scale: number): Move => (camera, rnd) => {
  const offset = camera.position.clone().sub(target);
  offset.multiplyScalar(1 + (rnd() - 0.5) * scale);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
};
const pan = (scale: number): Move => (camera, rnd) => {
  const shift = new THREE.Vector3((rnd() - 0.5) * scale, (rnd() - 0.5) * scale, (rnd() - 0.5) * scale);
  camera.position.add(shift);
  target.add(shift);
  camera.lookAt(target);
  target.set(0, 0, 0);
};
const freeRotate = (scale: number): Move => (camera, rnd) => {
  camera.rotateX((rnd() - 0.5) * scale);
  camera.rotateY((rnd() - 0.5) * scale);
  camera.rotateZ((rnd() - 0.5) * scale);
};
const flightStep = (): Move => (camera, rnd) => {
  // One exponential-lerp frame toward a pose tens of units away.
  const alpha = 1 - Math.exp(-6.5 / 60);
  const goal = camera.position.clone().add(
    new THREE.Vector3((rnd() - 0.5) * 80, (rnd() - 0.5) * 60, (rnd() - 0.5) * 80),
  );
  camera.position.lerp(goal, alpha);
  camera.lookAt(target);
};

const MOVES: Array<[string, Move]> = [
  ['orbit 0.002', orbit(0.002)],
  ['orbit 0.02', orbit(0.02)],
  ['orbit 0.2', orbit(0.2)],
  ['dolly 1%', dolly(0.02)],
  ['dolly 10%', dolly(0.2)],
  ['pan 0.5', pan(0.5)],
  ['pan 5', pan(5)],
  ['free 0.005', freeRotate(0.005)],
  ['free 0.05', freeRotate(0.05)],
  ['flight step', flightStep()],
];

interface Trial {
  move: string;
  exact: number;
  envelope: number;
  analytic: number;
}

function runTrials(seed: number, cellCount: number, perMove: number): Trial[] {
  const rnd = lcg(seed);
  const f = field(seed, cellCount);
  const trials: Trial[] = [];
  const viewDelta = new THREE.Matrix4();
  for (const [name, move] of MOVES) {
    for (let k = 0; k < perMove; k += 1) {
      const indexedCamera = makeCamera();
      // Start each trial from a different pose so the field is seen from
      // many sides, not one.
      orbit(3)(indexedCamera, rnd);
      dolly(0.6)(indexedCamera, rnd);
      indexedCamera.updateMatrixWorld(true);
      const envelope = new CellPickDriftEnvelope();
      const indexed = project(f, indexedCamera, envelope);
      if (envelope.empty) continue;

      const liveCamera = indexedCamera.clone();
      move(liveCamera, rnd);
      liveCamera.updateMatrixWorld(true);
      const live = project(f, liveCamera);

      viewDelta.multiplyMatrices(liveCamera.matrixWorldInverse, indexedCamera.matrixWorld);
      let maxRadius = 0;
      for (let i = 0; i < f.count; i += 1) {
        if (indexed.visible[i] && indexed.r[i] > maxRadius) maxRadius = indexed.r[i];
      }
      const projection = liveCamera.projectionMatrix.elements;
      const bound = envelope.driftPx(
        viewDelta,
        HALF_W * projection[0],
        HALF_H * projection[5],
        maxRadius,
      );
      // The analytic bound the envelope replaces, for the tightness record.
      const fromQ = new THREE.Quaternion();
      const toQ = new THREE.Quaternion();
      const scratch = new THREE.Vector3();
      indexedCamera.matrixWorld.decompose(scratch, fromQ, scratch);
      liveCamera.matrixWorld.decompose(scratch, toQ, scratch);
      let minViewZ = Infinity;
      const view = new THREE.Vector3();
      for (let i = 0; i < f.count; i += 1) {
        if (!indexed.visible[i]) continue;
        view.set(f.positions[i * 3], f.positions[i * 3 + 1], f.positions[i * 3 + 2])
          .applyMatrix4(indexedCamera.matrixWorldInverse);
        minViewZ = Math.min(minViewZ, -view.z);
      }
      const analytic = cellPickCameraDriftPx(
        fromQ.angleTo(toQ),
        indexedCamera.position.distanceTo(liveCamera.position),
        projection[5],
        HALF_W,
        HALF_H,
        minViewZ,
      );
      trials.push({ move: name, exact: exactDrift(indexed, live), envelope: bound, analytic });
    }
  }
  return trials;
}

describe('CellPickDriftEnvelope', () => {
  it('never reports less drift than the worst indexed disc actually had', () => {
    // Soundness is the whole contract: an admitted stale index aims hover at
    // the previous pose. Random fields, random poses, every motion family.
    let trials = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const trial of runTrials(seed, 1500, 6)) {
        trials += 1;
        expect(
          trial.envelope,
          `${trial.move}: exact ${trial.exact}px, envelope ${trial.envelope}px`,
        ).toBeGreaterThanOrEqual(trial.exact);
      }
    }
    expect(trials).toBeGreaterThan(300);
  });

  it('admits sub-budget motion the analytic bound rejected, and stays sound', () => {
    // The tightness that pays: for the small steps a damping tail and a route
    // flight produce, the box bound sits within a few × of the exact drift
    // while the viewport-corner bound sits an order of magnitude above it.
    const trials = runTrials(11, 2000, 10).filter((t) => t.exact > 0.01);
    const small = trials.filter((t) => t.exact < 1.5);
    expect(small.length).toBeGreaterThan(20);
    const envelopeRatio = median(small.map((t) => t.envelope / t.exact));
    const analyticRatio = median(small.map((t) => t.analytic / t.exact));
    expect(envelopeRatio).toBeLessThan(3);
    expect(analyticRatio).toBeGreaterThan(envelopeRatio * 2);
    // Every one of them, not just the median.
    for (const t of small) expect(t.envelope).toBeGreaterThanOrEqual(t.exact);
  });

  it('answers a rest pose with zero and a pose reaching the box with infinity', () => {
    const envelope = new CellPickDriftEnvelope();
    expect(envelope.empty).toBe(true);
    expect(envelope.driftPx(new THREE.Matrix4(), 1000, 1000, 10)).toBe(Infinity);
    envelope.include(1, 0.5, 10);
    envelope.include(-2, -1, 40);
    envelope.include(0.3, 0.1, 200);
    expect(envelope.empty).toBe(false);
    expect(envelope.driftPx(new THREE.Matrix4(), 1000, 1000, 10)).toBe(0);
    // Behind-camera input is ignored, not absorbed into the box.
    envelope.include(5, 5, -3);
    expect(envelope.minW).toBeCloseTo(1 / 200, 12);
    // A dolly that reaches the nearest entry (10 units) puts the box at the
    // camera plane: unbounded, so the caller rebuilds.
    const through = new THREE.Matrix4().makeTranslation(0, 0, 10);
    expect(envelope.driftPx(through, 1000, 1000, 10)).toBe(Infinity);
    // Half-way there is finite but large.
    const halfWay = new THREE.Matrix4().makeTranslation(0, 0, 5);
    expect(envelope.driftPx(halfWay, 1000, 1000, 10)).toBeGreaterThan(100);
    expect(Number.isFinite(envelope.driftPx(halfWay, 1000, 1000, 10))).toBe(true);
    envelope.reset();
    expect(envelope.empty).toBe(true);
  });

  it('is what five re-projected sentinel cells are not: a bound', () => {
    // The alternative the envelope replaced — measure the drift of the
    // nearest cell and the four screen-extreme cells and call that the field's
    // worst case. For an orbit the worst cell combines a large offset with a
    // large depth, and is routinely none of the five. Count the trials where
    // the five say "under budget" while a cell has actually drifted past it.
    const budget = 1.5;
    let unsound = 0;
    let trials = 0;
    const rnd = lcg(99);
    for (const seed of [21, 22, 23, 24]) {
      const f = field(seed, 2000);
      for (let k = 0; k < 60; k += 1) {
        const indexedCamera = makeCamera();
        orbit(3)(indexedCamera, rnd);
        dolly(0.6)(indexedCamera, rnd);
        indexedCamera.updateMatrixWorld(true);
        const envelope = new CellPickDriftEnvelope();
        const indexed = project(f, indexedCamera, envelope);
        const liveCamera = indexedCamera.clone();
        orbit(0.015)(liveCamera, rnd);
        liveCamera.updateMatrixWorld(true);
        const live = project(f, liveCamera);
        const exact = exactDrift(indexed, live);
        if (!(exact > budget)) continue;
        trials += 1;
        // The five sentinels.
        let nearest = -1;
        let minX = -1;
        let maxX = -1;
        let minY = -1;
        let maxY = -1;
        let nearestZ = Infinity;
        const view = new THREE.Vector3();
        for (let i = 0; i < f.count; i += 1) {
          if (!indexed.visible[i]) continue;
          view.set(f.positions[i * 3], f.positions[i * 3 + 1], f.positions[i * 3 + 2])
            .applyMatrix4(indexedCamera.matrixWorldInverse);
          if (-view.z < nearestZ) { nearestZ = -view.z; nearest = i; }
          if (minX < 0 || indexed.x[i] < indexed.x[minX]) minX = i;
          if (maxX < 0 || indexed.x[i] > indexed.x[maxX]) maxX = i;
          if (minY < 0 || indexed.y[i] < indexed.y[minY]) minY = i;
          if (maxY < 0 || indexed.y[i] > indexed.y[maxY]) maxY = i;
        }
        let sentinelDrift = 0;
        for (const i of [nearest, minX, maxX, minY, maxY]) {
          if (i < 0 || !live.visible[i]) continue;
          sentinelDrift = Math.max(
            sentinelDrift,
            Math.hypot(indexed.x[i] - live.x[i], indexed.y[i] - live.y[i])
              + Math.abs(indexed.r[i] - live.r[i]),
          );
        }
        if (sentinelDrift <= budget) unsound += 1;
        // …while the envelope, on the same trial, never does this.
        const viewDelta = new THREE.Matrix4()
          .multiplyMatrices(liveCamera.matrixWorldInverse, indexedCamera.matrixWorld);
        let maxRadius = 0;
        for (let i = 0; i < f.count; i += 1) {
          if (indexed.visible[i] && indexed.r[i] > maxRadius) maxRadius = indexed.r[i];
        }
        const projection = liveCamera.projectionMatrix.elements;
        expect(envelope.driftPx(
          viewDelta, HALF_W * projection[0], HALF_H * projection[5], maxRadius,
        )).toBeGreaterThan(budget);
      }
    }
    expect(trials).toBeGreaterThan(30);
    expect(unsound).toBeGreaterThan(0);
  });
});

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}
