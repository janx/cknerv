import type { Cell } from '@cknerv/types';
import type {
  CellIdentityProofEvent,
} from '../derives/cellIdentityProof.derive';
import CellBirthAnchorMarker from './CellBirthAnchorMarker';
import CellContentAddressEchoMarker from './CellContentAddressEchoMarker';
import CellOutpointLocatorMarker from './CellOutpointLocatorMarker';

/** Dispatch one selected-Cell proof without adding per-Cell scene objects. */
export default function CellIdentityProofMarker({
  cell,
  event,
  sampleElapsedSeconds,
}: {
  cell: Cell;
  event: CellIdentityProofEvent;
  /** Fixed review-frame time. Omit to use the live event clock. */
  sampleElapsedSeconds?: number;
}) {
  if (event.kind === 'address') {
    return (
      <CellOutpointLocatorMarker
        cell={cell}
        event={event}
        sampleElapsedSeconds={sampleElapsedSeconds}
      />
    );
  }
  if (event.kind === 'anchor') {
    return (
      <CellBirthAnchorMarker
        cell={cell}
        event={event}
        sampleElapsedSeconds={sampleElapsedSeconds}
      />
    );
  }
  return (
    <CellContentAddressEchoMarker
      cell={cell}
      event={event}
      sampleElapsedSeconds={sampleElapsedSeconds}
    />
  );
}

export type {
  CellIdentityProofEvent,
  CellIdentityProofKind,
} from '../derives/cellIdentityProof.derive';
