import { Fragment } from 'react';
import type { BootSequenceSnapshot } from '../../boot/bootSequence';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import {
  BOOT_SEQUENCE_GLYPH,
  BOOT_SEQUENCE_TITLE,
  bootPhaseLine,
  bootSequenceAccent,
  denseBootPhase,
} from './bootSequencePresentation';

/**
 * The page's boot record, in the top-centre slot.
 *
 * It succeeds the static shell in `ui-app/index.html` — same band, same
 * geometry, same words — so React taking `#root` swaps the mechanism without
 * the readout appearing to move or restart. Everything that differs is
 * something React can do and inline markup cannot: the whole phase trail
 * instead of one line, and per-phase colour.
 *
 * The snapshot arrives as a prop rather than being read here, because
 * `HudOverlay` already subscribes to decide whether this band exists at all,
 * and a second subscription would be a second render for the same store write.
 */
export default function BootSequenceBanner({
  boot,
  top,
  dense = false,
  // Accepted so every tenant of this slot takes the same call, and deliberately
  // unread: there is no animation here to switch off. Stillness is the contract
  // the static shell set — the band changes text and nothing else — and a
  // readout that started breathing the moment React arrived would be the
  // regression, not the feature.
  reducedMotion: _reducedMotion = false,
}: {
  boot: BootSequenceSnapshot;
  top: number;
  dense?: boolean;
  reducedMotion?: boolean;
}) {
  const accent = bootSequenceAccent(boot);
  const densePhase = dense ? denseBootPhase(boot) : null;
  const phases = dense ? (densePhase ? [densePhase] : []) : boot.phases;
  return (
    /* The edge-bound bar, same as `StreamHealthBanner` and for the same reason
       (`primitives.tsx` argues the grammar): the instrument coming up is not a
       card you could have opened, it is the frame itself speaking. Which is
       also why it takes the band's formula to the digit — the two are tenants
       of one slot and must not read as two different kinds of object. */
    <div
      role="status"
      aria-live="polite"
      data-boot-banner
      data-boot-dense={dense ? 'true' : undefined}
      style={{
        position: 'absolute',
        zIndex: 3,
        top,
        left: 0,
        right: 0,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: `linear-gradient(90deg,transparent,${rgba(accent, 0.13)} 28%,${rgba(HUD_COLORS.ground, 0.78)} 50%,${rgba(accent, 0.13)} 72%,transparent)`,
        borderBottom: `1px solid ${rgba(accent, 0.45)}`,
        color: accent,
      }}
    >
      <span aria-hidden style={{ fontSize: HUD_TYPE.label }}>{BOOT_SEQUENCE_GLYPH}</span>
      <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: HUD_TYPE.section, letterSpacing: 2 }}>
        {BOOT_SEQUENCE_TITLE}
      </span>
      <span
        data-boot-trail
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
          fontFamily: HUD_FONTS.mono,
          fontSize: HUD_TYPE.label,
          letterSpacing: 1.2,
        }}
      >
        {phases.map((phase, index) => {
          const line = bootPhaseLine(phase);
          return (
            <Fragment key={phase.id}>
              {/* The separator stays dim whatever the phases either side of it
                  are doing: it is punctuation, and punctuation that took a
                  state colour would read as a ninth line. */}
              {index > 0 ? (
                <span aria-hidden style={{ color: HUD_COLORS.dim }}>·</span>
              ) : null}
              <span
                data-boot-phase={line.id}
                data-state={line.state}
                style={{ color: line.color }}
              >
                {line.text}
              </span>
            </Fragment>
          );
        })}
      </span>
    </div>
  );
}
