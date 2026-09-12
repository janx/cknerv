// Whether the dev tuning panel has been ASKED FOR, and whether it is open.
//
// Two readings, and they are not the same one. `shown` is the toggle the
// backtick works; `armed` is whether anyone has ever asked at all, and it
// never goes back. What hangs on `armed` is `TweakSync` — leva's bridge into
// the LIVE store, five `useControls` over five full schemas, re-run on every
// App render for a panel nobody opened (3.6 ms of a block frame in a dev
// profile). A closed panel costs nothing to LOOK at, because `<Leva hidden>`
// renders null; what costs is the bridge behind it.
//
// ⚠️ WHAT MUST NOT HANG ON IT is `<Leva>` itself. leva injects its own
// always-visible panel — its skin, 10 px from the top right, over CELL·03, no
// toggle — the first time a `useControls` consumer mounts while no `<Leva>`
// has claimed the root (`useRenderRoot`, leva 0.9.36). The status strip, the
// sim clock and the adaptive-quality controller are all such consumers on an
// ordinary page, so the suppressor stays mounted whatever this says.
//
// It is a module store rather than App state because two components read it —
// App, to gate the bridge, and `Tweaks`, to draw the panel — and because the
// key listener belongs to neither of them. Same idiom as the quality and
// cell-display runtimes in `@cknerv/ui`.

import { useSyncExternalStore } from 'react';
import { hasQuerySwitch } from './render-quality';

export interface TweaksPanelState {
  /** Someone has asked for the panel at least once, so the bridge is worth
   *  mounting and worth keeping: a closed panel that re-opens instantly. */
  armed: boolean;
  /** The panel is on screen. */
  shown: boolean;
}

const CLOSED: TweaksPanelState = { armed: false, shown: false };

let state: TweaksPanelState = CLOSED;
const listeners = new Set<() => void>();
let keyListenerInstalled = false;

function publish(next: TweaksPanelState): void {
  if (next.armed === state.armed && next.shown === state.shown) return;
  state = next;
  for (const listener of listeners) listener();
}

/** The panel opens, and stays armed once it has been. */
export function toggleTweaksPanel(): void {
  publish({ armed: true, shown: !state.shown });
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== '`') return;
  // Never steal the backtick from a field the visitor is typing into.
  const target = event.target as HTMLElement | null;
  if (
    target
    && (target.tagName === 'INPUT'
      || target.tagName === 'TEXTAREA'
      || target.isContentEditable)
  ) return;
  event.stopPropagation();
  toggleTweaksPanel();
}

/** `?dev=1` is the other way to ask, and it asks before the first frame. */
function resolveQuerySwitch(search: string): void {
  if (hasQuerySwitch(search, 'dev')) publish({ armed: true, shown: true });
}

if (typeof window !== 'undefined') resolveQuerySwitch(window.location.search);

export function subscribeTweaksPanel(listener: () => void): () => void {
  listeners.add(listener);
  // The listener is installed by the first subscriber and never removed: App
  // holds one for the life of the page, and a store that stopped listening
  // between two consumers would swallow the backtick that mounts the panel.
  if (!keyListenerInstalled && typeof window !== 'undefined') {
    keyListenerInstalled = true;
    window.addEventListener('keydown', onKeyDown);
  }
  return () => { listeners.delete(listener); };
}

export function tweaksPanelSnapshot(): TweaksPanelState {
  return state;
}

export function useTweaksPanel(): TweaksPanelState {
  return useSyncExternalStore(
    subscribeTweaksPanel,
    tweaksPanelSnapshot,
    tweaksPanelSnapshot,
  );
}

/** Tests own the page, so they own this store; a `search` re-reads the switch
 *  a real page would have read at import. */
export function resetTweaksPanelForTest(search = ''): void {
  state = CLOSED;
  resolveQuerySwitch(search);
  for (const listener of listeners) listener();
}
