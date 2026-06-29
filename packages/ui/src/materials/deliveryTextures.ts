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
