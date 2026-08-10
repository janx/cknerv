// GPU-parametric fabric lifecycle (P1.7). Injects the complete per-edge
// lifecycle evaluation — grow/decay/death interval, alpha, death flash, taper,
// spatial energy compression, gold reinforcement tint, and usage half-life
// decay — into the fabric layer's LineMaterial vertex stage. Slots then hold
// STATIC records (curve + colors + event timestamps) written once per event;
// the only per-frame CPU is three uniform scalars. Every constant below is
// template-injected from the TypeScript reference implementations
// (fabricEdgeRender / fabricLuminance / consensusFlow / fabricReinforce), so
// the GLSL and CPU forms cannot drift apart numerically.
//
// Must be applied AFTER optimizeScreenSpaceCapsuleMaterial: the color hook
// anchors on the capsule variant's endpoint-constant assignments. Follows the
// house patch style — exact-string replacement that throws loudly when the
// upstream shader source drifts.

import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  DEATH_FLASH_MS,
  DEATH_RETRACT_MS,
  DECAY_MS,
  GROWTH_MS,
} from './fabricEdgeRender';
import {
  FABRIC_CORE_INNER_RADIUS,
  FABRIC_CORE_OUTER_RADIUS,
  FABRIC_TRUNK_RECLAIM,
  FABRIC_USAGE_RECLAIM,
  TAPER_MIN,
  TWIG_MIN,
} from './fabricLuminance';
import {
  GOLD_MIX_TRAFFIC_EDGE0,
  GOLD_MIX_TRAFFIC_EDGE1,
  GOLD_MIX_TRAFFIC_GAIN,
  GOLD_MIX_TRUNK_GAIN,
} from '../derives/consensusFlow.derive';
import { USAGE_DECAY_HALF_LIFE_S } from './fabricReinforce';
import { CONSENSUS_BRAID_PALETTE } from '../derives/consensusBraid.derive';
import { LIVE } from '../tweaks/liveTweaks';

/** `fabricLifecycle.y` value meaning "alive" (no dying timestamp). Any real
 * sim-second is far below this. */
export const FABRIC_LIFECYCLE_ALIVE_SENTINEL = 1.0e30;

/** GLSL float literal — guarantees a decimal point so ints stay floats. */
function glf(value: number): string {
  const s = String(value);
  return /[.e]/i.test(s) ? s : `${s}.0`;
}

function glv3(rgb: readonly number[]): string {
  return `vec3( ${glf(rgb[0])}, ${glf(rgb[1])}, ${glf(rgb[2])} )`;
}

const replaceShaderChunk = (
  source: string,
  expected: string,
  replacement: string,
  label: string,
): string => {
  if (!source.includes(expected)) {
    throw new Error(`fabric lifecycle shader: missing ${label}`);
  }
  return source.replace(expected, replacement);
};

/** Declarations + the full lifecycle evaluation, inserted before main(). All
 * four vertices of one capsule instance compute identical values, so the
 * endpoint-constant capsule varyings stay consistent without flat
 * interpolation. */
const LIFECYCLE_DECLARATIONS = `
		attribute vec3 fabricCurveFrom;
		attribute vec3 fabricCurveCtrl;
		attribute vec3 fabricCurveTo;
		attribute vec2 fabricSegmentSpan;
		attribute vec3 fabricColorFrom;
		attribute vec3 fabricColorTo;
		// x: bornAtSec, y: dyingAtSec (${glf(FABRIC_LIFECYCLE_ALIVE_SENTINEL)} = alive),
		// z: brightnessMul, w: packed(deathKind*4 + deadEndTo*2 + growReversed)
		attribute vec4 fabricLifecycle;
		// x: usage at last reinforce event, y: that event's sim-second
		attribute vec4 fabricUsage;
		// CPU-written recall-aperture scale per endpoint (1 outside recall)
		attribute vec2 fabricAperture;
		uniform float fabricSimTimeSec;
		uniform float fabricEnergyLive;
		uniform float fabricCenterDimLive;

		bool fabricLifeComputed = false;
		bool fabricLifeHidden = false;
		vec3 fabricLifeStart = vec3( 0.0 );
		vec3 fabricLifeEnd = vec3( 0.0 );
		vec3 fabricLifeColorStart = vec3( 0.0 );
		vec3 fabricLifeColorEnd = vec3( 0.0 );

		vec3 fabricBezierAt( const in float t ) {
			float u = 1.0 - t;
			return u * u * fabricCurveFrom
				+ 2.0 * u * t * fabricCurveCtrl
				+ t * t * fabricCurveTo;
		}

		float fabricTaperGl( const in float t ) {
			float k = 2.0 * t - 1.0;
			return ${glf(TAPER_MIN)} + ( 1.0 - ${glf(TAPER_MIN)} ) * k * k;
		}

		float fabricEnergyScaleGl(
			const in vec2 xz,
			const in float hierarchy,
			const in float usage,
			const in float flash
		) {
			float radius = length( xz );
			float radialMix = smoothstep(
				${glf(FABRIC_CORE_INNER_RADIUS)},
				${glf(FABRIC_CORE_OUTER_RADIUS)},
				radius
			);
			float coreFloor = clamp( fabricCenterDimLive, 0.0, 1.0 );
			coreFloor = coreFloor * coreFloor;
			float radial = coreFloor + ( 1.0 - coreFloor ) * radialMix;
			float semanticReclaim = max(
				clamp( flash, 0.0, 1.0 ),
				max(
					clamp( hierarchy, 0.0, 1.0 ) * ${glf(FABRIC_TRUNK_RECLAIM)},
					clamp( usage, 0.0, 1.0 ) * ${glf(FABRIC_USAGE_RECLAIM)}
				)
			);
			return radial + ( 1.0 - radial ) * semanticReclaim;
		}

		// Port of fabricEdgeRenderState: drawn interval + alpha + death flash.
		void fabricLifecycleInterval(
			out vec2 interval,
			out float alphaMul,
			out float flash
		) {
			interval = vec2( 0.0, 1.0 );
			alphaMul = 1.0;
			flash = 0.0;
			float flags = fabricLifecycle.w;
			float deathKind = floor( flags / 4.0 );
			float rem = flags - deathKind * 4.0;
			float deadEndTo = floor( rem / 2.0 );
			float growRev = rem - deadEndTo * 2.0;
			if ( fabricLifecycle.y < ${glf(FABRIC_LIFECYCLE_ALIVE_SENTINEL / 10)} ) {
				float decayMs = max(
					0.0,
					( fabricSimTimeSec - fabricLifecycle.y ) * 1000.0
				);
				if ( deathKind > 1.5 ) {
					if ( decayMs >= ${glf(DECAY_MS)} ) { fabricLifeHidden = true; return; }
					alphaMul = 1.0 - decayMs / ${glf(DECAY_MS)};
				} else {
					if ( decayMs >= ${glf(DEATH_RETRACT_MS)} ) { fabricLifeHidden = true; return; }
					float r = decayMs / ${glf(DEATH_RETRACT_MS)};
					flash = exp( - decayMs / ${glf(DEATH_FLASH_MS)} );
					interval.x = ( deadEndTo < 0.5 ) ? r : 0.0;
					interval.y = ( deadEndTo > 0.5 ) ? 1.0 - r : 1.0;
					if ( interval.y <= interval.x ) { fabricLifeHidden = true; return; }
				}
			} else {
				float ageMs = ( fabricSimTimeSec - fabricLifecycle.x ) * 1000.0;
				if ( ageMs < 0.0 ) { fabricLifeHidden = true; return; }
				if ( ageMs < ${glf(GROWTH_MS)} ) {
					float p = ageMs / ${glf(GROWTH_MS)};
					float u = 1.0 - p;
					alphaMul = 1.0 - u * u * u;
					interval.x = ( growRev > 0.5 ) ? 1.0 - p : 0.0;
					interval.y = ( growRev > 0.5 ) ? 1.0 : p;
				}
			}
		}

		vec3 fabricSampleColorGl(
			const in float t,
			const in vec3 position,
			const in vec3 semFrom,
			const in vec3 semTo,
			const in float energyBase,
			const in float hierarchy,
			const in float usage,
			const in float flash,
			const in float apertureScale
		) {
			float energy = energyBase
				* fabricTaperGl( t )
				* fabricEnergyScaleGl( position.xz, hierarchy, usage, flash )
				* apertureScale;
			vec3 sem = semFrom + ( semTo - semFrom ) * t;
			return sem * energy;
		}

		void computeFabricLifecycle() {
			if ( fabricLifeComputed ) return;
			fabricLifeComputed = true;
			vec2 interval;
			float alphaMul;
			float flash;
			fabricLifecycleInterval( interval, alphaMul, flash );
			if ( fabricLifeHidden || alphaMul <= 0.0 ) {
				fabricLifeHidden = true;
				return;
			}
			float span = interval.y - interval.x;
			float tA = min( interval.x + span * fabricSegmentSpan.x, interval.y );
			float tB = min( interval.x + span * fabricSegmentSpan.y, interval.y );
			fabricLifeStart = fabricBezierAt( tA );
			fabricLifeEnd = fabricBezierAt( tB );
			float hierarchy = clamp(
				( fabricLifecycle.z - ${glf(TWIG_MIN)} ) / ( 1.0 - ${glf(TWIG_MIN)} ),
				0.0,
				1.0
			);
			float usage = fabricUsage.x <= 0.0
				? 0.0
				: fabricUsage.x * exp2(
					- max( fabricSimTimeSec - fabricUsage.y, 0.0 )
						/ ${glf(USAGE_DECAY_HALF_LIFE_S)}
				);
			float goldMix = max(
				clamp( hierarchy, 0.0, 1.0 ) * ${glf(GOLD_MIX_TRUNK_GAIN)},
				smoothstep(
					${glf(GOLD_MIX_TRAFFIC_EDGE0)},
					${glf(GOLD_MIX_TRAFFIC_EDGE1)},
					clamp( usage, 0.0, 1.0 )
				) * ${glf(GOLD_MIX_TRAFFIC_GAIN)}
			);
			vec3 gold = ${glv3(CONSENSUS_BRAID_PALETTE.gold)};
			vec3 retire = ${glv3(CONSENSUS_BRAID_PALETTE.retire)};
			vec3 semFrom = ( fabricColorFrom + ( gold - fabricColorFrom ) * goldMix )
				* ( 1.0 - flash ) + retire * flash;
			vec3 semTo = ( fabricColorTo + ( gold - fabricColorTo ) * goldMix )
				* ( 1.0 - flash ) + retire * flash;
			float energyBase = fabricEnergyLive * alphaMul * fabricLifecycle.z;
			fabricLifeColorStart = fabricSampleColorGl(
				tA, fabricLifeStart, semFrom, semTo, energyBase,
				hierarchy, usage, flash, fabricAperture.x
			);
			fabricLifeColorEnd = fabricSampleColorGl(
				tB, fabricLifeEnd, semFrom, semTo, energyBase,
				hierarchy, usage, flash, fabricAperture.y
			);
		}
`;

/** The capsule variant's endpoint-color reads, replaced with lifecycle output. */
const CAPSULE_COLOR_HOOK = 'vColor.xyz = vec3( 1.0 );';
const CAPSULE_COLOR_START_READ = 'vCapsuleColorStart = instanceColorStart;';
const CAPSULE_COLOR_END_READ = 'vCapsuleColorEnd = instanceColorEnd;';

/** Stock camera-space endpoint reads (untouched by the capsule patch). */
const CAMERA_SPACE_READS = `
			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );`;

const CAMERA_SPACE_LIFECYCLE = `
			// camera space — endpoints come from the GPU-parametric lifecycle.
			computeFabricLifecycle();
			vec3 fabricStartLocal = fabricLifeHidden
				? vec3( 1.0e7, 1.0e7, 1.0e7 )
				: fabricLifeStart;
			vec3 fabricEndLocal = fabricLifeHidden
				? vec3( 1.0e7, 1.0e7, 1.0001e7 )
				: fabricLifeEnd;
			vec4 start = modelViewMatrix * vec4( fabricStartLocal, 1.0 );
			vec4 end = modelViewMatrix * vec4( fabricEndLocal, 1.0 );`;

/**
 * Patch a capsule-optimized fabric LineMaterial so segment endpoints and
 * endpoint colors are evaluated from static lifecycle records + sim time.
 * `instanceStart/End` and `instanceColorStart/End` become dead inputs on this
 * layer (the geometry keeps supplying them so shared plumbing is untouched).
 */
export function enableFabricLifecycleMaterial(
  material: LineMaterial,
): LineMaterial {
  material.uniforms.fabricSimTimeSec = { value: 0 };
  material.uniforms.fabricEnergyLive = { value: LIVE.cell.fabricAlpha };
  material.uniforms.fabricCenterDimLive = { value: LIVE.cell.centerDim };
  material.vertexShader = replaceShaderChunk(
    material.vertexShader,
    'void main() {',
    `${LIFECYCLE_DECLARATIONS}
		void main() {`,
    'main entry for lifecycle declarations',
  );
  material.vertexShader = replaceShaderChunk(
    material.vertexShader,
    CAPSULE_COLOR_HOOK,
    `computeFabricLifecycle();
				${CAPSULE_COLOR_HOOK}`,
    'capsule color hook (apply the capsule patch first)',
  );
  material.vertexShader = replaceShaderChunk(
    material.vertexShader,
    CAPSULE_COLOR_START_READ,
    'vCapsuleColorStart = fabricLifeColorStart;',
    'capsule start-color read',
  );
  material.vertexShader = replaceShaderChunk(
    material.vertexShader,
    CAPSULE_COLOR_END_READ,
    'vCapsuleColorEnd = fabricLifeColorEnd;',
    'capsule end-color read',
  );
  material.vertexShader = replaceShaderChunk(
    material.vertexShader,
    CAMERA_SPACE_READS,
    CAMERA_SPACE_LIFECYCLE,
    'camera-space endpoint reads',
  );
  material.needsUpdate = true;
  return material;
}

/** Per-frame uniform sync — the entire CPU cost of fabric animation. */
export function syncFabricLifecycleUniforms(
  material: LineMaterial,
  simTimeSec: number,
): void {
  material.uniforms.fabricSimTimeSec.value = simTimeSec;
  material.uniforms.fabricEnergyLive.value = LIVE.cell.fabricAlpha;
  material.uniforms.fabricCenterDimLive.value = LIVE.cell.centerDim;
}
