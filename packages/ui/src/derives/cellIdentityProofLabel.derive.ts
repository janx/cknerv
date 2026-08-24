import type { Cell } from '@cknerv/types';
import { HUD_COLORS, rgba } from '../components/hud/hudTheme';
import { deriveCellContentAddressEncoding } from './cellContentAddress.derive';
import {
  deriveCellBirthAnchorEncoding,
  deriveCellOutpointLocatorEncoding,
  type CellIdentityProofKind,
} from './cellIdentityProof.derive';

export interface CellIdentityProofLabel {
  kind: CellIdentityProofKind;
  code: 'WHERE' | 'WHAT' | 'WHEN';
  detail: string;
  title: string;
  color: string;
  dimColor: string;
}

export interface CellIdentityProofLabelFrame {
  opacity: number;
  reveal: number;
  driftPx: number;
}

export interface CellIdentityProofLabelPlacement {
  horizontal: 'left' | 'right';
  vertical: 'above' | 'below';
  gapPx: number;
  yPx: number;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const unit = clampUnit((value - edge0) / (edge1 - edge0));
  return unit * unit * (3 - 2 * unit);
}

/** Exact short evidence shown beside one transient WHERE / WHAT / WHEN proof. */
export function deriveCellIdentityProofLabel(
  cell: Cell,
  kind: CellIdentityProofKind,
): CellIdentityProofLabel {
  if (kind === 'address') {
    const encoding = deriveCellOutpointLocatorEncoding(
      cell.out_point.tx_hash,
      cell.out_point.index,
    );
    return {
      kind,
      code: 'WHERE',
      detail: encoding.fingerprint,
      title: `${cell.out_point.tx_hash}#${cell.out_point.index}`,
      color: '#9DF7FF',
      dimColor: 'rgba(157, 247, 255, 0.52)',
    };
  }
  if (kind === 'anchor') {
    const encoding = deriveCellBirthAnchorEncoding(cell.birth_block);
    return {
      kind,
      code: 'WHEN',
      detail: `#${encoding.block}`,
      title: `Birth block #${encoding.block} · 0x${encoding.hexadecimal}`,
      // Drift not toward a token but BETWEEN two, which is the shape of the
      // gold already on `hudDiscipline.test.ts`'s ban list: this one sat 14.1
      // from `goldInk` and 21.2 from `lockedGold` and was neither. It means
      // `goldInk` — the bright text tier, which is what a label is — and the
      // whole birth-anchor family says so now: the glyph, the marker ring and
      // the lab's WHEN column read the same token.
      color: HUD_COLORS.goldInk,
      // And through the helper, because a colour retyped as the decimal triple
      // its hex expands to is the same defect wearing an alpha — that is how
      // `crit` hid from every sweep this palette has ever run.
      dimColor: rgba(HUD_COLORS.goldInk, 0.52),
    };
  }
  const encoding = deriveCellContentAddressEncoding(cell.content_hash);
  return {
    kind,
    code: 'WHAT',
    detail: encoding.fingerprint,
    title: cell.content_hash,
    color: '#C7A7FF',
    dimColor: 'rgba(199, 167, 255, 0.54)',
  };
}

/**
 * The label arrives after its geometry is already legible and disappears with
 * the same bounded event. Reduced motion exposes the resolved evidence at once.
 */
export function cellIdentityProofLabelFrame(
  progress: number,
  strength: number,
  reducedMotion = false,
): CellIdentityProofLabelFrame {
  const boundedStrength = clampUnit(
    Number.isFinite(strength) ? strength : 0,
  );
  if (reducedMotion) {
    return {
      opacity: boundedStrength * 0.94,
      reveal: 1,
      driftPx: 0,
    };
  }
  const boundedProgress = clampUnit(
    Number.isFinite(progress) ? progress : 0,
  );
  const reveal = smoothstep(0.08, 0.24, boundedProgress);
  return {
    opacity: boundedStrength * reveal * 0.94,
    reveal,
    driftPx: (1 - reveal) * 4,
  };
}

/**
 * Place the label away from the screen edge and, on the default dashboard,
 * away from the center-right inspection rail. Only the open left field has
 * enough room for a label to grow rightward. The marker itself stays centered.
 */
export function deriveCellIdentityProofLabelPlacement({
  screenX,
  screenY,
  viewportWidth,
  viewportHeight,
  radiusPx,
}: {
  screenX: number;
  screenY: number;
  viewportWidth: number;
  viewportHeight: number;
  radiusPx: number;
}): CellIdentityProofLabelPlacement {
  const safeWidth = Math.max(1, viewportWidth);
  const safeHeight = Math.max(1, viewportHeight);
  const x = Number.isFinite(screenX) ? screenX : safeWidth * 0.5;
  const y = Number.isFinite(screenY) ? screenY : safeHeight * 0.5;
  const radius = Math.max(0, Number.isFinite(radiusPx) ? radiusPx : 0);
  return {
    horizontal: x >= safeWidth * 0.42 ? 'left' : 'right',
    vertical: y <= Math.max(54, safeHeight * 0.12) ? 'below' : 'above',
    gapPx: Math.max(12, radius + 8),
    yPx: y <= Math.max(54, safeHeight * 0.12) ? 7 : -8,
  };
}
