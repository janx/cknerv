// The client speaks to a window it does not own, over a channel every frame
// on the page can shout into. What is pinned here is therefore as much what
// it refuses to hear — a message from the wrong origin, from the wrong
// window, or that is not JSON at all — as what it says.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSoundCloudWidget,
  SOUNDCLOUD_EVENTS,
  SOUNDCLOUD_WIDGET_ORIGIN,
} from '../src/soundcloud-widget';

interface WidgetMessage {
  method: string;
  value?: unknown;
}

function mountFrame() {
  const frame = document.createElement('iframe');
  frame.src = `${SOUNDCLOUD_WIDGET_ORIGIN}/player/?url=track`;
  document.body.appendChild(frame);
  const source = frame.contentWindow as Window;
  const sent: WidgetMessage[] = [];
  const postMessage = vi.fn((data: string) => {
    sent.push(JSON.parse(data) as WidgetMessage);
  });
  vi.spyOn(source, 'postMessage').mockImplementation(
    postMessage as unknown as Window['postMessage'],
  );

  const receive = (
    method: string,
    value?: unknown,
    overrides: { origin?: string; source?: Window } = {},
  ) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ method, value }),
      origin: overrides.origin ?? SOUNDCLOUD_WIDGET_ORIGIN,
      source: overrides.source ?? source,
    }));
  };

  return { frame, postMessage, receive, sent, source };
}

let widgets: { dispose: () => void }[] = [];

function widgetFor(frame: HTMLIFrameElement) {
  const widget = createSoundCloudWidget(frame);
  widgets.push(widget);
  return widget;
}

beforeEach(() => {
  widgets = [];
});

afterEach(() => {
  widgets.forEach((widget) => widget.dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('createSoundCloudWidget', () => {
  it('says nothing until the widget is ready, then says it all in order', () => {
    const player = mountFrame();
    const widget = widgetFor(player.frame);

    widget.bind(SOUNDCLOUD_EVENTS.PLAY_PROGRESS, () => {});
    widget.setVolume(40);
    widget.play();
    expect(player.postMessage).not.toHaveBeenCalled();

    player.receive(SOUNDCLOUD_EVENTS.READY, null);

    expect(player.sent).toEqual([
      { method: 'addEventListener', value: 'playProgress' },
      { method: 'setVolume', value: 40 },
      { method: 'play' },
    ]);
    // The messages go to the player's own origin, never to `*`.
    expect(player.postMessage.mock.calls[0][1]).toBe(SOUNDCLOUD_WIDGET_ORIGIN);
  });

  it('registers a listener, delivers its events, and stops on unbind', () => {
    const player = mountFrame();
    const widget = widgetFor(player.frame);
    const positions: (number | undefined)[] = [];

    widget.bind(SOUNDCLOUD_EVENTS.PLAY_PROGRESS, (event) => {
      positions.push(event?.currentPosition);
    });
    player.receive(SOUNDCLOUD_EVENTS.READY, null);
    expect(player.sent).toEqual([
      { method: 'addEventListener', value: 'playProgress' },
    ]);

    player.receive(SOUNDCLOUD_EVENTS.PLAY_PROGRESS, { currentPosition: 1_200 });
    player.receive(SOUNDCLOUD_EVENTS.PLAY_PROGRESS, { currentPosition: 1_400 });
    expect(positions).toEqual([1_200, 1_400]);

    widget.unbind(SOUNDCLOUD_EVENTS.PLAY_PROGRESS);
    expect(player.sent.at(-1)).toEqual({
      method: 'removeEventListener',
      value: 'playProgress',
    });

    // A widget that has not stopped sending yet must find nobody home.
    player.receive(SOUNDCLOUD_EVENTS.PLAY_PROGRESS, { currentPosition: 1_600 });
    expect(positions).toEqual([1_200, 1_400]);
  });

  it('resolves a getter with the reply that carries its own method name', () => {
    const player = mountFrame();
    const widget = widgetFor(player.frame);
    const volumes: number[] = [];
    const listened: number[] = [];

    player.receive(SOUNDCLOUD_EVENTS.READY, null);
    widget.getVolume((volume) => volumes.push(volume));
    widget.getPosition((position) => listened.push(position));
    expect(player.sent).toEqual([
      { method: 'getVolume' },
      { method: 'getPosition' },
    ]);

    // The position's reply is not the volume's, and vice versa.
    player.receive('getPosition', 4_500);
    expect(volumes).toEqual([]);
    expect(listened).toEqual([4_500]);

    player.receive('getVolume', 63);
    expect(volumes).toEqual([63]);

    // A getter is answered once; a second reply has nobody waiting for it.
    player.receive('getVolume', 12);
    expect(volumes).toEqual([63]);
  });

  it('ignores a message from the wrong origin or the wrong window', () => {
    const player = mountFrame();
    const impostor = mountFrame();
    const widget = widgetFor(player.frame);
    const heard: unknown[] = [];
    widget.bind(SOUNDCLOUD_EVENTS.PLAY, (event) => heard.push(event));

    // A page that has guessed the protocol, shouting from its own origin.
    player.receive(SOUNDCLOUD_EVENTS.READY, null, {
      origin: 'https://evil.example',
    });
    expect(player.postMessage).not.toHaveBeenCalled();

    // A second SoundCloud frame — the right origin, the wrong player.
    player.receive(SOUNDCLOUD_EVENTS.READY, null, {
      source: impostor.source,
    });
    expect(player.postMessage).not.toHaveBeenCalled();

    player.receive(SOUNDCLOUD_EVENTS.READY, null);
    expect(player.sent).toEqual([
      { method: 'addEventListener', value: 'play' },
    ]);

    player.receive(SOUNDCLOUD_EVENTS.PLAY, { currentPosition: 1 }, {
      origin: 'https://w.soundcloud.com.evil.example',
    });
    player.receive(SOUNDCLOUD_EVENTS.PLAY, { currentPosition: 2 }, {
      source: impostor.source,
    });
    expect(heard).toEqual([]);

    player.receive(SOUNDCLOUD_EVENTS.PLAY, { currentPosition: 3 });
    expect(heard).toEqual([{ currentPosition: 3 }]);
  });

  it('ignores a frame that is not the protocol at all', () => {
    const player = mountFrame();
    const widget = widgetFor(player.frame);
    const heard: unknown[] = [];
    widget.bind(SOUNDCLOUD_EVENTS.PLAY, (event) => heard.push(event));
    player.receive(SOUNDCLOUD_EVENTS.READY, null);

    const shout = (data: unknown) => {
      window.dispatchEvent(new MessageEvent('message', {
        data,
        origin: SOUNDCLOUD_WIDGET_ORIGIN,
        source: player.source,
      }));
    };

    expect(() => {
      shout('{ not json');
      shout('null');
      shout('"a string"');
      shout(JSON.stringify({ value: 7 }));
      shout(JSON.stringify({ method: 42 }));
      shout({ method: SOUNDCLOUD_EVENTS.PLAY });
      shout(JSON.stringify({ method: 'somethingNewAtSoundCloud', value: 1 }));
    }).not.toThrow();
    expect(heard).toEqual([]);
  });

  it('hears nothing more once disposed, and never flushes what it held', () => {
    const player = mountFrame();
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const widget = widgetFor(player.frame);
    const heard: unknown[] = [];
    const handler = added.mock.calls
      .find(([type]) => type === 'message')?.[1];
    expect(handler).toBeDefined();

    widget.bind(SOUNDCLOUD_EVENTS.PLAY, (event) => heard.push(event));
    widget.play();
    widget.dispose();

    // The listener belongs to the widget: a page that opens the Jukebox
    // twenty times must not end up with twenty of them.
    expect(removed).toHaveBeenCalledWith('message', handler);

    player.receive(SOUNDCLOUD_EVENTS.READY, null);
    expect(player.postMessage).not.toHaveBeenCalled();

    player.receive(SOUNDCLOUD_EVENTS.PLAY, { currentPosition: 9 });
    expect(heard).toEqual([]);

    // Whatever is asked of it afterwards is asked of nobody.
    expect(() => {
      widget.play();
      widget.setVolume(10);
      widget.getVolume(() => heard.push('volume'));
      widget.dispose();
    }).not.toThrow();
    expect(player.postMessage).not.toHaveBeenCalled();
  });

  it('answers a late `ready` binding, because a widget is ready only once', async () => {
    const player = mountFrame();
    const widget = widgetFor(player.frame);
    player.receive(SOUNDCLOUD_EVENTS.READY, null);

    const seen: string[] = [];
    widget.bind(SOUNDCLOUD_EVENTS.READY, () => seen.push('ready'));
    await Promise.resolve();

    expect(seen).toEqual(['ready']);
    // `ready` is the one event that is never registered for: the widget sends
    // it unasked, and asking would name a listener the player has no name for.
    expect(player.sent).toEqual([]);
  });
});
