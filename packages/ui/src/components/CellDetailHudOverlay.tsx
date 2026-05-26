import { useEffect, useState, type MutableRefObject } from 'react';
import { Text } from '@react-three/drei';

import { population, GRID_SIZE } from '../cellLife/gameOfLife';
import { FONT_DISPLAY } from '../ui/fonts';
import { SCAN_PERIOD_S, WORLD } from './CellLifeDetail3D';
import type { ScanStateRef } from '../ui/scanState';

interface Props {
  scanStateRef: MutableRefObject<ScanStateRef | null>;
  /** Top-left of the viewport rect in HUD ortho coords. */
  x: number;
  y: number;
  /** Viewport rect width and height (in HUD ortho pixels). */
  width: number;
  height: number;
}

// Palette — match topology LCL amber accent.
const AMBER = '#ff8c26';

// Sub-scene's scan plane sweeps from (WORLD/2 - 0.2) to -(WORLD/2 - 0.2).
const SCAN_Y_TOP = WORLD / 2 - 0.2;
const SCAN_Y_BOT = -(WORLD / 2 - 0.2);

// Poll interval — 10 Hz, dodges per-frame React re-renders.
const POLL_MS = 100;

// Chrome geometry, in pixels (matches the mockup's CSS layout, sized
// for the 340x200 viewport):
const CORNER_LEN = 14;            // L bracket arm length
const CORNER_INSET = 4;           // bracket origin offset from viewport edge
const CORNER_THICKNESS = 1.5;     // bracket line thickness
const TRACK_INSET_FRAC = 0.10;    // tracks span 10%..90% of viewport height
const TRACK_OFFSET_PX = 8;        // distance from viewport edge to track line
const TRACK_THICKNESS = 1;        // track line thickness
const TICK_OFFSET_PX = 4;         // distance from viewport edge to start of tick
const TICK_LEN_PX = 5;            // short row tick length
const TICK_THICKNESS = 1;         // row tick thickness
const CURSOR_SIZE = 7;            // square stand-in for the round CSS cursor
const RANGE_MARKER_W = 8;         // base width of the top/bottom triangle markers
const RANGE_MARKER_H = 6;         // height of triangle markers
const READOUT_LABEL_FONT = 7.5;   // dim corner label (Y / ROW / POP / GEN)
const READOUT_VALUE_FONT = 9.0;   // amber corner value
const READOUT_LABEL_LETTERSPACING = 0.20;
const READOUT_VALUE_LETTERSPACING = 0.10;
const READOUT_LABEL_COLOR = '#94a3b8'; // dim label
const READOUT_INSET = 18;         // pixel offset from viewport edge for text origin
                                  // (must clear the L bracket corner at CORNER_INSET=4)
const READOUT_LABEL_GAP = 22;     // px gap between label anchor and value anchor

interface Snap {
  scanY: number;
  /** Signed Y as a string with explicit +/- sign, e.g. "+1.20" / "-0.40". */
  yLabel: string;
  rowIdx: number;
  pop: number;
  generation: number;
}

function readSnap(ref: MutableRefObject<ScanStateRef | null>): Snap {
  // Recompute scan phase from the same clock the sub-scene uses
  // (performance.now). The sub-scene drives the beam Y with the same
  // formula, so the HUD cursor aligns exactly with the beam.
  const phase = (performance.now() / 1000 % SCAN_PERIOD_S) / SCAN_PERIOD_S;
  const scanY = SCAN_Y_TOP + (SCAN_Y_BOT - SCAN_Y_TOP) * phase;
  // Use a unicode minus for the negative sign so it visually matches
  // the "+" sign's stroke weight in the monospace display font.
  const yLabel = scanY >= 0
    ? `+${scanY.toFixed(2)}`
    : `−${Math.abs(scanY).toFixed(2)}`;
  const rowIdx = Math.min(GRID_SIZE - 1, Math.floor(phase * GRID_SIZE));
  const s = ref.current;
  const pop = s ? population(s.grid) : 0;
  const generation = s?.generation ?? 0;
  return { scanY, yLabel, rowIdx, pop, generation };
}

/**
 * Screen-space (DetailHud ortho) overlay for the cell detail scan
 * viewport. Polls `scanStateRef` every POLL_MS (~10 Hz) and renders
 * the scan-instrument chrome:
 *   - 4 corner L brackets
 *   - left + right vertical tracks with GRID_SIZE row ticks each
 *   - cursor dots on both tracks synced to the beam Y
 *   - top + bottom triangle range markers (top/bot of scan range)
 *   - 4 corner readouts: Y (signed beam pos), ROW (N/8), POP, GEN
 *
 * All elements live in the DetailHud orthographic frame; the viewport
 * rect occupies [x, y] (top-left) to [x + width, y - height] (bottom-right),
 * since DetailHud's Y axis points up.
 */
export default function CellDetailHudOverlay({ scanStateRef, x, y, width, height }: Props) {
  const [snap, setSnap] = useState<Snap>(() => readSnap(scanStateRef));
  useEffect(() => {
    const id = window.setInterval(() => setSnap(readSnap(scanStateRef)), POLL_MS);
    return () => window.clearInterval(id);
  }, [scanStateRef]);

  // Track endpoints (in local ortho coords, origin at viewport TOP-LEFT,
  // Y increasing downward visually — but in DetailHud Y increases UPWARD,
  // so "below the top edge" means a smaller Y. The group is translated to
  // (x, y); local Y of the top edge is 0, local Y of the bottom edge is -height.
  const trackTopLocalY = -height * TRACK_INSET_FRAC;
  const trackBottomLocalY = -height * (1 - TRACK_INSET_FRAC);
  const trackExtent = trackBottomLocalY - trackTopLocalY; // negative (downward)
  const phase01 = (snap.scanY - SCAN_Y_TOP) / (SCAN_Y_BOT - SCAN_Y_TOP); // 0..1 top→bot
  const cursorLocalY = trackTopLocalY + trackExtent * phase01;

  // Row tick local Y positions: centered within each grid row's band
  // along the 80% inner span of the track. Matches the mockup's
  // (r + 0.5) / GRID * 80 + 10 percent formula, in local ortho coords.
  const tickYs: number[] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const frac = TRACK_INSET_FRAC + ((r + 0.5) / GRID_SIZE) * (1 - 2 * TRACK_INSET_FRAC);
    tickYs.push(-height * frac);
  }

  // Cursor X positions on the left + right tracks.
  const leftTrackX = TRACK_OFFSET_PX;
  const rightTrackX = width - TRACK_OFFSET_PX;

  return (
    <group position={[x, y, 0]}>
      {/* 4 corner L brackets */}
      <CornerL corner="tl" size={CORNER_LEN} inset={CORNER_INSET} thickness={CORNER_THICKNESS} viewportW={width} viewportH={height} />
      <CornerL corner="tr" size={CORNER_LEN} inset={CORNER_INSET} thickness={CORNER_THICKNESS} viewportW={width} viewportH={height} />
      <CornerL corner="bl" size={CORNER_LEN} inset={CORNER_INSET} thickness={CORNER_THICKNESS} viewportW={width} viewportH={height} />
      <CornerL corner="br" size={CORNER_LEN} inset={CORNER_INSET} thickness={CORNER_THICKNESS} viewportW={width} viewportH={height} />

      {/* Vertical tracks (left + right). Length = (1 - 2 * TRACK_INSET_FRAC) * height. */}
      <mesh position={[leftTrackX, (trackTopLocalY + trackBottomLocalY) / 2, 1]}>
        <planeGeometry args={[TRACK_THICKNESS, trackTopLocalY - trackBottomLocalY]} />
        <meshBasicMaterial color={AMBER} transparent opacity={0.25} />
      </mesh>
      <mesh position={[rightTrackX, (trackTopLocalY + trackBottomLocalY) / 2, 1]}>
        <planeGeometry args={[TRACK_THICKNESS, trackTopLocalY - trackBottomLocalY]} />
        <meshBasicMaterial color={AMBER} transparent opacity={0.25} />
      </mesh>

      {/* Row ticks (GRID_SIZE per side). */}
      {tickYs.map((ty, r) => (
        <RowTick key={`l${r}`} side="left"  y={ty} viewportW={width} />
      ))}
      {tickYs.map((ty, r) => (
        <RowTick key={`r${r}`} side="right" y={ty} viewportW={width} />
      ))}

      {/* Cursor dots — both tracks, synced to beam Y. */}
      <mesh position={[leftTrackX,  cursorLocalY, 2]}>
        <planeGeometry args={[CURSOR_SIZE, CURSOR_SIZE]} />
        <meshBasicMaterial color={AMBER} transparent opacity={0.95} />
      </mesh>
      <mesh position={[rightTrackX, cursorLocalY, 2]}>
        <planeGeometry args={[CURSOR_SIZE, CURSOR_SIZE]} />
        <meshBasicMaterial color={AMBER} transparent opacity={0.95} />
      </mesh>

      {/* Top + bottom triangle range markers, horizontally centered, just
          outside the track inset lines. Rendered as flat planes — a
          simple ▼/▲ stand-in since a true triangle geometry would be
          overkill at this size. */}
      <mesh position={[width / 2, trackTopLocalY + RANGE_MARKER_H, 1]}>
        <planeGeometry args={[RANGE_MARKER_W, RANGE_MARKER_H]} />
        <meshBasicMaterial color={AMBER} transparent opacity={0.7} />
      </mesh>
      <mesh position={[width / 2, trackBottomLocalY - RANGE_MARKER_H, 1]}>
        <planeGeometry args={[RANGE_MARKER_W, RANGE_MARKER_H]} />
        <meshBasicMaterial color={AMBER} transparent opacity={0.7} />
      </mesh>

      {/* Corner readouts: spaced "dim label + amber value" format. With
          the 340 px width there's room for both a slate-blue label glyph
          (Y/ROW/POP/GEN) and the LCL-amber value, separated by a small
          gap so the pair reads cleanly. */}
      {/* Top-left: Y +0.42 */}
      <Text
        font={FONT_DISPLAY} anchorX="left" anchorY="top"
        position={[READOUT_INSET, -READOUT_INSET, 3]}
        fontSize={READOUT_LABEL_FONT} color={READOUT_LABEL_COLOR}
        letterSpacing={READOUT_LABEL_LETTERSPACING}
      >Y</Text>
      <Text
        font={FONT_DISPLAY} anchorX="left" anchorY="top"
        position={[READOUT_INSET + READOUT_LABEL_GAP, -READOUT_INSET, 3]}
        fontSize={READOUT_VALUE_FONT} color={AMBER}
        letterSpacing={READOUT_VALUE_LETTERSPACING}
      >{snap.yLabel}</Text>

      {/* Top-right: ROW 3/8 */}
      <Text
        font={FONT_DISPLAY} anchorX="right" anchorY="top"
        position={[width - READOUT_INSET - READOUT_LABEL_GAP, -READOUT_INSET, 3]}
        fontSize={READOUT_LABEL_FONT} color={READOUT_LABEL_COLOR}
        letterSpacing={READOUT_LABEL_LETTERSPACING}
      >ROW</Text>
      <Text
        font={FONT_DISPLAY} anchorX="right" anchorY="top"
        position={[width - READOUT_INSET, -READOUT_INSET, 3]}
        fontSize={READOUT_VALUE_FONT} color={AMBER}
        letterSpacing={READOUT_VALUE_LETTERSPACING}
      >{`${snap.rowIdx}/${GRID_SIZE}`}</Text>

      {/* Bottom-left: POP 14 */}
      <Text
        font={FONT_DISPLAY} anchorX="left" anchorY="bottom"
        position={[READOUT_INSET, -height + READOUT_INSET, 3]}
        fontSize={READOUT_LABEL_FONT} color={READOUT_LABEL_COLOR}
        letterSpacing={READOUT_LABEL_LETTERSPACING}
      >POP</Text>
      <Text
        font={FONT_DISPLAY} anchorX="left" anchorY="bottom"
        position={[READOUT_INSET + READOUT_LABEL_GAP, -height + READOUT_INSET, 3]}
        fontSize={READOUT_VALUE_FONT} color={AMBER}
        letterSpacing={READOUT_VALUE_LETTERSPACING}
      >{String(snap.pop).padStart(2, '0')}</Text>

      {/* Bottom-right: GEN 004 */}
      <Text
        font={FONT_DISPLAY} anchorX="right" anchorY="bottom"
        position={[width - READOUT_INSET - READOUT_LABEL_GAP, -height + READOUT_INSET, 3]}
        fontSize={READOUT_LABEL_FONT} color={READOUT_LABEL_COLOR}
        letterSpacing={READOUT_LABEL_LETTERSPACING}
      >GEN</Text>
      <Text
        font={FONT_DISPLAY} anchorX="right" anchorY="bottom"
        position={[width - READOUT_INSET, -height + READOUT_INSET, 3]}
        fontSize={READOUT_VALUE_FONT} color={AMBER}
        letterSpacing={READOUT_VALUE_LETTERSPACING}
      >{String(snap.generation).padStart(3, '0')}</Text>
    </group>
  );
}

/** L-shaped corner bracket. Arms point INWARD from the corner so the
 *  bracket frames the viewport from outside its content area. */
function CornerL({
  corner, size, inset, thickness, viewportW, viewportH,
}: {
  corner: 'tl' | 'tr' | 'bl' | 'br';
  size: number;
  inset: number;
  thickness: number;
  viewportW: number;
  viewportH: number;
}) {
  // Corner origin in local ortho coords (group is at viewport top-left,
  // local Y increases downward visually => use negative Y for "below").
  const cornerX = (corner === 'tl' || corner === 'bl') ? inset : viewportW - inset;
  const cornerY = (corner === 'tl' || corner === 'tr') ? -inset : -viewportH + inset;
  // Inward direction at this corner.
  const dx = (corner === 'tl' || corner === 'bl') ? +1 : -1;
  const dy = (corner === 'tl' || corner === 'tr') ? -1 : +1;
  return (
    <group position={[cornerX, cornerY, 1]}>
      {/* Horizontal arm — runs from the corner inward along X. */}
      <mesh position={[dx * size / 2, 0, 0]}>
        <planeGeometry args={[size, thickness]} />
        <meshBasicMaterial color={AMBER} transparent opacity={0.85} />
      </mesh>
      {/* Vertical arm — runs from the corner inward along Y. */}
      <mesh position={[0, dy * size / 2, 0]}>
        <planeGeometry args={[thickness, size]} />
        <meshBasicMaterial color={AMBER} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

/** Short horizontal row tick on a left/right track. */
function RowTick({ side, y, viewportW }: { side: 'left' | 'right'; y: number; viewportW: number }) {
  // Tick centered on the gap between viewport edge and the track line.
  const x = side === 'left'
    ? TICK_OFFSET_PX + TICK_LEN_PX / 2
    : viewportW - TICK_OFFSET_PX - TICK_LEN_PX / 2;
  return (
    <mesh position={[x, y, 1]}>
      <planeGeometry args={[TICK_LEN_PX, TICK_THICKNESS]} />
      <meshBasicMaterial color={AMBER} transparent opacity={0.35} />
    </mesh>
  );
}
