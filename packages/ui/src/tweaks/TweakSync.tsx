// Bridges the leva panel into the LIVE store. Mount exactly once INSIDE
// <Canvas> (same reconciler slot as SimClockTicker). It re-renders only when a
// knob is dragged; it does not use useFrame and adds no per-frame cost. Reads
// the same folder labels as the panel; leva merges any same-named folders
// (e.g. shellScale lives under 'Galaxy 共识记忆' too).
import { useEffect } from 'react';
import { useControls } from 'leva';
import { galaxySchema, deliverySchema, peerSchema, cellSchema, FOLDER_LABELS } from './tweakSchema';
import { LIVE, applyTweaks, type PartialLive } from './liveTweaks';

export default function TweakSync(): null {
  const galaxy = useControls(FOLDER_LABELS.galaxy, galaxySchema);
  const delivery = useControls(FOLDER_LABELS.delivery, deliverySchema);
  const peer = useControls(FOLDER_LABELS.peer, peerSchema);
  const cell = useControls(FOLDER_LABELS.cell, cellSchema);

  useEffect(() => {
    applyTweaks(LIVE, { galaxy, delivery, peer, cell } as PartialLive);
  }, [galaxy, delivery, peer, cell]);

  return null;
}
