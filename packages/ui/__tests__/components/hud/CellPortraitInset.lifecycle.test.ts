/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { disposePortraitOrbitControls } from '../../../src/components/hud/CellPortraitInset';

type ConnectedOrbitControls = OrbitControls & {
  _interceptControlDown: EventListener;
  _interceptControlUp: EventListener;
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('CellPortraitInset OrbitControls lifecycle', () => {
  it('removes the original document listener after the portrait node is detached', () => {
    const removed = vi.spyOn(document, 'removeEventListener');

    for (let cycle = 0; cycle < 4; cycle += 1) {
      const element = document.createElement('div');
      document.body.append(element);
      const eventRoot = element.getRootNode();
      const controls = new OrbitControls(new PerspectiveCamera(), element);
      const connected = controls as ConnectedOrbitControls;
      const downListener = connected._interceptControlDown;
      const upListener = connected._interceptControlUp;

      // Three temporarily installs keyup while Control is held. Closing the
      // portrait before the key is released must clear that listener too.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' }));

      // This is the close/reopen order that leaked in the browser: Three's
      // own dispose now sees the detached element as its root.
      element.remove();
      expect(element.getRootNode()).toBe(element);
      disposePortraitOrbitControls(controls, eventRoot);

      expect(removed.mock.calls.some(([type, candidate, options]) => (
        type === 'keydown'
        && candidate === downListener
        && typeof options === 'object'
        && options?.capture === true
      ))).toBe(true);
      expect(removed.mock.calls.some(([type, candidate, options]) => (
        type === 'keyup'
        && candidate === upListener
        && typeof options === 'object'
        && options?.capture === true
      ))).toBe(true);
      removed.mockClear();
    }
  });
});
