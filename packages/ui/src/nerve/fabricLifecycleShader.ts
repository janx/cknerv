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
import { CAPSULE_INSPECTION_FRAGMENT } from '../geometry/screenSpaceCapsuleLine';
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
  FABRIC_TRUNK_PASS_MESH,
  FABRIC_TRUNK_THRESHOLD_DISABLED,
} from './fabricTrunkClass';
import { GOLD_MIX_TRUNK_GAIN } from '../derives/consensusFlow.derive';
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
		// Six attributes total — vertex attribute locations are a hard GPU
		// budget shared with the line/inspection pipeline. The curve's first
		// two .w lanes carry the static segment span and the third the width
		// tier; endpoint colors carry the CPU-baked recall-aperture scale in
		// .w (1 outside a recall).
		attribute vec4 fabricCurveFrom;   // xyz + spanStart
		attribute vec4 fabricCurveCtrl;   // xyz + spanEnd
		attribute vec4 fabricCurveTo;     // xyz + trunkness (width tier)
		attribute vec4 fabricColorFrom;   // rgb + apertureStart
		attribute vec4 fabricColorTo;     // rgb + apertureEnd
		// x: bornAtSec, y: dyingAtSec (${glf(FABRIC_LIFECYCLE_ALIVE_SENTINEL)} = alive),
		// z: brightnessMul, w: packed(deathKind*4 + deadEndTo*2 + growReversed)
		attribute vec4 fabricLifecycle;
		uniform float fabricSimTimeSec;
		uniform float fabricEnergyLive;
		uniform float fabricCenterDimLive;
		// Width tier (中央神经). Both passive passes run THIS shader over ONE
		// bake and differ only in these two scalars plus their linewidth, so
		// they cannot disagree about an edge's lifecycle, inspection weight or
		// recall aperture — and cannot both draw it.
		uniform float fabricTrunkThreshold;
		uniform float fabricTrunkPass;

		bool fabricLifeComputed = false;
		bool fabricLifeHidden = false;
		vec3 fabricLifeStart = vec3( 0.0 );
		vec3 fabricLifeEnd = vec3( 0.0 );
		vec3 fabricLifeColorStart = vec3( 0.0 );
		vec3 fabricLifeColorEnd = vec3( 0.0 );
		varying float vFabricFlash;

		vec3 fabricBezierAt( const in float t ) {
			float u = 1.0 - t;
			return u * u * fabricCurveFrom.xyz
				+ 2.0 * u * t * fabricCurveCtrl.xyz
				+ t * t * fabricCurveTo.xyz;
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
			vFabricFlash = 0.0;
			// The width partition, before any other work: an edge belongs to
			// exactly ONE pass, so the other pass drops it here having paid
			// one lane fetch and one compare. Twin of fabricTrunkPassDraws —
			// same comparison, same sentinels. Drawing an edge in BOTH passes
			// would roughly double its light and turn a width figure into a
			// brightness one, which is the de-glare ceiling this must not
			// touch.
			float fabricEdgePass = ( fabricCurveTo.w >= fabricTrunkThreshold )
				? 1.0
				: 0.0;
			if ( fabricEdgePass != fabricTrunkPass ) {
				fabricLifeHidden = true;
				return;
			}
			vec2 interval;
			float alphaMul;
			float flash;
			fabricLifecycleInterval( interval, alphaMul, flash );
			if ( fabricLifeHidden || alphaMul <= 0.0 ) {
				fabricLifeHidden = true;
				return;
			}
			vFabricFlash = flash;
			float span = interval.y - interval.x;
			float tA = min( interval.x + span * fabricCurveFrom.w, interval.y );
			float tB = min( interval.x + span * fabricCurveCtrl.w, interval.y );
			fabricLifeStart = fabricBezierAt( tA );
			fabricLifeEnd = fabricBezierAt( tB );
			float hierarchy = clamp(
				( fabricLifecycle.z - ${glf(TWIG_MIN)} ) / ( 1.0 - ${glf(TWIG_MIN)} ),
				0.0,
				1.0
			);
			// The base fabric always evaluated with usage 0 (reinforcement is
			// the warm overlay's job): trunk hierarchy alone drives the gold.
			float usage = 0.0;
			float goldMix = clamp( hierarchy, 0.0, 1.0 ) * ${glf(GOLD_MIX_TRUNK_GAIN)};
			vec3 gold = ${glv3(CONSENSUS_BRAID_PALETTE.gold)};
			vec3 retire = ${glv3(CONSENSUS_BRAID_PALETTE.retire)};
			vec3 semFrom = ( fabricColorFrom.rgb + ( gold - fabricColorFrom.rgb ) * goldMix )
				* ( 1.0 - flash ) + retire * flash;
			vec3 semTo = ( fabricColorTo.rgb + ( gold - fabricColorTo.rgb ) * goldMix )
				* ( 1.0 - flash ) + retire * flash;
			float energyBase = fabricEnergyLive * alphaMul * fabricLifecycle.z;
			// Aperture lanes are baked with flash = 0; a real retirement
			// reclaims full energy through the same affine lift the CPU applied
			// inside the aperture itself (lift commutes with the bake).
			float apertureStart = fabricColorFrom.w
				+ ( 1.0 - fabricColorFrom.w ) * flash;
			float apertureEnd = fabricColorTo.w
				+ ( 1.0 - fabricColorTo.w ) * flash;
			fabricLifeColorStart = fabricSampleColorGl(
				tA, fabricLifeStart, semFrom, semTo, energyBase,
				hierarchy, usage, flash, apertureStart
			);
			fabricLifeColorEnd = fabricSampleColorGl(
				tB, fabricLifeEnd, semFrom, semTo, energyBase,
				hierarchy, usage, flash, apertureEnd
			);
		}
`;

/** The capsule variant's endpoint-color reads, replaced with lifecycle output. */
const CAPSULE_COLOR_HOOK = 'vColor.xyz = vec3( 1.0 );';
const CAPSULE_COLOR_START_READ = 'vCapsuleColorStart = instanceColorStart;';
const CAPSULE_COLOR_END_READ = 'vCapsuleColorEnd = instanceColorEnd;';

/** Flash-lifted inspection application: attributes bake the pure field scale
 * (flash = 0) and the shader restores retirement's energy reclaim with its own
 * analytic flash — the lift is affine, so lifting the mixed value equals the
 * CPU's lift-per-endpoint-then-interpolate exactly. */
const CAPSULE_INSPECTION_FRAGMENT_LIFTED = `
			#ifdef USE_COLOR

				float fabricInspectionMix = mix(
					mix(
						vCapsuleInspectionFromStart,
						vCapsuleInspectionFromEnd,
						clamp( capsuleColorT, 0.0, 1.0 )
					),
					mix(
						vCapsuleInspectionToStart,
						vCapsuleInspectionToEnd,
						clamp( capsuleColorT, 0.0, 1.0 )
					),
					smoothstep(
						0.0,
						1.0,
						clamp( inspectionTransitionProgress, 0.0, 1.0 )
					)
				);
				diffuseColor.rgb *= fabricInspectionMix
					+ ( 1.0 - fabricInspectionMix ) * vFabricFlash;

			#endif`;

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
 *
 * `trunkPass` picks which half of the width partition this material draws.
 * Two materials over ONE geometry is the whole implementation of the trunk
 * tier: same records, same bake, same animation, one extra draw call.
 */
export function enableFabricLifecycleMaterial(
  material: LineMaterial,
  trunkPass: number = FABRIC_TRUNK_PASS_MESH,
): LineMaterial {
  material.uniforms.fabricSimTimeSec = { value: 0 };
  material.uniforms.fabricEnergyLive = { value: LIVE.cell.fabricAlpha };
  material.uniforms.fabricCenterDimLive = { value: LIVE.cell.centerDim };
  material.uniforms.fabricTrunkPass = { value: trunkPass };
  // Rest disabled: until a selection resolves a tier, the mesh pass draws
  // every edge and the wide pass draws none — exactly the pre-tier picture.
  material.uniforms.fabricTrunkThreshold = {
    value: FABRIC_TRUNK_THRESHOLD_DISABLED,
  };
  // The stock per-segment attributes become dead inputs here, and vertex
  // attribute LOCATIONS are a hard GPU budget (16 on common hardware) that
  // this stack would otherwise exceed — strip their declarations so no
  // driver can count them as active.
  material.vertexShader = replaceShaderChunk(
    material.vertexShader,
    `		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;`,
    '',
    'stock endpoint attribute declarations',
  );
  material.vertexShader = replaceShaderChunk(
    material.vertexShader,
    `		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;`,
    '',
    'stock endpoint color attribute declarations',
  );
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
  material.fragmentShader = replaceShaderChunk(
    material.fragmentShader,
    'uniform float inspectionTransitionProgress;',
    `uniform float inspectionTransitionProgress;
		varying float vFabricFlash;`,
    'fragment inspection uniform (inspection transition required)',
  );
  material.fragmentShader = replaceShaderChunk(
    material.fragmentShader,
    CAPSULE_INSPECTION_FRAGMENT,
    CAPSULE_INSPECTION_FRAGMENT_LIFTED,
    'capsule inspection fragment application',
  );
  material.needsUpdate = true;
  return material;
}

/** Publish a resolved width tier. Event-driven — one uniform write per
 * completed passive selection, and BOTH passes must receive the same value or
 * an edge would be drawn twice or not at all. */
export function setFabricTrunkThreshold(
  material: LineMaterial,
  threshold: number,
): void {
  material.uniforms.fabricTrunkThreshold.value = Number.isFinite(threshold)
    ? threshold
    : FABRIC_TRUNK_THRESHOLD_DISABLED;
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
