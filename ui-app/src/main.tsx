// SPA entry: fetch the two bootstrap snapshots in parallel, then mount
// the React tree. A failure on either snapshot renders a plain pre with
// the error so the user (and CI) can read the failure reason without
// digging into devtools.

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { fetchCellsSnapshot, fetchChainSnapshot } from './connect';

async function bootstrap() {
  const [chainResp, cellsResp] = await Promise.all([
    fetchChainSnapshot(),
    fetchCellsSnapshot(),
  ]);
  const root = ReactDOM.createRoot(document.getElementById('root')!);
  root.render(
    <React.StrictMode>
      <App
        initialChain={chainResp.chain}
        initialChainNodes={chainResp.chain_nodes ?? []}
        initialPeers={chainResp.peers ?? []}
        initialChainRevision={chainResp.revision}
        initialCells={cellsResp.snapshot}
        initialCellsRevision={cellsResp.revision}
      />
    </React.StrictMode>,
  );
}

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
