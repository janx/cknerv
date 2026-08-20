import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { makeCellHybridMaterial } from '../../src/materials/cellHybridMaterial';
import { makeCellFlareMaterial } from '../../src/materials/cellFlareMaterial';

/**
 * How many attributes of its own a `THREE.ShaderMaterial` may declare here.
 *
 *   16 vertex attribute slots (the ES 3.0 minimum, and what every GL backend
 *      on the reference machine reports for MAX_VERTEX_ATTRIBS)
 * −  3 declarations three.js injects into every non-raw ShaderMaterial
 *      (position, normal, uv)
 * = 13 custom attributes.
 *
 * The subtraction is unconditional because three r169 compiles these
 * materials as ESSL 3.00, where a driver assigns a slot to every DECLARED
 * input — an unused `normal` is NOT optimised away the way it is under ESSL
 * 1.00. Overrunning the budget does not fail any build, typecheck or unit
 * suite: the program simply never links, the draw call is dropped with
 * `useProgram: program not valid`, and the layer silently disappears from a
 * scene that still looks plausible. That is what this test exists to catch.
 *
 * Pack pairs into a vec2 before raising this number.
 */
const MAX_CUSTOM_VERTEX_ATTRIBUTES = 13;

/** Attribute declarations in a vertex shader source, name → GLSL type. */
function declaredAttributes(vertexShader: string): Map<string, string> {
  return new Map(
    [...vertexShader.matchAll(/^\s*attribute\s+(\w+)\s+(\w+)\s*;/gm)]
      .map((match) => [match[2], match[1]] as const),
  );
}

describe('cell vertex attribute budget', () => {
  const materials: ReadonlyArray<readonly [string, THREE.ShaderMaterial]> = [
    ['cellHybridMaterial', makeCellHybridMaterial()],
    ['cellFlareMaterial', makeCellFlareMaterial()],
  ];

  for (const [name, material] of materials) {
    it(`${name} fits the ${MAX_CUSTOM_VERTEX_ATTRIBUTES}-slot budget`, () => {
      const attributes = declaredAttributes(material.vertexShader);

      // A declaration this scan cannot see is a slot spent unaccounted for,
      // and a repeated name would collapse two of them into one entry.
      expect(attributes.size).toBe(
        (material.vertexShader.match(/^\s*attribute\s/gm) ?? []).length,
      );
      // three.js injects these three; re-declaring one both double-books a
      // slot and fails to compile.
      for (const injected of ['position', 'normal', 'uv']) {
        expect([...attributes.keys()]).not.toContain(injected);
      }

      expect(attributes.size).toBeLessThanOrEqual(
        MAX_CUSTOM_VERTEX_ATTRIBUTES,
      );
    });
  }

  it('reads every shared buffer at the same width in both layers', () => {
    const [, hybrid] = materials[0];
    const [, flare] = materials[1];
    const hybridAttributes = declaredAttributes(hybrid.vertexShader);
    const flareAttributes = declaredAttributes(flare.vertexShader);

    // The body and its write flare draw off the SAME buffers — CellGalaxy
    // hands one BufferAttribute to both geometries — so a pair packed in one
    // material and left as scalars in the other would read garbage.
    for (const [name, type] of flareAttributes) {
      const hybridType = hybridAttributes.get(name);
      if (hybridType === undefined) continue;
      expect(`${name}: ${type}`).toBe(`${name}: ${hybridType}`);
    }
    expect(flareAttributes.get('aRecordAt')).toBe('vec2');
    expect(flareAttributes.get('aStageAt')).toBe('vec2');
    expect(hybridAttributes.get('aRecordAt')).toBe('vec2');
    expect(hybridAttributes.get('aStageAt')).toBe('vec2');
  });
});
