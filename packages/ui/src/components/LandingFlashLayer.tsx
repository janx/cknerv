import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { LIVE } from '../tweaks/liveTweaks';
import { useCellGalaxyRef } from '../hooks/cellGalaxyContext';
import { cellPointSize } from '../derives/cellVisual.derive';
import { CELL_GALAXY_PALETTE } from '../visualPalette';
import { makeLandingFlashMaterial } from '../materials/landingFlashMaterial';
import {
  pointSpriteDeviceViewportHeight,
  resolvePointSpritePixelRatio,
} from '../materials/pointSpritePresentation';
import {
  createLandingFlashRing,
  landingFlashDrawCount,
  takeLandingFlashUpload,
  writeLandingFlash,
} from './landingFlashRing';
import type { LandingFlashQueue } from './landingFlashQueue';

// LandingFlashLayer — the Cells a block landing passes, flashing plainly.
//
// The third medium of one wave. When a delivered block's front is released in
// the Cell field, the annulus draws the crest, the fabric flushes along the
// fibres it crosses, and every Cell the crest passes flashes — at the instant
// it passes (`landingFlashSchedule`, peers.derive) and as loud as the crest is
// there. This layer is that flash: a soft warm-white bloom resolving into
// tissue rose, on its OWN `Points` geometry inside the galaxy's rotating
// group, so the shared Cell body geometry gains no attribute (it has none to
// give) and the protocol write seal (`aFlashAt` / `cellFlareMaterial`) is
// never fired for a landing that was not a write.
//
// Fed by a queue ref the delivery layer pushes `(cellId, atSec, amp)` into;
// drained here each frame, resolving each Cell's galaxy-local position and its
// presentation size from the cache — the same derivation the body writes into
// `aSize` (`cellPointSize`), so the bloom is sized to the Cell it sits on.
// Slots are recycled by age (landingFlashRing). At rest — empty queue, every
// flash ended — the draw range is 0 and the object is invisible: the layer
// costs nothing until a block lands.

const WARM_WHITE = CELL_GALAXY_PALETTE.warmWhite;

export interface LandingFlashLayerProps {
  /** The landing queue (`createLandingFlashQueue`), shared with the writer —
   *  `BlockDeliveryLayer` through `NetworkColony`. */
  queueRef: { readonly current: LandingFlashQueue };
}

export default function LandingFlashLayer({ queueRef }: LandingFlashLayerProps) {
  const simClock = useSimClock();
  // The stable frame-loop handle: positions and sizes are resolved on the
  // drain, from the newest committed cache, never from a render closure.
  const cellsCacheRef = useCellGalaxyRef();
  const ring = useMemo(() => createLandingFlashRing(), []);
  const material = useMemo(() => makeLandingFlashMaterial(), []);
  // The ring's typed arrays ARE the attribute stores — bound once, uploaded
  // by range after each drain, never reallocated.
  const attributes = useMemo(() => ({
    position: new THREE.BufferAttribute(ring.position, 3)
      .setUsage(THREE.DynamicDrawUsage),
    at: new THREE.BufferAttribute(ring.at, 1)
      .setUsage(THREE.DynamicDrawUsage),
    size: new THREE.BufferAttribute(ring.size, 1)
      .setUsage(THREE.DynamicDrawUsage),
    color: new THREE.BufferAttribute(ring.color, 4)
      .setUsage(THREE.DynamicDrawUsage),
  }), [ring]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', attributes.position);
    g.setAttribute('aLandingAt', attributes.at);
    g.setAttribute('aLandingSize', attributes.size);
    g.setAttribute('aLandingColor', attributes.color);
    g.setDrawRange(0, 0);
    // The same permissive sphere the Cell body uses: flashes sit on Cells,
    // and the tissue must not be culled at oblique angles.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 120);
    return g;
  }, [attributes]);
  const pointsRef = useRef<THREE.Points>(null);
  const drawCountRef = useRef(0);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useSimFrame((state) => {
    const points = pointsRef.current;
    if (!points) return;
    const now = simClock.elapsedSec;
    const dur = LIVE.delivery.landingDur;

    // Drain: every pending landing becomes a slot, resolved against the
    // cache as it stands now. A Cell that is gone, dead, or whose window has
    // already closed (a hitch longer than the window) takes no slot.
    const queue = queueRef.current;
    const pending = queue.ids.length;
    if (pending > 0) {
      const cells = cellsCacheRef.current.cells;
      for (let index = 0; index < pending; index += 1) {
        const at = queue.ats[index];
        if (at + dur <= now) continue;
        const cell = cells.get(queue.ids[index]);
        if (!cell || cell.death_at_ms !== null) continue;
        writeLandingFlash(
          ring,
          now,
          dur,
          cell.pos_seed[0],
          cell.pos_seed[1],
          cell.pos_seed[2],
          at,
          cellPointSize(cell),
          WARM_WHITE[0],
          WARM_WHITE[1],
          WARM_WHITE[2],
          queue.amps[index],
        );
      }
      queue.clear();
      const upload = takeLandingFlashUpload(ring);
      if (upload) {
        markUpload(attributes.position, upload.start, upload.count);
        markUpload(attributes.at, upload.start, upload.count);
        markUpload(attributes.size, upload.start, upload.count);
        markUpload(attributes.color, upload.start, upload.count);
      }
    }

    const count = landingFlashDrawCount(ring, now, dur);
    if (count !== drawCountRef.current) {
      geometry.setDrawRange(0, count);
      drawCountRef.current = count;
    }
    points.visible = count > 0;
    // The resting frame ends here: no uniform is worth syncing for a draw
    // that is not submitted.
    if (count === 0) return;

    material.uniforms.uTime.value = now;
    material.uniforms.uDuration.value = dur;
    material.uniforms.uSizeScale.value = LIVE.delivery.landingSize;
    // The same device viewport the Cell body and the flare size against.
    material.uniforms.uViewportHeight.value = pointSpriteDeviceViewportHeight(
      state.size.height,
      resolvePointSpritePixelRatio(state.gl.getPixelRatio()),
    );
  });

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={1}
      visible={false}
    />
  );
}

/** Upload only the slots the drain wrote. Ranges are in slot units; the
 *  attribute scales them by its own item size. */
function markUpload(
  attribute: THREE.BufferAttribute,
  start: number,
  count: number,
): void {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(start * attribute.itemSize, count * attribute.itemSize);
  attribute.needsUpdate = true;
}
