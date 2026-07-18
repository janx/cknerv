import { lazy, Suspense } from 'react';
import type { Cell } from '@cknerv/types';
import type { ConsensusBraidField } from '../../derives/consensusBraid.derive';
import type {
  ConsensusMemoryCellResponseRef,
  ConsensusMemoryTraceReadout,
} from '../../nerve/consensusMemoryTrace';
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
}: {
  direction: CellCoreDirection;
  cell: Cell;
  reducedMotion: boolean;
  focusField?: ConsensusBraidField | null;
  traceReadout?: ConsensusMemoryTraceReadout | null;
  traceResponseRef?: ConsensusMemoryCellResponseRef;
}) {
  if (direction === 'loom') {
    return (
      <Suspense fallback={null}>
        <QuantumLoomCore cell={cell} reducedMotion={reducedMotion} />
      </Suspense>
    );
  }
  if (direction === 'synthesis') {
    return (
      <Suspense fallback={null}>
        <InscribedBraidCore cell={cell} reducedMotion={reducedMotion} />
      </Suspense>
    );
  }
  return (
    <ConsensusMemory
      cell={cell}
      reducedMotion={reducedMotion}
      focusField={focusField}
      traceReadout={traceReadout}
      traceResponseRef={traceResponseRef}
    />
  );
}
