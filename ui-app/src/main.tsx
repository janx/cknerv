// SPA entry: fetch the two bootstrap snapshots in parallel, then mount
// the React tree. A failure on either snapshot is charged to the boot record
// and shown by the shell that is already on screen — see the catch at the
// foot of this file.

import React from 'react';
import ReactDOM from 'react-dom/client';
import type { CellGalaxySnapshot } from '@cknerv/types';
import {
  QUALITY_PRESETS,
  completeBootPhase,
  markBootModuleStarted,
  markBootViewPreparing,
  setAdaptiveQuality,
  setQualityMode,
} from '@cknerv/ui';
import App from './App';
import {
  chargeBootFault,
  installBootShellReadout,
  showBootShellFault,
} from './boot-shell';
import { fetchCellsSnapshot, fetchChainSnapshot } from './connect';
import { installPulseStatsHook } from './pulse-stats-hook';
import { installCellFieldHook } from './cell-field-hook';
import {
  resolveVisualReviewRoute,
  type VisualReviewRoute,
} from './visual-review-route';
import {
  resolveAutoStartupQuality,
  resolveQualityOverride,
  shouldApplyAutoStartupQuality,
} from './render-quality';

type VisualReviewLab = React.ComponentType<{ snapshot: CellGalaxySnapshot }>;

async function loadVisualReviewLab(
  route: VisualReviewRoute,
): Promise<VisualReviewLab> {
  switch (route) {
    case 'protocol-event':
      return (await import('./ProtocolEventLab')).default;
    case 'cell-proof':
      return (await import('./CellIdentityProofLab')).default;
    case 'cell-relic':
      return (await import('./CellRelicLab')).default;
    case 'cell-form':
      return (await import('./CellFormLab')).default;
  }
}

async function bootstrap() {
  // This line running is the proof the bundle arrived and evaluates; the boot
  // record starts `instrument` active on module load and closes it here.
  completeBootPhase('instrument');
  markBootModuleStarted(performance.now());
  const reviewRoute = resolveVisualReviewRoute(window.location.search);
  const qualityOverride = resolveQualityOverride(window.location.search);
  if (qualityOverride) {
    setQualityMode(qualityOverride);
  } else if (shouldApplyAutoStartupQuality(
    reviewRoute !== null,
    window.location.search,
  )) {
    // AUTO starts from a ceiling proportionate to the buffer High would ask
    // the GPU to carry. This runs before the first Canvas mount, so a 4K page
    // never spends warmup/calibration rendering a tier already measured past
    // its vsync budget. Deterministic review Labs stay at their documented High
    // default unless they explicitly opt into adaptive quality. The in-Canvas
    // controller retains lifetime ownership and may lower the ceiling further
    // after sustained pressure.
    setAdaptiveQuality(resolveAutoStartupQuality(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio,
      QUALITY_PRESETS.high.maxDpr,
    ));
  }
  const [chainResp, cellsResp, ReviewLab] = await Promise.all([
    fetchChainSnapshot(),
    fetchCellsSnapshot(),
    reviewRoute ? loadVisualReviewLab(reviewRoute) : Promise.resolve(null),
  ]);
  const root = ReactDOM.createRoot(document.getElementById('root')!);
  markBootViewPreparing(performance.now());
  root.render(
    <React.StrictMode>
      <StartupErrorBoundary>
        {ReviewLab ? (
          <ReviewLab snapshot={cellsResp.snapshot} />
        ) : (
          <App
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

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    const message = error.message || 'The initial view could not be rendered.';
    chargeBootFault(message);
    showBootShellFault(message);
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

// Dev affordance — attach window.__pulseStats() / __pulseStatsReset() for
// live inspection of the nerve-pulse drop counters. Independent of the
// render, so it stays available even if bootstrap below fails.
installPulseStatsHook();
// The second one is a decision as well as an installation, and it has to be
// taken here: the CellField mirror is scaffolding for the P2.3 consumer
// migration, so it is built only on a page opened with `?dev=1`, and this call
// is what reads the switch. Before the first cache generation reaches
// `ingestCellsCacheIntoField`, which is inside the tree `bootstrap` mounts.
installCellFieldHook();

// Drive the static boot readout in index.html from the boot record. Also
// independent of the render: a boot that never reaches React still names the
// phase it died in, and now keeps saying it — nothing replaces the shell.
installBootShellReadout();

// THE STATIC STARTUP LAYER IS THE WHOLE INITIAL ERROR UI.
//
// This used to build a plain block element in `#f88` — a colour outside the
// palette, in the browser's own monospace, at 20px of padding — and hand it to
// `root.replaceChildren`, deleting the boot shell in the same tick the record
// had just been told which phase died (report E, E-7). The one state a visitor
// with a dead server ever sees was the one state nobody had drawn.
//
// So: charge the fault to the diagnostic line the boot reached, then hand the
// full message to the startup layer's own fault surface. Nothing replaces the
// shell, and the same request and phase record remains available under DETAILS.
bootstrap().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  chargeBootFault(message);
  showBootShellFault(message);
});
