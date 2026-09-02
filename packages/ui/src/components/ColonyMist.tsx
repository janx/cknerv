// ColonyMist — the substance under the colony plane, everywhere, faintly.
//
// ⭐⭐⭐ THE PEER MESH IS THE BOUNDARY BETWEEN TWO UNIVERSES. Above it the cell
// canopy — CKB's spacetime; below it the other one. A POW cohort is a HOLE in
// that membrane, and this layer draws what fills the space on the other side of
// it: an energy field that is 「无处不在到处弥漫的物质」 — a diffuse substance that
// permeates space. It has NO SHAPE OF ITS OWN: not a sea, not a coast, not
// curtains, not a plume. Each of those was built and rejected by eye.
//
// ⭐⭐⭐ AND IT IS SECONDARY. It must never take focus from the peer mesh or the
// cell galaxy, which is what makes this the plainest program in the colony: two
// large flat sheets at a few percent of the mesh's brightness, ONE texture
// fetch each, no filaments, no sinks, no clock. The sheets exist so the space
// under the plane is not empty — and so the intake has something to be brighter
// THAN. ⚠️ Motion in the far field is exactly what would pull focus, so there
// is no `uTime` here and there must not be one.
//
// ⭐⭐⭐ THE INTAKE IS THE POINT, AND IT IS NOT IN THIS FILE. What the user asked
// for is 「pow cohort 汲取能量的视觉效果」, so the mist is DRAWN where it is being
// taken and is almost nothing everywhere else: the patch that gathers, spirals
// and swallows under each mouth is one instance per cohort in `ColonyCohorts`,
// beside the mark it belongs to, because it shares that layer's plan and its
// two lanes. This layer is the ground the patch is measured against.
//
// ⛔⛔⛔ NOTHING IS EVER DRAWN ABOVE THE MEMBRANE, and there is NO COLUMN,
// PLUME, FUNNEL OR PILLAR under any mouth at any brightness profile. Twenty-five
// rounds measured that: a shaft gated through the hole is invisible except from
// directly overhead, and an ungated one is a searchlight in miniature. ⭐ ONLY
// SURFACES BEING DRAWN EVER READ AS INTAKE.
//
// ⚠️⚠️ THE SHEETS ARE SQUARE, AND THE SQUARE IS THE ROTATION. They are mounted
// INSIDE the colony's counter-rotating group — which costs nothing, because the
// haze program reads the WORLD point under each fragment, so both its noise and
// its elliptical fade are fixed in world space and the turn is invisible on
// them. What the turn does reach is the sheet's own BOUNDARY. The fade is
// complete at ρ = `MIST_HAZE_EDGE_OUT` of the colony's ellipse, which reaches
// 230 wu along the long axis and 156.4 along the short one; a rectangle cut to
// those two numbers, turned 90°, would stop at 156.4 wu along an axis where the
// fade is still at 99.9 % — a hard straight edge across the substance, which is
// exactly the "it becomes a plate" failure the whole round is refusing. A
// SQUARE of `MIST_HAZE_HALF` contains the fade's whole disc at every angle.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { LIVE } from '../tweaks/liveTweaks';
import { COLONY_Y } from '../derives/networkTopology.derive';
import {
  MIST_HAZE_EDGE_OUT,
  MIST_HAZE_ELLIPSE,
  MIST_HAZE_SHEETS,
  type MistHazeSheet,
  makeMistHazeMaterial,
} from '../materials/colonyMist';
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
import { PERFORMANCE_PROBE_LABELS } from '../tweaks/performanceProbeStore';
import { createGpuProbeCallbacks } from '../tweaks/gpuTimerQuery';
import { createNonEmptyDrawGpuProbeCallbacks } from '../tweaks/nonEmptyGpuProbeCallbacks';

/**
 * Half-extent of a haze sheet, in world units: 230 wu, so each sheet is 460 wu
 * square.
 *
 * ⭐ DERIVED FROM THE FADE, NOT CHOSEN. `makeMistHazeMaterial` dissolves the
 * sheet between `MIST_HAZE_EDGE_IN` and `MIST_HAZE_EDGE_OUT` of the colony's
 * own ellipse and discards past it, so a sheet smaller than the fade's outer
 * ellipse ends at a nonzero value — a visible rim, and the substance becomes a
 * plate. The LONGER semi-axis is used for both sides because the sheet turns
 * with the colony while the fade does not (see the header).
 */
export const MIST_HAZE_HALF = MIST_HAZE_EDGE_OUT
  * Math.max(MIST_HAZE_ELLIPSE[0], MIST_HAZE_ELLIPSE[1]);

/**
 * The sheets this tier draws, deepest last, each with the world Y it lies at.
 *
 * ⭐ A PREFIX AND NOT A SELECTION: `MIST_HAZE_SHEETS` is ordered shallow-first,
 * so dropping the tail drops the DEEPER, fainter, coarser sheet and keeps the
 * one nearest the membrane. That is the right thing to lose — two sheets seen
 * through each other are what make the substance read as deep, and one is a
 * floor, but a floor at the wrong depth is a floor in the wrong place.
 *
 * Pure, so the tiers can be pinned without a renderer (r3f commits no tree
 * under jsdom).
 */
export function mistHazeSheetsDrawn(
  sheets: number,
): (MistHazeSheet & { y: number })[] {
  const count = Math.max(0, Math.min(MIST_HAZE_SHEETS.length, Math.floor(sheets)));
  return MIST_HAZE_SHEETS.slice(0, count).map((sheet) => ({
    ...sheet,
    y: COLONY_Y - sheet.depth,
  }));
}

/**
 * The ambient haze, as one flat additive plane per sheet.
 *
 * How many sheets is the quality cascade's `mistHazeSheets` (2 / 1 / 0). The
 * intake patch is never gated: it IS the feature, and what a low tier gives up
 * is the ambience the intake is measured against.
 */
export default function ColonyMist() {
  const { effective: quality } = useQualityRuntime();
  const sheets = QUALITY_PRESETS[quality].mistHazeSheets;
  const drawn = useMemo(() => mistHazeSheetsDrawn(sheets), [sheets]);
  // ⚠️ ONE PLANE FOR EVERY SHEET, because the sheets differ only in depth,
  // weight and grain — the first is a mesh transform and the other two are
  // uniforms, and none of them is geometry. Stable for the component's life:
  // a tier change moves how many meshes take it, never what it holds.
  const plane = useMemo(
    () => new THREE.PlaneGeometry(MIST_HAZE_HALF * 2, MIST_HAZE_HALF * 2),
    [],
  );
  // ⭐ ONE MATERIAL PER SHEET RATHER THAN ONE CLONED, and built for every sheet
  // the constant declares rather than for the ones this tier draws. Two sheets
  // are two draws with two different `uBase`/`uGrain`, so they cannot share a
  // uniform object either way; a factory call says that in one line where a
  // `.clone()` would leave the reader asking what was deep-copied. Building all
  // of them costs nothing a tier could save — a ShaderMaterial that never
  // enters the scene graph is never compiled — and it keeps the array's index
  // equal to the sheet's index at every tier.
  const materials = useMemo(() => MIST_HAZE_SHEETS.map((sheet) => {
    const material = makeMistHazeMaterial();
    material.uniforms.uBase.value = sheet.base;
    material.uniforms.uGrain.value = sheet.grain;
    return material;
  }), []);
  // True per-draw GPU timing when the opt-in render probe owns a timer-query
  // context; a boolean gate otherwise. ⭐ ONE LABEL, ONE CLOSURE PER SHEET: the
  // two draws are the same program over the same fade, so a mean over them is a
  // draw mean and not the mixture the probe contract forbids — but each needs
  // its own span holder, so a sheet can never end another sheet's query.
  const hazeGpuProbes = useMemo(() => MIST_HAZE_SHEETS.map(
    () => createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyMistHaze),
    ),
  ), []);
  useEffect(() => () => {
    plane.dispose();
    for (const material of materials) material.dispose();
  }, [materials, plane]);
  // The haze has no clock of its own, so this frame exists only to carry the
  // live knob. On the SIM frame, like every other knob in this colony: the
  // sheets freeze with the plane they hang under.
  useSimFrame(() => {
    const amp = LIVE.peer.cohortHazeAmp;
    for (const material of materials) material.uniforms.uAmp.value = amp;
  });

  // ⭐ NO SHEETS ⇒ NO DRAW, NOT AN EMPTY ONE. Every hook above still runs, so a
  // tier change is one render away — but nothing enters the scene graph at
  // `low`, and a material that is never rendered is never COMPILED.
  if (drawn.length === 0) return null;

  // ⚠️ Never a pick target: a plane 460 wu across, lying under the whole
  // colony, would put a wall of invisible target behind every node in it.
  //
  // ⚠️ FRUSTUM CULLING IS LEFT ON, unlike the marks'. Their extent rides a
  // uniform, so three cannot bound them from the geometry; a sheet's extent IS
  // its geometry, so the bounding sphere three computes is exact and a camera
  // that has left the colony behind stops paying for two full-screen planes.
  return (
    <group>
      {drawn.map((sheet, index) => (
        <mesh
          key={sheet.depth}
          geometry={plane}
          material={materials[index]}
          position={[0, sheet.y, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          {...hazeGpuProbes[index]}
          renderOrder={-1}
          raycast={() => null}
        />
      ))}
    </group>
  );
}
