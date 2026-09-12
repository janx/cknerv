// React Context that exposes a `CellGalaxyCache` to the @cknerv/ui
// component tree. Consumers (cknerv-cli ui-app, simulator/ui) wire the
// cache into the Provider; components read it via `useCellGalaxy()`.
//
// `useCellGalaxy()` throws if no provider is mounted — fail fast over
// silently returning an empty cache (which would hide the wiring bug
// behind a blank canvas). Local tests can stub by wrapping their tree
// in `<CellGalaxyProvider value={emptyCellsCache()}>`.

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { CellGalaxyCache } from '@cknerv/cache';

const CellGalaxyContext = createContext<CellGalaxyCache | null>(null);

/** Stable imperative handle for frame-loop consumers. Its value advances at
 * commit, so it must not drive React output; an r3f frame can read the newest
 * committed cache without subscribing the whole scene root to every immutable
 * cache object. */
export interface CellGalaxyCacheRef {
  readonly current: CellGalaxyCache;
}

const CellGalaxyRefContext = createContext<CellGalaxyCacheRef | null>(null);

export interface CellGalaxyProviderProps {
  value: CellGalaxyCache;
  children: ReactNode;
}

export function CellGalaxyProvider({
  value,
  children,
}: CellGalaxyProviderProps) {
  const valueRef = useRef(value);
  // Keep the imperative lane commit-consistent. A concurrent render must not
  // expose its uncommitted cache to the independently scheduled r3f loop.
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);
  return (
    <CellGalaxyRefContext.Provider value={valueRef}>
      <CellGalaxyContext.Provider value={value}>
        {children}
      </CellGalaxyContext.Provider>
    </CellGalaxyRefContext.Provider>
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
 * Stable, non-subscribing cache handle for imperative frame callbacks. The
 * handle identity never changes while its Provider remains mounted; `current`
 * advances after each Provider commit. Render-time/JSX decisions must continue
 * to use `useCellGalaxy()` so React schedules them normally.
 */
export function useCellGalaxyRef(): CellGalaxyCacheRef {
  const valueRef = useContext(CellGalaxyRefContext);
  if (valueRef === null) {
    throw new Error(
      '@cknerv/ui: useCellGalaxyRef() called outside a <CellGalaxyProvider>. ' +
        'Wrap the component tree in <CellGalaxyProvider value={cellsCache}> ' +
        'before mounting a frame-loop Cell consumer.',
    );
  }
  return valueRef;
}

/**
 * Non-throwing variant: returns the cache, or `null` when no provider is
 * mounted. For layers whose galaxy interaction is an *enhancement* (e.g. a
 * scene marker keyed on a Cell) and which must still mount standalone (tests,
 * galaxy-less scenes).
 *
 * ⚠️ It SUBSCRIBES. A consumer that only reads the cache inside a frame
 * callback wants `useCellGalaxyRefOptional` below — this one re-renders it on
 * every cells batch, which is two or three times a block.
 */
export function useCellGalaxyOptional(): CellGalaxyCache | null {
  return useContext(CellGalaxyContext);
}

/**
 * The non-subscribing, non-throwing pair: the stable handle, or `null` when no
 * provider is mounted. Same bargain as `useCellGalaxyRef` — the identity holds
 * for the provider's life, `current` advances at commit — for a layer that
 * reads the cache at INGEST TIME in its frame loop and must still mount in a
 * galaxy-less scene.
 */
export function useCellGalaxyRefOptional(): CellGalaxyCacheRef | null {
  return useContext(CellGalaxyRefContext);
}
