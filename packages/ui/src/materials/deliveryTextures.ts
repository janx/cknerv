import * as THREE from 'three';

const TAU = Math.PI * 2;
export const GEOMETRIC_SHOCKWAVE_SIDES = 12;
export const GEOMETRIC_SHOCKWAVE_GAPS = 3;
export const JELLYFISH_TENTACLE_COUNT = 3;
export const JELLYFISH_TENTACLE_SEGMENTS = 6;

function finish(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function strokeSegmentedRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  lineWidth: number,
): void {
  const gapEvery = GEOMETRIC_SHOCKWAVE_SIDES / GEOMETRIC_SHOCKWAVE_GAPS;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  for (let side = 0; side < GEOMETRIC_SHOCKWAVE_SIDES; side += 1) {
    if (side % gapEvery === gapEvery - 1) continue;
    const fromAngle = side / GEOMETRIC_SHOCKWAVE_SIDES * TAU;
    const toAngle = (side + 1) / GEOMETRIC_SHOCKWAVE_SIDES * TAU;
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(fromAngle) * radius,
      cy + Math.sin(fromAngle) * radius,
    );
    ctx.lineTo(
      cx + Math.cos(toAngle) * radius,
      cy + Math.sin(toAngle) * radius,
    );
    ctx.stroke();
  }
}

/**
 * Unmarked light membrane for the low-poly bell. Geometry owns the silhouette;
 * the texture contributes only a compact falloff, avoiding nested rings,
 * caustic decoration, or any second glyph competing with the wire canopy.
 */
export function makeJellyfishBellTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  const glow = ctx.createRadialGradient(c, c - 3, 0, c, c, size / 2);
  glow.addColorStop(0.0, 'rgba(255,255,255,0.34)');
  glow.addColorStop(0.30, 'rgba(255,255,255,0.16)');
  glow.addColorStop(0.68, 'rgba(255,255,255,0.045)');
  glow.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas);
}

/** Compatibility export for the original generic carrier texture name. */
export function makeProtocolCarrierTexture(): THREE.Texture {
  return makeJellyfishBellTexture();
}

/** Compatibility export for the legacy tuning/API name. */
export function makeBolusBloomTexture(): THREE.Texture {
  return makeJellyfishBellTexture();
}

/**
 * One interrupted twelve-sided pressure crest. The three gaps echo the open
 * bell skirt and make expansion legible without adding a second concentric ring.
 */
export function makeIngestShockwaveTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  const glow = ctx.createRadialGradient(c, c, 0, c, c, size / 2);
  glow.addColorStop(0.0, 'rgba(255,255,255,0.08)');
  glow.addColorStop(0.58, 'rgba(255,255,255,0.015)');
  glow.addColorStop(0.80, 'rgba(255,255,255,0.025)');
  glow.addColorStop(0.92, 'rgba(255,255,255,0.04)');
  glow.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  strokeSegmentedRing(ctx, c, c, 53, 'rgba(255,255,255,0.20)', 6.0);
  strokeSegmentedRing(ctx, c, c, 53, 'rgba(255,255,255,0.92)', 1.8);
  return finish(canvas);
}

/** Compatibility export for the original contact-flash API name. */
export function makeIngestFlashTexture(): THREE.Texture {
  return makeIngestShockwaveTexture();
}

/**
 * Three angular energy filaments below the bell. Six tapered straight sections
 * per filament preserve the jellyfish reading with far less visual noise than
 * the former five continuously waving strands.
 */
export function makeJellyfishWakeTexture(): THREE.Texture {
  const width = 128;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  const rootGlow = ctx.createRadialGradient(width / 2, 13, 0, width / 2, 13, 34);
  rootGlow.addColorStop(0, 'rgba(255,255,255,0.42)');
  rootGlow.addColorStop(0.48, 'rgba(255,255,255,0.11)');
  rootGlow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rootGlow;
  ctx.fillRect(20, 0, width - 40, 54);

  const roots = [-25, 0, 25] as const;
  const lengths = [0.84, 1, 0.88] as const;
  for (let tentacle = 0; tentacle < JELLYFISH_TENTACLE_COUNT; tentacle += 1) {
    const root = roots[tentacle];
    const lane = tentacle - 1;
    const point = (step: number): [number, number] => {
      const t = step / JELLYFISH_TENTACLE_SEGMENTS;
      const direction = step % 2 === 0 ? 1 : -1;
      const kink = step === 0
        ? 0
        : direction * (2.0 + t * 5.0) * (tentacle === 1 ? 0.62 : 1);
      return [
        width / 2 + root * (1 - t * 0.20) + lane * t * 5 + kink,
        13 + t * (height - 28) * lengths[tentacle],
      ];
    };

    for (let segment = 0; segment < JELLYFISH_TENTACLE_SEGMENTS; segment += 1) {
      const [x0, y0] = point(segment);
      const [x1, y1] = point(segment + 1);
      const strength = Math.pow(1 - segment / JELLYFISH_TENTACLE_SEGMENTS, 0.72);
      ctx.strokeStyle = `rgba(255,255,255,${
        (tentacle === 1 ? 0.88 : 0.68) * strength
      })`;
      ctx.lineWidth = 0.55 + 2.1 * strength * (tentacle === 1 ? 1 : 0.82);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  return finish(canvas);
}

/** Compatibility export for the original carrier-trail API name. */
export function makeBolusTrailTexture(): THREE.Texture {
  return makeJellyfishWakeTexture();
}
