import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Vector2 } from 'three';

/**
 * LineSegmentsGeometry normally tessellates every screen-space segment as
 * three adjacent quads: start cap, body, and end cap. A capsule is convex, so
 * one enclosing quad plus the same fragment-space round-cap test produces the
 * same silhouette with one third of the triangles.
 *
 * The retained vertices are the two outer corners at each end. Their existing
 * LineMaterial positions already include the half-width cap extension.
 */
export const SCREEN_CAPSULE_INDEX = [0, 6, 1, 6, 7, 1] as const;
export const SCREEN_CAPSULE_TRIANGLES_PER_SEGMENT = 2;

const replaceShaderChunk = (
  source: string,
  expected: string,
  replacement: string,
  label: string,
): string => {
  if (!source.includes(expected)) {
    throw new Error(`LineMaterial shader changed: missing ${label}`);
  }
  return source.replace(expected, replacement);
};

/** Geometry-compatible drop-in for LineSegments2's raycasting and bounds. */
export function makeScreenSpaceCapsuleGeometry(): LineSegmentsGeometry {
  const geometry = new LineSegmentsGeometry();
  geometry.setIndex([...SCREEN_CAPSULE_INDEX]);
  return geometry;
}

const VERTEX_COLOR_ASSIGNMENT = `
			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif`;

const VERTEX_CAPSULE_ASSIGNMENT = `
			#ifdef USE_COLOR

				// The fragment shader reconstructs the original clamped endpoint
				// gradient. vColor remains neutral for Three's standard varyings.
				vColor.xyz = vec3( 1.0 );
				vCapsuleColorStart = instanceColorStart;
				vCapsuleColorEnd = instanceColorEnd;

			#endif`;

const NDC_ENDPOINTS = `
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;`;

const NDC_CAPSULE_ENDPOINTS = `${NDC_ENDPOINTS}

			// These values are identical at all four vertices of an instance,
			// hence ordinary varyings remain constant without flat interpolation.
			vec2 capsuleViewportPx = resolution * capsulePixelRatio;
			vec2 capsuleViewportOriginPx = capsuleViewportOrigin
				* capsulePixelRatio;
			vCapsuleStartPx = ( ndcStart.xy * 0.5 + 0.5 )
				* capsuleViewportPx + capsuleViewportOriginPx;
			vCapsuleEndPx = ( ndcEnd.xy * 0.5 + 0.5 )
				* capsuleViewportPx + capsuleViewportOriginPx;
			vCapsuleStartW = clipStart.w;
			vCapsuleEndW = clipEnd.w;`;

const SCREEN_CAP_TEST = `
			#else

				#ifdef USE_ALPHA_TO_COVERAGE

					// artifacts appear on some hardware if a derivative is taken within a conditional
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );

					if ( abs( vUv.y ) > 1.0 ) {

						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

					}

				#else

					if ( abs( vUv.y ) > 1.0 ) {

						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;

						if ( len2 > 1.0 ) discard;

					}

				#endif

			#endif`;

const SCREEN_CAPSULE_TEST = `
			#else

				// The two-triangle quad spans both caps. Recover the exact capsule
				// from the current fragment and the projected real endpoints.
				vec2 capsuleDelta = vCapsuleEndPx - vCapsuleStartPx;
				float capsuleLengthSq = dot( capsuleDelta, capsuleDelta );
				float capsuleLinearT = capsuleLengthSq > 1e-8
					? dot( gl_FragCoord.xy - vCapsuleStartPx, capsuleDelta ) / capsuleLengthSq
					: 0.0;
				float capsuleT = clamp( capsuleLinearT, 0.0, 1.0 );
				vec2 capsuleClosest = vCapsuleStartPx + capsuleDelta * capsuleT;
				float capsuleRadius = max(
					linewidth * capsulePixelRatio * 0.5,
					1e-6
				);
				vec2 capsuleDistance = gl_FragCoord.xy - capsuleClosest;
				float capsuleDistanceSq = dot( capsuleDistance, capsuleDistance );
				float capsuleRadiusSq = capsuleRadius * capsuleRadius;

				#ifdef USE_ALPHA_TO_COVERAGE

					float capsuleNorm = sqrt( capsuleDistanceSq ) / capsuleRadius;
					float capsuleDerivative = fwidth( capsuleNorm );
					alpha = 1.0 - smoothstep(
						1.0 - capsuleDerivative,
						1.0 + capsuleDerivative,
						capsuleNorm
					);

				#else

					if ( capsuleDistanceSq > capsuleRadiusSq ) discard;

				#endif

			#endif`;

const COLOR_FRAGMENT = '			#include <color_fragment>';
const CAPSULE_COLOR_FRAGMENT = `
			#ifdef USE_COLOR

				// Match the original body's perspective-correct interpolation, but
				// clamp both caps to their endpoint colours.
				float capsuleStartWeight = ( 1.0 - capsuleT ) / vCapsuleStartW;
				float capsuleEndWeight = capsuleT / vCapsuleEndW;
				float capsuleColorT = capsuleEndWeight
					/ ( capsuleStartWeight + capsuleEndWeight );
				diffuseColor.rgb *= mix(
					vCapsuleColorStart,
					vCapsuleColorEnd,
					clamp( capsuleColorT, 0.0, 1.0 )
				);

			#endif`;

/**
 * Patch a non-dashed, screen-space LineMaterial to shade the enclosing quad as
 * the same rounded capsule that the stock six-triangle template produced.
 * Throwing on shader-source drift makes a Three upgrade fail loudly instead of
 * silently changing the visual language.
 */
export function optimizeScreenSpaceCapsuleMaterial(
  material: LineMaterial,
): LineMaterial {
  if (material.worldUnits || material.dashed) {
    throw new Error(
      'screen-space capsule optimization requires a solid pixel-width LineMaterial',
    );
  }
  material.uniforms.capsulePixelRatio = { value: 1 };
  material.uniforms.capsuleViewportOrigin = { value: new Vector2() };
  material.vertexShader = replaceShaderChunk(
    material.vertexShader,
    '#include <color_pars_vertex>',
    `#include <color_pars_vertex>

		varying vec2 vCapsuleStartPx;
		varying vec2 vCapsuleEndPx;
		varying float vCapsuleStartW;
		varying float vCapsuleEndW;
		uniform float capsulePixelRatio;
		uniform vec2 capsuleViewportOrigin;
		#ifdef USE_COLOR
			varying vec3 vCapsuleColorStart;
			varying vec3 vCapsuleColorEnd;
		#endif`,
    'vertex varying insertion point',
  );
  material.vertexShader = replaceShaderChunk(
    material.vertexShader,
    VERTEX_COLOR_ASSIGNMENT,
    VERTEX_CAPSULE_ASSIGNMENT,
    'vertex color assignment',
  );
  material.vertexShader = replaceShaderChunk(
    material.vertexShader,
    NDC_ENDPOINTS,
    NDC_CAPSULE_ENDPOINTS,
    'projected endpoints',
  );

  material.fragmentShader = replaceShaderChunk(
    material.fragmentShader,
    '#include <color_pars_fragment>',
    `#include <color_pars_fragment>

		varying vec2 vCapsuleStartPx;
		varying vec2 vCapsuleEndPx;
		varying float vCapsuleStartW;
		varying float vCapsuleEndW;
		uniform float capsulePixelRatio;
		#ifdef USE_COLOR
			varying vec3 vCapsuleColorStart;
			varying vec3 vCapsuleColorEnd;
		#endif`,
    'fragment varying insertion point',
  );
  material.fragmentShader = replaceShaderChunk(
    material.fragmentShader,
    SCREEN_CAP_TEST,
    SCREEN_CAPSULE_TEST,
    'screen-space cap test',
  );
  material.fragmentShader = replaceShaderChunk(
    material.fragmentShader,
    COLOR_FRAGMENT,
    CAPSULE_COLOR_FRAGMENT,
    'fragment color application',
  );
  material.needsUpdate = true;
  return material;
}

/** Keep CSS-pixel LineMaterial inputs aligned with physical gl_FragCoord. */
export function syncScreenSpaceCapsuleViewport(
  material: LineMaterial,
  pixelRatio: number,
  viewportX: number,
  viewportY: number,
): void {
  material.uniforms.capsulePixelRatio.value = pixelRatio;
  const origin = material.uniforms.capsuleViewportOrigin.value as Vector2;
  origin.set(viewportX, viewportY);
}
