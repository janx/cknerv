import { describe, expect, it } from 'vitest';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  SCREEN_CAPSULE_INDEX,
  SCREEN_CAPSULE_TRIANGLES_PER_SEGMENT,
  enableLineInspectionTransitionMaterial,
  makeScreenSpaceCapsuleGeometry,
  optimizeScreenSpaceCapsuleMaterial,
  syncScreenSpaceCapsuleViewport,
} from '../../src/geometry/screenSpaceCapsuleLine';

describe('screen-space capsule line', () => {
  it('covers the same outer capsule rectangle with one third of the triangles', () => {
    const stock = new LineSegmentsGeometry();
    const capsule = makeScreenSpaceCapsuleGeometry();

    expect(stock.index?.count).toBe(18);
    expect(capsule.index?.count).toBe(6);
    expect(capsule.index!.count / 3).toBe(
      SCREEN_CAPSULE_TRIANGLES_PER_SEGMENT,
    );
    expect(Array.from(capsule.index!.array)).toEqual([
      ...SCREEN_CAPSULE_INDEX,
    ]);

    const position = capsule.getAttribute('position');
    expect([0, 6, 1, 7].map((index) => [
      position.getX(index),
      position.getY(index),
    ])).toEqual([
      [-1, 2],
      [-1, -1],
      [1, 2],
      [1, -1],
    ]);
  });

  it('reconstructs round caps and the clamped perspective colour gradient', () => {
    const material = optimizeScreenSpaceCapsuleMaterial(new LineMaterial({
      vertexColors: true,
      worldUnits: false,
    }));

    expect(material.vertexShader).toContain('vCapsuleStartPx');
    expect(material.vertexShader).toContain(
      'resolution * capsulePixelRatio',
    );
    expect(material.vertexShader).toContain('vCapsuleColorStart');
    expect(material.fragmentShader).toContain(
      'if ( capsuleDistanceSq > capsuleRadiusSq ) discard',
    );
    expect(material.fragmentShader).toContain(
      ') * vCapsuleInvLengthSq',
    );
    expect(material.vertexShader).toContain(
      'vCapsuleStartInvW = 1.0 / clipStart.w',
    );
    expect(material.fragmentShader).toContain(
      'capsuleEndWeight = capsuleT * vCapsuleEndInvW',
    );
    expect(material.fragmentShader).not.toContain('/ capsuleLengthSq');
    expect(material.fragmentShader).not.toContain('/ vCapsuleEndW');
    expect(material.fragmentShader).toContain(
      'mix(\n\t\t\t\t\tvCapsuleColorStart,',
    );
    expect(material.fragmentShader).not.toContain(
      'if ( abs( vUv.y ) > 1.0 )',
    );

    syncScreenSpaceCapsuleViewport(material, 2, 13, 17);
    expect(material.uniforms.capsulePixelRatio.value).toBe(2);
    expect(material.uniforms.capsuleViewportOrigin.value.toArray()).toEqual([
      13,
      17,
    ]);
  });

  it('rejects material modes whose stock silhouette is not a screen capsule', () => {
    expect(() => optimizeScreenSpaceCapsuleMaterial(new LineMaterial({
      worldUnits: true,
    }))).toThrow('solid pixel-width LineMaterial');
    expect(() => optimizeScreenSpaceCapsuleMaterial(new LineMaterial({
      dashed: true,
    }))).toThrow('solid pixel-width LineMaterial');
  });

  it('cross-fades static endpoint inspection energy through one uniform', () => {
    const stock = enableLineInspectionTransitionMaterial(new LineMaterial({
      vertexColors: true,
      worldUnits: false,
    }));
    expect(stock.uniforms.inspectionTransitionProgress.value).toBe(1);
    expect(stock.vertexShader).toContain('instanceInspectionFromStart');
    expect(stock.vertexShader).toContain('instanceInspectionToEnd');
    expect(stock.fragmentShader).toContain(
      'clamp( inspectionTransitionProgress, 0.0, 1.0 )',
    );

    // The same patch composes with the two-triangle capsule rewrite used by
    // the complete passive fabric.
    optimizeScreenSpaceCapsuleMaterial(stock);
    expect(stock.fragmentShader).toContain('capsuleDistanceSq');
    expect(stock.fragmentShader).toContain(
      'vCapsuleInspectionFromStart',
    );
    expect(stock.fragmentShader).toContain(
      'clamp( capsuleColorT, 0.0, 1.0 )',
    );
  });
});
