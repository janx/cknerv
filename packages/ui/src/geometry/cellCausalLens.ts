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
  endpointId: number,
  role: CellCausalArcRole,
): Vec3 {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const planarDistance = Math.hypot(dx, dz);
  const seed = Math.imul(endpointId ^ (role === 'input' ? 0x45d9f3b : 0x27d4eb2d), 0x9e3779b1);
  const sign = (seed & 1) === 0 ? -1 : 1;
  let px: number;
  let pz: number;
  if (planarDistance > 0.001) {
    px = -dz / planarDistance;
    pz = dx / planarDistance;
  } else {
    const phase = ((seed >>> 1) & 0xffff) / 0xffff * Math.PI * 2;
    px = Math.cos(phase);
    pz = Math.sin(phase);
  }
  const bow = Math.min(4.2, 0.58 + planarDistance * 0.075) * sign;
  return [
    (from[0] + to[0]) * 0.5 + px * bow,
    (from[1] + to[1]) * 0.5 + Math.min(2.8, 0.65 + planarDistance * 0.055),
    (from[2] + to[2]) * 0.5 + pz * bow,
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
        navigationTargetId: null,
        from: [...hub],
        control: arcControl(
          hub,
          to,
          selectedOutput.id,
          'selected-output',
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

  for (const input of visibleInputs) {
    const from = endpointPosition(input);
    if (!from) continue;
    arcs.push({
      key: `input:${input.id}`,
      endpointId: input.id,
      role: 'input',
      navigationTargetId: input.id,
      from,
      control: arcControl(from, hub, input.id, 'input'),
      to: [...hub],
    });
  }
  for (const output of visibleOutputs) {
    const to = endpointPosition(output);
    if (!to) continue;
    const role = output.role === 'selected'
      ? 'selected-output'
      : 'sibling-output';
    arcs.push({
      key: `output:${output.id}`,
      endpointId: output.id,
      role,
      navigationTargetId: role === 'sibling-output' ? output.id : null,
      from: [...hub],
      control: arcControl(hub, to, output.id, role),
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
