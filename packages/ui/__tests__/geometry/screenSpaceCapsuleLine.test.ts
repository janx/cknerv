import { describe, expect, it } from 'vitest';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  SCREEN_CAPSULE_INDEX,
  SCREEN_CAPSULE_TRIANGLES_PER_SEGMENT,
  enableTaperedCapsuleWidthMaterial,
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

  it('lets one instance carry its own width, at both ends of the same stroke', () => {
    // The bridge class is the scene's only stroke that is not one width from
    // end to end — see `BRIDGE_TIP_WIDTH_RATIO` for why a class would want
    // that and why a width LADDER could not have given it. Three patches, all
    // anchored on strings the capsule patch or the stock shader produces.
    const material = new LineMaterial({
      vertexColors: true, linewidth: 2.4, worldUnits: false,
    });
    optimizeScreenSpaceCapsuleMaterial(material);
    enableTaperedCapsuleWidthMaterial(material);

    // Two attributes in, two varyings across.
    expect(material.vertexShader)
      .toContain('attribute float instanceWidthStart;');
    expect(material.vertexShader)
      .toContain('attribute float instanceWidthEnd;');
    expect(material.vertexShader)
      .toContain('vCapsuleWidthStart = instanceWidthStart;');
    expect(material.fragmentShader)
      .toContain('varying float vCapsuleWidthEnd;');

    // ⭐ The quad expands by the WIDER end and the fragment test takes the
    // interpolated one. The quad is a bounding shape, not the silhouette, so
    // it must contain the whole tapered capsule at any taper — including a
    // reversed one — and the extra fragments at the thin end are discarded.
    expect(material.vertexShader).toContain(
      'offset *= linewidth * max( instanceWidthStart, instanceWidthEnd );',
    );
    expect(material.vertexShader).not.toContain('offset *= linewidth;');
    expect(material.fragmentShader)
      .toContain('mix( vCapsuleWidthStart, vCapsuleWidthEnd, capsuleT )');
    // The radius rides the SAME `capsuleT` the cap test already computed, so
    // the drawn shape is a swept disk of linearly varying radius and each cap
    // is still an exact circle at its own end's width.
    const radius = material.fragmentShader.indexOf('float capsuleRadius');
    const t = material.fragmentShader.indexOf('float capsuleT =');
    expect(t).toBeGreaterThan(-1);
    expect(t).toBeLessThan(radius);
    // And the stock flat-radius line is gone rather than shadowed.
    expect(material.fragmentShader)
      .not.toContain('linewidth * capsulePixelRatio * 0.5,');
  });

  it('refuses to ride a material that is not a screen-space capsule', () => {
    // The patches anchor on the capsule patch's own output, so applying them
    // to a stock material would silently miss — this makes it loud.
    const stock = new LineMaterial({
      vertexColors: true, linewidth: 2, worldUnits: false,
    });
    expect(() => enableTaperedCapsuleWidthMaterial(stock)).toThrow(/capsule/);
  });

  it('rejects material modes whose stock silhouette is not a screen capsule', () => {
    expect(() => optimizeScreenSpaceCapsuleMaterial(new LineMaterial({
      worldUnits: true,
    }))).toThrow('solid pixel-width LineMaterial');
    expect(() => optimizeScreenSpaceCapsuleMaterial(new LineMaterial({
      dashed: true,
    }))).toThrow('solid pixel-width LineMaterial');
  });

  it('carries no inspection cross-fade machinery on the stock patch', () => {
    const material = optimizeScreenSpaceCapsuleMaterial(new LineMaterial({
      vertexColors: true,
      worldUnits: false,
    }));
    expect(material.uniforms.inspectionTransitionProgress).toBeUndefined();
    expect(material.vertexShader).not.toContain('instanceInspection');
    expect(material.fragmentShader).not.toContain('inspectionTransitionProgress');
    expect(material.fragmentShader).toContain('capsuleDistanceSq');
    expect(material.fragmentShader).toContain(
      'clamp( capsuleColorT, 0.0, 1.0 )',
    );
  });
});
