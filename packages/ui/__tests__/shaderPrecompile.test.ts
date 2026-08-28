// The other half of `BootFrameSentinel`, tested where the frame loop is not:
// R3F callbacks cannot run under jsdom and no test environment here has a GL
// context, so the kick takes the narrowest renderer surface it can use.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mesh, PerspectiveCamera, Points, Scene } from 'three';
import {
  bootShaderPrecompileState,
  kickBootShaderPrecompile,
  resetBootShaderPrecompileForTest,
  type BootPrecompileRenderer,
} from '../src/boot/shaderPrecompile';

const scene = new Scene();
const camera = new PerspectiveCamera();

interface FakeRenderer extends BootPrecompileRenderer {
  calls: { scene: unknown; camera: unknown }[];
  settle: () => void;
  reject: () => void;
}

/** A renderer that records what it was asked to compile and hands back a
 *  promise the test decides the fate of. */
function fakeRenderer(options: {
  parallel?: boolean;
  throws?: boolean;
} = {}): FakeRenderer {
  const { parallel = true, throws = false } = options;
  let settle: () => void = () => {};
  let reject: () => void = () => {};
  const calls: { scene: unknown; camera: unknown }[] = [];
  return {
    calls,
    settle: () => settle(),
    reject: () => reject(),
    extensions: {
      has: (name: string) => parallel && name === 'KHR_parallel_shader_compile',
    },
    compileAsync: (compiledScene, compiledCamera) => {
      calls.push({ scene: compiledScene, camera: compiledCamera });
      if (throws) throw new Error('no context');
      return new Promise<void>((resolve, rejectPromise) => {
        settle = () => resolve();
        reject = () => rejectPromise(new Error('link failed'));
      });
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetBootShaderPrecompileForTest();
});

afterEach(() => {
  resetBootShaderPrecompileForTest();
  vi.useRealTimers();
});

describe('boot shader precompile — the kick', () => {
  it('issues nothing inside the calling frame', () => {
    const gl = fakeRenderer();

    kickBootShaderPrecompile(gl, scene, camera);
    // The traverse and the shader-source assembly are ordinary main-thread
    // JS; the frame that reports first light must not pay for them.
    expect(gl.calls).toHaveLength(0);
    expect(bootShaderPrecompileState()).toBe('compiling');

    vi.runAllTimers();
    expect(gl.calls).toEqual([{ scene, camera }]);
  });

  it('reports compiled once the driver finishes linking', async () => {
    const gl = fakeRenderer();

    kickBootShaderPrecompile(gl, scene, camera);
    vi.runAllTimers();
    expect(bootShaderPrecompileState()).toBe('compiling');

    gl.settle();
    await vi.waitFor(() => {
      expect(bootShaderPrecompileState()).toBe('compiled');
    });
  });
});

describe('boot shader precompile — one shot', () => {
  it('ignores a second kick while the first is still linking', () => {
    const gl = fakeRenderer();

    kickBootShaderPrecompile(gl, scene, camera);
    // StrictMode remounts the sentinel, which re-lights on its second mount.
    kickBootShaderPrecompile(gl, scene, camera);
    vi.runAllTimers();

    expect(gl.calls).toHaveLength(1);
  });

  it('ignores a second kick after the first finished', async () => {
    const gl = fakeRenderer();

    kickBootShaderPrecompile(gl, scene, camera);
    vi.runAllTimers();
    gl.settle();
    await vi.waitFor(() => {
      expect(bootShaderPrecompileState()).toBe('compiled');
    });

    kickBootShaderPrecompile(gl, scene, camera);
    vi.runAllTimers();
    expect(gl.calls).toHaveLength(1);
    expect(bootShaderPrecompileState()).toBe('compiled');
  });

  it('ignores a second kick from a different renderer', () => {
    const first = fakeRenderer();
    const second = fakeRenderer();

    kickBootShaderPrecompile(first, scene, camera);
    kickBootShaderPrecompile(second, scene, camera);
    vi.runAllTimers();

    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
  });
});

describe('boot shader precompile — drivers that cannot do it', () => {
  it('issues nothing without parallel shader compile', () => {
    const gl = fakeRenderer({ parallel: false });

    kickBootShaderPrecompile(gl, scene, camera);
    vi.runAllTimers();

    // Batching every program into one blocking link is worse than the lazy
    // spread it would replace, so such a page keeps the spread.
    expect(gl.calls).toHaveLength(0);
    expect(bootShaderPrecompileState()).toBe('unsupported');
  });

  it('stays skipped for the session — no later kick retries', () => {
    const soft = fakeRenderer({ parallel: false });
    const parallel = fakeRenderer();

    kickBootShaderPrecompile(soft, scene, camera);
    kickBootShaderPrecompile(parallel, scene, camera);
    vi.runAllTimers();

    expect(parallel.calls).toHaveLength(0);
    expect(bootShaderPrecompileState()).toBe('unsupported');
  });

  it('survives a renderer that throws on the call', () => {
    const gl = fakeRenderer({ throws: true });

    kickBootShaderPrecompile(gl, scene, camera);
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(bootShaderPrecompileState()).toBe('failed');
  });

  it('survives a link that rejects, and does not retry', async () => {
    const gl = fakeRenderer();

    kickBootShaderPrecompile(gl, scene, camera);
    vi.runAllTimers();
    gl.reject();
    await vi.waitFor(() => {
      expect(bootShaderPrecompileState()).toBe('failed');
    });

    kickBootShaderPrecompile(gl, scene, camera);
    vi.runAllTimers();
    expect(gl.calls).toHaveLength(1);
  });
});

describe('boot shader precompile — what the compile walk reaches', () => {
  // The zero-count pools (fabric layers, flare, near-identity braids) flip
  // `visible = false` while they hold nothing. The precompile must still
  // link them, and the render walk must still skip them: both are facts
  // about three's source, pinned here against the installed version so an
  // upgrade re-asks the question.
  const require = createRequire(import.meta.url);
  // `three` exports no package.json subpath; its main entry sits one level
  // below the package root (`build/three.cjs`).
  const threeRoot = join(dirname(require.resolve('three')), '..');
  const rendererSource = readFileSync(
    join(threeRoot, 'src/renderers/WebGLRenderer.js'),
    'utf8',
  );
  const threeVersion = (
    JSON.parse(readFileSync(join(threeRoot, 'package.json'), 'utf8')) as { version: string }
  ).version;

  it('three r169: compile walks with traverse; the render walk drops invisible objects first', () => {
    expect(threeVersion).toBe('0.169.0');
    const compile = rendererSource.slice(
      rendererSource.indexOf('this.compile = function'),
      rendererSource.indexOf('this.compileAsync = function'),
    );
    // The material walk (not the light gather, which is `traverseVisible`).
    expect(compile).toContain('scene.traverse( function ( object ) {');
    expect(compile).toContain('if ( ! ( object.isMesh || object.isPoints || object.isLine || object.isSprite ) )');
    expect(compile).not.toContain('object.visible');
    const project = rendererSource.slice(
      rendererSource.indexOf('function projectObject('),
      rendererSource.indexOf('function renderScene('),
    );
    expect(project.indexOf('if ( object.visible === false ) return;')).toBeGreaterThan(-1);
    // …and the before-render hook runs only from renderObject, which only
    // the render list reaches.
    const renderObject = rendererSource.slice(
      rendererSource.indexOf('function renderObject('),
      rendererSource.indexOf('function getProgram('),
    );
    expect(renderObject).toContain('object.onBeforeRender( _this, scene, camera, geometry, material, group );');
    expect(rendererSource.match(/object\.onBeforeRender\(/g)).toHaveLength(1);
  });

  it('a hidden pool is on the compile walk and off the render walk', () => {
    const root = new Scene();
    const hiddenMesh = new Mesh();
    hiddenMesh.visible = false;
    const hiddenPoints = new Points();
    hiddenPoints.visible = false;
    const shown = new Points();
    root.add(hiddenMesh, hiddenPoints, shown);
    const compiled: unknown[] = [];
    root.traverse((object) => { compiled.push(object); });
    const rendered: unknown[] = [];
    root.traverseVisible((object) => { rendered.push(object); });
    expect(compiled).toEqual(expect.arrayContaining([hiddenMesh, hiddenPoints, shown]));
    expect(rendered).toContain(shown);
    expect(rendered).not.toContain(hiddenMesh);
    expect(rendered).not.toContain(hiddenPoints);
  });
});

describe('boot shader precompile — test rewind', () => {
  it('drops a kick that was scheduled but never ran', () => {
    const gl = fakeRenderer();

    kickBootShaderPrecompile(gl, scene, camera);
    resetBootShaderPrecompileForTest();
    vi.runAllTimers();

    expect(gl.calls).toHaveLength(0);
    expect(bootShaderPrecompileState()).toBe('idle');
  });
});
