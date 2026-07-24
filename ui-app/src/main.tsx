// SPA entry: fetch the two bootstrap snapshots in parallel, then mount
// the React tree. A failure on either snapshot renders a plain pre with
// the error so the user (and CI) can read the failure reason without
// digging into devtools.

import React from 'react';
import ReactDOM from 'react-dom/client';
import type { CellGalaxySnapshot } from '@cknerv/types';
import { setQualityMode } from '@cknerv/ui';
import App from './App';
import { fetchCellsSnapshot, fetchChainSnapshot } from './connect';
import { installPulseStatsHook } from './pulse-stats-hook';
import {
  resolveVisualReviewRoute,
  type VisualReviewRoute,
} from './visual-review-route';
import { resolveQualityOverride } from './render-quality';

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
  const reviewRoute = resolveVisualReviewRoute(window.location.search);
  const qualityOverride = resolveQualityOverride(window.location.search);
  if (qualityOverride) setQualityMode(qualityOverride);
  const [chainResp, cellsResp, ReviewLab] = await Promise.all([
    fetchChainSnapshot(),
    fetchCellsSnapshot(),
    reviewRoute ? loadVisualReviewLab(reviewRoute) : Promise.resolve(null),
  ]);
  const root = ReactDOM.createRoot(document.getElementById('root')!);
  root.render(
    <React.StrictMode>
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
    </React.StrictMode>,
  );
}

// Dev affordance — attach window.__pulseStats() / __pulseStatsReset() for
// live inspection of the nerve-pulse drop counters. Independent of the
// render, so it stays available even if bootstrap below fails.
installPulseStatsHook();

bootstrap().catch((e: unknown) => {
  // Safe DOM API rendering — `textContent` escapes the message so a
  // hostile chain payload can't smuggle script tags into the error UI.
  const root = document.getElementById('root');
  if (!root) return;
  const pre = document.createElement('pre');
  pre.style.color = '#f88';
  pre.style.padding = '20px';
  pre.style.whiteSpace = 'pre-wrap';
  const message = e instanceof Error ? e.message : String(e);
  pre.textContent = `cknerv bootstrap failed:\n${message}`;
  root.replaceChildren(pre);
});
