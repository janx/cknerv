import React from 'react';
import type { CellGalaxySnapshot, ChainEntry, ChainNode, Peer } from '@cknerv/types';
import {
  beginBootModule,
  completeBootModule,
  failBootModule,
  markBootViewPreparing,
  type BootModuleId,
} from '@cknerv/ui/boot';
import {
  QUALITY_PRESETS,
  setAdaptiveQuality,
  setQualityMode,
} from '@cknerv/ui/quality';
import { chargeBootFault, showBootShellFault } from './boot-shell';
import { fetchCellsSnapshot, fetchChainSnapshot } from './connect';
import { resolveVisualReviewRoute, type VisualReviewRoute } from './visual-review-route';
import {
  resolveAutoStartupQuality,
  resolveQualityOverride,
  shouldApplyAutoStartupQuality,
} from './render-quality';

interface AppViewProps {
  initialChain: ChainEntry;
  initialChainNodes: ChainNode[];
  initialPeers: Peer[];
  initialChainRevision: number;
  initialCells: CellGalaxySnapshot;
  initialCellsRevision: number;
}
type LoadedView =
  | { kind: 'app'; Component: React.ComponentType<AppViewProps> }
  | { kind: 'review'; Component: React.ComponentType<{ snapshot: CellGalaxySnapshot }> };
interface ReactDomClient {
  createRoot(container: Element | DocumentFragment): { render(children: React.ReactNode): void };
}
interface CellFieldModule { installCellFieldHook(search?: string): void }
interface DiagnosticsModule { installPulseStatsHook(): void }

export interface StartupDependencies {
  fetchChain: typeof fetchChainSnapshot;
  fetchCells: typeof fetchCellsSnapshot;
  loadView(route: VisualReviewRoute | null): Promise<LoadedView>;
  loadReactDom(): Promise<ReactDomClient>;
  loadCellField(): Promise<CellFieldModule>;
  loadDiagnostics(): Promise<DiagnosticsModule>;
  now(): number;
  search: string;
  root(): HTMLElement;
}

async function defaultLoadView(route: VisualReviewRoute | null): Promise<LoadedView> {
  switch (route) {
    case 'protocol-event':
      return { kind: 'review', Component: (await import('./ProtocolEventLab')).default };
    case 'cell-proof':
      return { kind: 'review', Component: (await import('./CellIdentityProofLab')).default };
    case 'cell-relic':
      return { kind: 'review', Component: (await import('./CellRelicLab')).default };
    case 'cell-form':
      return { kind: 'review', Component: (await import('./CellFormLab')).default };
    default:
      return { kind: 'app', Component: (await import('./App')).default };
  }
}

function defaults(): StartupDependencies {
  return {
    fetchChain: fetchChainSnapshot,
    fetchCells: fetchCellsSnapshot,
    loadView: defaultLoadView,
    loadReactDom: () => import('react-dom/client'),
    loadCellField: () => import('./cell-field-hook'),
    loadDiagnostics: () => import('./pulse-stats-hook'),
    now: () => performance.now(),
    search: window.location.search,
    root: () => {
      const root = document.getElementById('root');
      if (!root) throw new Error('startup root is missing');
      return root;
    },
  };
}

async function observedModule<T>(
  id: BootModuleId,
  load: () => Promise<T>,
  now: () => number,
  install?: (module: T) => void,
): Promise<T> {
  beginBootModule(id, now());
  try {
    const module = await load();
    install?.(module);
    completeBootModule(id, now());
    return module;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    failBootModule(id, now(), detail);
    throw error;
  }
}

export async function bootstrap(overrides: Partial<StartupDependencies> = {}): Promise<void> {
  const dependencies = { ...defaults(), ...overrides };
  const reviewRoute = resolveVisualReviewRoute(dependencies.search);
  const qualityOverride = resolveQualityOverride(dependencies.search);
  if (qualityOverride) {
    setQualityMode(qualityOverride);
  } else if (shouldApplyAutoStartupQuality(reviewRoute !== null, dependencies.search)) {
    setAdaptiveQuality(resolveAutoStartupQuality(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio,
      QUALITY_PRESETS.high.maxDpr,
    ));
  }

  // These calls execute through their first await and put both requests on the
  // wire before any heavyweight module loader below is invoked.
  const chainPromise = dependencies.fetchChain();
  const cellsPromise = dependencies.fetchCells();
  const viewPromise = observedModule('view', () => dependencies.loadView(reviewRoute), dependencies.now);
  const reactDomPromise = observedModule('react-dom', dependencies.loadReactDom, dependencies.now);
  const cellFieldPromise = observedModule(
    'cell-field',
    dependencies.loadCellField,
    dependencies.now,
    (module) => module.installCellFieldHook(dependencies.search),
  );
  // Installs even if data fails: Promise.all observes this promise but cannot
  // cancel the import or its install callback.
  const diagnosticsPromise = observedModule(
    'diagnostics',
    dependencies.loadDiagnostics,
    dependencies.now,
    (module) => module.installPulseStatsHook(),
  );

  const results = await Promise.all([
    chainPromise,
    cellsPromise,
    viewPromise,
    reactDomPromise,
    cellFieldPromise,
    diagnosticsPromise,
  ]);
  const [chainResp, cellsResp, view, reactDom] = results;
  const root = reactDom.createRoot(dependencies.root());
  markBootViewPreparing(dependencies.now());
  root.render(
    <React.StrictMode>
      <StartupErrorBoundary>
        {view.kind === 'review' ? (
          <view.Component snapshot={cellsResp.snapshot} />
        ) : (
          <view.Component
            initialChain={chainResp.chain}
            initialChainNodes={chainResp.chain_nodes ?? []}
            initialPeers={chainResp.peers ?? []}
            initialChainRevision={chainResp.revision}
            initialCells={cellsResp.snapshot}
            initialCellsRevision={cellsResp.revision}
          />
        )}
      </StartupErrorBoundary>
    </React.StrictMode>,
  );
}

class StartupErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(error: Error): void {
    const message = error.message || 'The initial view could not be rendered.';
    chargeBootFault(message);
    showBootShellFault(message);
  }
  render(): React.ReactNode { return this.state.failed ? null : this.props.children; }
}
