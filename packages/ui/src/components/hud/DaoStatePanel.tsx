import { memo, type CSSProperties } from 'react';
import type {
  DaoStateRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import DaoStateReadout, { canRenderDaoStateReadout } from './DaoStateReadout';
import { useHudClockSelector } from './hudClock';
import { HudPanel, PanelHeader } from './primitives';

function DaoStatePanel({ source, record, style, nowMs }: {
  source?: EnrichmentSourceStatus;
  record?: DaoStateRecord | null;
  style?: CSSProperties;
  /** A host's clock, for labs and deterministic tests. Absent, the gate below
   *  and the readout's freshness line read the shared HUD clock themselves. */
  nowMs?: number;
}) {
  // A boolean off the clock: it flips when the record ages past the stale
  // window, and sleeps through every tick that leaves it where it was.
  const renderable = useHudClockSelector(
    (clock) => canRenderDaoStateReadout(source, record, nowMs ?? clock),
  );
  if (!renderable) return null;

  return (
    <HudPanel watermark="道" style={{ width: 300, ...style }}>
      {/* No accent: a tinted module tag is how a panel says "I am one half of
          the mesh pair", and it means nothing once every panel does it. DAO·05
          falls back to the registry's slate with CKB·01, ECG·04 and GL·08. */}
      <PanelHeader en="NERVOS DAO" cjk="道" idx="DAO·05" />
      <DaoStateReadout source={source} record={record} nowMs={nowMs} />
    </HudPanel>
  );
}

// Memoized with the other rail panels — see `BlockchainReadout`. The clock
// no longer arrives as a prop: the freshness line is a leaf of its own.
export default memo(DaoStatePanel);
