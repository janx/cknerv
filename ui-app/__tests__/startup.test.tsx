import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBootSequence, resetBootSequenceForTest } from '@cknerv/ui/boot';
import type { CellGalaxySnapshot, ChainEntry } from '@cknerv/types';
import { bootstrap, type StartupDependencies } from '../src/startup';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const chainResponse = {
  revision: 3,
  chain: {} as ChainEntry,
  chain_nodes: [],
  peers: [],
};
const cellsResponse = {
  revision: 4,
  snapshot: {} as CellGalaxySnapshot,
};

function baseDependencies(events: string[]): StartupDependencies {
  return {
    fetchChain: vi.fn(async () => { events.push('fetch-chain'); return chainResponse; }),
    fetchCells: vi.fn(async () => { events.push('fetch-cells'); return cellsResponse; }),
    loadView: vi.fn(async () => {
      events.push('load-view');
      return { kind: 'app' as const, Component: () => null };
    }),
    loadReactDom: vi.fn(async () => {
      events.push('load-react-dom');
      return {
        createRoot: () => ({ render: () => { events.push('render'); } }),
      };
    }),
    loadCellField: vi.fn(async () => {
      events.push('load-cell-field');
      return { installCellFieldHook: () => { events.push('install-cell-field'); } };
    }),
    loadDiagnostics: vi.fn(async () => {
      events.push('load-diagnostics');
      return { installPulseStatsHook: () => { events.push('install-diagnostics'); } };
    }),
    now: () => 10,
    search: '',
    root: () => document.createElement('div'),
  };
}

beforeEach(() => {
  resetBootSequenceForTest();
});

describe('startup module and snapshot handoff', () => {
  it('starts both requests before loaders and waits for every dependency before render', async () => {
    const events: string[] = [];
    const chain = deferred<typeof chainResponse>();
    const cells = deferred<typeof cellsResponse>();
    const view = deferred<{ kind: 'app'; Component: React.ComponentType<never> }>();
    const reactDom = deferred<Awaited<ReturnType<StartupDependencies['loadReactDom']>>>();
    const dependencies = baseDependencies(events);
    dependencies.fetchChain = vi.fn(() => { events.push('fetch-chain'); return chain.promise; });
    dependencies.fetchCells = vi.fn(() => { events.push('fetch-cells'); return cells.promise; });
    dependencies.loadView = vi.fn(() => {
      events.push('load-view');
      return view.promise as ReturnType<StartupDependencies['loadView']>;
    });
    dependencies.loadReactDom = vi.fn(() => {
      events.push('load-react-dom');
      return reactDom.promise;
    });

    const boot = bootstrap(dependencies);
    expect(events.slice(0, 2)).toEqual(['fetch-chain', 'fetch-cells']);
    expect(events).not.toContain('render');
    chain.resolve(chainResponse);
    cells.resolve(cellsResponse);
    await Promise.resolve();
    expect(events).not.toContain('render');
    view.resolve({ kind: 'app', Component: () => null });
    reactDom.resolve({ createRoot: () => ({ render: () => { events.push('render'); } }) });
    await boot;

    expect(events.indexOf('install-cell-field')).toBeLessThan(events.indexOf('render'));
    expect(events.indexOf('install-diagnostics')).toBeLessThan(events.indexOf('render'));
    expect(getBootSequence().modules?.every((module) => module.state === 'ready')).toBe(true);
  });

  it('records a rejected view chunk separately and never creates a root', async () => {
    const events: string[] = [];
    const dependencies = baseDependencies(events);
    dependencies.loadView = vi.fn(async () => { throw new Error('view chunk unavailable'); });

    await expect(bootstrap(dependencies)).rejects.toThrow('view chunk unavailable');
    expect(events).not.toContain('render');
    expect(getBootSequence().modules?.find((module) => module.id === 'view')).toMatchObject({
      state: 'failed',
      detail: 'view chunk unavailable',
    });
  });

  it('installs diagnostics after a snapshot failure', async () => {
    const events: string[] = [];
    const diagnostics = deferred<{ installPulseStatsHook(): void }>();
    const dependencies = baseDependencies(events);
    dependencies.fetchCells = vi.fn(async () => { throw new Error('cells unavailable'); });
    dependencies.loadDiagnostics = vi.fn(() => diagnostics.promise);

    const boot = bootstrap(dependencies);
    await expect(boot).rejects.toThrow('cells unavailable');
    diagnostics.resolve({ installPulseStatsHook: () => { events.push('install-diagnostics'); } });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toContain('install-diagnostics');
    expect(getBootSequence().modules?.find((module) => module.id === 'diagnostics')?.state)
      .toBe('ready');
  });
});
