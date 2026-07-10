// CellNucleusPortrait — the cell-detail hero: a dedicated <Canvas> (its own
// WebGL context, alive only while a cell is selected) rendering the BARE
// content_hash dendrite (branches + cores + inner glow, no crystal shell),
// slowly rotating, under a DIAGNOSTIC SWEEP: a bright blade beam that EXCITES
// the nucleus it crosses (branches flash + cores pop, with a fading trail),
// its phase driven by a scanEpochMs shared with the panel so the DOM cursor +
// readout decode ride the same sweep. Galaxy untouched (excitation is local).
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { dendriteNucleus } from '../../derives/dendriteNucleus';
import { makeNucleusPointMaterial } from '../../materials/cellNucleusMaterial';
import { nucleusBoundingRadius, framingScale } from './nucleusFraming';

const WARM_LINE = new THREE.Color(1.0, 0.72, 0.42); // resting branch gold
const EXCITE_HOT = new THREE.Color(1.0, 0.95, 0.82); // near-white-amber flash target
const WARMTH = 1.0;
const TARGET_WORLD_R = 1.0;
const ROT_RAD_PER_S = 0.35;
export const SCAN_PERIOD_S = 4.0;   // shared with CellDetailPanel (cursor + decode)
const SCAN_TOP = 1.25;
const SCAN_BOT = -1.25;
const BEAM_COLOR = new THREE.Color(0xffd68a);
const BLADE_COLOR = new THREE.Color(1.0, 0.92, 0.72);
const BEAM_PLANE_W = 3.0;
const HALO_PLANE_H = 0.7;
const BLADE_PLANE_H = 0.05;
// Excitation band: how the sweeping beam lights the nucleus it crosses.
const EXCITE_REACH = 0.18;   // world-Y half-band of the sharp flash
const EXCITE_TRAIL = 0.55;   // world-Y trail length behind (above) the beam
const CORE_ALPHA_BOOST = 0.9;
const CORE_SIZE_BOOST = 0.8;

/** Asymmetric "comet" halo: bright fringe at the leading edge + soft exp tail.
 *  flipY=false (DataTexture default). If the tail visually points the WRONG
 *  way live, flip by swapping `lead`→`1-lead` and the branch. */
function makeBeamHaloTexture(color: THREE.Color): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * 4);
  const r = (color.r * 255) | 0, g = (color.g * 255) | 0, b = (color.b * 255) | 0;
  const lead = 0.12;
  for (let i = 0; i < size; i++) {
    const norm = i / (size - 1);
    const a = norm < lead ? norm / lead : Math.exp(-(norm - lead) * 4.0);
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = (a * 255) | 0;
  }
  const tex = new THREE.DataTexture(data, 1, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
}

/** Excitation 0..1 of a vertex/point at world-Y `y` by a beam at `beamY`
 *  sweeping DOWN — sharp within EXCITE_REACH, plus a fading trail ABOVE
 *  (y > beamY, where the beam already passed). */
function excite(y: number, beamY: number): number {
  const d = y - beamY;
  const near = Math.abs(d) < EXCITE_REACH ? 1 - Math.abs(d) / EXCITE_REACH : 0;
  const trail = d > 0 && d < EXCITE_TRAIL ? (1 - d / EXCITE_TRAIL) * 0.6 : 0;
  return near > trail ? near : trail;
}

function NucleusScene({ contentHash, reducedMotion, scanEpochMs }: {
  contentHash: string; reducedMotion: boolean; scanEpochMs: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const bladeRef = useRef<THREE.Mesh>(null);

  const built = useMemo(() => {
    const nuc = dendriteNucleus(contentHash);
    const scale = framingScale(nucleusBoundingRadius(nuc.segments), TARGET_WORLD_R);

    // Branches: positions + a live per-vertex color buffer + precomputed Y.
    const lineGeom = new THREE.BufferGeometry();
    const n = nuc.segments.length;
    const lp = new Float32Array(n);
    const lcol = new Float32Array(n);
    const vertexY = new Float32Array(n / 3);
    for (let i = 0; i < n; i++) lp[i] = nuc.segments[i] * scale;
    for (let j = 0; j < n / 3; j++) { vertexY[j] = lp[j * 3 + 1]; lcol[j * 3] = WARM_LINE.r; lcol[j * 3 + 1] = WARM_LINE.g; lcol[j * 3 + 2] = WARM_LINE.b; }
    lineGeom.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lineGeom.setAttribute('color', new THREE.BufferAttribute(lcol, 3));

    const mkPoints = (arr: { x: number; y: number; z: number; s: number; a?: number }[], sizeMul: number) => {
      const cnt = arr.length;
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(cnt * 3);
      const size = new Float32Array(cnt);
      const alpha = new Float32Array(cnt);
      const baseSize = new Float32Array(cnt);
      const baseAlpha = new Float32Array(cnt);
      const py = new Float32Array(cnt);
      arr.forEach((nd, i) => {
        pos[i * 3] = nd.x * scale; pos[i * 3 + 1] = nd.y * scale; pos[i * 3 + 2] = nd.z * scale;
        const s = nd.s * scale * sizeMul; size[i] = s; baseSize[i] = s;
        const a = nd.a ?? 1; alpha[i] = a; baseAlpha[i] = a;
        py[i] = nd.y * scale;
      });
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      return { g, baseSize, baseAlpha, py };
    };
    const core = mkPoints(nuc.cores, 2.0);
    const glow = mkPoints(nuc.glows, 2.0);

    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const coreMat = makeNucleusPointMaterial(0.26);
    const glowMat = makeNucleusPointMaterial(0.46);
    for (const m of [coreMat, glowMat]) m.uniforms.uWarmth.value = WARMTH;
    const haloTex = makeBeamHaloTexture(BEAM_COLOR);
    return { lineGeom, lcol, vertexY, core, glow, coreGeom: core.g, glowGeom: glow.g, lineMat, coreMat, glowMat, haloTex };
  }, [contentHash]);

  useEffect(() => () => {
    const b = built;
    b.lineGeom.dispose(); b.coreGeom.dispose(); b.glowGeom.dispose();
    b.lineMat.dispose(); b.coreMat.dispose(); b.glowMat.dispose(); b.haloTex.dispose();
  }, [built]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const vh = state.size.height;
    const p11 = state.camera.projectionMatrix.elements[5];
    for (const m of [built.coreMat, built.glowMat]) {
      m.uniforms.uViewportHeight.value = vh;
      m.uniforms.uProjY.value = p11;
    }
    if (groupRef.current && !reducedMotion) groupRef.current.rotation.y = t * ROT_RAD_PER_S;

    // Beam phase off the SHARED epoch so DOM cursor + decode align to it.
    const phase = reducedMotion ? -1 : ((((performance.now() - scanEpochMs) / 1000) % SCAN_PERIOD_S) / SCAN_PERIOD_S);
    const beamY = SCAN_TOP + (SCAN_BOT - SCAN_TOP) * (phase < 0 ? 0 : phase);

    if (beamRef.current) {
      beamRef.current.visible = !reducedMotion;
      if (!reducedMotion) {
        beamRef.current.position.y = beamY;
        const op = phase > 0.94 ? (1 - phase) / 0.06 : phase < 0.04 ? phase / 0.04 : 1;
        if (haloRef.current) (haloRef.current.material as THREE.MeshBasicMaterial).opacity = op * 0.9;
        if (bladeRef.current) (bladeRef.current.material as THREE.MeshBasicMaterial).opacity = op * 0.95;
      }
    }

    // Excite branches (vertexColors) — base warm when reduced / far, hot near beam.
    const { lcol, vertexY } = built;
    for (let j = 0; j < vertexY.length; j++) {
      const e = reducedMotion ? 0 : excite(vertexY[j], beamY);
      lcol[j * 3] = WARM_LINE.r + (EXCITE_HOT.r - WARM_LINE.r) * e;
      lcol[j * 3 + 1] = WARM_LINE.g + (EXCITE_HOT.g - WARM_LINE.g) * e;
      lcol[j * 3 + 2] = WARM_LINE.b + (EXCITE_HOT.b - WARM_LINE.b) * e;
    }
    (built.lineGeom.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    // Excite cores/glows — alpha + size pop.
    for (const p of [built.core, built.glow]) {
      const aSize = p.g.getAttribute('aSize') as THREE.BufferAttribute;
      const aAlpha = p.g.getAttribute('aAlpha') as THREE.BufferAttribute;
      const sArr = aSize.array as Float32Array;
      const aArr = aAlpha.array as Float32Array;
      for (let i = 0; i < p.py.length; i++) {
        const e = reducedMotion ? 0 : excite(p.py[i], beamY);
        sArr[i] = p.baseSize[i] * (1 + e * CORE_SIZE_BOOST);
        aArr[i] = Math.min(1, p.baseAlpha[i] + e * CORE_ALPHA_BOOST);
      }
      aSize.needsUpdate = true; aAlpha.needsUpdate = true;
    }
  });

  return (
    <>
      <group ref={groupRef}>
        <lineSegments geometry={built.lineGeom} material={built.lineMat} frustumCulled={false} />
        <points geometry={built.glowGeom} material={built.glowMat} frustumCulled={false} renderOrder={2} />
        <points geometry={built.coreGeom} material={built.coreMat} frustumCulled={false} renderOrder={3} />
      </group>
      <group ref={beamRef}>
        <mesh ref={haloRef}>
          <planeGeometry args={[BEAM_PLANE_W, HALO_PLANE_H]} />
          <meshBasicMaterial map={built.haloTex} transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={bladeRef}>
          <planeGeometry args={[BEAM_PLANE_W, BLADE_PLANE_H]} />
          <meshBasicMaterial color={BLADE_COLOR} transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}

export default function CellNucleusPortrait({ contentHash, reducedMotion, scanEpochMs }: {
  contentHash: string; reducedMotion: boolean; scanEpochMs: number;
}) {
  return (
    <div style={{ width: '100%', aspectRatio: '1 / 1', pointerEvents: 'none' }}>
      <Canvas
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0, 3], fov: 40, near: 0.1, far: 20 }}
        style={{ background: 'transparent' }}
        frameloop={reducedMotion ? 'demand' : 'always'}
      >
        <NucleusScene contentHash={contentHash} reducedMotion={reducedMotion} scanEpochMs={scanEpochMs} />
      </Canvas>
    </div>
  );
}
