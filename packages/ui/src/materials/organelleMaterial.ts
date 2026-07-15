import * as THREE from 'three';
// Data-payload crystal packet — violet/cyan, small, and deliberately quieter
// than the main photonic orbit packets in the selected-cell portrait.
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
      void main(){
        vec2 uv=gl_PointCoord-0.5;
        float diamond=abs(uv.x)+abs(uv.y);
        if(diamond>0.5) discard;
        float border=smoothstep(0.29,0.38,diamond)*(1.0-smoothstep(0.44,0.5,diamond));
        float bitX=step(0.0,uv.x);
        float bitY=step(0.0,uv.y);
        float bit=mix(bitX,1.0-bitY,step(0.0,uv.x*uv.y));
        float interior=(1.0-smoothstep(0.18,0.39,diamond))*(0.34+0.66*bit);
        float a=(border*0.72+interior*0.5)*vAlpha;
        vec3 violet=vec3(0.66,0.42,1.0);
        vec3 cyan=vec3(0.28,0.92,1.0);
        vec3 col=mix(violet,cyan,bit)*interior+cyan*border*0.8;
        gl_FragColor=vec4(col*a,a);
      }`,
  });
}
