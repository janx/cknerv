import {
  createContext,
  useContext,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type { ConsensusMemoryTraceFocus } from '../nerve/consensusMemoryTrace';

export type ConsensusMemoryFocusRef = MutableRefObject<ConsensusMemoryTraceFocus | null>;

const ConsensusMemoryFocusContext = createContext<ConsensusMemoryFocusRef | null>(null);

/**
 * Imperative bridge between the consensus-route overlay and the batched Cell
 * body. A ref keeps the render clock authoritative without turning every
 * recalled hop into a React re-render.
 */
export function ConsensusMemoryFocusScope({ children }: { children: ReactNode }) {
  const focusRef = useRef<ConsensusMemoryTraceFocus | null>(null);
  return (
    <ConsensusMemoryFocusContext.Provider value={focusRef}>
      {children}
    </ConsensusMemoryFocusContext.Provider>
  );
}

export function useConsensusMemoryFocusRef(): ConsensusMemoryFocusRef | null {
  return useContext(ConsensusMemoryFocusContext);
}
