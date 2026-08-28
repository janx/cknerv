import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createNonEmptyDrawGpuProbeCallbacks,
  createNonEmptyInstanceGpuProbeCallbacks,
  drawSubmitsWork,
} from '../../src/tweaks/nonEmptyGpuProbeCallbacks';

function invokeCallbacks(
  callbacks: Pick<THREE.Object3D, 'onBeforeRender' | 'onAfterRender'>,
  geometry: THREE.InstancedBufferGeometry,
  material: THREE.Material,
): void {
  const renderer = {} as THREE.WebGLRenderer;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const group = new THREE.Group();
  callbacks.onBeforeRender(renderer, scene, camera, geometry, material, group);
  callbacks.onAfterRender(renderer, scene, camera, geometry, material, group);
}

describe('createNonEmptyInstanceGpuProbeCallbacks', () => {
  it('does not time an empty instanced pass but preserves object callbacks', () => {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.instanceCount = 0;
    const material = new THREE.MeshBasicMaterial();
    const object = new THREE.Mesh(geometry, material);
    const originalBefore = vi.fn();
    const originalAfter = vi.fn();
    const probeBefore = vi.fn();
    const probeAfter = vi.fn();
    object.onBeforeRender = originalBefore;
    object.onAfterRender = originalAfter;

    const callbacks = createNonEmptyInstanceGpuProbeCallbacks(object, {
      onBeforeRender: probeBefore,
      onAfterRender: probeAfter,
    });
    invokeCallbacks(callbacks, geometry, material);

    expect(originalBefore).toHaveBeenCalledOnce();
    expect(originalAfter).toHaveBeenCalledOnce();
    expect(probeBefore).not.toHaveBeenCalled();
    expect(probeAfter).not.toHaveBeenCalled();
  });

  it('times one populated draw with a paired scope in draw order', () => {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.instanceCount = 3;
    const material = new THREE.MeshBasicMaterial();
    const object = new THREE.Mesh(geometry, material);
    const order: string[] = [];
    object.onBeforeRender = () => { order.push('object-before'); };
    object.onAfterRender = () => { order.push('object-after'); };

    const callbacks = createNonEmptyInstanceGpuProbeCallbacks(object, {
      onBeforeRender: () => { order.push('probe-before'); },
      onAfterRender: () => { order.push('probe-after'); },
    });
    invokeCallbacks(callbacks, geometry, material);

    expect(order).toEqual([
      'object-before',
      'probe-before',
      'probe-after',
      'object-after',
    ]);
  });
});

describe('drawSubmitsWork', () => {
  const material = new THREE.MeshBasicMaterial();

  it('answers the three questions renderBufferDirect asks, in its order', () => {
    // An InstancedMesh draws `object.count` instances of whatever geometry.
    const positioned = new THREE.BufferGeometry();
    positioned.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    const instanced = new THREE.InstancedMesh(positioned, material, 8);
    instanced.count = 0;
    expect(drawSubmitsWork(instanced, positioned)).toBe(false);
    instanced.count = 3;
    expect(drawSubmitsWork(instanced, positioned)).toBe(true);

    // An InstancedBufferGeometry draws `instanceCount`.
    const instancedGeometry = new THREE.InstancedBufferGeometry();
    instancedGeometry.instanceCount = 0;
    expect(drawSubmitsWork(new THREE.Mesh(instancedGeometry, material), instancedGeometry)).toBe(false);
    instancedGeometry.instanceCount = 2;
    expect(drawSubmitsWork(undefined, instancedGeometry)).toBe(true);

    // Anything else draws its draw range over the vertices (or indices) it holds.
    const points = new THREE.Points(positioned, material);
    expect(drawSubmitsWork(points, positioned)).toBe(true);
    positioned.setDrawRange(0, 0);
    expect(drawSubmitsWork(points, positioned)).toBe(false);
    const empty = new THREE.BufferGeometry();
    expect(drawSubmitsWork(new THREE.LineSegments(empty, material), empty)).toBe(false);
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    indexed.setIndex(new THREE.BufferAttribute(new Uint16Array(0), 1));
    expect(drawSubmitsWork(undefined, indexed)).toBe(false);
    indexed.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    expect(drawSubmitsWork(undefined, indexed)).toBe(true);
  });
});

describe('createNonEmptyDrawGpuProbeCallbacks', () => {
  function invoke(
    callbacks: Pick<THREE.Object3D, 'onBeforeRender' | 'onAfterRender'>,
    object: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ): void {
    const renderer = {} as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    const group = new THREE.Group();
    // Three calls the hooks as the object's methods.
    callbacks.onBeforeRender.call(object, renderer, scene, camera, geometry, material, group);
    callbacks.onAfterRender.call(object, renderer, scene, camera, geometry, material, group);
  }

  it('times an instanced batch only while it has instances', () => {
    const material = new THREE.MeshBasicMaterial();
    const geometry = new THREE.PlaneGeometry(1, 1);
    const batch = new THREE.InstancedMesh(geometry, material, 16);
    const probeBefore = vi.fn();
    const probeAfter = vi.fn();
    const callbacks = createNonEmptyDrawGpuProbeCallbacks({
      onBeforeRender: probeBefore,
      onAfterRender: probeAfter,
    });
    batch.count = 0;
    invoke(callbacks, batch, geometry, material);
    expect(probeBefore).not.toHaveBeenCalled();
    expect(probeAfter).not.toHaveBeenCalled();
    batch.count = 5;
    invoke(callbacks, batch, geometry, material);
    expect(probeBefore).toHaveBeenCalledOnce();
    expect(probeAfter).toHaveBeenCalledOnce();
  });

  it('times a point pass only while its draw range is populated', () => {
    const material = new THREE.PointsMaterial();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30), 3));
    geometry.setDrawRange(0, 0);
    const points = new THREE.Points(geometry, material);
    const probeBefore = vi.fn();
    const probeAfter = vi.fn();
    const callbacks = createNonEmptyDrawGpuProbeCallbacks({
      onBeforeRender: probeBefore,
      onAfterRender: probeAfter,
    });
    invoke(callbacks, points, geometry, material);
    expect(probeBefore).not.toHaveBeenCalled();
    geometry.setDrawRange(0, 10);
    invoke(callbacks, points, geometry, material);
    expect(probeBefore).toHaveBeenCalledOnce();
    expect(probeAfter).toHaveBeenCalledOnce();
  });
});
