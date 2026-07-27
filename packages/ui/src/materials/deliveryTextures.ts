import * as THREE from 'three';

function finish(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Screen-space companion to the 3D woven carrier. Three interrupted neutral
 * loops preserve the contributor-crossing silhouette at galaxy distance while
 * the runtime material supplies the block's hash-stable A-lane colour.
 */
export function makeProtocolCarrierTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,0.58)');
  g.addColorStop(0.24, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.055)');
  g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  strokeInterruptedLoop(ctx, c, c, 40, 21, 0.12, 0.28, 0.9, 2.6);
  strokeInterruptedLoop(ctx, c, c, 24, 41, 0.46, -0.34, 0.72, 2.1);
  strokeInterruptedLoop(ctx, c, c, 34, 31, 0.78, 0.96, 0.52, 1.5);

  ctx.strokeStyle = 'rgba(255,255,255,0.96)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(c, c - 7);
  ctx.lineTo(c + 6, c);
  ctx.lineTo(c, c + 7);
  ctx.lineTo(c - 6, c);
  ctx.lineTo(c, c - 7);
  ctx.stroke();
  return finish(canvas);
}

/** Compatibility export for the legacy tuning/API name. */
export function makeBolusBloomTexture(): THREE.Texture {
  return makeProtocolCarrierTexture();
}

/** Neutral agreement flash, tinted at runtime from carrier → pale consensus. */
export function makeIngestFlashTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.16)');
  g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas);
}

/**
 * Neutral three-rail carrier trace. Interrupted contributor lanes converge at
 * the woven glyph and replace the former soft comet plume; runtime tint keeps
 * the same per-block identity as the network surge and landing mark.
 */
export function makeBolusTrailTexture(): THREE.Texture {
  const W = 96;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  const railOffsets = [-18, 0, 18];
  for (let rail = 0; rail < railOffsets.length; rail += 1) {
    const offset = railOffsets[rail];
    for (let segment = 0; segment < 7; segment += 1) {
      const y0 = 18 + segment * 31 + rail * 5;
      const y1 = Math.min(H - 12, y0 + 17 + (segment % 2) * 4);
      const f0 = y0 / H;
      const f1 = y1 / H;
      // Contributor rails open away from their shared head. The restrained
      // phase wobble prevents a rigid targeting-reticle silhouette.
      const x0 = W / 2 + offset * (0.12 + f0 * 0.88)
        + Math.sin(segment * 1.7 + rail) * 1.8;
      const x1 = W / 2 + offset * (0.12 + f1 * 0.88)
        + Math.sin((segment + 1) * 1.7 + rail) * 1.8;
      const strength = Math.pow(1 - f0, 0.82);
      ctx.strokeStyle = `rgba(255,255,255,${0.18 + strength * (rail === 1 ? 0.66 : 0.46)})`;
      ctx.lineWidth = 0.7 + strength * (rail === 1 ? 2.4 : 1.65);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Small square agreement samples make the trace read as information lanes.
    for (let node = 0; node < 3; node += 1) {
      const y = 52 + node * 58 + rail * 8;
      const f = y / H;
      const x = W / 2 + offset * (0.12 + f * 0.88);
      const alpha = 0.58 * Math.pow(1 - f, 0.7);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      const size = 2.8 - f * 1.2;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
  }
  return finish(canvas);
}

function strokeInterruptedLoop(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  phase: number,
  rotation: number,
  alpha: number,
  lineWidth: number,
): void {
  const sections = 6;
  const steps = 8;
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = lineWidth;
  for (let section = 0; section < sections; section += 1) {
    const start = phase + section / sections * Math.PI * 2;
    const end = start + Math.PI * 2 / sections * 0.63;
    ctx.beginPath();
    for (let step = 0; step <= steps; step += 1) {
      const angle = start + (end - start) * step / steps;
      const x0 = Math.cos(angle) * radiusX;
      const y0 = Math.sin(angle) * radiusY;
      const x = cx + x0 * Math.cos(rotation) - y0 * Math.sin(rotation);
      const y = cy + x0 * Math.sin(rotation) + y0 * Math.cos(rotation);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
