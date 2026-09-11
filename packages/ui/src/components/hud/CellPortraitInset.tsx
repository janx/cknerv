import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CELL_CARD_ACCENT, HUD_COLORS, rgba } from './hudTheme';
import { spatialPlateTail } from './primitives';
import { useReducedMotion } from './useReducedMotion';
import {
  CELL_PORTRAIT_INSET,
  cellPortraitScissorRect,
  type CellPortraitScissorRect,
  useCellPortraitRevision,
} from './cellPortraitInsetChannel';

const PORTRAIT_FOV_DEG = 40;
const PORTRAIT_CAMERA_Z = 3;
/** Camera-space depth of the backing plate; braid geometry stays within
 * ~1.1 units of the origin, well in front of it. */
const PLATE_DISTANCE = 11;

/** CSS `linear-gradient(100deg, …)` reproduced on a 2D canvas so the braid
 * keeps its dark directional plate now that it composites over the Galaxy
 * instead of over the card's DOM background. Exported for tests. */
export function drawPortraitPlateGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  accent: string,
): void {
  const theta = (100 * Math.PI) / 180;
  const dirX = Math.sin(theta);
  const dirY = -Math.cos(theta);
  const lineLength = Math.abs(width * dirX) + Math.abs(height * dirY);
  const cx = width / 2;
  const cy = height / 2;
  const gradient = ctx.createLinearGradient(
    cx - (dirX * lineLength) / 2,
    cy - (dirY * lineLength) / 2,
    cx + (dirX * lineLength) / 2,
    cy + (dirY * lineLength) / 2,
  );
  gradient.addColorStop(0, rgba(HUD_COLORS.stageGround, 0.985));
  gradient.addColorStop(0.72, rgba(HUD_COLORS.stageGround, 0.965));
  gradient.addColorStop(1, spatialPlateTail(accent));
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/** Plate plane size that fills the portrait frustum at PLATE_DISTANCE, with a
 * small overscan against edge seams. The square viewport keeps aspect ≈ 1. */
export function portraitPlateSize(fovDeg: number, distance: number): number {
  return 2 * distance * Math.tan((fovDeg * Math.PI) / 360) * 1.03;
}

function makePlateMaterial(): THREE.MeshBasicMaterial {
  const surface = document.createElement('canvas');
  surface.width = 256;
  surface.height = 256;
  const ctx = surface.getContext('2d');
  // The specimen column and the analysis column are two halves of ONE card,
  // eight pixels apart, and both tails are cut by `spatialPlateTail`. Painted
  // in the card's own accent for that reason alone: this plate wore cyan back
  // when the whole cell dialect did, and kept it through the rose rebind — so
  // the braid's tail dimmed toward teal-black beside a plum-black analysis
  // plate, which reads as two windows that happen to touch.
  if (ctx) drawPortraitPlateGradient(ctx, 256, 256, CELL_CARD_ACCENT);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

const SCRATCH_SIZE = new THREE.Vector2();
const SCRATCH_RECT: CellPortraitScissorRect = { x: 0, y: 0, width: 0, height: 0 };

type ConnectedOrbitControls = OrbitControls & {
  /** Three r169 installs this native listener on domElement.getRootNode(). */
  _interceptControlDown: EventListener;
  /** Installed temporarily while Control is held during a pointer gesture. */
  _interceptControlUp: EventListener;
};

/**
 * OrbitControls r169 looks up the event root again during dispose. Once React
 * has detached the portrait element, getRootNode() returns the element itself,
 * leaving its keydown listener (and a keyup listener while Control is held) on
 * the original document. Keep that root and remove the exact installed
 * listeners before Three performs its normal cleanup.
 */
export function disposePortraitOrbitControls(
  controls: OrbitControls,
  eventRoot: EventTarget,
): void {
  const connected = controls as ConnectedOrbitControls;
  eventRoot.removeEventListener(
    'keydown',
    connected._interceptControlDown,
    { capture: true },
  );
  eventRoot.removeEventListener(
    'keyup',
    connected._interceptControlUp,
    { capture: true },
  );
  controls.dispose();
}

/**
 * Renders the selected Cell's braid with the MAIN renderer: after the Galaxy
 * pass it scissors the portrait square and draws the braid scene through its
 * own camera — one WebGL context, shared program cache, no per-selection
 * context churn. Mount only while a Cell is selected: with no priority-1
 * subscriber R3F auto-renders and the closed-state pipeline is untouched.
 */
export default function CellPortraitInset({
  onInteractionChange,
}: {
  /** Owns pointer orbit inside the portrait square (locks Galaxy controls). */
  onInteractionChange?: (active: boolean) => void;
}) {
  useCellPortraitRevision();
  const element = CELL_PORTRAIT_INSET.element;
  const content = CELL_PORTRAIT_INSET.content;
  const reduced = useReducedMotion();
  const gl = useThree((state) => state.gl);
  const controlsRef = useRef<OrbitControls | null>(null);
  const braidScene = useMemo(() => new THREE.Scene(), []);
  const braidCamera = useMemo(() => {
    const camera = new THREE.PerspectiveCamera(PORTRAIT_FOV_DEG, 1, 0.1, 20);
    camera.position.set(0, 0, PORTRAIT_CAMERA_Z);
    return camera;
  }, []);
  const plateMaterial = useMemo(makePlateMaterial, []);
  const plateSize = portraitPlateSize(PORTRAIT_FOV_DEG, PLATE_DISTANCE);
  // The plate lives below a primitive camera. R3F deliberately leaves a
  // primitive's subtree alone on unmount, so this geometry has one explicit
  // owner just like the material below.
  const plateGeometry = useMemo(
    () => new THREE.PlaneGeometry(plateSize, plateSize),
    [plateSize],
  );
  // Injected portal size feeds LineMaterial.resolution and the Html labels;
  // it follows the measured square, which only changes on layout flips.
  const [portalSize, setPortalSize] = useState({ width: 260, height: 260 });

  useEffect(() => () => {
    plateGeometry.dispose();
    plateMaterial.map?.dispose();
    plateMaterial.dispose();
  }, [plateGeometry, plateMaterial]);

  useLayoutEffect(() => {
    if (!element) return;
    const eventRoot = element.getRootNode();
    const controls = new OrbitControls(braidCamera, element);
    controls.enableDamping = !reduced;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.rotateSpeed = 0.65;
    controls.target.set(0, 0, 0);
    const setDragging = (active: boolean) => {
      element.dataset.cellPortraitDragging = active ? 'true' : 'false';
      element.style.cursor = active ? 'grabbing' : 'grab';
      onInteractionChange?.(active);
    };
    const handleStart = () => setDragging(true);
    const handleEnd = () => setDragging(false);
    controls.addEventListener('start', handleStart);
    controls.addEventListener('end', handleEnd);
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener('start', handleStart);
      controls.removeEventListener('end', handleEnd);
      disposePortraitOrbitControls(controls, eventRoot);
      controlsRef.current = null;
      onInteractionChange?.(false);
    };
  }, [braidCamera, element, onInteractionChange, reduced]);

  // gl.info stays untouched here: RenderStatsSampler owns info accounting
  // (autoReset=false + per-window resets while sampling), and both passes
  // below accumulate into its window like any other multi-pass frame.
  useEffect(() => () => {
    gl.autoClear = true;
    gl.setScissorTest(false);
  }, [gl]);

  // The braid's programs compile asynchronously on mount so the FIRST
  // selection never blocks a frame on shader compilation — that lazy compile
  // was the dominant slice of the ~100ms first-select hitch. The braid pass
  // simply starts once its programs are ready (a few frames, under the scan
  // reveal); programs are cached per shader, so every later mount resolves
  // immediately.
  //
  // ONLY when the driver offers KHR_parallel_shader_compile: without it,
  // compileAsync degrades to one synchronous batch compile in a microtask —
  // measurably WORSE than the historical lazy spread (250ms vs 103ms on the
  // extension-less headless GLES stack) — so such drivers keep the old
  // first-render compile instead.
  const braidCompiledRef = useRef(false);
  useEffect(() => {
    if (!gl.extensions.has('KHR_parallel_shader_compile')) {
      braidCompiledRef.current = true;
      return undefined;
    }
    braidCompiledRef.current = false;
    let cancelled = false;
    // One frame lets the portal's children commit their materials first.
    const raf = requestAnimationFrame(() => {
      void gl.compileAsync(braidScene, braidCamera)
        .catch(() => undefined)
        .then(() => {
          if (!cancelled) braidCompiledRef.current = true;
        });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [gl, braidScene, braidCamera]);

  useFrame((state) => {
    const renderer = state.gl;
    renderer.autoClear = true;
    renderer.render(state.scene, state.camera);

    const inset = CELL_PORTRAIT_INSET;
    renderer.getSize(SCRATCH_SIZE);
    if (!cellPortraitScissorRect(
      inset.offset,
      inset.cardOriginValid,
      inset.cardOriginX,
      inset.cardOriginY,
      SCRATCH_SIZE.y,
      SCRATCH_RECT,
    )) return;
    controlsRef.current?.update();
    if (
      inset.offset
      && (inset.offset.width !== portalSize.width
        || inset.offset.height !== portalSize.height)
    ) {
      setPortalSize({
        width: inset.offset.width,
        height: inset.offset.height,
      });
    }
    const aspect = SCRATCH_RECT.width / SCRATCH_RECT.height;
    if (braidCamera.aspect !== aspect) {
      braidCamera.aspect = aspect;
      braidCamera.updateProjectionMatrix();
    }
    // Programs still compiling: keep the square empty for these few frames
    // instead of stalling the whole canvas on a synchronous compile.
    if (!braidCompiledRef.current) return;
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setScissor(
      SCRATCH_RECT.x,
      SCRATCH_RECT.y,
      SCRATCH_RECT.width,
      SCRATCH_RECT.height,
    );
    renderer.setViewport(
      SCRATCH_RECT.x,
      SCRATCH_RECT.y,
      SCRATCH_RECT.width,
      SCRATCH_RECT.height,
    );
    renderer.clearDepth();
    renderer.render(braidScene, braidCamera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, SCRATCH_SIZE.x, SCRATCH_SIZE.y);
    renderer.autoClear = true;
  }, 1);

  return createPortal(
    <>
      {/* Camera child: the plate stays screen-fixed under the braid while
          the user orbits, exactly like the DOM plate it replaces. */}
      <primitive object={braidCamera}>
        <mesh position={[0, 0, -PLATE_DISTANCE]} renderOrder={-10}>
          <primitive object={plateGeometry} attach="geometry" />
          <primitive object={plateMaterial} attach="material" />
        </mesh>
      </primitive>
      {content}
    </>,
    braidScene,
    {
      camera: braidCamera,
      size: {
        width: portalSize.width,
        height: portalSize.height,
        top: 0,
        left: 0,
      },
    },
  );
}
