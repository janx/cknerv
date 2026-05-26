import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/**
 * Per-cell material factories for the cell detail polyhedra wall.
 *
 * The wall renders one membrane mesh + one wireframe LineSegments + one
 * solid inner nucleus per CKB cell (64 of each). Each mesh owns its own
 * material so per-cell tinting and opacity drives don't share state
 * across cells.
 *
 * Palette aligns with the topology NeuralFabric:
 *   - alive primary (v=1) → CRIMSON (deep red / structural neural tissue)
 *   - alive dual    (v=2) → LCL amber (synaptic firing accent)
 *
 * Edge highlights lerp toward white so the wireframe pops against the
 * dark background while staying on-palette.
 */

/** Crimson — alive primary (v = 1). */
export const CRIMSON = new THREE.Color(0.62, 0.10, 0.20);   // ≈ #9E1933
/** LCL amber — alive dual (v = 2). */
export const LCL = new THREE.Color(1.00, 0.55, 0.15);

/** Edge highlight for crimson cells (crimson + 40% white). */
export const CRIMSON_EDGE = CRIMSON.clone().lerp(new THREE.Color(1, 1, 1), 0.40);
/** Edge highlight for LCL amber cells (LCL + 30% white). */
export const LCL_EDGE = LCL.clone().lerp(new THREE.Color(1, 1, 1), 0.30);

/** Build a fresh membrane material for one alive cell. The caller owns
 *  it (so per-cell tinting + opacity drives don't share state).
 *
 *  Plain MeshStandardMaterial — NOT MeshPhysicalMaterial. The earlier
 *  physical variant used `transmission` + `flatShading` + low
 *  roughness, which together produced a granular speckle: transmission
 *  sampled the PMREM env map and dropped bright specks on each face,
 *  while flat shading + low roughness made each face flicker
 *  independently as the wall rotated. Dropping both yields a smooth,
 *  softly-glowing translucent shell. The faceted-polyhedron reading
 *  comes from the inset edge wireframe + inner nucleus, not from
 *  per-face shading. */
export function makeMembraneMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: CRIMSON.clone(),
    emissive: CRIMSON.clone(),
    emissiveIntensity: 0.95,
    roughness: 0.50,
    metalness: 0.0,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/** Fresh edge line material for one cell's wireframe.
 *
 *  Uses LineMaterial (from three/examples/jsm/lines) — the fat-line
 *  pipeline the rest of the codebase uses (see NeuralFabric). Plain
 *  `LineBasicMaterial.linewidth` is ignored on virtually all GL
 *  platforms (capped at 1 px), so a 1-px hairline could not carry the
 *  "this is a polyhedron with N faces" reading against the bright
 *  membrane glow. LineMaterial draws shader-expanded ribbons that
 *  respect `linewidth` in pixels at the cost of needing a `resolution`
 *  Vector2 matching the active render target's pixel size.
 *
 *  Each cell owns its OWN LineMaterial instance because the per-frame
 *  loop mutates `.color` (cluster tint) and `.opacity` (step-pulse
 *  flash) per cell. The `resolution` is a SHARED Vector2 owned by the
 *  SubScene — mutating that one vector updates every cell's material
 *  in lock-step. */
export function makeEdgeMaterial(resolution: THREE.Vector2): LineMaterial {
  return new LineMaterial({
    color: CRIMSON_EDGE.getHex(),
    linewidth: 2.0,
    transparent: true,
    opacity: 0.95,
    worldUnits: false,
    resolution,
    dashed: false,
    depthTest: true,
    depthWrite: false,
  });
}
