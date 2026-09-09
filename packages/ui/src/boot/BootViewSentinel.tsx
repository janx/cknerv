import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { BufferGeometry, Camera, Object3D, Scene, WebGLRenderer } from 'three';
import { markBootViewPresented } from './bootSequence';
import { drawSubmitsWork } from '../tweaks/nonEmptyGpuProbeCallbacks';

/** Latch proof from the Cell body pass itself, and only for the default
 * framebuffer. The scene observer consumes this after Three finishes the
 * same render. */
export function recordBootCellDraw(
  renderer: WebGLRenderer,
  object: Object3D,
  geometry: BufferGeometry,
  contentDrawnRef?: { current: boolean },
): void {
  if (
    contentDrawnRef
    && !contentDrawnRef.current
    && renderer.getRenderTarget() === null
    && drawSubmitsWork(object, geometry)
  ) contentDrawnRef.current = true;
}

/** Legal DOM-only empty views have no Canvas draw to observe. A layout effect
 * proves their empty-state DOM has committed before handing off the shell. */
export function BootEmptyViewSentinel(): null {
  useLayoutEffect(() => { markBootViewPresented('empty'); }, []);
  return null;
}

export function installBootViewAfterRender(
  scene: Scene,
  gl: WebGLRenderer,
  camera: Camera,
  populated: boolean,
  contentDrawnRef?: { readonly current: boolean },
): () => void {
  const previous = scene.onAfterRender;
  let reported = false;
  const afterRender: typeof scene.onAfterRender = (...args) => {
    previous?.apply(scene, args);
    const [renderer, renderedScene, renderedCamera] = args;
    if (reported) return;
    if (renderer !== gl || renderedScene !== scene || renderedCamera !== camera) return;
    if (!gl.domElement.isConnected) return;
    if (gl.getRenderTarget() !== null) return;
    if (populated && contentDrawnRef && !contentDrawnRef.current) return;
    reported = true;
    markBootViewPresented(populated ? 'populated' : 'empty');
  };
  scene.onAfterRender = afterRender;
  return () => {
    if (scene.onAfterRender === afterRender) scene.onAfterRender = previous;
  };
}

/**
 * Reports the first completed render of the Canvas that mounted this sentinel.
 * Three invokes Scene.onAfterRender after all scene objects have drawn, unlike
 * Canvas.onCreated and useFrame callbacks, which both run before presentation.
 */
export default function BootViewSentinel({ populated, contentDrawnRef }: {
  populated: boolean;
  contentDrawnRef?: { readonly current: boolean };
}): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    // Bind the proof to this R3F root's main scene, camera and drawing
    // surface. A portal/scissor render or another Canvas cannot satisfy it.
    return installBootViewAfterRender(scene, gl, camera, populated, contentDrawnRef);
  }, [camera, contentDrawnRef, gl, populated, scene]);

  return null;
}
