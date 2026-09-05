import type { StreamHealthPhase } from '@cknerv/cache';
import type { NodeFault, StreamHealthSummary } from '../../derives/streamHealth.derive';
import {
  formatStreamAge,
  formatStreamChannels,
} from '../../derives/streamHealth.derive';
import { HUD_COLORS, HUD_FONTS, HUD_MOTION, HUD_TYPE, rgba } from './hudTheme';
import TopBand from './TopBand';

const PRESENTATION: Record<
  Exclude<StreamHealthPhase, 'live'>,
  { title: string; color: string }
> = {
  connecting: { title: 'CONNECTING DATA PLANE', color: HUD_COLORS.cyanWire },
  retrying: { title: 'STREAM INTERRUPTED', color: HUD_COLORS.warning },
  resyncing: { title: 'RECONCILING SNAPSHOT', color: HUD_COLORS.memory },
  stale: { title: 'DATA FROZEN', color: HUD_COLORS.danger },
};

/**
 * The gravest of the two words that are not a phase's.
 *
 * `DATA FROZEN` is the CONSEQUENCE, and it is the right word when the browser
 * cannot say why: a socket went quiet, and the last frame is what is on
 * screen. When the `node` channel hands over a fault the page knows the CAUSE,
 * and naming a cause you know is worth more than naming its effect — an
 * operator reading NODE UNREACHABLE goes and looks at their node, and one
 * reading DATA FROZEN reloads the tab.
 *
 * It takes the SAME colour, the same band and the same breathing frame. That
 * is deliberate and it is the whole of what "distinguished by form and word,
 * not by a borrowed hue" means: the register is the severity, and severity has
 * not changed — only the sentence has.
 */
const NODE_PRESENTATION = { title: 'NODE UNREACHABLE', color: HUD_COLORS.danger };

/**
 * The second word the node channel owns, and the quieter of the two.
 *
 * A quarantined projection is not the node's fault — the node is answering,
 * the adapter is alive, and one VIEW of the chain has stopped being built. But
 * the reader's situation is the same as the frozen one (a panel is showing a
 * number that will not change again) and the page knows exactly which view, so
 * it says which: the errand is the server's log, not the node's.
 *
 * It is RANKED BELOW `NODE UNREACHABLE` and the ranking is not made here — the
 * channel hands over one fault, already chosen (`NodeFault`), because which of
 * two true readings matters more is a fact about the readings.
 *
 * The name is the server's own, and it is the ONE string in this band a server
 * gets to author, so it is upper-cased on the way in: the HUD prints one case,
 * and a projection registered as `cells` may not be the lowercase word in a
 * danger band. Several are joined the way `formatStreamChannels` joins several
 * channels — there is one grammar for "more than one of these" in this file.
 */
const QUARANTINE_TITLE = 'PROJECTION QUARANTINED';

function nodePresentation(fault: NodeFault): { title: string; color: string } {
  if (fault.kind === 'unreachable') return NODE_PRESENTATION;
  return {
    title: `${QUARANTINE_TITLE} · ${fault.projections.map((name) => name.toUpperCase()).join(' + ')}`,
    color: HUD_COLORS.danger,
  };
}

export function streamHealthPresentation(
  summary: StreamHealthSummary,
): { title: string; color: string } | null {
  if (summary.phase === 'live') return null;
  // The frozen register is the only one that hands its sentence over: below it
  // the page is describing a transport it can watch, and the node channel has
  // nothing to add to CONNECTING or RETRYING that the socket is not saying.
  return summary.phase === 'stale' && summary.nodeFault !== null
    ? nodePresentation(summary.nodeFault)
    : PRESENTATION[summary.phase];
}

export default function StreamHealthBanner({
  summary,
  reducedMotion = false,
  top = 30,
}: {
  summary: StreamHealthSummary;
  reducedMotion?: boolean;
  top?: number;
}) {
  const visual = streamHealthPresentation(summary);
  if (!visual) return null;
  const channel = formatStreamChannels(summary.affectedChannels);
  const retry = summary.phase === 'retrying' && summary.attempt > 0
    ? ` · RETRY ${summary.attempt}`
    : '';
  const age = summary.phase === 'stale'
    ? ` · LAST FRAME ${formatStreamAge(summary.lastMessageAgeMs)}`
    : '';
  return (
    <>
      {/* The third form in the house shape grammar (`primitives.tsx`): an
          edge-bound bar, and this file is one tenant of the single one the HUD
          draws (`TopBand`). It is neither docked nor floating, so it takes
          neither the panels' corner brackets nor the plates' cut corner — it
          runs the full width and the viewport ends it. Nothing about the data
          plane being unwell is a card you could have opened; this is the frame
          itself raising its voice. */}
      <TopBand
        accent={visual.color}
        title={visual.title}
        top={top}
        animation={reducedMotion || summary.phase !== 'stale'
          ? undefined
          : `cknerv-hud-breathe ${HUD_MOTION.grow}ms ${HUD_MOTION.loopEase} infinite`}
        attrs={{
          'data-stream-health-banner': 'true',
          'data-stream-phase': summary.phase,
        }}
      >
        {/* THE LETTERS ARE AT FULL AND THE SOFTENING IS THE GLOW.
          * This line was `rgba(visual.color, 0.82)`, which is a legibility
          * budget spent on tone: DATA FROZEN — the gravest thing this band
          * says — measured 3.9 : 1 over the band's centre and 2.2 over its
          * 28 % stop on a lit scene (report F, F-10). The two states that
          * clear 5 : 1 were the calm ones.
          *
          * An alarm may not be the quietest ink on screen, and the reason the
          * alpha was there — a bare `danger` at 9 px shouts — is a job for
          * atmosphere. So the ink is the reading and the halo is the tone,
          * which is the same division the whole palette runs on. */}
        <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 1.2, color: visual.color, textShadow: `0 0 7px ${rgba(visual.color, 0.42)}` }}>
          {channel}{retry}{age}
        </span>
      </TopBand>
      {summary.phase === 'stale' ? (
        <div
          aria-hidden
          data-stream-stale-frame
          style={{
            position: 'absolute',
            zIndex: 2,
            inset: 2,
            border: `1px solid ${rgba(visual.color, 0.32)}`,
            boxShadow: `inset 0 0 42px ${rgba(visual.color, 0.07)}`,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </>
  );
}
