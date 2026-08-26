import type * as THREE from 'three';

export interface GpuDrawProbeCallbacks {
  onBeforeRender(): void;
  onAfterRender(): void;
}

/**
 * Compose a draw probe with an instanced object's existing render callbacks.
 *
 * Three invokes object callbacks even when an instanced geometry has no
 * instances to submit on some renderer versions. Starting a timer query in
 * that case would mix empty submissions into the pass percentile. The
 * object's original callbacks still run for every invocation: LineSegments2
 * uses its before hook to keep screen-space material uniforms in sync.
 */
export function createNonEmptyInstanceGpuProbeCallbacks(
  object: THREE.Object3D,
  probe: GpuDrawProbeCallbacks,
): Pick<THREE.Object3D, 'onBeforeRender' | 'onAfterRender'> {
  const originalBefore = object.onBeforeRender.bind(object);
  const originalAfter = object.onAfterRender.bind(object);
  let measuring = false;

  return {
    onBeforeRender(renderer, scene, camera, geometry, material, group) {
      originalBefore(renderer, scene, camera, geometry, material, group);
      const instanceCount = (geometry as THREE.InstancedBufferGeometry)
        .instanceCount;
      measuring = typeof instanceCount === 'number' && instanceCount > 0;
      if (measuring) probe.onBeforeRender();
    },
    onAfterRender(renderer, scene, camera, geometry, material, group) {
      if (measuring) probe.onAfterRender();
      measuring = false;
      originalAfter(renderer, scene, camera, geometry, material, group);
    },
  };
}
