import * as THREE from 'three';

export type ConsensusMemoryKnotTextureProfile = 'glow' | 'core';

const TEXTURE_SIZE = 32;

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clampUnit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Transparent photonic knot: diamond rim, crossed filaments, tiny nucleus. */
export function makeConsensusMemoryKnotTexture(
  profile: ConsensusMemoryKnotTextureProfile,
): THREE.DataTexture {
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const u = (x + 0.5) / TEXTURE_SIZE - 0.5;
      const v = (y + 0.5) / TEXTURE_SIZE - 0.5;
      const diamond = Math.abs(u) + Math.abs(v);
      const radius = Math.hypot(u, v);
      const boundary = 1 - smoothstep(0.46, 0.5, diamond);
      const rimWidth = profile === 'glow' ? 0.085 : 0.035;
      const rim = Math.exp(-Math.pow((diamond - 0.36) / rimWidth, 2));
      const filamentWidth = profile === 'glow' ? 0.052 : 0.024;
      const filament = Math.max(
        Math.exp(-Math.pow(Math.abs(u - v) / filamentWidth, 2)),
        Math.exp(-Math.pow(Math.abs(u + v) / filamentWidth, 2)),
      ) * (1 - smoothstep(0.28, 0.46, diamond));
      const nucleusWidth = profile === 'glow' ? 0.12 : 0.07;
      const nucleus = Math.exp(-Math.pow(radius / nucleusWidth, 2));
      const signal = profile === 'glow'
        ? rim * 0.46 + filament * 0.2 + nucleus * 0.3
        : Math.max(rim * 0.9, filament * 0.58, nucleus);
      const alpha = Math.round(clampUnit(signal * boundary) * 255);
      const offset = (y * TEXTURE_SIZE + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(
    data,
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    THREE.RGBAFormat,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function makeConsensusMemoryKnotMaterial(
  profile: ConsensusMemoryKnotTextureProfile,
  size: number,
  opacity: number,
): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    map: makeConsensusMemoryKnotTexture(profile),
    size,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity,
    alphaTest: 0.005,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

export function disposeConsensusMemoryKnotMaterial(
  material: THREE.PointsMaterial,
): void {
  material.map?.dispose();
  material.dispose();
}
