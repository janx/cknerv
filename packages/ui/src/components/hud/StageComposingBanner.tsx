import { HUD_COLORS, HUD_FONTS, HUD_TYPE } from './hudTheme';
import TopBand from './TopBand';
import {
  STAGE_COMPOSING_TITLE,
  stageComposingLine,
} from './stageComposingPresentation';

/**
 * The boot readout's second chapter: the stage is still being composed.
 *
 * The same band the boot record just used, in the same slot, with one word
 * changed — because it is the same instrument still speaking. It used to be a
 * separate floating plate with a gauge in it, which made the handover read as
 * two unrelated things, one of which flashed past: a boxed plate with a glowing
 * bar appearing under a full-bleed band of text, for a second and a half,
 * usually after the band had already gone.
 *
 * Quiet is still the register. Composition is the organism living, not a
 * fault, so the chapter takes the instrument's own wire cyan — never a state
 * colour — and never animates. What outranks it (a stream fault, a replay, a
 * raised alarm) says so in its own surface; `HudOverlay` arbitrates the slot.
 */
export default function StageComposingBanner({
  staged,
  budget,
  curated,
  composed,
  top,
}: {
  staged: number | null;
  budget: number | null;
  curated: number | null;
  composed: boolean;
  top: number;
}) {
  const line = stageComposingLine({ staged, budget, curated, composed });
  if (!line) return null;
  return (
    <TopBand
      accent={HUD_COLORS.cyanWire}
      title={STAGE_COMPOSING_TITLE}
      top={top}
      fill={line.fill}
      attrs={{ 'data-stage-composing-banner': 'true' }}
    >
      {/* The counted form in `dim`, exactly as the boot trail's finished lines
          and the replay plate's block count are: the measurement is what a
          reader looks up, not what the band shouts. */}
      <span
        data-stage-composing-line
        style={{
          fontFamily: HUD_FONTS.mono,
          fontSize: HUD_TYPE.label,
          letterSpacing: 1.2,
          color: HUD_COLORS.dim,
          whiteSpace: 'nowrap',
        }}
      >
        {line.text}
      </span>
    </TopBand>
  );
}
