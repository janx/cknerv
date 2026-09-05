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
import { HUD_COLORS, HUD_FONTS, QUALITY_MODE_CONTROL } from '@cknerv/ui';

/**
 * The dev panel in the instrument's own language.
 *
 * `<Leva />` with no theme is leva 0.9's stock skin — its greys, its blue
 * accent, rounded radii, its own sans face and a drag bar that says "Leva" —
 * fixed 10 px from the top right, i.e. over CELL·03. That would be a
 * third-party costume anywhere; here it is worse, because the always-visible
 * QUALITY control in the status strip writes into this same store (report E,
 * E-10). One system, two skins, and the seam ran straight down the middle of
 * one setting.
 *
 * Fifteen lines, and every value is read from the theme rather than picked to
 * match it. What is NOT touched: leva's internals, its layout, its input
 * widgets. This is chrome, and the plan's non-goals say so.
 */
const TWEAKS_THEME = {
  colors: {
    elevation1: HUD_COLORS.stageGround,
    elevation2: HUD_COLORS.panel,
    elevation3: HUD_COLORS.trackGround,
    accent1: HUD_COLORS.cyanWire,
    accent2: HUD_COLORS.cyanWire,
    accent3: HUD_COLORS.orange,
    highlight1: HUD_COLORS.dim,
    highlight2: HUD_COLORS.legendInk,
    highlight3: HUD_COLORS.ink,
    folderWidgetColor: HUD_COLORS.orange,
    folderTextColor: HUD_COLORS.orange,
  },
  fonts: { mono: HUD_FONTS.mono, sans: HUD_FONTS.mono },
  radii: { xs: '0px', sm: '0px', lg: '0px' },
  fontSizes: { root: '10px' },
} as const;

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

  // `TWEAKS · DEV` rather than leva's own wordmark: the panel is one of this
  // instrument's surfaces while it is open, and the backtick that opens it is
  // named in the PANELS menu's KEYS footer.
  return (
    <Leva
      hidden={!shown}
      collapsed={false}
      theme={TWEAKS_THEME}
      titleBar={{ title: 'TWEAKS · DEV' }}
    />
  );
}
