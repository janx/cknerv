import type { EpochInfo } from '@cknerv/types';

export interface EpochReadout {
  number: string;
  progress: string;
}

/** Keep the epoch number separate from its index/length fraction.
 *  CKB's canonical `number.index/length` notation is compact, but reads like
 *  one oversized fraction when rendered without labels. */
export function formatEpochReadout(epoch: EpochInfo): EpochReadout {
  if (epoch.length <= 0) return { number: '—', progress: '—' };
  return {
    number: `#${epoch.number.toLocaleString('en-US')}`,
    progress: `${epoch.index.toLocaleString('en-US')} / ${epoch.length.toLocaleString('en-US')}`,
  };
}
