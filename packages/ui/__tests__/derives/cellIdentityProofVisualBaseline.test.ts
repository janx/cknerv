import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  cellContentAddressEchoFrame,
  deriveCellContentAddressEncoding,
  deriveCellContentAddressSegments,
} from '../../src/derives/cellContentAddress.derive';
import {
  cellBirthAnchorEchoFrame,
  cellOutpointLocatorEchoFrame,
  deriveCellBirthAnchorEncoding,
  deriveCellBirthAnchorSegments,
  deriveCellOutpointLocatorEncoding,
  deriveCellOutpointLocatorSegments,
} from '../../src/derives/cellIdentityProof.derive';
import {
  cellIdentityProofLabelFrame,
  deriveCellIdentityProofLabel,
  deriveCellIdentityProofLabelPlacement,
} from '../../src/derives/cellIdentityProofLabel.derive';
import {
  CELL_IDENTITY_PROOF_LABEL_VISUAL_TOKENS,
} from '../../src/components/cellIdentityProofLabel.presentation';
import expectedBaseline from '../fixtures/cellIdentityProofVisualBaseline.json';

const CELL: Cell = {
  id: 42,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 16_204_800,
  tag: null,
  pos_seed: [0, 0, 0],
  out_point: {
    tx_hash: `0x${'0123456789abcdef'.repeat(4)}`,
    index: 0x01020304,
  },
  capacity: 100,
  data_hex: '0x',
  content_hash: `0x${'fedcba9876543210'.repeat(4)}`,
};

const round = (value: number): number => Number(value.toFixed(4));

function roundedRecord(
  value: object,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    typeof item === 'number' ? round(item) : item,
  ]));
}

function geometrySummary(segments: ReadonlyArray<{
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  color: readonly [number, number, number];
  energy: number;
  role?: string;
}>) {
  const values = segments.flatMap((segment) => [
    ...segment.from,
    ...segment.to,
  ]);
  const roleCounts = segments.reduce<Record<string, number>>(
    (counts, segment) => {
      const role = segment.role ?? 'signature';
      counts[role] = (counts[role] ?? 0) + 1;
      return counts;
    },
    {},
  );
  const summarizeSegment = (segment: (typeof segments)[number]) => ({
    from: segment.from.map(round),
    to: segment.to.map(round),
    color: segment.color.map(round),
    energy: round(segment.energy),
    role: segment.role ?? 'signature',
  });
  return {
    count: segments.length,
    roles: roleCounts,
    extent: round(Math.max(...values.map(Math.abs))),
    coordinateSum: round(values.reduce((sum, value) => sum + value, 0)),
    energySum: round(segments.reduce(
      (sum, segment) => sum + segment.energy,
      0,
    )),
    first: summarizeSegment(segments[0]),
    last: summarizeSegment(segments[segments.length - 1]),
  };
}

function visualBaseline() {
  const addressEncoding = deriveCellOutpointLocatorEncoding(
    CELL.out_point.tx_hash,
    CELL.out_point.index,
  );
  const contentEncoding = deriveCellContentAddressEncoding(CELL.content_hash);
  const anchorEncoding = deriveCellBirthAnchorEncoding(CELL.birth_block);
  const addressFrame = cellOutpointLocatorEchoFrame(0.36);
  const contentFrame = cellContentAddressEchoFrame(0.36);
  const anchorFrame = cellBirthAnchorEchoFrame(0.72);

  return {
    tokens: CELL_IDENTITY_PROOF_LABEL_VISUAL_TOKENS,
    address: {
      encoding: {
        fingerprint: addressEncoding.fingerprint,
        indexBytes: addressEncoding.indexBytes,
        lanes: addressEncoding.lanes.map(round),
      },
      frame: roundedRecord(addressFrame),
      label: deriveCellIdentityProofLabel(CELL, 'address'),
      labelFrame: roundedRecord(cellIdentityProofLabelFrame(
        addressFrame.progress,
        addressFrame.strength,
      )),
      placement: roundedRecord(deriveCellIdentityProofLabelPlacement({
        screenX: 150,
        screenY: 150,
        viewportWidth: 460,
        viewportHeight: 520,
        radiusPx: addressFrame.radiusPx,
      })),
      geometry: geometrySummary(
        deriveCellOutpointLocatorSegments(addressEncoding),
      ),
    },
    content: {
      encoding: {
        fingerprint: contentEncoding.fingerprint,
        phase: round(contentEncoding.phase),
        lanes: contentEncoding.lanes.map(round),
      },
      frame: roundedRecord(contentFrame),
      label: deriveCellIdentityProofLabel(CELL, 'content'),
      labelFrame: roundedRecord(cellIdentityProofLabelFrame(
        contentFrame.progress,
        contentFrame.strength,
      )),
      placement: roundedRecord(deriveCellIdentityProofLabelPlacement({
        screenX: 230,
        screenY: 150,
        viewportWidth: 460,
        viewportHeight: 520,
        radiusPx: contentFrame.radiusPx,
      })),
      geometry: geometrySummary(
        deriveCellContentAddressSegments(contentEncoding),
      ),
    },
    anchor: {
      encoding: {
        block: anchorEncoding.block,
        hexadecimal: anchorEncoding.hexadecimal,
        digits: anchorEncoding.digits,
        phase: round(anchorEncoding.phase),
      },
      frame: roundedRecord(anchorFrame),
      label: deriveCellIdentityProofLabel(CELL, 'anchor'),
      labelFrame: roundedRecord(cellIdentityProofLabelFrame(
        anchorFrame.progress,
        anchorFrame.strength,
      )),
      placement: roundedRecord(deriveCellIdentityProofLabelPlacement({
        screenX: 310,
        screenY: 150,
        viewportWidth: 460,
        viewportHeight: 520,
        radiusPx: 12,
      })),
      geometry: geometrySummary(
        deriveCellBirthAnchorSegments(anchorEncoding),
      ),
    },
  };
}

describe('Cell identity proof visual baseline', () => {
  it('locks the representative WHERE / WHAT / WHEN key frames', () => {
    expect(visualBaseline()).toEqual(expectedBaseline);
  });
});
