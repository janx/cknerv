import * as THREE from 'three';
// Green data-payload point material — same world-space sizing math as the warm
// nucleus material, distinct green so "data" reads at a glance. Portrait-only.
export function makeOrganelleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uViewportHeight: { value: 800 }, uProjY: { value: 1.0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: /* glsl */`
      attribute float aSize; attribute float aAlpha; uniform float uViewportHeight; uniform float uProjY; varying float vAlpha;
      void main(){ vAlpha=aAlpha; vec4 vp=viewMatrix*modelMatrix*vec4(position,1.0); gl_Position=projectionMatrix*vp;
        gl_PointSize=aSize*uProjY*(uViewportHeight*0.5/max(-vp.z,0.001)); }`,
    fragmentShader: /* glsl */`
      precision highp float; varying float vAlpha;
      void main(){ vec2 uv=gl_PointCoord-0.5; float r=length(uv); if(r>0.5) discard;
        float g=exp(-pow(r/0.32,2.0)); float a=g*vAlpha; gl_FragColor=vec4(vec3(0.65,0.95,0.4)*a,a); }`,
  });
}
