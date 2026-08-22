import type { CSSProperties } from 'react';
import type {
  DaoStateRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import DaoStateReadout, { canRenderDaoStateReadout } from './DaoStateReadout';
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
    <HudPanel watermark="道" style={{ width: 300, ...style }}>
      {/* No accent: a tinted module tag is how a panel says "I am one half of
          the mesh pair", and it means nothing once every panel does it. DAO·05
          falls back to the registry's slate with CKB·01, ECG·04 and GL·08. */}
      <PanelHeader en="NERVOS DAO" cjk="道" idx="DAO·05" />
      <DaoStateReadout source={source} record={record} variant="panel" nowMs={nowMs} />
    </HudPanel>
  );
}
