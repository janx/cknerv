import * as THREE from 'three';
import { BIRTH_DEATH_GLSL, HASH11_GLSL } from './cellEnvelope.glsl';
import { makeShockwaveUniforms, SHOCKWAVE_SLOTS } from './shockwaveMaterial';

/**
 * Programmable silicon Cell shell.
 *
 * One instanced draw renders a faceted ceramic vessel and its technical surface
 * language. Asset class changes the package proportions, lock class changes the
 * security aperture, content_hash drives checksum/routing traces, capacity is
 * physical mass, and observed data density populates violet memory lanes.
 */
export function makeCellOrganismMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBirthDurS: { value: 0.5 },
      uDeathDurS: { value: 0.6 },
      uOpacity: { value: 1.0 },
      ...makeShockwaveUniforms(),
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec3 aBary;
      attribute vec3 aAccent;
      attribute vec4 aGenome;
      // x asset class, y lock class, z observed payload density, w capacity mass
      attribute vec4 aSemantic;
      attribute float aBornAt;
      attribute float aDeathAt;
      attribute float aRotPhase;

      uniform float uTime;
      uniform float uBirthDurS;
      uniform float uDeathDurS;
      uniform float uShockwaveAt[${SHOCKWAVE_SLOTS}];
      uniform vec2 uShockwaveOriginXZ[${SHOCKWAVE_SLOTS}];
      uniform float uShockwaveSpeed;
      uniform float uShockwaveDurS;
      uniform float uShockwaveBandBase;
      uniform float uShockwaveBandGrow;
      uniform float uShockwaveTrailBoost;

      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;
      varying vec3 vAccent;
      varying vec3 vBary;
      varying vec4 vGenome;
      varying vec4 vSemantic;
      varying float vLife;
      varying float vShockwave;

      ${BIRTH_DEATH_GLSL}

      float shockwaveAtVertex(vec2 worldXZ) {
        float total = 0.0;
        for (int i = 0; i < ${SHOCKWAVE_SLOTS}; i++) {
          float age = uTime - uShockwaveAt[i];
          if (age < 0.0 || age >= uShockwaveDurS) continue;
          float ringR = uShockwaveSpeed * age;
          float dist = length(worldXZ - uShockwaveOriginXZ[i]);
          float bandWidth = uShockwaveBandBase + uShockwaveBandGrow * age;
          float band = exp(-pow((dist - ringR) / bandWidth, 2.0));
          float behind = max(0.0, ringR - dist);
          float trail = exp(-behind / max(bandWidth * 3.2, 0.001)) * step(dist, ringR);
          float t = age / uShockwaveDurS;
          float life = sin(3.14159265 * t)
            * (1.0 - smoothstep(0.3, 1.0, t))
            * (1.0 - t);
          total += (band + trail * uShockwaveTrailBoost) * life;
        }
        return total;
      }

      void main() {
        float birth = clamp((uTime - aBornAt) / uBirthDurS, 0.0, 1.0);
        float death = clamp((uTime - aDeathAt) / uDeathDurS, 0.0, 1.0);
        float life = birthEase(birth) * (1.0 - deathEase(death));
        vLife = life;
        vAccent = aAccent;
        vGenome = aGenome;
        vSemantic = aSemantic;
        vBary = aBary;

        vec3 unit = normalize(position);

        // Asset families are processor-package proportions, never soft lobes.
        vec3 classScale = vec3(1.0);
        if (aSemantic.x > 0.5 && aSemantic.x < 1.5) {
          classScale = vec3(1.08, 0.78, 1.08); // sUDT: planar chiplet carrier
        } else if (aSemantic.x > 1.5 && aSemantic.x < 2.5) {
          classScale = vec3(1.13, 0.86, 0.95); // xUDT: asymmetric extension plane
        } else if (aSemantic.x > 2.5 && aSemantic.x < 3.5) {
          classScale = vec3(0.91, 1.24, 0.91); // DAO: block-height clock stack
        } else if (aSemantic.x > 3.5 && aSemantic.x < 4.5) {
          classScale = vec3(0.88, 1.08, 1.16); // Spore: programmable fabric
        } else if (aSemantic.x > 4.5) {
          classScale = vec3(0.94 + aGenome.x * 0.1, 1.04, 1.08 - aGenome.x * 0.08);
        }

        // Static per-vertex crystal stress keeps every content hash distinct
        // while preserving hard planar facets. There is intentionally no breath.
        float vertexCode = fract(
          dot(abs(unit), vec3(3.13, 5.27, 7.61))
          + dot(aGenome.xyz, vec3(1.0, 1.7, 2.3))
        );
        float crystalStress = (floor(vertexCode * 4.0) / 3.0 - 0.5) * 0.032;
        vec3 p = position * classScale * aSemantic.w * (1.0 + crystalStress);

        // Pattern coordinates stay attached to the unrotated membrane. The
        // varying rides the rotated vertices, so gates/rings turn with the body
        // instead of reading like a screen-space overlay.
        vLocal = normalize(p);

        float ang = uTime * (0.012 + aGenome.y * 0.014) + aRotPhase;
        float c = cos(ang);
        float s = sin(ang);
        p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
        vec3 shapedNormal = normalize(normal / classScale);
        vec3 nr = normalize(vec3(
          c * shapedNormal.x + s * shapedNormal.z,
          shapedNormal.y,
          -s * shapedNormal.x + c * shapedNormal.z
        ));

        vec4 baseWorld = modelMatrix * instanceMatrix * vec4(p * life, 1.0);
        float shock = shockwaveAtVertex(baseWorld.xz);
        p *= 1.0 + min(1.0, shock) * 0.07;
        vec4 world = modelMatrix * instanceMatrix * vec4(p * life, 1.0);

        vShockwave = shock;
        vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * nr);
        vView = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;
      varying vec3 vAccent;
      varying vec3 vBary;
      varying vec4 vGenome;
      varying vec4 vSemantic;
      varying float vLife;
      varying float vShockwave;

      ${HASH11_GLSL}

      const float PI = 3.14159265359;
      const float TAU = 6.28318530718;

      float thinBand(float d, float inner, float outer) {
        return 1.0 - smoothstep(inner, outer, abs(d));
      }

      float squareRing(vec2 q, float radius, float width) {
        float d = max(abs(q.x), abs(q.y)) - radius;
        return thinBand(d, width * 0.35, width);
      }

      float apertureX(vec3 p, float radius, float width) {
        float cap = smoothstep(0.42, 0.80, p.x);
        return cap * squareRing(p.yz, radius, width);
      }

      float apertureY(vec3 p, float radius, float width) {
        float cap = smoothstep(0.46, 0.82, p.y);
        return cap * squareRing(p.xz, radius, width);
      }

      float apertureZ(vec3 p, float radius, float width) {
        float cap = smoothstep(0.46, 0.82, p.z);
        return cap * squareRing(p.xy, radius, width);
      }

      float accessGate(vec3 p, float lockClass) {
        float gate = apertureX(p, 0.29, 0.026);
        if (lockClass > 0.5 && lockClass < 1.5) {
          // Multisig: three coordinated square security apertures.
          gate = max(gate, apertureY(p, 0.235, 0.022));
          gate = max(gate, apertureZ(p, 0.235, 0.022));
        } else if (lockClass > 1.5 && lockClass < 2.5) {
          // ACP: deliberately open side-channel in the package aperture.
          float openSide = smoothstep(0.04, 0.22, p.y)
            * (1.0 - smoothstep(0.12, 0.32, abs(p.z)));
          gate *= 1.0 - openSide;
        } else if (lockClass > 2.5 && lockClass < 3.5) {
          // Omnilock: programmable segmented logic aperture.
          float a = (atan(p.z, p.y) + PI) / TAU;
          float segment = step(0.31, fract(a * 12.0 + vGenome.y));
          gate *= segment;
          gate = max(gate, apertureX(p, 0.19, 0.016));
        } else if (lockClass > 3.5) {
          // Unknown: incomplete classifier trace rather than fake semantics.
          float a = (atan(p.z, p.y) + PI) / TAU;
          gate *= step(0.42, hash11(floor(a * 12.0) + vGenome.z * 19.0));
        }
        return gate;
      }

      void main() {
        if (vLife <= 0.001) discard;

        vec3 N = normalize(vNormal);
        vec3 V = normalize(vView);
        vec3 P = normalize(vLocal);
        float ndv = max(dot(N, V), 0.0);
        float fresnel = pow(1.0 - ndv, 2.35);
        float diffuse = 0.35 + 0.65 * max(dot(N, normalize(vec3(0.35, 0.78, 0.52))), 0.0);

        // Facet edge gives the vessel a technical skeleton without a second draw.
        float baryMin = min(min(vBary.x, vBary.y), vBary.z);
        float facetEdge = 1.0 - smoothstep(0.0, 0.055, baryMin);

        float theta = atan(P.z, P.x);
        float u = (theta + PI) / TAU;
        float checksumHeight = 0.29 + vGenome.x * 0.10;
        float checksumBand = thinBand(abs(P.y) - checksumHeight, 0.012, 0.036);
        float tickCell = floor(u * 32.0);
        float tickShape = thinBand(fract(u * 32.0) - 0.5, 0.07, 0.15);
        float tickBit = step(0.37, hash11(tickCell + vGenome.y * 41.0));
        float checksum = checksumBand * tickShape * tickBit;

        // Orthogonal hash-stable routing fabric projected onto the polyhedron.
        float traceFreq = 4.0 + mod(vSemantic.x, 4.0);
        float traceX = thinBand(
          fract((P.x + 1.0) * traceFreq + vGenome.z) - 0.5,
          0.012,
          0.035
        ) * smoothstep(0.18, 0.5, abs(P.z));
        float traceY = thinBand(
          fract((P.y + 1.0) * (traceFreq - 1.0) + vGenome.w) - 0.5,
          0.012,
          0.035
        ) * smoothstep(0.18, 0.5, abs(P.x));
        float traceBit = step(
          0.42,
          hash11(floor((P.x + P.y + 2.0) * traceFreq) + vGenome.w * 31.0)
        );
        float trace = max(traceX, traceY) * (0.28 + 0.72 * traceBit);

        // Data occupies packetized violet memory lanes. Density controls how
        // many cells resolve; no free-floating biological organelles.
        float dataLatitude = 0.12 + vGenome.w * 0.11;
        float dataOrbit = thinBand(P.y - dataLatitude, 0.012, 0.034);
        float packetWindow = smoothstep(0.08, 0.22, fract(u * 24.0))
          * (1.0 - smoothstep(0.72, 0.90, fract(u * 24.0)));
        float dataPackets = step(0.26 + (1.0 - vSemantic.z) * 0.48,
          hash11(floor(u * 24.0) + vGenome.x * 53.0));
        dataOrbit *= packetWindow * dataPackets * vSemantic.z;

        float gate = accessGate(P, vSemantic.y);
        float shock = min(1.0, vShockwave);

        vec3 ceramic = vec3(0.006, 0.024, 0.043);
        vec3 cool = vec3(0.22, 0.82, 1.0);
        vec3 payloadViolet = vec3(0.66, 0.40, 1.0);
        vec3 siliconWhite = vec3(0.72, 0.94, 1.0);

        vec3 col = ceramic * diffuse;
        col += cool * (fresnel * 0.72 + facetEdge * 0.24);
        col += mix(siliconWhite, vAccent, 0.18) * checksum * 0.88;
        col += mix(cool, vAccent, 0.12) * trace * 0.58;
        col += payloadViolet * dataOrbit * 1.45;
        col += mix(cool, payloadViolet, 0.38) * gate * 0.92;
        col = mix(col, siliconWhite * 1.22, shock * 0.52);

        float alpha = 0.055
          + fresnel * 0.30
          + facetEdge * 0.13
          + checksum * 0.30
          + trace * 0.16
          + dataOrbit * 0.48
          + gate * 0.30
          + shock * 0.18;
        alpha = min(0.92, alpha) * vLife * uOpacity;
        if (alpha < 0.012) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}
