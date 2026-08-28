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

/**
 * Whether the draw three is about to issue can produce a fragment at all —
 * the same three questions `renderBufferDirect` answers before its own
 * zero-count early-out, in the same order: an `InstancedMesh` draws
 * `object.count` instances, an `InstancedBufferGeometry` draws
 * `instanceCount`, and anything else draws its draw range over the vertices
 * (or indices) it actually holds. `object` is the `this` three calls the
 * hooks with; a caller without one (a bare invocation) is answered from the
 * geometry alone.
 */
export function drawSubmitsWork(
  object: unknown,
  geometry: THREE.BufferGeometry,
): boolean {
  const instanced = object as
    | { isInstancedMesh?: boolean; count?: number }
    | null
    | undefined;
  if (instanced && instanced.isInstancedMesh === true) {
    return typeof instanced.count === 'number' && instanced.count > 0;
  }
  const instancedGeometry = geometry as THREE.InstancedBufferGeometry;
  if (instancedGeometry.isInstancedBufferGeometry === true) {
    return instancedGeometry.instanceCount > 0;
  }
  if (!(geometry.drawRange.count > 0)) return false;
  const index = geometry.index;
  const vertices = index !== null
    ? index.count
    : (geometry.attributes.position?.count ?? 0);
  return vertices > 0;
}

/**
 * A draw probe for an object whose callbacks are otherwise the defaults —
 * the JSX-built points, lines and instanced meshes — that skips the timer
 * whenever the draw would submit nothing. Three calls the hooks as the
 * object's methods, so the instance count is read off `this`; the plain
 * `<points>` passes read their draw range off the geometry the hook is
 * handed. Disabled, this is one count read and one boolean gate per draw.
 */
export function createNonEmptyDrawGpuProbeCallbacks(
  probe: GpuDrawProbeCallbacks,
): Pick<THREE.Object3D, 'onBeforeRender' | 'onAfterRender'> {
  let measuring = false;

  return {
    onBeforeRender(
      this: unknown,
      _renderer,
      _scene,
      _camera,
      geometry,
    ) {
      measuring = drawSubmitsWork(this, geometry);
      if (measuring) probe.onBeforeRender();
    },
    onAfterRender() {
      if (measuring) probe.onAfterRender();
      measuring = false;
    },
  };
}
