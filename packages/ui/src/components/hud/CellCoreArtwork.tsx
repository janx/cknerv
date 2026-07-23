import { lazy, Suspense, useMemo } from 'react';
import type { Cell } from '@cknerv/types';
import type { ConsensusBraidField } from '../../derives/consensusBraid.derive';
import { deriveCellContentAddressEncoding } from '../../derives/cellContentAddress.derive';
import type {
  ConsensusMemoryCellResponseRef,
  ConsensusMemoryTraceReadout,
} from '../../nerve/consensusMemoryTrace';
import CellContentAddressHalo from './CellContentAddressHalo';
import ConsensusMemory from './ConsensusMemory';

const QuantumLoomCore = lazy(() => import('./QuantumLoomCore'));
const InscribedBraidCore = lazy(() => import('./InscribedBraidCore'));

export type CellCoreDirection = 'relic' | 'loom' | 'synthesis';

export const CELL_CORE_DIRECTIONS: ReadonlyArray<{
  id: CellCoreDirection;
  code: string;
  name: string;
  cjk: string;
  character: string;
}> = [
  { id: 'relic', code: 'A', name: 'PSIONIC BRAID', cjk: '灵能编织', character: 'woven / agreement knots' },
  { id: 'loom', code: 'C', name: 'CELESTIAL SCRIPT', cjk: '天穹铭文', character: 'inscribed / ceremonial' },
  { id: 'synthesis', code: 'A+C', name: 'INSCRIBED BRAID', cjk: '铭文织环', character: 'braided / inscribed' },
] as const;

export default function CellCoreArtwork({
  direction,
  cell,
  reducedMotion,
  focusField = null,
  traceReadout = null,
  traceResponseRef,
  traceEvidenceFocusSourceId = null,
}: {
  direction: CellCoreDirection;
  cell: Cell;
  reducedMotion: boolean;
  focusField?: ConsensusBraidField | null;
  traceReadout?: ConsensusMemoryTraceReadout | null;
  traceResponseRef?: ConsensusMemoryCellResponseRef;
  traceEvidenceFocusSourceId?: number | null;
}) {
  const addressEncoding = useMemo(
    () => deriveCellContentAddressEncoding(cell.content_hash),
    [cell.content_hash],
  );
  const core = direction === 'loom' ? (
    <Suspense fallback={null}>
      <QuantumLoomCore cell={cell} reducedMotion={reducedMotion} />
    </Suspense>
  ) : direction === 'synthesis' ? (
    <Suspense fallback={null}>
      <InscribedBraidCore cell={cell} reducedMotion={reducedMotion} />
    </Suspense>
  ) : (
    <ConsensusMemory
      cell={cell}
      reducedMotion={reducedMotion}
      focusField={focusField}
      traceReadout={traceReadout}
      traceResponseRef={traceResponseRef}
      traceEvidenceFocusSourceId={traceEvidenceFocusSourceId}
    />
  );
  return (
    <>
      {core}
      <CellContentAddressHalo
        encoding={addressEncoding}
        contentFocused={focusField === 'data'}
        reducedMotion={reducedMotion}
      />
    </>
  );
}
