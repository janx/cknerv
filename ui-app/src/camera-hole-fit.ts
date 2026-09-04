/**
 * Where the camera stands, given the hole the HUD leaves it.
 *
 * The default pose was a constant — `position [110,108,110]`, fov 50, target
 * the galaxy's centre — at every viewport, while the frame it composes into is
 * not a constant at all. Measured at `25c7d5a`: at 1920 the HUD leaves a
 * 1,190 px hole between the rails and the 1.6× halo projects 1,506 px wide, so
 * the corona is cut 177 px on the left and 139 px on the right; at 1440 the
 * RIM itself runs 19 px under the left rail; at 900 most of the rim is behind
 * panels. The silhouette is the galaxy's most legible attribute at this
 * distance and the UI chrome was drawing its edge.
 *
 * So the distance is derived from the hole instead. Two knobs and no more: how
 * far back the camera stands, and where its target sits on the stage's own
 * horizontal axis, so the composition is centred on the HOLE rather than on
 * the viewport the hole is off-centre in.
 *
 * ONE form is fitted, at every width: the 1.6× halo. The fit is therefore
 * MONOTONE in the hole — a narrower hole is never a closer camera — and where
 * the hole is too narrow for the halo it saturates at the controls' own far
 * limit rather than changing its mind about what it is fitting. See
 * `MAX_DISTANCE`.
 *
 * ⚠️ Initial pose and reset only. A reader who has orbited owns the camera
 * from that moment; a resize that re-framed their view out from under them
 * would be the instrument overruling the hand on it.
 */

import type { HudHole } from '@cknerv/ui';

/**
 * The default pose's own direction, kept exactly: `[110,108,110]` looking at
 * `[0, CELLS_Y, 0]` is `(110, 70, 110)` normalised. Only the LENGTH of this
 * ray is fitted — the elevation and the azimuth are composition decisions that
 * were made by eye and are not the frame's business.
 */
const VIEW_RAY = (() => {
  const length = Math.hypot(110, 70, 110);
  return { x: 110 / length, y: 70 / length, z: 110 / length };
})();

/** Clear px between the silhouette and the panel beside it. Under a rail's own
 *  13 px padding the corona would touch the chrome without crossing it, which
 *  reads as a crop rather than as a gap. */
export const CAMERA_HOLE_MARGIN_PX = 24;

/**
 * There is no second form to fall back to, and that is the decision.
 *
 * The first cut of this module fitted the halo above a 1,100 px hole and the
 * RIM below it, on the argument that the corona is the part of the form that
 * can afford to be cropped. The argument is sound and the mechanism is not: a
 * fallback LOWERS a requirement, and a requirement lowered at a threshold is a
 * step. Arithmetically, at a 1,190 px hole the halo fit stood at 215; at 1,100
 * it would stand at 233; at 1,099 the rim took over at about 120 — so dragging
 * a window from 1920 to 1600 made the galaxy GROW by 1.4× and then shrink
 * again on the way back. A resize is a frame changing size, not a picture
 * changing subject, and the eye reads a jump in the subject's size as an
 * event.
 *
 * So one form is fitted at every width. Under about a 610 px hole on a 1,080
 * px stage the halo no longer fits at any distance a reader could orbit back
 * from, and the fit saturates at `MAX_DISTANCE`: the corona then runs under
 * the panels exactly as the fallback intended, but it arrives there by the
 * camera stopping, not by the requirement changing — continuously, and only
 * ever in one direction. What the fallback was protecting is protected
 * anyway: at the saturated pose the RIM still stands clear inside a 360 px
 * hole (it wants 319 of the 400), and the one stage where it does not — a
 * 160 px hole at 900 — is a stage the fallback also answered with 400.
 */

/** The camera may not come closer than the controls allow, nor go further:
 *  `OrbitControls` min/max distance in `App.tsx`. The far limit is also where
 *  the fit saturates — a hole too narrow for the halo is answered with the
 *  furthest pose there IS, never with an unreachable one, and never by fitting
 *  something smaller instead. */
const MIN_DISTANCE = 4;
const MAX_DISTANCE = 400;

/** Points sampled around the ellipse. The silhouette's extreme in screen x is
 *  not at a fixed parameter — perspective moves it toward the near side — so
 *  it is found rather than derived, and 256 points put the answer inside a
 *  tenth of a pixel at every distance this solves for. */
const ELLIPSE_SAMPLES = 256;

/** The hole is read ONCE, by `hudHoleFromRects` in `@cknerv/ui` — the same
 *  reading the inspector's cards compose into. This module used to carry its
 *  own copy of that rule; two definitions of the hole would be two frames, and
 *  the card and the galaxy would each be composing into a different one. */
export type CameraHole = HudHole;

export interface CameraExtent {
  halfX: number;
  halfZ: number;
}

export interface CameraHoleFit {
  /** Distance from the target along the default pose's ray. */
  distance: number;
  /** Where the controls' target sits on the world x axis. */
  targetX: number;
  /** Whether the hole decided the distance, or the far limit did. Reporting,
   *  not a branch: the caller applies the same pose either way. */
  saturated: boolean;
  /** The camera position that distance and target imply, ready for a pose. */
  position: [number, number, number];
}

/**
 * The form the camera is fitted to, restated rather than imported.
 *
 * `FIELD_HALF_X/Z` live in `packages/ui/src/helix.ts` and the 1.6 in
 * `geometry/populationFieldPlacement.ts`; neither module is on the package's
 * public surface, and putting them there so one camera could read three
 * numbers would widen an API for a constant. So they are restated here — and
 * `camera-hole-fit.test.ts` reads both source files and fails if the
 * statements ever disagree, which is the same bargain `cellDataReader.derive`
 * strikes with the card's own 728.
 */
const FIELD_HALF_X = 60;
const FIELD_HALF_Z = 54;
const HALO_EDGE = 1.6;

/** The form the frame is fitted to, at every width. */
export const CAMERA_HALO_EXTENT: CameraExtent = {
  halfX: FIELD_HALF_X * HALO_EDGE,
  halfZ: FIELD_HALF_Z * HALO_EDGE,
};

/** The silhouette the halo is 1.6× of. The fit never picks it — that was the
 *  fallback, and the fallback was a step — but it is the number the halo is
 *  stated FROM, so it is stated once and the cross-file toll reads it. */
export const CAMERA_RIM_EXTENT: CameraExtent = {
  halfX: FIELD_HALF_X,
  halfZ: FIELD_HALF_Z,
};

/**
 * Where the ellipse's silhouette lands on the screen's horizontal axis, in
 * viewport pixels, for a camera standing `distance` along the pose ray from
 * `(targetX, ·, 0)`.
 *
 * The pixel offset from the screen's centre is `(vx / vz) · H / 2tan(fov/2)`
 * and carries NO viewport width: the vertical field is what a perspective
 * camera is defined by, and the horizontal one is that times the aspect, so
 * the width cancels. That is why this fit reads the viewport's HEIGHT and the
 * hole's edges, and never the viewport's width.
 */
function silhouetteSpan(
  extent: CameraExtent,
  distance: number,
  targetX: number,
  viewportWidth: number,
  viewportHeight: number,
  fovDegrees: number,
): { min: number; max: number } {
  const scale = viewportHeight / (2 * Math.tan((fovDegrees * Math.PI) / 360));
  const centre = viewportWidth / 2;
  // Camera and basis. The ellipse is planar and the target sits in its plane,
  // so the whole solve runs at y = 0 — the elevation only ever reaches this
  // through the ray's own y.
  const px = targetX + VIEW_RAY.x * distance;
  const py = VIEW_RAY.y * distance;
  const pz = VIEW_RAY.z * distance;
  const forward = { x: -VIEW_RAY.x, y: -VIEW_RAY.y, z: -VIEW_RAY.z };
  // right = normalize(forward × up), up = (0,1,0) — horizontal by
  // construction, which is why an elevation never tilts this measure.
  const rx = -forward.z;
  const rz = forward.x;
  const rl = Math.hypot(rx, rz);
  const rightX = rx / rl;
  const rightZ = rz / rl;
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < ELLIPSE_SAMPLES; index += 1) {
    const angle = (index / ELLIPSE_SAMPLES) * Math.PI * 2;
    const ex = Math.cos(angle) * extent.halfX;
    const ez = Math.sin(angle) * extent.halfZ;
    const dx = ex - px;
    const dy = -py;
    const dz = ez - pz;
    const depth = dx * forward.x + dy * forward.y + dz * forward.z;
    if (depth <= 1e-3) continue;
    const lateral = dx * rightX + dz * rightZ;
    const at = centre + (lateral / depth) * scale;
    if (at < min) min = at;
    if (at > max) max = at;
  }
  return { min, max };
}

/**
 * Where the galaxy's own axis lands.
 *
 * `(0, ·, 0)` is the world point the whole composition is built around — the
 * helix's centre, and the local node's chain anchor, which used to project to
 * the exact horizontal centre of the VIEWPORT for every azimuth and elevation
 * because it sat on the camera's orbit axis. Aiming the frame at the hole
 * means putting THIS point on the hole's centre, not the silhouette's bounding
 * box: the bounding box is pulled toward whichever side of the ellipse is
 * nearer the camera, and a composition centred on a perspective artefact is
 * centred on nothing anybody can name.
 */
function axisAt(
  distance: number,
  targetX: number,
  viewportWidth: number,
  viewportHeight: number,
  fovDegrees: number,
): number {
  const span = silhouetteSpan(
    { halfX: 0, halfZ: 0 },
    distance,
    targetX,
    viewportWidth,
    viewportHeight,
    fovDegrees,
  );
  return span.min;
}

/** Smallest distance in `[MIN, MAX]` at which the whole silhouette lies inside
 *  `[lo, hi]`. As the camera retreats the silhouette shrinks toward the point
 *  the camera is aimed at, which is inside the hole by construction, so "does
 *  it fit" is monotone in the distance and 40 halvings settle it under a
 *  pixel. */
function fitDistance(
  extent: CameraExtent,
  lo: number,
  hi: number,
  targetX: number,
  viewportWidth: number,
  viewportHeight: number,
  fovDegrees: number,
): number {
  const fits = (distance: number): boolean => {
    const span = silhouetteSpan(
      extent, distance, targetX, viewportWidth, viewportHeight, fovDegrees,
    );
    return span.min >= lo && span.max <= hi;
  };
  let near = MIN_DISTANCE;
  let far = MAX_DISTANCE;
  if (!fits(far)) return far;
  if (fits(near)) return near;
  for (let step = 0; step < 40; step += 1) {
    const mid = (near + far) / 2;
    if (fits(mid)) far = mid; else near = mid;
  }
  return far;
}

/** Target x at which the galaxy's axis sits on `wanted`. Moving the target
 *  right carries the whole rig right, so the axis falls monotonically. */
function fitTargetX(
  distance: number,
  wanted: number,
  viewportWidth: number,
  viewportHeight: number,
  fovDegrees: number,
): number {
  const at = (targetX: number) => axisAt(
    distance, targetX, viewportWidth, viewportHeight, fovDegrees,
  );
  let lo = -400;
  let hi = 400;
  if (at(lo) < wanted) return lo;
  if (at(hi) > wanted) return hi;
  for (let step = 0; step < 40; step += 1) {
    const mid = (lo + hi) / 2;
    if (at(mid) > wanted) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Fit the composition to the hole the HUD leaves.
 *
 * Distance and target settle each other — the target's shift changes the
 * camera's aim and so the projection the distance was solved against — so they
 * are alternated rather than solved once. Three rounds put both inside a
 * pixel; a fourth changes nothing this instrument can measure.
 */
export function fitCameraToHole({
  hole,
  viewportWidth,
  viewportHeight,
  fov,
  extent,
  margin = CAMERA_HOLE_MARGIN_PX,
}: {
  hole: CameraHole;
  viewportWidth: number;
  viewportHeight: number;
  fov: number;
  /** Overridden only by a caller that wants a specific form fitted. The rule
   *  itself has one form and no branch — see the note above `MAX_DISTANCE`. */
  extent?: CameraExtent;
  margin?: number;
}): CameraHoleFit {
  const holeWidth = Math.max(0, hole.right - hole.left);
  const form = extent ?? CAMERA_HALO_EXTENT;
  const inner = Math.min(margin, Math.max(0, holeWidth / 2 - 1));
  const insideLeft = hole.left + inner;
  const insideRight = hole.right - inner;
  const wanted = (hole.left + hole.right) / 2;
  // Distance and target settle each other — the target's shift changes the aim
  // the distance was solved against — so they alternate. Three rounds put both
  // inside a pixel; a fourth changes nothing this instrument can measure.
  let distance = fitDistance(
    form, insideLeft, insideRight, 0, viewportWidth, viewportHeight, fov,
  );
  let targetX = 0;
  for (let round = 0; round < 3; round += 1) {
    targetX = fitTargetX(distance, wanted, viewportWidth, viewportHeight, fov);
    distance = fitDistance(
      form, insideLeft, insideRight, targetX,
      viewportWidth, viewportHeight, fov,
    );
  }
  return {
    distance,
    targetX,
    saturated: distance >= MAX_DISTANCE,
    position: [
      targetX + VIEW_RAY.x * distance,
      VIEW_RAY.y * distance,
      VIEW_RAY.z * distance,
    ],
  };
}
