import type { CSSProperties } from 'react';
import type {
  DaoStateRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import DaoStateReadout, { canRenderDaoStateReadout } from './DaoStateReadout';
import { HudPanel, PanelHeader } from './primitives';

export default function DaoStatePanel({ source, record, style }: {
  source?: EnrichmentSourceStatus;
  record?: DaoStateRecord | null;
  style?: CSSProperties;
}) {
  if (!canRenderDaoStateReadout(source, record)) return null;

  return (
    <HudPanel style={{ width: 300, ...style }}>
      <PanelHeader en="NERVOS DAO" cjk="道" idx="DAO·05" />
      <DaoStateReadout source={source} record={record} variant="panel" />
    </HudPanel>
  );
}
