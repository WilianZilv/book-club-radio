// Radiance Cascades 2D (Sannikov): iluminação global de um andar visto de cima.
// Entrada: canvas R x R com a planta (rgb = luz emitida, alpha = opacidade do obstáculo).
// Cascata i: sondas a cada 2^i texels, 4^(i+1) direções, raios no intervalo [(4^i-1)/3, (4^(i+1)-1)/3];
// todas as cascatas cabem numa textura 2R x 2R (direções em blocos por sonda). Depois as cascatas são
// mescladas de cima para baixo e a cascata 0 vira a irradiância por texel (R x R), que os materiais leem.
import * as THREE from 'three'

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

const RAY = `
uniform sampler2D uScene;
uniform float uR;
uniform float uSpacing;
uniform float uSqrtD;
uniform float uStart;
uniform float uEnd;
uniform float uEmit;
varying vec2 vUv;
void main() {
  vec2 px = floor(vUv * 2.0 * uR);
  vec2 probe = floor(px / uSqrtD);
  vec2 local = px - probe * uSqrtD;
  float dirIdx = local.y * uSqrtD + local.x;
  float ang = (dirIdx + 0.5) / (uSqrtD * uSqrtD) * 6.2831853;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 origin = (probe + 0.5) * uSpacing;
  vec3 rad = vec3(0.0);
  float T = 1.0;
  float t = uStart;
  for (int k = 0; k < 400; k++) {
    if (t >= uEnd || T < 0.01) break;
    vec2 p = origin + dir * t;
    if (p.x < 0.0 || p.y < 0.0 || p.x >= uR || p.y >= uR) break;
    vec4 s = texture2D(uScene, p / uR);
    rad += T * s.rgb * s.a * uEmit;
    T *= 1.0 - s.a;
    t += 1.0;
  }
  gl_FragColor = vec4(rad, T);
}`

const MERGE = `
uniform sampler2D uRay;
uniform sampler2D uUpper;
uniform float uR;
uniform float uSpacing;
uniform float uSqrtD;
uniform float uHasUpper;
varying vec2 vUv;
void main() {
  vec2 px = floor(vUv * 2.0 * uR);
  vec2 probe = floor(px / uSqrtD);
  vec2 local = px - probe * uSqrtD;
  float dirIdx = local.y * uSqrtD + local.x;
  vec4 r = texture2D(uRay, (px + 0.5) / (2.0 * uR));
  if (uHasUpper < 0.5 || r.a < 0.001) {
    gl_FragColor = r;
    return;
  }
  float uS = uSpacing * 2.0;
  float uSq = uSqrtD * 2.0;
  float upN = uR / uS;
  vec2 g = ((probe + 0.5) * uSpacing) / uS - 0.5;
  vec2 base = floor(g);
  vec2 f = g - base;
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    vec2 off = vec2(float(j - (j / 2) * 2), float(j / 2));
    vec2 up = clamp(base + off, vec2(0.0), vec2(upN - 1.0));
    float w = (off.x > 0.5 ? f.x : 1.0 - f.x) * (off.y > 0.5 ? f.y : 1.0 - f.y);
    vec3 sum = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      float ud = dirIdx * 4.0 + float(k);
      vec2 ul = vec2(mod(ud, uSq), floor(ud / uSq));
      sum += texture2D(uUpper, (up * uSq + ul + 0.5) / (2.0 * uR)).rgb;
    }
    acc += w * sum * 0.25;
  }
  gl_FragColor = vec4(r.rgb + r.a * acc, r.a);
}`

const FINAL = `
uniform sampler2D uMerged;
uniform float uR;
varying vec2 vUv;
void main() {
  vec2 probe = floor(vUv * uR);
  vec3 sum = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    vec2 local = vec2(float(k - (k / 2) * 2), float(k / 2));
    sum += texture2D(uMerged, (probe * 2.0 + local + 0.5) / (2.0 * uR)).rgb;
  }
  gl_FragColor = vec4(sum * 0.25, 1.0);
}`

// uma das 4 direções da cascata 0 (45, 135, 225, 315 graus): luz que chega daquele lado, por texel
const FINAL_DIR = `
uniform sampler2D uMerged;
uniform float uR;
uniform float uK;
varying vec2 vUv;
void main() {
  vec2 probe = floor(vUv * uR);
  vec2 local = vec2(mod(uK, 2.0), floor(uK / 2.0));
  gl_FragColor = vec4(texture2D(uMerged, (probe * 2.0 + local + 0.5) / (2.0 * uR)).rgb, 1.0);
}`

const PREVIEW = `
uniform sampler2D uOut;
varying vec2 vUv;
void main() {
  vec3 v = texture2D(uOut, vUv).rgb * 1.5;
  gl_FragColor = vec4(pow(v / (1.0 + v), vec3(1.0 / 2.2)), 1.0);
}`

export class RadianceCascades {
  R: number
  N: number
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  sceneTex: THREE.CanvasTexture
  rays: THREE.WebGLRenderTarget[] = []
  merged: THREE.WebGLRenderTarget[] = []
  out: THREE.WebGLRenderTarget
  dirs: THREE.WebGLRenderTarget[] = []
  dirM: THREE.ShaderMaterial
  quad: THREE.Mesh
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  scene = new THREE.Scene()
  rayM: THREE.ShaderMaterial
  mergeM: THREE.ShaderMaterial
  finalM: THREE.ShaderMaterial
  previewM: THREE.ShaderMaterial
  previewRT: THREE.WebGLRenderTarget
  renderer: THREE.WebGLRenderer

  constructor(renderer: THREE.WebGLRenderer, R = 256) {
    this.renderer = renderer
    this.R = R
    // cascatas até o último intervalo cobrir a diagonal da planta
    this.N = Math.max(1, Math.ceil(Math.log(R * Math.SQRT2 * 3 + 1) / Math.log(4)))
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.canvas.height = R
    this.ctx = this.canvas.getContext('2d')!
    this.sceneTex = new THREE.CanvasTexture(this.canvas)
    // linha 0 do canvas = z 0 do mundo (sem inverter)
    this.sceneTex.flipY = false
    this.sceneTex.magFilter = THREE.NearestFilter
    this.sceneTex.minFilter = THREE.NearestFilter
    this.sceneTex.generateMipmaps = false
    const opts = { type: THREE.HalfFloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false }
    for (let i = 0; i < this.N; i++) {
      this.rays.push(new THREE.WebGLRenderTarget(2 * R, 2 * R, opts))
      this.merged.push(new THREE.WebGLRenderTarget(2 * R, 2 * R, opts))
    }
    this.out = new THREE.WebGLRenderTarget(R, R, { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false })
    for (let k = 0; k < 4; k++) this.dirs.push(new THREE.WebGLRenderTarget(R, R, { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false }))
    this.dirM = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FINAL_DIR, uniforms: { uMerged: { value: null }, uR: { value: R }, uK: { value: 0 } } })
    const uni = () => ({ uR: { value: R }, uSpacing: { value: 1 }, uSqrtD: { value: 2 } })
    this.rayM = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: RAY, uniforms: { ...uni(), uScene: { value: this.sceneTex }, uStart: { value: 0 }, uEnd: { value: 1 }, uEmit: { value: 1 } } })
    this.mergeM = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: MERGE, uniforms: { ...uni(), uRay: { value: null }, uUpper: { value: null }, uHasUpper: { value: 0 } } })
    this.finalM = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FINAL, uniforms: { uMerged: { value: null }, uR: { value: R } } })
    this.previewM = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: PREVIEW, uniforms: { uOut: { value: this.out.texture } } })
    this.previewRT = new THREE.WebGLRenderTarget(R, R, { depthBuffer: false })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.rayM)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  get texture() {
    return this.out.texture
  }

  // desenhe a planta no ctx (já limpo, preto transparente) e chame compute()
  compute(emit = 1) {
    const r = this.renderer
    const prev = r.getRenderTarget()
    const prevAuto = r.autoClear
    r.autoClear = true
    this.sceneTex.needsUpdate = true
    // raios de cada cascata
    this.quad.material = this.rayM
    for (let i = 0; i < this.N; i++) {
      const u = this.rayM.uniforms
      u.uSpacing.value = 2 ** i
      u.uSqrtD.value = 2 * 2 ** i
      u.uStart.value = (4 ** i - 1) / 3
      u.uEnd.value = (4 ** (i + 1) - 1) / 3
      u.uEmit.value = emit
      r.setRenderTarget(this.rays[i])
      r.render(this.scene, this.cam)
    }
    // mescla de cima para baixo
    this.quad.material = this.mergeM
    for (let i = this.N - 1; i >= 0; i--) {
      const u = this.mergeM.uniforms
      u.uSpacing.value = 2 ** i
      u.uSqrtD.value = 2 * 2 ** i
      u.uRay.value = this.rays[i].texture
      u.uUpper.value = i + 1 < this.N ? this.merged[i + 1].texture : null
      u.uHasUpper.value = i + 1 < this.N ? 1 : 0
      r.setRenderTarget(this.merged[i])
      r.render(this.scene, this.cam)
    }
    this.quad.material = this.finalM
    this.finalM.uniforms.uMerged.value = this.merged[0].texture
    r.setRenderTarget(this.out)
    r.render(this.scene, this.cam)
    this.quad.material = this.dirM
    this.dirM.uniforms.uMerged.value = this.merged[0].texture
    for (let k = 0; k < 4; k++) {
      this.dirM.uniforms.uK.value = k
      r.setRenderTarget(this.dirs[k])
      r.render(this.scene, this.cam)
    }
    r.setRenderTarget(prev)
    r.autoClear = prevAuto
  }

  // resultado em 8 bits (tonemap simples) para mostrar na tela; linha 0 = z 0
  preview(): Uint8Array {
    const r = this.renderer
    const prev = r.getRenderTarget()
    this.quad.material = this.previewM
    r.setRenderTarget(this.previewRT)
    r.render(this.scene, this.cam)
    const buf = new Uint8Array(this.R * this.R * 4)
    r.readRenderTargetPixels(this.previewRT, 0, 0, this.R, this.R, buf)
    r.setRenderTarget(prev)
    return buf
  }

  dispose() {
    this.previewRT.dispose()
    this.previewM.dispose()
    for (const t of [...this.rays, ...this.merged, ...this.dirs, this.out]) t.dispose()
    this.dirM.dispose()
    this.sceneTex.dispose()
    this.rayM.dispose()
    this.mergeM.dispose()
    this.finalM.dispose()
  }
}

// Liga a GI 2D num material padrão: soma a irradiância do andar (pela posição x/z do fragmento) na luz indireta.
// A luz vem em 4 direções do plano, pesadas pela normal: o lado virado para a fonte acende, o de trás fica no escuro.
export interface GiUniforms {
  // luz que sobe do chão de LED da cobertura (manta com o vídeo): cor por x/z, some com a altura
  uFloorTex: { value: THREE.Texture | null }
  uFloorRect: { value: THREE.Vector4 }
  uFloorY: { value: number }
  uFloorK: { value: number }
  uGiD0: { value: THREE.Texture | null }
  uGiD1: { value: THREE.Texture | null }
  uGiD2: { value: THREE.Texture | null }
  uGiD3: { value: THREE.Texture | null }
  uGiRect: { value: THREE.Vector4 }
  uGiY: { value: THREE.Vector2 }
  uGiStrength: { value: number }
}

export function giHook(m: THREE.Material, uni: GiUniforms) {
  const mm = m as THREE.MeshStandardMaterial
  if (!(mm.isMeshStandardMaterial) || mm.userData.gi) return
  mm.userData.gi = true
  const prev = mm.onBeforeCompile
  const prevKey = mm.customProgramCacheKey
  mm.onBeforeCompile = (sh, r) => {
    prev.call(mm, sh, r)
    Object.assign(sh.uniforms, uni)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vGiWorld;
varying vec3 vGiN;`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
// normal no mundo (a normal em vista volta pela transposta da matriz de vista)
vGiN = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vec4 giW = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
giW = instanceMatrix * giW;
#endif
vGiWorld = (modelMatrix * giW).xyz;`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vGiWorld;
varying vec3 vGiN;
uniform sampler2D uFloorTex;
uniform vec4 uFloorRect;
uniform float uFloorY;
uniform float uFloorK;
uniform sampler2D uGiD0;
uniform sampler2D uGiD1;
uniform sampler2D uGiD2;
uniform sampler2D uGiD3;
uniform vec4 uGiRect;
uniform vec2 uGiY;
uniform float uGiStrength;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
if (uGiStrength > 0.0 && vGiWorld.y > uGiY.x - 0.15 && vGiWorld.y < uGiY.y) {
  // lê a luz um pouco à frente da superfície (para onde ela olha): quem está ao lado do fogo pega o fogo,
  // sem fazer sombra em si mesmo na planta
  vec2 gn = length(vGiN) > 0.01 ? normalize(vGiN).xz : vec2(0.0);
  vec2 guv = (vGiWorld.xz + gn * 0.4 - uGiRect.xy) / uGiRect.zw;
  if (guv.x > 0.0 && guv.y > 0.0 && guv.x < 1.0 && guv.y < 1.0) {
    vec3 L0 = texture2D(uGiD0, guv).rgb;
    vec3 L1 = texture2D(uGiD1, guv).rgb;
    vec3 L2 = texture2D(uGiD2, guv).rgb;
    vec3 L3 = texture2D(uGiD3, guv).rgb;
    vec3 E = (L0 + L1 + L2 + L3) * 0.25;
    float hl = length(gn) * length(vGiN.xz);
    if (hl > 0.01) {
      // cos(normal, direção) com meia-volta, ao quadrado: frente 1, lado 0.25, costas 0
      float a = dot(gn, vec2(0.7071, 0.7071));
      float b = dot(gn, vec2(-0.7071, 0.7071));
      vec4 w = vec4(a, b, -a, -b) * 0.5 + 0.5;
      w *= w;
      E = mix(E, (L0 * w.x + L1 * w.y + L2 * w.z + L3 * w.w) / max(dot(w, vec4(1.0)), 0.001), hl);
    }
    reflectedLight.indirectDiffuse += BRDF_Lambert(material.diffuseColor) * E * uGiStrength;
  }
}
if (uFloorK > 0.0) {
  vec2 fuv = (vGiWorld.xz - uFloorRect.xy) / uFloorRect.zw;
  float hgt = vGiWorld.y - uFloorY;
  if (fuv.x > 0.0 && fuv.y > 0.0 && fuv.x < 1.0 && fuv.y < 1.0 && hgt > -0.05) {
    // virado para baixo pega tudo, de lado um pouco, para cima nada
    float face = clamp(0.5 - normalize(vGiN).y * 0.5, 0.0, 1.0);
    reflectedLight.indirectDiffuse += BRDF_Lambert(material.diffuseColor) * texture2D(uFloorTex, fuv).rgb * uFloorK * face * face * exp(-max(0.0, hgt) * 0.9);
  }
}`)
      // superfície iluminada não passa de 1 (antes do tonemap): o bloom (corte em 1,05) fica só para o que brilha
      // sozinho (neon, LED, fogo, lâmpada), sem névoa no teto e no chão perto das luzes
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(1.0));`)
  }
  mm.customProgramCacheKey = () => `${prevKey.call(mm)}|gi`
  mm.needsUpdate = true
}
