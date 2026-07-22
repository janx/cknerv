import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeNucleusPointMaterial } from '../../src/materials/cellNucleusMaterial';

describe('makeNucleusPointMaterial', () => {
  it('turns only resolved agreement knots into the pale-gold lock state', () => {
    const material = makeNucleusPointMaterial(0.38);

    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.vertexShader).toContain('attribute float aResolve');
    expect(material.vertexShader).toContain('vResolve = aResolve');
    expect(material.vertexShader).toContain('uViewportHeight');
    expect(material.fragmentShader).toContain('resolvedGold');
    expect(material.fragmentShader).toContain('clamp(vResolve, 0.0, 1.0)');
  });
});
