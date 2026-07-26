import type { Vec3 } from '../types';
import type {
  CellCausalEndpoint,
  CellCausalLens,
} from '../derives/cellCausalLens.derive';

export const CELL_CAUSAL_LENS_HUB_LIFT = 4.6;
export const CELL_CAUSAL_LENS_MAX_INPUTS = 4;
export const CELL_CAUSAL_LENS_MAX_SIBLINGS = 4;

export type CellCausalArcRole = 'input' | 'selected-output' | 'sibling-output';

export interface CellCausalArc {
  key: string;
  endpointId: number;
  role: CellCausalArcRole;
  /** Stable transaction-order tier within the input or output fan. */
  laneIndex: number;
  /** Visible tier count for the matching input or output fan. */
  laneCount: number;
  /**
   * Retained input/sibling record that can become the next inspected Cell.
   * The already-selected output and identity-only tether deliberately remain
   * inert, even though both have honest geometry.
   */
  navigationTargetId: number | null;
  from: Vec3;
  control: Vec3;
  to: Vec3;
}

export interface CellCausalLensLayout {
  hub: Vec3;
  arcs: readonly CellCausalArc[];
  hiddenInputCount: number;
  hiddenSiblingCount: number;
}

export interface CellCausalLensLayoutOptions {
  maxInputs?: number;
  maxSiblings?: number;
  hubLift?: number;
}

const clampCount = (value: number | undefined, fallback: number): number => (
  Number.isFinite(value)
    ? Math.max(0, Math.floor(value ?? fallback))
    : fallback
);

function endpointPosition(endpoint: CellCausalEndpoint): Vec3 | null {
  return endpoint.record ? [...endpoint.record.pos_seed] : null;
}

function arcControl(
  from: Vec3,
  to: Vec3,
  role: CellCausalArcRole,
  laneIndex: number,
): Vec3 {
  if (role === 'selected-output') {
    // The selected output is the identity spine directly beneath the
    // transaction hub. Keeping its carrier axial makes the inspected Cell the
    // visual conclusion instead of treating it as another decorative lane.
    return [
      (from[0] + to[0]) * 0.5,
      (from[1] + to[1]) * 0.5,
      (from[2] + to[2]) * 0.5,
    ];
  }
  const hub = role === 'input' ? to : from;
  const endpoint = role === 'input' ? from : to;
  const dx = endpoint[0] - hub[0];
  const dz = endpoint[2] - hub[2];
  const planarDistance = Math.hypot(dx, dz);
  const radialX = planarDistance > 0.001 ? dx / planarDistance : 0;
  const radialZ = planarDistance > 0.001 ? dz / planarDistance : 0;
  // Every control remains on the hub→endpoint radial plane, so adjacent
  // transaction lanes cannot acquire the arbitrary left/right crossings of
  // the former id-seeded bow. A small outward pull keeps the silhouette soft.
  const radialPull = Math.min(1.45, 0.2 + planarDistance * 0.045);
  const terrainLift = Math.min(0.36, planarDistance * 0.03);
  // Incoming evidence forms the upper vault; produced sibling Cells occupy a
  // lower fan. Transaction order adds a stable tier inside each band.
  const tierLift = role === 'input'
    ? 1.5 + laneIndex * 0.34
    : 0.44 + laneIndex * 0.15;
  return [
    (from[0] + to[0]) * 0.5 + radialX * radialPull,
    Math.max(from[1], to[1]) + tierLift + terrainLift,
    (from[2] + to[2]) * 0.5 + radialZ * radialPull,
  ];
}

/**
 * Build a bounded scene layout without changing evidence completeness.
 * Presentation caps hide only already-retained endpoints; missing records stay
 * reported by the lens model and are never assigned invented positions.
 */
export function deriveCellCausalLensLayout(
  lens: CellCausalLens,
  options: CellCausalLensLayoutOptions = {},
): CellCausalLensLayout {
  const selected = lens.selectedCell.pos_seed;
  const hub: Vec3 = [
    selected[0],
    selected[1] + (
      Number.isFinite(options.hubLift)
        ? Math.max(0.5, options.hubLift ?? CELL_CAUSAL_LENS_HUB_LIFT)
        : CELL_CAUSAL_LENS_HUB_LIFT
    ),
    selected[2],
  ];
  if (lens.status === 'unavailable') {
    const selectedOutput = lens.outputs.find(
      (item) => item.role === 'selected' && item.record !== null,
    );
    const to = selectedOutput ? endpointPosition(selectedOutput) : null;
    const identityArc: CellCausalArc[] = [];
    if (selectedOutput && to) {
      identityArc.push({
        key: `output:${selectedOutput.id}`,
        endpointId: selectedOutput.id,
        role: 'selected-output',
        laneIndex: 0,
        laneCount: 1,
        navigationTargetId: null,
        from: [...hub],
        control: arcControl(
          hub,
          to,
          'selected-output',
          0,
        ),
        to,
      });
    }
    return {
      hub,
      // The selected outpoint itself proves tx → selected output. Inputs and
      // siblings remain unknown and therefore receive no geometry.
      arcs: identityArc,
      hiddenInputCount: 0,
      hiddenSiblingCount: 0,
    };
  }

  const maxInputs = clampCount(
    options.maxInputs,
    CELL_CAUSAL_LENS_MAX_INPUTS,
  );
  const maxSiblings = clampCount(
    options.maxSiblings,
    CELL_CAUSAL_LENS_MAX_SIBLINGS,
  );
  const retainedInputs = lens.inputs.filter((item) => item.record !== null);
  const retainedSiblings = lens.outputs.filter(
    (item) => item.role === 'sibling' && item.record !== null,
  );
  const visibleInputs = retainedInputs.slice(0, maxInputs);
  const visibleSiblingIds = new Set(
    retainedSiblings.slice(0, maxSiblings).map((item) => item.id),
  );
  const visibleOutputs = lens.outputs.filter((item) => (
    item.record !== null
    && (item.role === 'selected' || visibleSiblingIds.has(item.id))
  ));
  const arcs: CellCausalArc[] = [];

  for (let laneIndex = 0; laneIndex < visibleInputs.length; laneIndex += 1) {
    const input = visibleInputs[laneIndex];
    const from = endpointPosition(input);
    if (!from) continue;
    arcs.push({
      key: `input:${input.id}`,
      endpointId: input.id,
      role: 'input',
      laneIndex,
      laneCount: visibleInputs.length,
      navigationTargetId: input.id,
      from,
      control: arcControl(from, hub, 'input', laneIndex),
      to: [...hub],
    });
  }
  for (let laneIndex = 0; laneIndex < visibleOutputs.length; laneIndex += 1) {
    const output = visibleOutputs[laneIndex];
    const to = endpointPosition(output);
    if (!to) continue;
    const role = output.role === 'selected'
      ? 'selected-output'
      : 'sibling-output';
    arcs.push({
      key: `output:${output.id}`,
      endpointId: output.id,
      role,
      laneIndex,
      laneCount: visibleOutputs.length,
      navigationTargetId: role === 'sibling-output' ? output.id : null,
      from: [...hub],
      control: arcControl(hub, to, role, laneIndex),
      to,
    });
  }

  return {
    hub,
    arcs,
    hiddenInputCount: Math.max(0, retainedInputs.length - visibleInputs.length),
    hiddenSiblingCount: Math.max(
      0,
      retainedSiblings.length - visibleSiblingIds.size,
    ),
  };
}

export function cellCausalArcPoint(
  arc: CellCausalArc,
  progress: number,
): Vec3 {
  const t = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
  const oneMinus = 1 - t;
  return [
    oneMinus * oneMinus * arc.from[0]
      + 2 * oneMinus * t * arc.control[0]
      + t * t * arc.to[0],
    oneMinus * oneMinus * arc.from[1]
      + 2 * oneMinus * t * arc.control[1]
      + t * t * arc.to[1],
    oneMinus * oneMinus * arc.from[2]
      + 2 * oneMinus * t * arc.control[2]
      + t * t * arc.to[2],
  ];
}

/** Consecutive line-segment pairs suitable for LineSegmentsGeometry. */
export function sampleCellCausalArc(
  arc: CellCausalArc,
  segments = 14,
): number[] {
  const count = Number.isFinite(segments)
    ? Math.max(1, Math.floor(segments))
    : 14;
  const positions: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const from = cellCausalArcPoint(arc, index / count);
    const to = cellCausalArcPoint(arc, (index + 1) / count);
    positions.push(...from, ...to);
  }
  return positions;
}
