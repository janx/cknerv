// Leva knobs panel — hidden by default, toggled with the backtick (`)
// key. Mirrors ckb-rcg's TweaksPanel.
//
// Why this component must exist: @cknerv/ui primitives (CellGalaxy,
// useSimFrame, …) call leva's `useControls`. If no <Leva>
// is rendered, leva auto-injects its own default panel — always visible,
// no toggle. Rendering our own <Leva> suppresses that auto-panel and lets
// us drive `hidden` ourselves. Honors `?dev=1` for parity with ckb-rcg.

import { useEffect, useState } from 'react';
import { Leva, useControls } from 'leva';
import { QUALITY_MODE_CONTROL } from '@cknerv/ui';

export default function Tweaks() {
  // Registered here (before <Canvas>) so this top-level control lands at the
  // TOP of the leva panel, above the tweak folders. The sampler + panel read
  // the same control (leva dedups by key).
  useControls('Time', QUALITY_MODE_CONTROL);

  const [shown, setShown] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('dev') === '1';
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '`') return;
      // Don't steal the backtick while the user is typing into a field.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      e.stopPropagation();
      setShown((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <Leva hidden={!shown} collapsed={false} />;
}
