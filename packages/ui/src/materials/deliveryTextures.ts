import * as THREE from 'three';

const TAU = Math.PI * 2;

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
 * Soft membrane behind the 3D carrier. The baked ember spectrum is multiplied
 * by the block's hash-stable colour at runtime. A double octagon, open sectors,
 * and a small aperture preserve the A.T.-Field silhouette without decorative
 * honeycomb noise.
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
  strokeRegularPolygon(ctx, c, c, 64, 8, rotation, 'rgba(255,158,32,0.72)', 1.8);
  strokeRegularPolygon(ctx, c, c, 22, 8, rotation, 'rgba(255,228,130,0.92)', 2.2);

  for (let sector = 0; sector < 8; sector += 1) {
    const angle = rotation + sector / 8 * TAU;
    // The eight open spars echo the line geometry and keep the membrane
    // readable at distance without filling every sector with a facet.
    ctx.strokeStyle = sector % 2 === 0
      ? 'rgba(255,211,91,0.64)'
      : 'rgba(255,91,9,0.48)';
    ctx.lineWidth = sector % 2 === 0 ? 1.65 : 1.05;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * 22, c + Math.sin(angle) * 22);
    ctx.lineTo(c + Math.cos(angle) * 64, c + Math.sin(angle) * 64);
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
 * Three-rail energy wake. Broken ember lanes and tiny hexagonal fragments trail
 * the octagonal field instead of reading as a soft comet plume; runtime tint
 * keeps the wake attached to the same per-block identity as the network surge.
 */
export function makeBolusTrailTexture(): THREE.Texture {
  const width = 96;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  const railOffsets = [-18, 0, 18];
  for (let rail = 0; rail < railOffsets.length; rail += 1) {
    const offset = railOffsets[rail];
    for (let segment = 0; segment < 7; segment += 1) {
      const y0 = 18 + segment * 31 + rail * 5;
      const y1 = Math.min(height - 12, y0 + 17 + (segment % 2) * 4);
      const f0 = y0 / height;
      const f1 = y1 / height;
      const x0 = width / 2 + offset * (0.12 + f0 * 0.88)
        + Math.sin(segment * 1.7 + rail) * 1.8;
      const x1 = width / 2 + offset * (0.12 + f1 * 0.88)
        + Math.sin((segment + 1) * 1.7 + rail) * 1.8;
      const strength = Math.pow(1 - f0, 0.82);
      const alpha = 0.18 + strength * (rail === 1 ? 0.66 : 0.46);
      ctx.strokeStyle = rail === 1
        ? `rgba(255,198,74,${alpha})`
        : `rgba(255,67,9,${alpha})`;
      ctx.lineWidth = 0.7 + strength * (rail === 1 ? 2.4 : 1.65);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    for (let node = 0; node < 3; node += 1) {
      const y = 52 + node * 58 + rail * 8;
      const f = y / height;
      const x = width / 2 + offset * (0.12 + f * 0.88);
      const alpha = 0.58 * Math.pow(1 - f, 0.7);
      strokeRegularPolygon(
        ctx,
        x,
        y,
        3.2 - f * 1.2,
        6,
        Math.PI / 6,
        `rgba(255,126,22,${alpha})`,
        0.9,
      );
    }
  }
  return finish(canvas);
}
