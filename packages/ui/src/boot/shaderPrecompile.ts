import type { Camera, Object3D } from 'three';

/**
 * Hands the scene's shader programs to the driver while the readout still
 * holds the stage.
 *
 * A program is created and linked the first time something DRAWS with it, and
 * a cold browser session has no GPU shader cache to fall back on. So every
 * program whose object never draws during boot — the pools that sit at zero
 * count until an event fills them, the layers that carry nothing until a
 * route warms, the geometry that is behind the camera at the default
 * framing — links on the first frame that finally draws it. The visitor's
 * first camera drag reaches a batch of them at once, and that frame is
 * measured in seconds, once per browser session (an in-session reload is
 * clean: the GPU-process cache survives it, the page's own state does not).
 *
 * `WebGLRenderer.compile` walks with `traverse`, not `traverseVisible`, and
 * derives its program keys from object KIND, geometry attributes and
 * material alone — never from instance counts, draw ranges, or camera
 * layers. One call over the live scene therefore reaches every mounted
 * material whether or not it has ever been drawn, and nothing has to be
 * lifted into drawable form for it. What it cannot reach is what is not
 * mounted: the inspection overlays that exist only while something is
 * selected compile on their own first draw, as they always did.
 *
 * ONLY on drivers that offer KHR_parallel_shader_compile. Without it the
 * link happens on the calling thread and batching every program into one
 * call trades the first drag's stall for a worse one during boot — the same
 * measurement, and the same gate, as the portrait inset's braid compile. A
 * page on such a driver keeps the lazy spread.
 */

const PARALLEL_SHADER_COMPILE = 'KHR_parallel_shader_compile';

export type BootShaderPrecompileState =
  /** Never kicked — the renderer has not reported for duty yet. */
  | 'idle'
  /** Kicked on a driver with no parallel compile: nothing was issued. */
  | 'unsupported'
  /** Issued; the driver is linking. */
  | 'compiling'
  /** Every program the scene carried at the kick is linked. */
  | 'compiled'
  /** The renderer refused the call. Terminal like the rest: a boot compiles
   *  once or not at all, and a retry would land in the window this exists to
   *  keep clear. */
  | 'failed';

/** The renderer surface this needs, and no more — the rule stays testable
 *  without a GL context, which no test environment here has. */
export interface BootPrecompileRenderer {
  extensions: { has(name: string): boolean };
  compileAsync: (scene: Object3D, camera: Camera) => Promise<unknown>;
}

let state: BootShaderPrecompileState = 'idle';
let pending: ReturnType<typeof setTimeout> | null = null;

export function bootShaderPrecompileState(): BootShaderPrecompileState {
  return state;
}

/**
 * Compile once, off the frame loop.
 *
 * One-shot on the module, not on the caller: the sentinel that reports first
 * light is remounted by StrictMode and re-lights on the second mount, and a
 * second traverse would land in the same window the first is trying to keep
 * clear. Called from inside a frame callback, so the synchronous half —
 * the traverse and the shader-source assembly — is deferred out of it; only
 * the driver's link is genuinely parallel.
 */
export function kickBootShaderPrecompile(
  gl: BootPrecompileRenderer,
  scene: Object3D,
  camera: Camera,
): void {
  if (state !== 'idle') return;
  if (!gl.extensions.has(PARALLEL_SHADER_COMPILE)) {
    state = 'unsupported';
    return;
  }
  state = 'compiling';
  pending = setTimeout(() => {
    pending = null;
    let compiling: Promise<unknown>;
    try {
      compiling = gl.compileAsync(scene, camera);
    } catch {
      state = 'failed';
      return;
    }
    void compiling.then(
      () => { state = 'compiled'; },
      () => { state = 'failed'; },
    );
  }, 0);
}

/** A page boots once; only tests rewind. Drops a scheduled kick too — a timer
 *  surviving into the next test would compile against a torn-down fake. */
export function resetBootShaderPrecompileForTest(): void {
  if (pending !== null) {
    clearTimeout(pending);
    pending = null;
  }
  state = 'idle';
}
