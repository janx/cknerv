import type { BootRequestSnapshot, BootSequenceSnapshot } from '@cknerv/ui';

export const BOOT_SLOW_MS = 8_000;
export const BOOT_RELOAD_MS = 30_000;

export interface BootPresentation {
  state: 'preparing' | 'receiving' | 'waiting' | 'view' | 'failed' | 'presented';
  heading: string;
  detail: string;
  showReload: boolean;
  cells: BootMeshPresentation;
  chain: BootMeshPresentation;
}

export interface BootMeshPresentation {
  state: 'pending' | 'active' | 'done' | 'failed';
  progress: number | null;
  indeterminate: boolean;
}

function latestRequest(sequence: BootSequenceSnapshot, kind: BootRequestSnapshot['kind']): BootRequestSnapshot | null {
  const requests = sequence.requests ?? [];
  for (let i = requests.length - 1; i >= 0; i -= 1) {
    if (requests[i].kind === kind) return requests[i];
  }
  return null;
}

function bytes(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${value} B`;
}

function requestStatus(label: string, request: BootRequestSnapshot | null): string {
  if (!request) return '';
  if (request.totalBytes !== null && request.totalBytes > 0) {
    const progress = Math.min(1, request.receivedBytes / request.totalBytes);
    return `RECEIVING ${label} · ${Math.floor(progress * 100)}%`;
  }
  return request.receivedBytes > 0
    ? `RECEIVING ${label} · ${bytes(request.receivedBytes)}`
    : `WAITING FOR ${label}`;
}

function mesh(request: BootRequestSnapshot | null): BootMeshPresentation {
  if (!request) return { state: 'pending', progress: null, indeterminate: false };
  if (request.state === 'done') return { state: 'done', progress: 1, indeterminate: false };
  if (request.state === 'failed') return { state: 'failed', progress: null, indeterminate: false };
  const progress = request.totalBytes === null
    ? null
    : Math.min(1, request.receivedBytes / request.totalBytes);
  return { state: 'active', progress, indeterminate: progress === null };
}

/** Pure mapping from observed boot events and an injectable monotonic clock. */
export function bootPresentation(sequence: BootSequenceSnapshot, nowMs: number): BootPresentation {
  const chain = latestRequest(sequence, 'chain');
  const cells = latestRequest(sequence, 'cells');
  const meshes = { chain: mesh(chain), cells: mesh(cells) };
  if (sequence.viewPresented) {
    return { state: 'presented', heading: '', detail: '', showReload: false, ...meshes };
  }
  const failedPhase = sequence.phases.find((phase) => phase.state === 'failed');
  const finalRequestFailure = chain?.state === 'failed'
    ? chain
    : cells?.state === 'failed' && cells.transport === 'cells-json' ? cells : null;
  if (finalRequestFailure || failedPhase) {
    return {
      state: 'failed',
      heading: 'UNABLE TO LOAD CKNERV',
      detail: finalRequestFailure?.detail ?? failedPhase?.detail ?? 'Unknown startup error',
      showReload: true,
      ...meshes,
    };
  }
  const requests = [chain, cells].filter((request): request is BootRequestSnapshot => (
    request !== null && (request.state === 'requesting' || request.state === 'reading')
  ));
  if (requests.length > 0) {
    const idleMs = Math.max(...requests.map((request) => nowMs - request.lastActivityAtMs));
    const waiting = idleMs >= BOOT_SLOW_MS;
    const activeCells = cells?.state === 'requesting' || cells?.state === 'reading';
    const activeChain = chain?.state === 'requesting' || chain?.state === 'reading';
    let current = activeCells && activeChain
      ? ((cells?.lastActivityAtMs ?? 0) >= (chain?.lastActivityAtMs ?? 0) ? cells : chain)
      : activeCells ? cells : chain;
    if (waiting) current = requests.reduce((stalled, request) => (
      request.lastActivityAtMs < stalled.lastActivityAtMs ? request : stalled
    ));
    const label = current?.kind === 'cells' ? 'CELLS' : 'NETWORK';
    const receiving = requestStatus(label, current);
    const received = current && current.receivedBytes > 0
      ? `${bytes(current.receivedBytes)} RECEIVED`
      : 'WAITING FOR RESPONSE';
    return {
      state: waiting ? 'waiting' : 'receiving',
      heading: waiting ? 'STILL WAITING FOR DATA' : receiving,
      detail: waiting ? `${received} · NO NEW DATA` : '',
      showReload: idleMs >= BOOT_RELOAD_MS,
      ...meshes,
    };
  }
  if (chain?.state === 'done' && cells?.state === 'done') {
    const waitingMs = nowMs - (sequence.viewPreparingAtMs ?? nowMs);
    return {
      state: 'view',
      heading: 'PREPARING THE VIEW',
      detail: '',
      showReload: waitingMs >= BOOT_RELOAD_MS,
      ...meshes,
    };
  }
  return {
    state: 'preparing',
    heading: 'PREPARING CKNERV',
    detail: '',
    showReload: false,
    ...meshes,
  };
}
