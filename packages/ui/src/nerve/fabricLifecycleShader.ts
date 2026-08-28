// GPU-parametric fabric lifecycle (P1.7). Injects the complete per-edge
// lifecycle evaluation — grow/decay/death interval, alpha, death flash, taper,
// spatial energy compression, gold reinforcement tint, usage half-life decay,
// and the tissue flush a landed block sends along the fibres — into the
// fabric layer's LineMaterial vertex stage. Slots then hold STATIC records
// (curve + colors + event timestamps) written once per event; the only
// per-frame CPU is a handful of uniform scalars (the flush's slot lanes are
// the tissueFlush singleton's own arrays, bound by reference). Every constant
// below is template-injected from the TypeScript reference implementations
// (fabricEdgeRender / fabricLuminance / consensusFlow / fabricReinforce /
// peers.derive), so the GLSL and CPU forms cannot drift apart numerically.
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
  FABRIC_TRUNK_PASS_MESH,
  FABRIC_TRUNK_THRESHOLD_DISABLED,
} from './fabricTrunkClass';
import { GOLD_MIX_TRUNK_GAIN } from '../derives/consensusFlow.derive';
import { CONSENSUS_BRAID_PALETTE } from '../derives/consensusBraid.derive';
import { LIVE } from '../tweaks/liveTweaks';
import {
  CONTACT_FRONT_FALLOFF_REFERENCE,
  CONTACT_FRONT_ONSET,
  CONTACT_FRONT_REACH_KNEE,
  CONTACT_FRONT_START_RADIUS,
} from '../derives/peers.derive';
import {
  WAVE_CREST_WAKE_GLSL,
  WAVE_WAKE_LENGTH,
} from '../materials/shockwaveMaterial';
import { CELL_GALAXY_PALETTE } from '../visualPalette';
import { TISSUE_FLUSH_SLOTS, tissueFlush } from '../tweaks/tissueFlush';

/** `fabricLifecycle.y` value meaning "alive" (no dying timestamp). Any real
 * sim-second is far below this. */
export const FABRIC_LIFECYCLE_ALIVE_SENTINEL = 1.0e30;

/** The flush crest's half-width, world units. Deliberately far wider than the
 * annulus front's crest (0.40 wu at release): the flush is sampled at capsule
 * ENDPOINTS — a fabric edge is four capsules — so a razor crest would flicker
 * segment to segment as it crossed, while a 0.9 wu edge with a ~2.9 wu wake
 * (WAVE_WAKE_LENGTH × this) interpolates cleanly. Body-dominant by
 * construction. */
export const FLUSH_HALF_WIDTH = 0.9;
/** Wake amplitude behind the flush crest, on the crest+wake profile every
 * plane of a block event draws (shockwaveMaterial.waveCrestWake). */
export const FLUSH_WAKE_AMP = 0.6;

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
		// budget shared with the line pipeline. The curve's first two .w
		// lanes carry the static segment span and the third the width tier;
		// endpoint colors carry the CPU-baked recall-aperture scale in .w
		// (1 outside a recall).
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
		// they cannot disagree about an edge's lifecycle or recall aperture —
		// and cannot both draw it.
		uniform float fabricTrunkThreshold;
		uniform float fabricTrunkPass;
		// The tissue flush: a landed block's contact front, sampled along the
		// fibres it crosses. The five slot lanes ARE the tissueFlush
		// singleton's typed arrays, bound by reference (three uploads a
		// numeric typed array as-is on every draw); the scalars are the
		// block-impact knobs, synced per frame.
		uniform float fabricFlushAt[${TISSUE_FLUSH_SLOTS}];
		uniform vec2 fabricFlushOrigin[${TISSUE_FLUSH_SLOTS}];
		uniform vec3 fabricFlushColor[${TISSUE_FLUSH_SLOTS}];
		uniform float fabricFlushReach[${TISSUE_FLUSH_SLOTS}];
		uniform float fabricFlushPunch[${TISSUE_FLUSH_SLOTS}];
		uniform float fabricFlushWindow;
		uniform float fabricFlushSpeed;
		uniform float fabricFlushFalloff;
		uniform float fabricFlushAmp;
		uniform float fabricFlushMix;

		bool fabricLifeComputed = false;
		bool fabricLifeHidden = false;
		vec3 fabricLifeStart = vec3( 0.0 );
		vec3 fabricLifeEnd = vec3( 0.0 );
		vec3 fabricLifeColorStart = vec3( 0.0 );
		vec3 fabricLifeColorEnd = vec3( 0.0 );

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

		${WAVE_CREST_WAKE_GLSL}

		// Twin of contactFrontState + contactRelease (peers.derive), run per
		// slot at ONE fibre endpoint: the front's radius from real seconds at
		// the shared wave speed, its reach clamped to what the window can
		// complete, the knee extinction, the 1/r falloff at the LIVE power,
		// the strength envelope, and the crest+wake profile every plane of a
		// block event draws. Returns the flush colour premultiplied by the
		// signal in rgb — the block's carrier hue resolving into tissue rose
		// over the window, exactly as the annulus front does — and the signal
		// itself in a. A slot at the sentinel (or outside its window) is
		// skipped on the first compare and contributes exactly 0.
		vec4 fabricFlushGl( const in vec2 xz ) {
			float total = 0.0;
			vec3 carrier = vec3( 0.0 );
			for ( int i = 0; i < ${TISSUE_FLUSH_SLOTS}; i ++ ) {
				float age = fabricSimTimeSec - fabricFlushAt[ i ];
				if ( age < 0.0 || age >= fabricFlushWindow ) continue;
				float crestRadius = ${glf(CONTACT_FRONT_START_RADIUS)} + fabricFlushSpeed * age;
				float cappedReach = min(
					fabricFlushReach[ i ],
					${glf(CONTACT_FRONT_START_RADIUS)} + fabricFlushSpeed * fabricFlushWindow
				);
				float reachFade = 1.0 - smoothstep(
					0.0,
					1.0,
					( crestRadius - cappedReach * ${glf(CONTACT_FRONT_REACH_KNEE)} )
						/ max( cappedReach * ( 1.0 - ${glf(CONTACT_FRONT_REACH_KNEE)} ), 1e-4 )
				);
				// The base is in (0, 1] by construction (radius >= start > 0),
				// so pow is defined on every driver.
				float falloff = pow(
					${glf(CONTACT_FRONT_FALLOFF_REFERENCE)} / ( ${glf(CONTACT_FRONT_FALLOFF_REFERENCE)} + crestRadius ),
					fabricFlushFalloff
				);
				float u = clamp( age / fabricFlushWindow, 0.0, 1.0 );
				float life = ( 1.0 - u ) * smoothstep( 0.0, 1.0, u / ${glf(CONTACT_FRONT_ONSET)} );
				float dist = length( xz - fabricFlushOrigin[ i ] );
				float signal = waveCrestWake(
					( dist - crestRadius ) / ${glf(FLUSH_HALF_WIDTH)},
					crestRadius - dist,
					${glf(FLUSH_HALF_WIDTH)},
					${glf(WAVE_WAKE_LENGTH)},
					${glf(FLUSH_WAKE_AMP)}
				) * reachFade * falloff * life * fabricFlushPunch[ i ];
				float colorT = 1.0 - ( 1.0 - u ) * ( 1.0 - u ) * ( 1.0 - u );
				carrier += mix( fabricFlushColor[ i ], ${glv3(CELL_GALAXY_PALETTE.tissueRose)}, colorT ) * signal;
				total += signal;
			}
			return vec4( carrier, total );
		}

		float fabricEnergyScaleGl(
			const in vec2 xz,
			const in float hierarchy,
			const in float usage,
			const in float flash,
			const in float flush
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
			// A death flash and a block's flush reclaim the core floor the
			// same way — each clamped, so neither exceeds a full reclaim, and
			// a flush of exactly 0 leaves the max exactly where it was. This
			// is what lets a flush at the galaxy core lift fibres OUT of the
			// centerDim² floor instead of multiplying 9 % by a little.
			float semanticReclaim = max(
				max( clamp( flash, 0.0, 1.0 ), clamp( flush, 0.0, 1.0 ) ),
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
			const in float apertureScale,
			const in vec4 flush
		) {
			float energy = energyBase
				* fabricTaperGl( t )
				* fabricEnergyScaleGl(
					position.xz, hierarchy, usage, flash,
					flush.a * fabricFlushAmp
				)
				* apertureScale;
			vec3 sem = semFrom + ( semTo - semFrom ) * t;
			// The flush tints as it lifts: the semantic colour leans toward
			// the front's own (carrier resolving to rose) by the signal. At a
			// signal of 0 the mix is the identity, so an idle fibre is the
			// same bits it was before the flush existed.
			sem = mix(
				sem,
				flush.rgb / max( flush.a, 1e-5 ),
				clamp( flush.a * fabricFlushMix, 0.0, 1.0 )
			);
			return sem * energy;
		}

		void computeFabricLifecycle() {
			if ( fabricLifeComputed ) return;
			fabricLifeComputed = true;
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
			// The tissue flush, sampled at each ENDPOINT and never per fragment:
			// an edge is four capsules, and the wide crest + wake interpolate
			// cleanly between endpoint samples where a razor crest would
			// flicker segment to segment.
			vec4 flushStart = fabricFlushGl( fabricLifeStart.xz );
			vec4 flushEnd = fabricFlushGl( fabricLifeEnd.xz );
			fabricLifeColorStart = fabricSampleColorGl(
				tA, fabricLifeStart, semFrom, semTo, energyBase,
				hierarchy, usage, flash, apertureStart, flushStart
			);
			fabricLifeColorEnd = fabricSampleColorGl(
				tB, fabricLifeEnd, semFrom, semTo, energyBase,
				hierarchy, usage, flash, apertureEnd, flushEnd
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
  // The flush slot lanes are the tissueFlush singleton's typed arrays, bound
  // by REFERENCE: three hands a numeric typed array to gl.uniformNfv as-is on
  // every draw (WebGLUniforms `flatten` returns it untouched), so a stamp
  // reaches BOTH passive passes on their next draw with no per-frame copy and
  // no second place for a slot to rot. The singleton never reallocates them
  // (resetTissueFlush fills in place).
  material.uniforms.fabricFlushAt = { value: tissueFlush.at };
  material.uniforms.fabricFlushOrigin = { value: tissueFlush.originXZ };
  material.uniforms.fabricFlushColor = { value: tissueFlush.color };
  material.uniforms.fabricFlushReach = { value: tissueFlush.reach };
  material.uniforms.fabricFlushPunch = { value: tissueFlush.amp };
  material.uniforms.fabricFlushWindow = { value: LIVE.delivery.ingestDur };
  material.uniforms.fabricFlushSpeed = { value: LIVE.delivery.waveSpeed };
  material.uniforms.fabricFlushFalloff = { value: LIVE.delivery.waveFalloff };
  material.uniforms.fabricFlushAmp = { value: LIVE.delivery.flushAmp };
  material.uniforms.fabricFlushMix = { value: LIVE.delivery.flushMix };
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

/** Per-frame uniform sync — the entire CPU cost of fabric animation: the sim
 * clock, the two fabric knobs, and the five block-impact scalars the flush
 * twin runs on (its window, the shared wave speed and falloff power, and its
 * own amplitude / mix). The flush slot lanes need no sync — they are the
 * singleton's arrays, bound by reference at build time. */
export function syncFabricLifecycleUniforms(
  material: LineMaterial,
  simTimeSec: number,
): void {
  const uniforms = material.uniforms;
  uniforms.fabricSimTimeSec.value = simTimeSec;
  uniforms.fabricEnergyLive.value = LIVE.cell.fabricAlpha;
  uniforms.fabricCenterDimLive.value = LIVE.cell.centerDim;
  uniforms.fabricFlushWindow.value = LIVE.delivery.ingestDur;
  uniforms.fabricFlushSpeed.value = LIVE.delivery.waveSpeed;
  uniforms.fabricFlushFalloff.value = LIVE.delivery.waveFalloff;
  uniforms.fabricFlushAmp.value = LIVE.delivery.flushAmp;
  uniforms.fabricFlushMix.value = LIVE.delivery.flushMix;
}
