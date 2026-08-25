import { Fragment } from 'react';
import type { BootSequenceSnapshot } from '../../boot/bootSequence';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE } from './hudTheme';
import TopBand from './TopBand';
import {
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
 * The band itself is `TopBand`, which is also what the composing readout that
 * SUCCEEDS this one wears, and what the health banner that alternates with it
 * wears. This file is one chapter of that instrument, not a banner of its own.
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
    <TopBand
      accent={accent}
      title={BOOT_SEQUENCE_TITLE}
      top={top}
      attrs={{
        'data-boot-banner': 'true',
        'data-boot-dense': dense ? 'true' : undefined,
      }}
    >
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
    </TopBand>
  );
}
