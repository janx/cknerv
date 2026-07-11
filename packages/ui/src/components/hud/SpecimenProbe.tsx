// SpecimenProbe — the DOM half of the marker probe. A cyan reticle + decoded
// callout that rides the landmark the in-Canvas projector locked onto: a
// lightweight rAF reader of the portrait's probeRef. Each frame it re-reads the
// mutable ref (so the marker follows the rotating landmark) and asks the panel
// (labelFor) to decode the active field. Renders NOTHING until the probe locks on
// (visible), so it is inert under reduced-motion and in jsdom, where probeRef
// starts hidden. `epochMs`/`count` are part of the shared-scan interface passed
// by the panel; the live marker state is read from probeRef, not recomputed here.
import { useEffect, useState, type MutableRefObject } from 'react';
import type { ProbeScreen } from './CellNucleusPortrait';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';

const CYAN = HUD_COLORS.cyanWire;
const GREEN = HUD_COLORS.nominal;

export default function SpecimenProbe({ probeRef, reduced, labelFor }: {
  probeRef: MutableRefObject<ProbeScreen>;
  epochMs: number;
  count: number;
  reduced: boolean;
  labelFor: (index: number) => { field: string; value: string };
}) {
  // tick forces a re-read of the mutable probeRef each frame; the reticle then
  // follows the rotating landmark. No rAF under reduced-motion (frozen).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const loop = () => { setTick((t) => (t + 1) % 1e6); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const s = probeRef.current;
  if (reduced || !s.visible) return null;
  const { field, value } = labelFor(s.index);
  // reticle contracts as it locks (lockT 0→1); a quick snap over the first sliver.
  const box = 13 + 9 * Math.max(0, 1 - s.lockT / 0.12);
  return (
    <div aria-hidden style={{ position: 'absolute', left: s.x, top: s.y, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', width: box * 2, height: box * 2, left: -box, top: -box, border: `1.4px solid ${CYAN}`, boxShadow: `0 0 6px ${CYAN}66` }} />
      <div style={{ position: 'absolute', left: 22, top: -18, whiteSpace: 'nowrap', fontFamily: HUD_FONTS.mono, fontSize: 10, color: CYAN, textShadow: `0 0 4px ${CYAN}` }}>
        <span>{field.toUpperCase()}</span><br /><span style={{ color: GREEN }}>▸ {value}</span>
      </div>
    </div>
  );
}
