// React Context that exposes a `CellGalaxyCache` to the @cknerv/ui
// component tree. Consumers (cknerv-cli ui-app, simulator/ui) wire the
// cache into the Provider; components read it via `useCellGalaxy()`.
//
// `useCellGalaxy()` throws if no provider is mounted — fail fast over
// silently returning an empty cache (which would hide the wiring bug
// behind a blank canvas). Local tests can stub by wrapping their tree
// in `<CellGalaxyProvider value={emptyCellsCache()}>`.

import { createContext, useContext, type ReactNode } from 'react';
import type { CellGalaxyCache } from '@cknerv/cache';

const CellGalaxyContext = createContext<CellGalaxyCache | null>(null);

export interface CellGalaxyProviderProps {
  value: CellGalaxyCache;
  children: ReactNode;
}

export function CellGalaxyProvider({
  value,
  children,
}: CellGalaxyProviderProps) {
  return (
    <CellGalaxyContext.Provider value={value}>
      {children}
    </CellGalaxyContext.Provider>
  );
}

/**
 * Read the current `CellGalaxyCache` from the surrounding
 * `CellGalaxyProvider`. Throws if no provider is mounted so wiring
 * bugs surface immediately rather than as blank cells.
 */
export function useCellGalaxy(): CellGalaxyCache {
  const v = useContext(CellGalaxyContext);
  if (v === null) {
    throw new Error(
      '@cknerv/ui: useCellGalaxy() called outside a <CellGalaxyProvider>. ' +
        'Wrap the component tree in <CellGalaxyProvider value={cellsCache}> ' +
        '(typically driven by connectCellsStream from @cknerv/cache).',
    );
  }
  return v;
}

/**
 * Non-throwing variant: returns the cache, or `null` when no provider is
 * mounted. For layers whose galaxy interaction is an *enhancement* (e.g.
 * `BlockDeliveryLayer` igniting the cells it lands on) and which must still
 * mount standalone (tests, galaxy-less scenes).
 */
export function useCellGalaxyOptional(): CellGalaxyCache | null {
  return useContext(CellGalaxyContext);
}
