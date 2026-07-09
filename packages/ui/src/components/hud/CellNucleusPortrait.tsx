// CellNucleusPortrait — the cell-detail hero. A small dedicated <Canvas>
// (its own WebGL context, alive only while a cell is selected) that renders
// the BARE identity nucleus — the dendrite grown from content_hash (branches
// + cores + inner glow), no crystal shell — slowly rotating, swept by a scan
// beam. Byte-identical identity to the galaxy (same dendriteNucleus derive).
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { dendriteNucleus } from '../../derives/dendriteNucleus';
import { makeNucleusPointMaterial } from '../../materials/cellNucleusMaterial';
import { nucleusBoundingRadius, framingScale } from './nucleusFraming';

const WARM_LINE = new THREE.Color(1.0, 0.72, 0.42); // warmth=1 gold (matches CellNucleus LINE_WARM)
const WARMTH = 1.0;                 // portrait is always warm gold
const TARGET_WORLD_R = 1.0;         // nucleus fits a unit radius; camera framed for ~70% fill
const ROT_RAD_PER_S = 0.35;         // slow ambient turn
const SCAN_PERIOD_S = 4.0;          // top→bottom sweep period
const SCAN_TOP = 1.25;              // beam travels a touch beyond the nucleus
const SCAN_BOT = -1.25;
const BEAM_COLOR = new THREE.Color(0xffd68a);
const BEAM_PLANE_W = 3.0;
const BEAM_PLANE_H = 0.5;

/** 1×64 gaussian gradient (bright center → transparent edges) for the beam. */
function makeBeamGradientTexture(color: THREE.Color): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * 4);
  const r = (color.r * 255) | 0, g = (color.g * 255) | 0, b = (color.b * 255) | 0;
  for (let i = 0; i < size; i++) {
    const norm = (i - size / 2) / (size / 2);
    const alpha = Math.exp(-norm * norm * 3.5);
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = (alpha * 255) | 0;
  }
  const tex = new THREE.DataTexture(data, 1, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
}

function NucleusScene({ contentHash, reducedMotion }: { contentHash: string; reducedMotion: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Mesh>(null);

  // Build pre-scaled geometry once per hash. Positions AND point sizes are
  // multiplied by the framing scale so aSize stays consistent with positions
  // (group.scale would desync the world-diameter point sizing).
  const built = useMemo(() => {
    const nuc = dendriteNucleus(contentHash);
    const scale = framingScale(nucleusBoundingRadius(nuc.segments), TARGET_WORLD_R);

    const lineGeom = new THREE.BufferGeometry();
    const lp = new Float32Array(nuc.segments.length);
    for (let i = 0; i < nuc.segments.length; i++) lp[i] = nuc.segments[i] * scale;
    lineGeom.setAttribute('position', new THREE.BufferAttribute(lp, 3));

    const mkPoints = (arr: { x: number; y: number; z: number; s: number; a?: number }[], sizeMul: number) => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(arr.length * 3);
      const size = new Float32Array(arr.length);
      const alpha = new Float32Array(arr.length);
      arr.forEach((n, i) => {
        pos[i * 3] = n.x * scale; pos[i * 3 + 1] = n.y * scale; pos[i * 3 + 2] = n.z * scale;
        size[i] = n.s * scale * sizeMul;
        alpha[i] = n.a ?? 1;
      });
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      return g;
    };
    const coreGeom = mkPoints(nuc.cores, 2.0);
    const glowGeom = mkPoints(nuc.glows, 2.0);

    const lineMat = new THREE.LineBasicMaterial({ color: WARM_LINE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const coreMat = makeNucleusPointMaterial(0.26);
    const glowMat = makeNucleusPointMaterial(0.46);
    for (const m of [coreMat, glowMat]) m.uniforms.uWarmth.value = WARMTH;
    const beamTex = makeBeamGradientTexture(BEAM_COLOR);
    return { lineGeom, coreGeom, glowGeom, lineMat, coreMat, glowMat, beamTex };
  }, [contentHash]);

  useEffect(() => () => {
    const b = built;
    b.lineGeom.dispose(); b.coreGeom.dispose(); b.glowGeom.dispose();
    b.lineMat.dispose(); b.coreMat.dispose(); b.glowMat.dispose(); b.beamTex.dispose();
  }, [built]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Per-frame point-sprite uniforms (MANDATORY, else sub-pixel).
    const vh = state.size.height;
    const p11 = state.camera.projectionMatrix.elements[5];
    for (const m of [built.coreMat, built.glowMat]) {
      m.uniforms.uViewportHeight.value = vh;
      m.uniforms.uProjY.value = p11;
    }
    if (groupRef.current && !reducedMotion) groupRef.current.rotation.y = t * ROT_RAD_PER_S;
    if (beamRef.current) {
      if (reducedMotion) {
        beamRef.current.visible = false;
      } else {
        const phase = (t % SCAN_PERIOD_S) / SCAN_PERIOD_S; // 0..1 top→bot
        beamRef.current.visible = true;
        beamRef.current.position.y = SCAN_TOP + (SCAN_BOT - SCAN_TOP) * phase;
        const mat = beamRef.current.material as THREE.MeshBasicMaterial;
        // wrap fade near the period boundary (avoid teleport)
        mat.opacity = phase > 0.92 ? (1 - phase) / 0.08 : phase < 0.05 ? phase / 0.05 : 1;
      }
    }
  });

  return (
    <>
      <ambientLight intensity={0.4} />
      <group ref={groupRef}>
        <lineSegments geometry={built.lineGeom} material={built.lineMat} frustumCulled={false} />
        <points geometry={built.glowGeom} material={built.glowMat} frustumCulled={false} renderOrder={2} />
        <points geometry={built.coreGeom} material={built.coreMat} frustumCulled={false} renderOrder={3} />
      </group>
      <mesh ref={beamRef}>
        <planeGeometry args={[BEAM_PLANE_W, BEAM_PLANE_H]} />
        <meshBasicMaterial map={built.beamTex} transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

export default function CellNucleusPortrait({ contentHash, reducedMotion }: {
  contentHash: string; reducedMotion: boolean;
}) {
  return (
    <div style={{ width: '100%', aspectRatio: '1 / 1', pointerEvents: 'none', marginBottom: 10 }}>
      <Canvas
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0, 3], fov: 40, near: 0.1, far: 20 }}
        style={{ background: 'transparent' }}
        frameloop={reducedMotion ? 'demand' : 'always'}
      >
        <NucleusScene contentHash={contentHash} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
