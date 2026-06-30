import * as THREE from 'three';

function finish(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Bolus body bloom: warm-gold core (energy/matter) → cool-cyan rim
 *  (external/signal). The cool→warm read is baked into the radius. Stub-safe. */
export function makeBolusBloomTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,250,1.0)');
  g.addColorStop(0.32, 'rgba(255,207,106,0.72)'); // warm gold
  g.addColorStop(0.7, 'rgba(111,216,255,0.16)'); // cyan rim
  g.addColorStop(1.0, 'rgba(111,216,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas);
}

/** Ingest flash: her white-hot flare colour (rgb 255,252,242), so the handoff
 *  reads as the queen flaring, not an alien colour. Stub-safe. */
export function makeIngestFlashTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.3, 'rgba(255,252,242,0.7)');
  g.addColorStop(0.7, 'rgba(255,236,200,0.16)');
  g.addColorStop(1.0, 'rgba(255,236,200,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas);
}

/** Speed trail: a vertical streak baked head(top, white-gold) → tail(bottom, cyan→transparent)
 *  from stacked radial blobs (stub-safe — same idiom as courierFlameTexture). Rendered on a
 *  camera-facing Sprite that is Y-stretched at runtime; the texture's +Y (top) is the HEAD. */
export function makeBolusTrailTexture(): THREE.Texture {
  const W = 64;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  const N = 26;
  for (let i = 0; i < N; i += 1) {
    const f = i / (N - 1); // 0 = head (top) .. 1 = tail (bottom)
    const cy = H * (0.06 + 0.9 * f);
    const r = W * (0.44 * (1 - f) + 0.06);
    const hot = Math.pow(1 - f, 1.5);
    const g = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, r);
    g.addColorStop(0.0, `rgba(255,240,210,${0.5 * hot})`); // white-gold head
    g.addColorStop(0.45, `rgba(255,200,110,${0.3 * hot})`); // gold
    g.addColorStop(1.0, 'rgba(120,210,255,0.0)'); // → cyan, transparent
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  return finish(canvas);
}

/** Shockwave ring: an additive annulus (transparent core → bright cyan-white ring →
 *  transparent edge) from one radial gradient. Stub-safe. */
export function makeRingTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(170,238,255,0.0)');
  g.addColorStop(0.5, 'rgba(170,238,255,0.0)');
  g.addColorStop(0.66, 'rgba(220,250,255,0.95)'); // bright ring band
  g.addColorStop(0.78, 'rgba(150,235,255,0.25)');
  g.addColorStop(1.0, 'rgba(150,235,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas);
}
