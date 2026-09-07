// The SoundCloud player is an iframe, and the vendor's own way of driving it —
// `https://w.soundcloud.com/player/api.js` appended to `document.head` — is a
// third-party script running with THIS page's origin, i.e. with reach to every
// `/api/*` route the dashboard talks to and every `window.__*` dev hook the app
// installs. What that script actually does is 5 KB of `postMessage`
// bookkeeping: JSON `{ method, value }` strings posted at the iframe, JSON
// `{ method, value }` strings coming back. That is the whole protocol, and it
// is spoken here instead, so the widest the SPA's trust boundary ever gets is
// one cross-origin iframe that can send this module strings.
//
// Everything below is the wire the vendor script speaks, confirmed against it:
// the outgoing shape, the `addEventListener` / `removeEventListener` bridge
// methods, the getters replying under their own method name, and the `ready`
// gate before which the widget hears nothing.

/** The player's origin. Every one of the Jukebox's `embedUrl`s is served from
 *  it, it is the only origin this module will accept a message from, and it is
 *  the `targetOrigin` every outgoing message is addressed to — so a message is
 *  never delivered to whatever else may have taken the frame over. */
export const SOUNDCLOUD_WIDGET_ORIGIN = 'https://w.soundcloud.com';

/** The event names the widget emits, as the vendor's `SC.Widget.Events`
 *  spells them. Exported so callers name an event rather than typing the
 *  string, which is what the vendor's `Events` object was being loaded for. */
export const SOUNDCLOUD_EVENTS = {
  FINISH: 'finish',
  PLAY: 'play',
  PLAY_PROGRESS: 'playProgress',
  READY: 'ready',
  SEEK: 'seek',
} as const;

/** The bridge methods: registering and dropping an event listener are
 *  themselves messages, not a local subscription — the widget sends nothing
 *  for an event nobody asked for. */
const ADD_LISTENER = 'addEventListener';
const REMOVE_LISTENER = 'removeEventListener';

/** The payload `playProgress` and `seek` carry. The widget sends more fields
 *  than this (`loadedProgress`, `relativePosition`); the Jukebox reads one. */
export interface SoundCloudWidgetEvent {
  currentPosition?: number;
}

export interface SoundCloudWidget {
  bind: (
    eventName: string,
    listener: (event?: SoundCloudWidgetEvent) => void,
  ) => void;
  unbind: (eventName: string) => void;
  getPosition: (callback: (position: number) => void) => void;
  getVolume: (callback: (volume: number) => void) => void;
  pause: () => void;
  play: () => void;
  seekTo: (milliseconds: number) => void;
  setVolume: (volume: number) => void;
}

type WidgetListener = (event?: SoundCloudWidgetEvent) => void;
type GetterCallback = (value: number) => void;

interface OutgoingMessage {
  method: string;
  value?: unknown;
}

/** A message is ours only if BOTH hold. `origin` is the browser's own
 *  statement of who sent it and cannot be forged by the sender; `source`
 *  identifies WHICH window, so a second SoundCloud frame on the page — or the
 *  player of a track the user has already switched away from — cannot answer
 *  in this one's name. Anything else on the page's `message` channel is not
 *  addressed to us and is dropped without being parsed. */
function isFromWidget(event: MessageEvent, iframe: HTMLIFrameElement): boolean {
  return event.origin === SOUNDCLOUD_WIDGET_ORIGIN
    && event.source !== null
    && event.source === iframe.contentWindow;
}

/**
 * Drive one SoundCloud player iframe over `postMessage`, with no vendor script
 * in the page.
 *
 * The returned object is the shape the Jukebox drives — the eight calls it
 * makes of a player, plus `dispose()`, which is the part the vendor never had:
 * its listener was installed once, globally, for the life of the document.
 * Here the window listener belongs to the widget and goes when the widget
 * goes, which is what makes a track switch a clean handover rather than a
 * growing stack of listeners answering for a frame that is gone.
 *
 * Nothing may be said to the widget before it announces `ready`; calls made
 * before then are queued and flushed in order, so a caller never has to know
 * whether the player has finished loading.
 */
export function createSoundCloudWidget(
  iframe: HTMLIFrameElement,
): SoundCloudWidget & { dispose: () => void } {
  const listeners = new Map<string, Set<WidgetListener>>();
  /** Getter callbacks waiting for a reply, by the method that will carry it.
   *  The widget answers a getter under the getter's own name and answers once,
   *  so a reply drains every callback queued for that name. */
  const pending = new Map<string, GetterCallback[]>();
  const queue: OutgoingMessage[] = [];
  let ready = false;
  let disposed = false;

  const post = (message: OutgoingMessage): void => {
    if (disposed) return;
    if (!ready) {
      queue.push(message);
      return;
    }
    // The frame may have been detached between the call and this line — a
    // track switch unmounts it, and a listener still holding a reference must
    // not throw into whatever called it.
    iframe.contentWindow?.postMessage(
      JSON.stringify(message),
      SOUNDCLOUD_WIDGET_ORIGIN,
    );
  };

  const flush = (): void => {
    const queued = queue.splice(0, queue.length);
    queued.forEach(post);
  };

  const deliver = (method: string, value: unknown): void => {
    const waiting = pending.get(method);
    if (waiting && waiting.length > 0) {
      pending.set(method, []);
      waiting.forEach((callback) => {
        if (typeof value === 'number') callback(value);
      });
    }
    const bound = listeners.get(method);
    if (!bound) return;
    // A listener may unbind during the round, so iterate a copy.
    [...bound].forEach((listener) => {
      listener(
        typeof value === 'object' && value !== null
          ? (value as SoundCloudWidgetEvent)
          : undefined,
      );
    });
  };

  const onMessage = (event: MessageEvent): void => {
    if (disposed || !isFromWidget(event, iframe)) return;

    let payload: unknown;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      // The widget also posts frames this protocol knows nothing about.
      return;
    }
    if (typeof payload !== 'object' || payload === null) return;

    const { method, value } = payload as { method?: unknown; value?: unknown };
    if (typeof method !== 'string') return;

    if (method === SOUNDCLOUD_EVENTS.READY && !ready) {
      ready = true;
      flush();
    }
    deliver(method, value);
  };

  window.addEventListener('message', onMessage);

  const bind = (eventName: string, listener: WidgetListener): void => {
    const bound = listeners.get(eventName) ?? new Set<WidgetListener>();
    const first = bound.size === 0;
    bound.add(listener);
    listeners.set(eventName, bound);
    // `ready` is the one event the widget sends unasked; asking for it would
    // register a listener the player has no name for. A caller that binds it
    // after the fact still hears it, because a widget only becomes ready once.
    if (eventName === SOUNDCLOUD_EVENTS.READY) {
      if (ready) queueMicrotask(() => listener(undefined));
      return;
    }
    if (first) post({ method: ADD_LISTENER, value: eventName });
  };

  const unbind = (eventName: string): void => {
    const bound = listeners.delete(eventName);
    if (!bound || eventName === SOUNDCLOUD_EVENTS.READY) return;
    post({ method: REMOVE_LISTENER, value: eventName });
  };

  const request = (method: string, callback: GetterCallback): void => {
    const waiting = pending.get(method) ?? [];
    waiting.push(callback);
    pending.set(method, waiting);
    post({ method });
  };

  return {
    bind,
    unbind,
    getPosition: (callback) => request('getPosition', callback),
    getVolume: (callback) => request('getVolume', callback),
    pause: () => post({ method: 'pause' }),
    play: () => post({ method: 'play' }),
    seekTo: (milliseconds) => post({ method: 'seekTo', value: milliseconds }),
    setVolume: (volume) => post({ method: 'setVolume', value: volume }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('message', onMessage);
      queue.length = 0;
      listeners.clear();
      pending.clear();
    },
  };
}
