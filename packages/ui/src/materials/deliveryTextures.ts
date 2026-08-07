import * as THREE from 'three';

const TAU = Math.PI * 2;
export const JELLYFISH_TENTACLE_COUNT = 5;
export const JELLYFISH_TENTACLE_SEGMENTS = 14;

function finish(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function strokeRegularPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
  color: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let side = 0; side <= sides; side += 1) {
    const angle = rotation + side / sides * TAU;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (side === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Soft umbrella membrane behind the 3D carrier. One octagonal rim, one aperture,
 * and four open ribs preserve a minimal A.T.-Field silhouette; the translucent
 * fill lets the same shape read as the bell of an energy jellyfish in flight.
 */
export function makeProtocolCarrierTexture(): THREE.Texture {
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'miter';

  const glow = ctx.createRadialGradient(c, c, 0, c, c, size / 2);
  glow.addColorStop(0.0, 'rgba(255,236,168,0.30)');
  glow.addColorStop(0.28, 'rgba(255,139,38,0.15)');
  glow.addColorStop(0.68, 'rgba(255,58,8,0.055)');
  glow.addColorStop(1.0, 'rgba(255,24,0,0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const rotation = Math.PI / 8;
  strokeRegularPolygon(ctx, c, c, 73, 8, rotation, 'rgba(255,66,7,0.94)', 4.0);
  strokeRegularPolygon(ctx, c, c, 20, 8, rotation, 'rgba(255,228,130,0.92)', 2.0);

  for (let sector = 0; sector < 8; sector += 2) {
    const angle = rotation + sector / 8 * TAU;
    ctx.strokeStyle = 'rgba(255,196,68,0.58)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * 20, c + Math.sin(angle) * 20);
    ctx.lineTo(c + Math.cos(angle) * 73, c + Math.sin(angle) * 73);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255,239,164,0.88)';
  ctx.fillRect(c - 1.5, c - 1.5, 3, 3);
  return finish(canvas);
}

/** Compatibility export for the legacy tuning/API name. */
export function makeBolusBloomTexture(): THREE.Texture {
  return makeProtocolCarrierTexture();
}

/**
 * Octagonal contact wave, tinted at runtime from carrier → pale consensus.
 * The bright outer band and quiet middle make scale-up read as energy spreading
 * across the Cell field instead of as a growing solid sprite.
 */
export function makeIngestFlashTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(c, c, 0, c, c, size / 2);
  glow.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  glow.addColorStop(0.12, 'rgba(255,224,158,0.46)');
  glow.addColorStop(0.34, 'rgba(255,112,20,0.055)');
  glow.addColorStop(0.62, 'rgba(255,65,8,0.02)');
  glow.addColorStop(0.76, 'rgba(255,117,18,0.42)');
  glow.addColorStop(0.84, 'rgba(255,231,143,0.92)');
  glow.addColorStop(0.92, 'rgba(255,72,8,0.24)');
  glow.addColorStop(1.0, 'rgba(255,38,2,0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  strokeRegularPolygon(ctx, c, c, 53, 8, Math.PI / 8, 'rgba(255,99,10,0.88)', 2.6);
  strokeRegularPolygon(ctx, c, c, 47, 8, Math.PI / 8, 'rgba(255,221,112,0.64)', 1.25);
  return finish(canvas);
}

/**
 * Five soft energy tentacles rooted below the octagonal umbrella. Unequal
 * lengths, taper, and phase-offset curves replace the previous mechanical rails
 * while runtime tint keeps the whole jellyfish tied to one block identity.
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
  rootGlow.addColorStop(0, 'rgba(255,234,154,0.54)');
  rootGlow.addColorStop(0.45, 'rgba(255,117,20,0.16)');
  rootGlow.addColorStop(1, 'rgba(255,48,5,0)');
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
        ? `rgba(255,235,168,${0.90 * strength})`
        : `rgba(255,176,60,${0.78 * strength})`;
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
