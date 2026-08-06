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
 * Screen-space membrane behind the 3D carrier. The baked ember/orange spectrum
 * is multiplied by the block's hash-stable warm colour at runtime, preserving
 * event identity while producing an A.T.-Field-inspired octagonal barrier:
 * nested plates, radial braces, and a ring of honeycomb energy facets.
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
  glow.addColorStop(0.0, 'rgba(255,226,132,0.34)');
  glow.addColorStop(0.22, 'rgba(255,139,38,0.20)');
  glow.addColorStop(0.58, 'rgba(255,66,10,0.085)');
  glow.addColorStop(0.82, 'rgba(255,35,4,0.035)');
  glow.addColorStop(1.0, 'rgba(255,24,0,0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const rotation = Math.PI / 8;
  strokeRegularPolygon(ctx, c, c, 74, 8, rotation, 'rgba(255,52,6,0.94)', 4.2);
  strokeRegularPolygon(ctx, c, c, 68, 8, rotation, 'rgba(255,128,18,0.74)', 1.3);
  strokeRegularPolygon(ctx, c, c, 57, 8, rotation, 'rgba(255,87,7,0.86)', 2.6);
  strokeRegularPolygon(ctx, c, c, 40, 8, rotation, 'rgba(255,176,42,0.82)', 2.1);
  strokeRegularPolygon(ctx, c, c, 19, 8, rotation, 'rgba(255,222,112,0.96)', 2.4);

  for (let sector = 0; sector < 8; sector += 1) {
    const angle = rotation + sector / 8 * TAU;
    const nextAngle = rotation + (sector + 1) / 8 * TAU;
    const midpointAngle = (angle + nextAngle) / 2;

    // Depth braces on the 3D glyph are echoed here so the barrier remains
    // legible at long camera distances.
    ctx.strokeStyle = sector % 2 === 0
      ? 'rgba(255,205,72,0.78)'
      : 'rgba(255,82,8,0.68)';
    ctx.lineWidth = sector % 2 === 0 ? 1.8 : 1.15;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * 19, c + Math.sin(angle) * 19);
    ctx.lineTo(c + Math.cos(angle) * 74, c + Math.sin(angle) * 74);
    ctx.stroke();

    const facetCenterX = c + Math.cos(midpointAngle) * 49;
    const facetCenterY = c + Math.sin(midpointAngle) * 49;
    strokeRegularPolygon(
      ctx,
      facetCenterX,
      facetCenterY,
      8.5,
      6,
      midpointAngle + Math.PI / 6,
      'rgba(255,119,17,0.66)',
      1.25,
    );

    // Short exterior discharge marks keep the silhouette energetic without a
    // circular halo that would hide its characteristic eight-sided profile.
    ctx.strokeStyle = 'rgba(255,173,46,0.64)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(midpointAngle) * 79, c + Math.sin(midpointAngle) * 79);
    ctx.lineTo(c + Math.cos(midpointAngle) * 87, c + Math.sin(midpointAngle) * 87);
    ctx.stroke();
  }

  // A hot central aperture anchors the otherwise translucent membrane.
  strokeRegularPolygon(ctx, c, c, 10, 8, rotation, 'rgba(255,245,194,0.98)', 2.0);
  ctx.fillStyle = 'rgba(255,232,136,0.92)';
  ctx.fillRect(c - 2, c - 2, 4, 4);
  return finish(canvas);
}

/** Compatibility export for the legacy tuning/API name. */
export function makeBolusBloomTexture(): THREE.Texture {
  return makeProtocolCarrierTexture();
}

/** Octagonal contact flare, tinted at runtime from carrier → pale consensus. */
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
  glow.addColorStop(0.24, 'rgba(255,220,150,0.74)');
  glow.addColorStop(0.62, 'rgba(255,91,15,0.18)');
  glow.addColorStop(1.0, 'rgba(255,38,2,0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  strokeRegularPolygon(ctx, c, c, 49, 8, Math.PI / 8, 'rgba(255,82,9,0.78)', 2.4);
  strokeRegularPolygon(ctx, c, c, 36, 8, Math.PI / 8, 'rgba(255,178,49,0.72)', 1.6);
  strokeRegularPolygon(ctx, c, c, 18, 8, Math.PI / 8, 'rgba(255,244,192,0.88)', 1.25);
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
