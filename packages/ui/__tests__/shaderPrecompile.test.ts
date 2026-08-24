// The other half of `BootFrameSentinel`, tested where the frame loop is not:
// R3F callbacks cannot run under jsdom and no test environment here has a GL
// context, so the kick takes the narrowest renderer surface it can use.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
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
