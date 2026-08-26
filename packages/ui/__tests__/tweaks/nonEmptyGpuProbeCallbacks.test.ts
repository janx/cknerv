import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createNonEmptyInstanceGpuProbeCallbacks } from '../../src/tweaks/nonEmptyGpuProbeCallbacks';

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
