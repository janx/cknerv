// Leva knobs panel — hidden by default, toggled with the backtick (`)
// key. Mirrors ckb-rcg's TweaksPanel.
//
// Why this component must exist, and why it is mounted even on a page nobody
// will ever tune: @cknerv/ui primitives (the status strip, the sim clock, the
// adaptive-quality controller) call leva's `useControls`. If no <Leva> has
// claimed the root when the first of them mounts, leva injects its own default
// panel — its skin, 10 px from the top right, over CELL·03, always visible, no
// toggle. Rendering our own <Leva> suppresses that and lets us drive `hidden`
// ourselves, and `<Leva hidden>` renders null, so the closed panel is not DOM.
//
// What is NOT mounted until someone asks is `TweakSync`, the bridge that
// registers five whole schemas with leva — see `tweaks-panel.ts`, which owns
// the backtick and the `?dev=1` switch for both halves.
//
// `memo` because it takes no props and nothing App does can change what it
// draws: unmemoized, it re-rendered (and re-ran `useControls`) on every App
// render, which is once a block plus every poll.

import { memo } from 'react';
import { Leva, useControls } from 'leva';
import { HUD_COLORS, HUD_FONTS, QUALITY_MODE_CONTROL } from '@cknerv/ui';
import { useTweaksPanel } from './tweaks-panel';

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

function Tweaks() {
  // Registered here (before <Canvas>) so this top-level control lands at the
  // TOP of the leva panel, above the tweak folders. The sampler + panel read
  // the same control (leva dedups by key).
  useControls('Time', QUALITY_MODE_CONTROL);

  const { shown } = useTweaksPanel();

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

export default memo(Tweaks);
