import * as THREE from 'three';

/**
 * The two point primitives of the block handoff. Everything with a silhouette
 * — the carrier rim, the released front — is geometry or shader, not texture;
 * these only supply the compact light that sits at a single point.
 *
 * Both are deliberately hard-centred. Soft blobs were what made the previous
 * carrier read as an organism drifting in, and a soft contact core cannot carry
 * a "release" the way a small searing point can.
 */

function finish(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Compact core light. It rides the carrier glyph in flight and becomes the
 * searing point at contact, so one primitive covers the whole arc: a small hot
 * centre with a fast falloff and no ring, halo band, or second glyph competing
 * with the rim.
 */
export function makeCarrierCoreTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  const glow = ctx.createRadialGradient(c, c, 0, c, c, size / 2);
  glow.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  glow.addColorStop(0.08, 'rgba(255,255,255,0.62)');
  glow.addColorStop(0.22, 'rgba(255,255,255,0.20)');
  glow.addColorStop(0.52, 'rgba(255,255,255,0.05)');
  glow.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas);
}

/**
 * Travel streak. One hard-edged tapered bar — brightest at the head, gone at
 * the tail — rather than the three waving filaments the swimming carrier used.
 * Canvas row 0 is the head: the renderer aligns the plane's local +Y with the
 * travel axis and THREE's default flip maps row 0 to that end.
 */
export function makeCarrierTrailTexture(): THREE.Texture {
  const width = 64;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  const centre = width / 2;

  // Per-row fills keep the long edges hard while the bar tapers, which a
  // gradient cannot do without smearing the streak into a plume.
  for (let row = 0; row < height; row += 1) {
    const t = row / (height - 1);
    const alpha = Math.pow(1 - t, 1.7);
    if (alpha <= 0.003) continue;
    const halfSpan = Math.max(0.5, centre * 0.58 * Math.pow(1 - t, 0.85));
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(4)})`;
    ctx.fillRect(centre - halfSpan, row, halfSpan * 2, 1);
  }

  // A short hot cap so the streak reads as trailing a moving head, not as a
  // free-floating bar.
  const cap = ctx.createRadialGradient(centre, 6, 0, centre, 6, 26);
  cap.addColorStop(0, 'rgba(255,255,255,0.85)');
  cap.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  cap.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = cap;
  ctx.fillRect(0, 0, width, 40);
  return finish(canvas);
}
