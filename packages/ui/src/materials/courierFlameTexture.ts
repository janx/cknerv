import * as THREE from 'three';

function finish(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Round hot bloom for the nozzle — sits at the cube so it melts into the flame
 * head (the seamless cube↔tail junction). A single white-hot → cyan → transparent
 * radial blob. Stub-safe (createRadialGradient + fillRect only).
 */
export function makeCourierBloomTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.3, 'rgba(216,250,255,0.62)');
  g.addColorStop(0.7, 'rgba(125,220,255,0.14)');
  g.addColorStop(1.0, 'rgba(125,220,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas);
}

/**
 * Directed jet-thrust plume: a tall texture, bright rounded nozzle at the TOP
 * (v=1) tapering to a feathered soft tail at the bottom (v=0). Built additively
 * from a column of overlapping radial blobs (wide+bright at the nozzle → narrow+
 * faint at the tail), so the alpha is feathered everywhere — no geometric edges.
 * Mapped on a quad whose +Y points along the flight direction. Stub-safe
 * (createRadialGradient + fillRect; `globalCompositeOperation` is just assigned).
 */
export function makeCourierPlumeTexture(): THREE.Texture {
  const W = 96;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  const N = 26;
  for (let i = 0; i < N; i += 1) {
    const f = i / (N - 1);                  // 0 = nozzle (top) .. 1 = tail (bottom)
    const cy = H * (0.12 + 0.84 * f);       // march down the canvas
    const r = W * (0.46 * (1 - f) + 0.07);  // wide at nozzle → narrow at tail
    const hot = Math.pow(1 - f, 1.4);       // brightness fades toward the tail
    const g = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, r);
    g.addColorStop(0.0, `rgba(255,255,255,${0.42 * hot})`);
    g.addColorStop(0.4, `rgba(170,235,255,${0.26 * hot})`);
    g.addColorStop(1.0, 'rgba(125,220,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  return finish(canvas);
}
