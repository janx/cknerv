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
}: {
  cell: Cell;
  event: CellIdentityProofEvent;
}) {
  if (event.kind === 'address') {
    return <CellOutpointLocatorMarker cell={cell} event={event} />;
  }
  if (event.kind === 'anchor') {
    return <CellBirthAnchorMarker cell={cell} event={event} />;
  }
  return <CellContentAddressEchoMarker cell={cell} event={event} />;
}

export type {
  CellIdentityProofEvent,
  CellIdentityProofKind,
} from '../derives/cellIdentityProof.derive';
