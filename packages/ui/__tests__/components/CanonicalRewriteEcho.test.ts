import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  makeCanonicalRewriteEchoMaterial,
} from '../../src/components/CanonicalRewriteEcho';
import {
  CANONICAL_REWRITE_ECHO_DURATION_S,
} from '../../src/derives/canonicalRewrite.derive';

describe('CanonicalRewriteEcho material', () => {
  it('uses one additive point shader with a bounded correction lifetime', () => {
    const material = makeCanonicalRewriteEchoMaterial();

    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.uniforms.uDuration.value)
      .toBe(CANONICAL_REWRITE_ECHO_DURATION_S);
    expect(material.vertexShader).toContain('attribute float aSeed');
    expect(material.fragmentShader).toContain('diamond');

    material.dispose();
  });
});
