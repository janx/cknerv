import type { CSSProperties } from 'react';
import type {
  DaoStateRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import DaoStateReadout, { canRenderDaoStateReadout } from './DaoStateReadout';
import { HUD_COLORS } from './hudTheme';
import { HudPanel, PanelHeader } from './primitives';

export default function DaoStatePanel({ source, record, style, nowMs = Date.now() }: {
  source?: EnrichmentSourceStatus;
  record?: DaoStateRecord | null;
  style?: CSSProperties;
  /** Shared HUD clock for freshness and deterministic tests. */
  nowMs?: number;
}) {
  if (!canRenderDaoStateReadout(source, record, nowMs)) return null;

  return (
    <HudPanel style={{ width: 300, ...style }}>
      <PanelHeader en="NERVOS DAO" cjk="道" idx="DAO·05" accent={HUD_COLORS.orange} />
      <DaoStateReadout source={source} record={record} variant="panel" nowMs={nowMs} />
    </HudPanel>
  );
}
