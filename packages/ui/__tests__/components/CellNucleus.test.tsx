import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  writeSparseScalarAttribute,
  type ScalarAttributeSlotWrite,
  type ScalarThresholdEpoch,
} from '../../src/geometry/sparseScalarAttribute';
import {
  markPopulatedBufferUpdate,
} from '../../src/geometry/populatedBufferAttribute';
import {
  CELL_EXPANDED_DETAIL_THRESHOLD,
  CELL_HOVER_FOCUS,
  dampCellFocus,
} from '../../src/derives/cellInteraction.derive';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/CellNucleus.tsx'),
  'utf8',
);

describe('CellNucleus dynamic attributes', () => {
  it('uploads only a populated prefix and leaves empty batches silent', () => {
    const attribute = new THREE.BufferAttribute(new Float32Array(24), 3)
      .setUsage(THREE.DynamicDrawUsage);

    expect(markPopulatedBufferUpdate(attribute, 9)).toBe(true);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 9 }]);
    const populatedVersion = attribute.version;

    expect(markPopulatedBufferUpdate(attribute, 0)).toBe(false);
    expect(attribute.updateRanges).toEqual([]);
    expect(attribute.version).toBe(populatedVersion);

    expect(markPopulatedBufferUpdate(attribute, 999)).toBe(true);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 24 }]);

    const interleaved = new THREE.InstancedInterleavedBuffer(
      new Float32Array(30),
      6,
      1,
    ).setUsage(THREE.DynamicDrawUsage);
    expect(markPopulatedBufferUpdate(interleaved, 12)).toBe(true);
    expect(interleaved.updateRanges).toEqual([{ start: 0, count: 12 }]);
  });

  it('clears, writes, and uploads only changed scalar slots', () => {
    const values = new Float32Array(8);
    values[1] = 0.5;
    values[4] = 0.8;
    const attribute = new THREE.BufferAttribute(values, 1);
    const previousSlots = [1, 4];

    expect(writeSparseScalarAttribute(attribute, previousSlots, [
      { index: 4, value: 0.9 },
      { index: 6, value: 0.7 },
    ])).toBe(true);
    expect(values[1]).toBe(0);
    expect(values[4]).toBeCloseTo(0.9);
    expect(values[6]).toBeCloseTo(0.7);
    expect(previousSlots).toEqual([4, 6]);
    expect(attribute.updateRanges).toEqual([
      { start: 1, count: 1 },
      { start: 4, count: 1 },
      { start: 6, count: 1 },
    ]);
    const version = attribute.version;

    expect(writeSparseScalarAttribute(attribute, previousSlots, [
      { index: 4, value: 0.9 },
      { index: 6, value: 0.7 },
    ])).toBe(false);
    expect(attribute.version).toBe(version);

    expect(writeSparseScalarAttribute(attribute, previousSlots, [])).toBe(true);
    expect(previousSlots).toEqual([]);
    expect(Array.from(values)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('counts crossings of the line, not motion along it', () => {
    const attribute = new THREE.BufferAttribute(new Float32Array(8), 1);
    const slots: number[] = [];
    const epoch: ScalarThresholdEpoch = {
      threshold: CELL_EXPANDED_DETAIL_THRESHOLD,
      epoch: 0,
    };

    // Arriving above the line is a crossing — once, however many slots did it.
    expect(writeSparseScalarAttribute(attribute, slots, [
      { index: 1, value: 0.4 },
      { index: 5, value: 0.9 },
    ], epoch)).toBe(true);
    expect(epoch.epoch).toBe(1);

    // Every value moves, every slot uploads, no slot changes sides.
    const version = attribute.version;
    expect(writeSparseScalarAttribute(attribute, slots, [
      { index: 1, value: 0.55 },
      { index: 5, value: 0.61 },
    ], epoch)).toBe(true);
    expect(attribute.version).not.toBe(version);
    expect(epoch.epoch).toBe(1);

    // Two slots cross in one batch — still one bump: a batch is one answer.
    expect(writeSparseScalarAttribute(attribute, slots, [
      { index: 1, value: 0.01 },
      { index: 5, value: 0.001 },
    ], epoch)).toBe(true);
    expect(epoch.epoch).toBe(2);

    // Below the line the same churn is invisible to a threshold reader, and
    // so is the clear that finally drops both slots to zero.
    expect(writeSparseScalarAttribute(attribute, slots, [
      { index: 1, value: 0.004 },
    ], epoch)).toBe(true);
    expect(writeSparseScalarAttribute(attribute, slots, [], epoch)).toBe(true);
    expect(epoch.epoch).toBe(2);

    // A batch that changes nothing at all cannot bump either.
    expect(writeSparseScalarAttribute(attribute, slots, [], epoch)).toBe(false);
    expect(epoch.epoch).toBe(2);

    // Dropping a slot that WAS above the line is a crossing, even though the
    // batch never names it — this is the camera-LOD path losing a near cell.
    expect(writeSparseScalarAttribute(attribute, slots, [
      { index: 3, value: 0.8 },
    ], epoch)).toBe(true);
    expect(epoch.epoch).toBe(3);
    expect(writeSparseScalarAttribute(attribute, slots, [
      { index: 4, value: 0.7 },
    ], epoch)).toBe(true);
    expect(epoch.epoch).toBe(4);
    expect(Array.from(attribute.array as Float32Array)).toEqual([
      0, 0, 0, 0, Math.fround(0.7), 0, 0, 0,
    ]);
  });

  it('leaves the picker asleep for a whole hover envelope', () => {
    // The finding, replayed with the real easing and the real writer: a hover
    // in and back out at 60 fps. Detail is CellNucleus's far-field envelope
    // term — cameraDetail 0, so `focus * 0.68` — and the picker re-projects
    // ~12K cells on every pointer event the epoch moves for.
    const attribute = new THREE.BufferAttribute(new Float32Array(4), 1);
    const slots: number[] = [];
    const epoch: ScalarThresholdEpoch = {
      threshold: CELL_EXPANDED_DETAIL_THRESHOLD,
      epoch: 0,
    };
    const frame = (focus: number) => {
      const writes: ScalarAttributeSlotWrite[] = [{ index: 2, value: focus * 0.68 }];
      return writeSparseScalarAttribute(attribute, slots, writes, epoch);
    };

    let focus = 0;
    let uploads = 0;
    let frames = 0;
    for (const target of [CELL_HOVER_FOCUS, 0]) {
      // Each leg runs until the ease snaps, which `dampCellFocus` does at
      // 0.001 of its target — 0.3–0.7 s of full-rate writes per hover edge.
      for (let i = 0; i < 240 && focus !== target; i += 1) {
        focus = dampCellFocus(focus, target, 1 / 60);
        if (frame(focus)) uploads += 1;
        frames += 1;
      }
      expect(focus).toBe(target);
    }

    // The ease really did run long and really did upload the whole time...
    expect(frames).toBeGreaterThan(40);
    expect(uploads).toBe(frames);
    // ...and the pick answer changed exactly twice: on the way up and back.
    expect(epoch.epoch).toBe(2);
    expect(attribute.array[2]).toBe(0);
  });

  it('stops full-buffer writes after the focus envelope settles', () => {
    expect(SOURCE).toContain('let focusEnvelopeChanged = false');
    expect(SOURCE).toContain('if (next !== current) focusEnvelopeChanged = true');
    expect(SOURCE).toContain('const focusNeedsWrite = focusEnvelopeChanged');
    expect(SOURCE).toContain('writeSparseScalarAttribute');
    expect(SOURCE).not.toContain('focusPreviouslyActive ||');
    expect(SOURCE).not.toContain('detailArray.fill');
    expect(SOURCE).not.toContain('focusArray.fill');
    expect(SOURCE).not.toContain('recallArray.fill');
  });

  it('profiles the bounded spatial LOD query and candidate bake as one CPU scope', () => {
    const refresh = SOURCE.slice(
      SOURCE.indexOf('    if (refreshLod) {'),
      SOURCE.indexOf('    } else if (focusNeedsWrite || recallNeedsWrite)'),
    );
    const begin = refresh.indexOf('const lodProbe = beginCpuProbe(');
    const ensure = refresh.indexOf('ensureCellNucleusSpatialIndex(');
    const query = refresh.indexOf('queryCellNucleusCandidateIndices(');
    const bake = refresh.indexOf('for (const index of candidateIndices)');
    const sort = refresh.indexOf('near.current.sort(');
    const end = refresh.indexOf('endCpuProbe(lodProbe);');

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(begin).toBeLessThan(ensure);
    expect(ensure).toBeLessThan(query);
    expect(query).toBeLessThan(bake);
    expect(bake).toBeLessThan(sort);
    expect(sort).toBeLessThan(end);
    expect(refresh).toContain('PERFORMANCE_PROBE_LABELS.cellNucleusLod');
    // The scope API owns the clock gate; the production renderer must not read
    // wall time on an ordinary disabled LOD refresh.
    expect(refresh).not.toContain('performance.now');
  });

  it('reuses the stable-slot lookup for semantic ids and verified route hops', () => {
    expect(SOURCE).toContain(
      '        visibleIndexByCell,\n        directIds,',
    );
    expect(SOURCE).toContain(
      '(visibleIndexByCell.get(routeHopFocus.cellId) ?? -1)',
    );
    // A missing or stale lookup can still describe the exceptional retained
    // tail, but that scan remains route-hop-only and starts after drawCount.
    expect(SOURCE).toContain(
      'for (let index = count; index < cells.length; index += 1)',
    );
    expect(SOURCE).toContain(
      'cells[index].id !== routeHopFocus.cellId',
    );
    expect(SOURCE).not.toContain('cellNucleusSpatialIndexOf');
  });

  it('streams only populated line and node geometry ranges', () => {
    expect(SOURCE).toContain('setUsage(THREE.DynamicDrawUsage)');
    expect(SOURCE).toContain(
      'const lineFloatCount = writeCursor.lineVertices * 3',
    );
    expect(SOURCE).toContain(
      'markPopulatedBufferUpdate(positionAttribute.data, lineFloatCount)',
    );
    expect(SOURCE).toContain(
      'markPopulatedBufferUpdate(colorAttribute.data, lineFloatCount)',
    );
    expect(SOURCE).toContain(
      'writeCursor.nodes * nodePositionAttribute.itemSize',
    );
    expect(SOURCE).toContain('const committed = committedDrawCounts.current');
    expect(SOURCE).not.toContain(
      'positionAttribute.data.needsUpdate = true',
    );
    expect(SOURCE).not.toContain(
      'colorAttribute.data.needsUpdate = true',
    );
  });
});
