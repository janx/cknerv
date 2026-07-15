import type { Cell } from '@cknerv/types';
import type { ConsensusBraidField } from '../../derives/consensusBraid.derive';
import ConsensusMemory from './ConsensusMemory';
import QuantumLoomCore from './QuantumLoomCore';
import InscribedBraidCore from './InscribedBraidCore';

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
}: {
  direction: CellCoreDirection;
  cell: Cell;
  reducedMotion: boolean;
  focusField?: ConsensusBraidField | null;
}) {
  if (direction === 'loom') {
    return <QuantumLoomCore cell={cell} reducedMotion={reducedMotion} />;
  }
  if (direction === 'synthesis') {
    return <InscribedBraidCore cell={cell} reducedMotion={reducedMotion} />;
  }
  return (
    <ConsensusMemory
      cell={cell}
      reducedMotion={reducedMotion}
      focusField={focusField}
    />
  );
}
