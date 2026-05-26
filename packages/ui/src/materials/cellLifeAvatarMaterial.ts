import * as THREE from 'three';

/**
 * Per-cell CellLife avatar material.
 *
 * Renders an instanced billboard quad inside each truncated-octahedron
 * `CellShell`. The fragment shader procedurally reads packed alive/amber
 * bits from per-instance vec4+float attributes and draws the seed pattern
 * using one of 6 shape masks (selected by `aShape`).
 *
 * Shape index is canonical with `cellLifeWall.ts/SHAPE_FACTORIES` so the
 * cell node avatar's 2D silhouette and the detail panel's 3D polyhedron
 * resolve from the same `byte[16] mod SHAPE_COUNT` mapping. Each
 * silhouette is the 2D projection of the corresponding 3D polyhedron
 * (tetrahedron → triangle, box → square, etc.) — see `pickShape` in the
 * fragment shader for the full table.
 *
 * Animation timing reuses the `birthEase`/`deathEase` envelope from
 * `cellEnvelope.glsl.ts` so the avatar grows and fades in lockstep with
 * its host shell.
 */

import { BIRTH_DEATH_GLSL } from './cellEnvelope.glsl';
import { CRIMSON, LCL } from './cellLifeDetail3DMaterial';

export function makeCellLifeAvatarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime:      { value: 0 },
      uBirthDurS: { value: 0.5 },
      uDeathDurS: { value: 0.6 },
      uOpacity:   { value: 0.85 },
      // Palette is sourced from cellLifeDetail3DMaterial so the avatar's
      // seed pattern reads with the same crimson/LCL pair as the detail
      // panel's polyhedra wall.
      uCrimson:   { value: CRIMSON.clone() },
      uLcl:       { value: LCL.clone() },
    },
    vertexShader: /* glsl */ `
      attribute vec3  aPos;
      attribute float aBornAt;
      attribute float aDeathAt;
      attribute float aSizeWorld;

      attribute vec4  aAlive0;
      attribute float aAlive1;
      attribute vec4  aColor0;
      attribute float aColor1;
      attribute float aShape;
      attribute float aDual;

      uniform float uTime;
      uniform float uBirthDurS;
      uniform float uDeathDurS;

      varying vec2  vUv;
      varying vec4  vAlive0;
      varying float vAlive1;
      varying vec4  vColor0;
      varying float vColor1;
      varying float vShape;
      varying float vDual;
      varying float vLifeGate;

      ${BIRTH_DEATH_GLSL}

      void main() {
        float birthRamp = clamp((uTime - aBornAt) / uBirthDurS, 0.0, 1.0);
        float deathRamp = clamp((uTime - aDeathAt) / uDeathDurS, 0.0, 1.0);
        float scale = birthEase(birthRamp) * (1.0 - deathEase(deathRamp));
        vLifeGate = scale;

        // Billboard the unit-quad to face the camera. The cell center \`aPos\`
        // is in the local frame of the rotating canopy group, so we transform
        // it through modelViewMatrix to get its view-space position, then
        // expand the quad in view space (which is always camera-aligned).
        vec4 mvCenter = modelViewMatrix * vec4(aPos, 1.0);
        vec3 viewPos = mvCenter.xyz + vec3(position.x, position.y, 0.0) * aSizeWorld * scale;
        gl_Position = projectionMatrix * vec4(viewPos, 1.0);

        vUv     = uv;
        vAlive0 = aAlive0;
        vAlive1 = aAlive1;
        vColor0 = aColor0;
        vColor1 = aColor1;
        vShape  = aShape;
        vDual   = aDual;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uOpacity;
      uniform vec3  uCrimson;
      uniform vec3  uLcl;

      varying vec2  vUv;
      varying vec4  vAlive0;
      varying float vAlive1;
      varying vec4  vColor0;
      varying float vColor1;
      varying float vShape;
      varying float vDual;
      varying float vLifeGate;

      const float GRID_SIZE = 8.0;
      const float INTERIOR_SIZE = 6.0;
      // Membrane/wireframe split inside each shape cell:
      //   FILL_INSET  shrinks the shape boundary by this much to form the
      //               inner membrane fill.
      //   The thin ring between (FILL_INSET) and (0.0) is the wireframe
      //   edge — same two-layer reading as cellLifeDetail3DMaterial's
      //   translucent membrane + bright LineSegments2 wireframe.
      //   FILL_ALPHA / EDGE_ALPHA mirror the detail panel's 0.55 membrane
      //   opacity + 0.95 edge opacity ratio.
      const float FILL_INSET = 0.06;
      const float FILL_ALPHA = 0.50;
      const float EDGE_ALPHA = 0.95;
      const float EDGE_WHITE_MIX = 0.35;

      float pickBitVec(vec4 b0, float b1, float idx) {
        float byteIdx = floor(idx / 8.0);
        float bitPos = mod(idx, 8.0);
        float byte = byteIdx < 1.0 ? b0.x
                   : byteIdx < 2.0 ? b0.y
                   : byteIdx < 3.0 ? b0.z
                   : byteIdx < 4.0 ? b0.w
                   : b1;
        return mod(floor(byte / pow(2.0, 7.0 - bitPos)), 2.0);
      }

      // Each shape returns its mask value with the outer boundary
      // inset by \`bias\` units; bias = 0 is the original shape, bias > 0
      // shrinks inward. Letting bias vary lets the same function emit
      // both the inner-fill mask and the outer-boundary mask so the
      // caller can derive the wireframe ring as (outer - inner).
      //
      // The 6 shapes are 2D silhouettes of the polyhedra in
      // cellLifeWall.ts/SHAPE_FACTORIES, in the SAME ORDER:
      //   0 Tetrahedron      → triangle (vertex-up)
      //   1 Box              → square
      //   2 Octahedron       → diamond (vertex-up)
      //   3 Icosahedron      → hexagon
      //   4 Dodecahedron     → pentagon (vertex-up)
      //   5 Octahedron sub-1 → circle (subdivision approaches sphere)
      // Keeping the mapping aligned means a given cell's content_hash
      // resolves to the same polyhedron type in the avatar and in the
      // detail panel's 3D wall.

      // 0: triangle (Tetrahedron silhouette, vertex-up).
      //   apex at p.y ≈ 0.95, base at p.y ≈ 0.10. Width tapers linearly
      //   from 0 at the apex to 0.45 (half-width) at the base.
      float shapeTriangle(vec2 p, float bias) {
        float halfBase = max(0.0, 0.45 * p.y);
        return 1.0 - smoothstep(halfBase - bias, halfBase + 0.04 - bias, abs(p.x - 0.5));
      }
      // 1: square (Box silhouette, axis-aligned).
      float shapeSquare(vec2 p, float bias) {
        return 1.0 - smoothstep(0.38 - bias, 0.42 - bias, max(abs(p.x - 0.5), abs(p.y - 0.5)));
      }
      // 2: diamond (Octahedron silhouette, vertex-up = rotated square).
      float shapeDiamond(vec2 p, float bias) {
        return 1.0 - smoothstep(0.38 - bias, 0.42 - bias, abs(p.x - 0.5) + abs(p.y - 0.5));
      }
      // 3: hexagon (Icosahedron silhouette, regular 6-sided).
      float shapeHexagon(vec2 p, float bias) {
        vec2 q = abs(p - 0.5);
        return 1.0 - smoothstep(0.38 - bias, 0.42 - bias, max(q.y, q.x * 0.866 + q.y * 0.5));
      }
      // 4: pentagon (Dodecahedron silhouette, vertex-up).
      //   Implemented as the max of 5 signed half-plane distances; one
      //   vertex points up so the silhouette reads as a "house" shape
      //   distinct from the hexagon.
      //   Edge normals (vertex-up pentagon):
      //     ( 0.588,  0.809), (-0.588,  0.809),
      //     (-0.951, -0.309), ( 0.000, -1.000), ( 0.951, -0.309)
      //   Boundary at d == 0.40, transition width 0.04, mirroring the
      //   other regular polygons so wireframe widths feel uniform.
      float shapePentagon(vec2 p, float bias) {
        vec2 q = p - 0.5;
        float d = -1.0;
        d = max(d, q.x *  0.588 + q.y *  0.809);
        d = max(d, q.x * -0.588 + q.y *  0.809);
        d = max(d, q.x * -0.951 + q.y * -0.309);
        d = max(d,                q.y * -1.000);
        d = max(d, q.x *  0.951 + q.y * -0.309);
        return 1.0 - smoothstep(0.38 - bias, 0.42 - bias, d);
      }
      // 5: circle (rounded Octahedron silhouette ≈ sphere).
      float shapeCircle(vec2 p, float bias) {
        return 1.0 - smoothstep(0.38 - bias, 0.42 - bias, length(p - 0.5));
      }

      float pickShape(int idx, vec2 p, float bias) {
        if (idx == 0) return shapeTriangle(p, bias);
        if (idx == 1) return shapeSquare(p, bias);
        if (idx == 2) return shapeDiamond(p, bias);
        if (idx == 3) return shapeHexagon(p, bias);
        if (idx == 4) return shapePentagon(p, bias);
        return shapeCircle(p, bias);
      }

      void main() {
        if (vLifeGate <= 0.0) discard;

        vec2 grid = floor(vUv * GRID_SIZE);
        if (grid.x < 1.0 || grid.x > 6.0 || grid.y < 1.0 || grid.y > 6.0) discard;

        float idx = (grid.y - 1.0) * INTERIOR_SIZE + (grid.x - 1.0);
        float alive = pickBitVec(vAlive0, vAlive1, idx);
        if (alive < 0.5) discard;

        float colorBit = pickBitVec(vColor0, vColor1, idx);
        vec3 baseColor = (vDual > 0.5 && colorBit > 0.5) ? uLcl : uCrimson;
        vec3 edgeColor = mix(baseColor, vec3(1.0), EDGE_WHITE_MIX);

        vec2 local = fract(vUv * GRID_SIZE);
        float fillMask  = pickShape(int(vShape), local, FILL_INSET);
        float outerMask = pickShape(int(vShape), local, 0.0);
        float edgeMask  = clamp(outerMask - fillMask, 0.0, 1.0);
        if (outerMask < 0.01) discard;

        // Additive blending: bake everything into RGB and emit alpha=1.
        // The composite is (membrane fill) + (wireframe edge), gated by
        // birth/death envelope and global uOpacity.
        vec3 rgb = baseColor * fillMask * FILL_ALPHA
                 + edgeColor * edgeMask * EDGE_ALPHA;
        rgb *= uOpacity * vLifeGate;
        gl_FragColor = vec4(rgb, 1.0);
      }
    `,
  });
}
