import * as THREE from 'three';

export function makeCellCanopyVeilMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uColorA: { value: new THREE.Color('#c21b4d') },
      uColorB: { value: new THREE.Color('#ff4fa3') },
      uColorC: { value: new THREE.Color('#ff8c26') },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uColorC;

      varying vec2 vUv;

      float rimNoise(vec2 p) {
        float a = atan(p.y, p.x);
        float n = 0.0;
        n += 0.040 * sin(a * 5.0 + uTime * 0.09);
        n += 0.028 * sin(a * 9.0 - uTime * 0.06 + 1.7);
        n += 0.018 * sin(a * 14.0 + p.x * 2.4 - p.y * 1.8);
        return n;
      }

      float canopyMask(vec2 p) {
        float r = length(p);
        float edge = 0.88 + rimNoise(p);
        float disk = 1.0 - smoothstep(edge - 0.26, edge, r);
        float centerRelief = smoothstep(0.08, 0.42, r);
        return disk * mix(0.54, 1.0, centerRelief);
      }

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float breathWave = sin(uTime * 1.12);
        float breath = 0.5 + 0.5 * breathWave;
        breath = smoothstep(0.0, 1.0, breath);
        vec2 breathedP = p / (1.0 + 0.022 * breathWave);
        float mask = canopyMask(breathedP);
        if (mask <= 0.0) discard;

        float drift = 0.5 + 0.5 * sin(p.x * 2.1 - p.y * 1.4);
        float colorMix = 0.56 + 0.06 * sin(p.x * 1.2 - p.y * 0.8);
        vec3 tint = mix(uColorA, uColorB, colorMix);
        tint = mix(tint, uColorC, 0.040);

        float alpha = mask * mix(0.035, 0.1025, breath) * (0.985 + 0.015 * drift) * uIntensity;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(tint, alpha);
      }
    `,
  });
}
