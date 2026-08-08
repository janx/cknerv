import * as THREE from 'three';

const TAU = Math.PI * 2;
const TEXTURE_CURVE_SEGMENTS = 96;
export const JELLYFISH_TENTACLE_COUNT = 5;
export const JELLYFISH_TENTACLE_SEGMENTS = 14;

function finish(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function strokeFluidLoop(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  ripple: number,
  lobes: number,
  phase: number,
  color: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let segment = 0; segment <= TEXTURE_CURVE_SEGMENTS; segment += 1) {
    const angle = segment / TEXTURE_CURVE_SEGMENTS * TAU;
    const fluidRadius = radius + ripple * Math.cos(angle * lobes + phase);
    const x = cx + Math.cos(angle) * fluidRadius;
    const y = cy + Math.sin(angle) * fluidRadius;
    if (segment === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function strokeFluidArc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  start: number,
  span: number,
  bend: number,
  color: string,
  lineWidth: number,
): void {
  const segments = 28;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let segment = 0; segment <= segments; segment += 1) {
    const t = segment / segments;
    const angle = start + span * t;
    const fluidRadius = radius + Math.sin(t * Math.PI) * bend;
    const x = cx + Math.cos(angle) * fluidRadius;
    const y = cy + Math.sin(angle) * fluidRadius;
    if (segment === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Soft front membrane for the 3D jellyfish bell. A subtly scalloped skirt and
 * drifting caustic arcs reinforce the rounded dome without a central aperture,
 * radial spokes, or a hard polygonal boundary. Runtime tint supplies the exact
 * block-carrier hue.
 */
export function makeJellyfishBellTexture(): THREE.Texture {
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const glow = ctx.createRadialGradient(c, c - 4, 0, c, c, size / 2);
  glow.addColorStop(0.0, 'rgba(255,255,255,0.42)');
  glow.addColorStop(0.24, 'rgba(255,255,255,0.22)');
  glow.addColorStop(0.58, 'rgba(255,255,255,0.075)');
  glow.addColorStop(0.86, 'rgba(255,255,255,0.025)');
  glow.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // The broad under-stroke reads as a living, translucent skirt rather than a
  // wire barrier; the narrow crest stays crisp at galaxy camera distance.
  strokeFluidLoop(ctx, c, c, 72, 2.8, 7, 0.35, 'rgba(255,255,255,0.13)', 9.0);
  strokeFluidLoop(ctx, c, c, 72, 2.8, 7, 0.35, 'rgba(255,255,255,0.88)', 2.8);
  strokeFluidLoop(ctx, c, c - 1, 58, 1.2, 7, 1.10, 'rgba(255,255,255,0.28)', 1.4);

  strokeFluidArc(ctx, c, c - 2, 48, -2.72, 1.12, 4.5, 'rgba(255,255,255,0.30)', 1.3);
  strokeFluidArc(ctx, c, c - 2, 51, -0.82, 1.20, -3.0, 'rgba(255,255,255,0.24)', 1.1);
  strokeFluidArc(ctx, c, c - 3, 36, 0.72, 1.38, 3.5, 'rgba(255,255,255,0.20)', 1.0);
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
 * Fluid pressure ring used both for the bell's faint propulsion pulse and its
 * larger Cell-galaxy contact wave. The quiet centre and round double crest make
 * scale-up read as a travelling shockwave, never as another solid object.
 */
export function makeIngestShockwaveTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  const glow = ctx.createRadialGradient(c, c, 0, c, c, size / 2);
  glow.addColorStop(0.0, 'rgba(255,255,255,0.18)');
  glow.addColorStop(0.16, 'rgba(255,255,255,0.10)');
  glow.addColorStop(0.42, 'rgba(255,255,255,0.025)');
  glow.addColorStop(0.66, 'rgba(255,255,255,0.02)');
  glow.addColorStop(0.78, 'rgba(255,255,255,0.48)');
  glow.addColorStop(0.85, 'rgba(255,255,255,0.94)');
  glow.addColorStop(0.93, 'rgba(255,255,255,0.20)');
  glow.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  strokeFluidLoop(ctx, c, c, 53, 0, 1, 0, 'rgba(255,255,255,0.24)', 7.0);
  strokeFluidLoop(ctx, c, c, 53, 0, 1, 0, 'rgba(255,255,255,0.92)', 2.2);
  strokeFluidLoop(ctx, c, c, 46, 0, 1, 0, 'rgba(255,255,255,0.42)', 1.1);
  return finish(canvas);
}

/** Compatibility export for the original contact-flash API name. */
export function makeIngestFlashTexture(): THREE.Texture {
  return makeIngestShockwaveTexture();
}

/**
 * Five soft energy tentacles rooted below the rounded umbrella. Unequal
 * lengths, taper, and phase-offset curves keep the wake biological while
 * runtime tint ties the whole jellyfish to one observed block identity.
 */
export function makeJellyfishWakeTexture(): THREE.Texture {
  const width = 128;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  const rootGlow = ctx.createRadialGradient(width / 2, 14, 0, width / 2, 14, 48);
  rootGlow.addColorStop(0, 'rgba(255,255,255,0.54)');
  rootGlow.addColorStop(0.45, 'rgba(255,255,255,0.16)');
  rootGlow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rootGlow;
  ctx.fillRect(0, 0, width, 70);

  const roots = [-33, -17, 0, 17, 33] as const;
  const lengths = [0.78, 0.94, 1, 0.90, 0.75] as const;
  for (let tentacle = 0; tentacle < JELLYFISH_TENTACLE_COUNT; tentacle += 1) {
    const root = roots[tentacle];
    const phase = tentacle * 1.37;
    const point = (t: number): [number, number] => {
      const sway = Math.sin(t * TAU * 1.28 + phase) * (3 + t * 10);
      const drift = (tentacle - 2) * t * 1.1;
      return [
        width / 2 + root * (1 - t * 0.24) + sway + drift,
        14 + t * (height - 26) * lengths[tentacle],
      ];
    };

    for (let segment = 0; segment < JELLYFISH_TENTACLE_SEGMENTS; segment += 1) {
      const t0 = segment / JELLYFISH_TENTACLE_SEGMENTS;
      const t1 = (segment + 1) / JELLYFISH_TENTACLE_SEGMENTS;
      const [x0, y0] = point(t0);
      const [x1, y1] = point(t1);
      const strength = Math.pow(1 - t0, 0.58);
      const centerGain = tentacle === 2 ? 1 : 0.84;
      ctx.strokeStyle = tentacle === 2
        ? `rgba(255,255,255,${0.90 * strength})`
        : `rgba(255,255,255,${0.78 * strength})`;
      ctx.lineWidth = 0.40 + 2.5 * strength * centerGain;
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
