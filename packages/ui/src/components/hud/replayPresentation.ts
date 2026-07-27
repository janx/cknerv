import type { ReplayPhase } from '@cknerv/types';
import { HUD_COLORS } from './hudTheme';

export interface ReplayPresentation {
  tag: string;
  title: string;
  subtitle: string;
  color: string;
  waiting: string;
}

/** One visual vocabulary for both DOM and R3F replay HUDs. The phase comes
 * from chain observation; this helper only assigns presentation semantics. */
export function replayPresentation(phase: ReplayPhase): ReplayPresentation {
  switch (phase) {
    case 'boot':
      return {
        tag: 'BOOT',
        title: 'SEEDING CONSENSUS CELLS',
        subtitle: '播种',
        color: HUD_COLORS.orange,
        waiting: 'WAITING FOR INITIAL CANON',
      };
    case 'catchup':
      return {
        tag: 'CATCHUP',
        title: 'RESTORING CHAIN CONTINUITY',
        subtitle: 'CHAIN SYNC',
        color: HUD_COLORS.cyanWire,
        waiting: 'WAITING FOR CANONICAL BLOCKS',
      };
    case 'reorg':
      return {
        tag: 'REORG',
        title: 'RECONCILING CANON',
        subtitle: 'CANON REPAIR',
        color: HUD_COLORS.danger,
        waiting: 'WAITING FOR CANONICAL SUFFIX',
      };
    case 'rebuild':
      return {
        tag: 'REBUILD',
        title: 'REBUILDING CONSENSUS MEMORY',
        subtitle: 'STATE RESET',
        color: HUD_COLORS.rebuild,
        waiting: 'WAITING FOR REBUILD WINDOW',
      };
  }
}
