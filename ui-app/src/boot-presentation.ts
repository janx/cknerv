import type { BootRequestSnapshot, BootSequenceSnapshot } from '@cknerv/ui';

export const BOOT_SLOW_MS = 8_000;
export const BOOT_RELOAD_MS = 30_000;

export interface BootPresentation {
  state: 'preparing' | 'receiving' | 'waiting' | 'view' | 'failed' | 'presented';
  heading: string;
  detail: string;
  showReload: boolean;
  progress: number | null;
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

function cellsDetail(request: BootRequestSnapshot | null): string {
  if (!request) return '';
  if (request.totalBytes !== null && request.totalBytes > 0) {
    const progress = Math.min(1, request.receivedBytes / request.totalBytes);
    return `${Math.floor(progress * 100)}% · ${bytes(request.receivedBytes)} / ${bytes(request.totalBytes)}`;
  }
  return request.receivedBytes > 0 ? `${bytes(request.receivedBytes)} RECEIVED` : 'WAITING FOR RESPONSE';
}

/** Pure mapping from observed boot events and an injectable monotonic clock. */
export function bootPresentation(sequence: BootSequenceSnapshot, nowMs: number): BootPresentation {
  if (sequence.viewPresented) {
    return { state: 'presented', heading: '', detail: '', showReload: false, progress: null };
  }
  const chain = latestRequest(sequence, 'chain');
  const cells = latestRequest(sequence, 'cells');
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
      progress: null,
    };
  }
  const requests = [chain, cells].filter((request): request is BootRequestSnapshot => (
    request !== null && (request.state === 'requesting' || request.state === 'reading')
  ));
  if (requests.length > 0) {
    const idleMs = Math.max(...requests.map((request) => nowMs - request.lastActivityAtMs));
    const waiting = idleMs >= BOOT_SLOW_MS;
    let detail = cellsDetail(cells);
    if (cells?.state === 'done' && chain?.state !== 'done') detail = 'CELL DATA RECEIVED · WAITING FOR CHAIN SNAPSHOT';
    const progress = cells?.totalBytes && cells.totalBytes > 0 ? Math.min(1, cells.receivedBytes / cells.totalBytes) : null;
    return {
      state: waiting ? 'waiting' : 'receiving',
      heading: waiting ? 'STILL WAITING FOR DATA' : 'RECEIVING CHAIN DATA',
      detail,
      showReload: idleMs >= BOOT_RELOAD_MS,
      progress,
    };
  }
  if (chain?.state === 'done' && cells?.state === 'done') {
    const waitingMs = nowMs - (sequence.viewPreparingAtMs ?? nowMs);
    return {
      state: 'view',
      heading: 'PREPARING THE VIEW',
      detail: 'THE LIVE VIEW IS ALMOST READY',
      showReload: waitingMs >= BOOT_RELOAD_MS,
      progress: null,
    };
  }
  return {
    state: 'preparing',
    heading: 'PREPARING CKNERV',
    detail: '',
    showReload: false,
    progress: null,
  };
}
