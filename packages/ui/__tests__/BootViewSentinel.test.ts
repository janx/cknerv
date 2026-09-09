import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { getBootSequence, resetBootSequenceForTest } from '../src/boot/bootSequence';
import {
  installBootViewAfterRender,
  recordBootCellDraw,
} from '../src/boot/BootViewSentinel';

afterEach(() => {
  document.body.replaceChildren();
  resetBootSequenceForTest();
});

function renderArgs(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Parameters<THREE.Scene['onAfterRender']> {
  return [renderer, scene, camera, null as never, null as never, new THREE.Group()];
}

describe('completed-view presentation signal', () => {
  it('latches only an actual Cell body draw to the default framebuffer', () => {
    let renderTarget: object | null = {};
    const gl = { getRenderTarget: () => renderTarget } as THREE.WebGLRenderer;
    const ref = { current: false };
    const points = new THREE.Points();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.setDrawRange(0, 0);

    recordBootCellDraw(gl, points, geometry, ref);
    expect(ref.current).toBe(false);
    renderTarget = null;
    recordBootCellDraw(gl, points, geometry, ref);
    expect(ref.current).toBe(false);
    geometry.setDrawRange(0, 1);
    recordBootCellDraw(gl, points, geometry, ref);
    expect(ref.current).toBe(true);
  });

  it('ignores context creation and another canvas, then latches after this scene renders', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    let renderTarget: object | null = null;
    const gl = { domElement: canvas, getRenderTarget: () => renderTarget } as THREE.WebGLRenderer;
    const other = { domElement: document.createElement('canvas'), getRenderTarget: () => null } as THREE.WebGLRenderer;
    const previousThis: unknown[] = [];
    const previous = vi.fn(function (this: unknown) { previousThis.push(this); });
    scene.onAfterRender = previous;
    const contentDrawnRef = { current: false };
    const dispose = installBootViewAfterRender(scene, gl, camera, true, contentDrawnRef);

    expect(getBootSequence().viewPresented).toBe(false);
    scene.onAfterRender(...renderArgs(other, scene, camera));
    expect(getBootSequence().viewPresented).toBe(false);
    scene.onAfterRender(...renderArgs(gl, scene, new THREE.PerspectiveCamera()));
    expect(getBootSequence().viewPresented).toBe(false);
    renderTarget = {};
    scene.onAfterRender(...renderArgs(gl, scene, camera));
    expect(getBootSequence().viewPresented).toBe(false);
    renderTarget = null;
    scene.onAfterRender(...renderArgs(gl, scene, camera));
    expect(getBootSequence().viewPresented).toBe(false);
    contentDrawnRef.current = true;
    scene.onAfterRender(...renderArgs(gl, scene, camera));
    expect(getBootSequence().viewPresented).toBe(true);
    expect(getBootSequence().viewKind).toBe('populated');
    // The scene hook may run again, but the store and observer are one-shot.
    scene.onAfterRender(...renderArgs(gl, scene, camera));
    expect(previous).toHaveBeenCalledTimes(6);
    expect(previousThis.every((value) => value === scene)).toBe(true);
    dispose();
    expect(scene.onAfterRender).toBe(previous);
  });

  it('allows a rendered legal empty scene to hand off without an FPS gate', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const gl = { domElement: canvas, getRenderTarget: () => null } as THREE.WebGLRenderer;
    installBootViewAfterRender(scene, gl, camera, false);
    scene.onAfterRender(...renderArgs(gl, scene, camera));
    expect(getBootSequence()).toMatchObject({ viewPresented: true, viewKind: 'empty' });
  });
});
