// O club (antiga cobertura do prédio 3D): palco com telão de LED, domo e manta de pixels com o vídeo do DJ, caixas
// de som, feixes, pista, lounges com mesinhas e sofás e bar. Mundo de um nível: o piso do club é y = ry.
import * as THREE from 'three'

import { SCREEN_PX } from '../djPlayer.ts'
import { D, beamTex, bx, cyl, geo, glow, plane, plant, rb, shade, signTex, sofa, sph, std, tagHits, unitPlane, type Box2, type Seat } from './kit.ts'

export type PartyAct = 'dance' | 'sit' | 'bar' | 'chat' | 'smoke' | 'bartend'

// ---------- cobertura: club de house ----------
// Cabine do DJ (Maestro) com CDJs e mixer, telão do YouTube atrás, pista de LED, lareira, bar e lounge.
export interface Club {
  // luz de cada metro da pista na GI (10 x 5, tirada do vídeo; apagada sem música)
  led: { cols: THREE.Color[] }
  jogs: THREE.Object3D[]
  flames: THREE.Object3D[]
  beams: THREE.Object3D[]
  // material de cada feixe (uniforms de posição do canhão, cor e brilho) e a mancha de luz no chão
  beamMats: THREE.ShaderMaterial[]
  pools: THREE.Mesh[]
  // onde os agentes inativos curtem: pista, sofás, banquetas e rodinhas
  spots: { act: PartyAct, x: number, z: number, rot: number, lift: number }[]
  // planta da cobertura para a GI 2D: fogo e brilhos (emissores) e móveis (obstáculos)
  glows: { x: number, z: number, r: number, color: string, fire?: boolean }[]
  blocks: { x0: number, z0: number, x1: number, z1: number, a: number, color?: string }[]
  screen: { x: number, y: number, z: number, w: number, h: number }
  // centro de cada falante (mundo) e o raio dele
  speakers: { p: THREE.Vector3, r: number }[]
  // lâmpadas pendentes do bar (luz de verdade nas mais perto) e onde cada bartender anda (atrás do balcão)
  lamps: THREE.Vector3[]
  // quadros do bar: cada um com o seu canvas; mostram frames guardados do vídeo (shown = qual)
  pictures: { c: CanvasRenderingContext2D, tex: THREE.CanvasTexture, shown: number }[]
  bartenders: { x0: number, x1: number, z: number }[]
  // balcão do bar (frente em z, tampo em top): o cardápio fica em cima, do lado dos clientes
  bar: { x0: number, x1: number, z: number, top: number }
  // caixas de som (centro no chão): a música sai delas
  boxes: { x: number, z: number }[]
  // parte móvel de cada falante (borda, cone e calota): anda para fora e para dentro no ritmo da faixa dele
  drivers: { g: THREE.Group, r: number, band: number }[]
  screenGlow: { c: CanvasRenderingContext2D, tex: THREE.CanvasTexture, mat: THREE.MeshBasicMaterial }
  // neon roxo e rosa do club (a cor segue a paleta do vídeo)
  // telão nosso, domo e o que some quando eles estão no ar (furo do iframe e grade por cima dele)
  video: { mats: THREE.ShaderMaterial[], screen: THREE.Mesh, dome: THREE.Points, hole: THREE.Mesh, grid: THREE.Mesh, manta: THREE.Points | null }
  neon: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial]
  maestro: { x: number, z: number }
}

// Feixe volumétrico: cone aberto aditivo cujo brilho cai com a distância do canhão e com o ângulo entre a
// superfície e o olhar (o miolo do cone, visto de frente, fica denso; a borda some), mais um "pó" cintilando.
export function volumetricBeam(color: string) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uApex: { value: new THREE.Vector3() },
      uLength: { value: 250 },
      uFloorY: { value: -1e9 },
      uPower: { value: 3.2 },
      uGain: { value: 0.55 },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uApex;
      uniform float uLength;
      uniform float uFloorY;
      uniform float uPower;
      uniform float uGain;
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        // abaixo do piso da cobertura o feixe não existe (não atravessa o prédio)
        if (vWorld.y < uFloorY) discard;
        float dm = distance(vWorld, uApex);
        float d = dm / uLength;
        // miolo forte nos primeiros metros e uma cauda longa e fraca até o fim do cone (zera suave, sem corte)
        float fall = (exp(-dm / 7.0) * 0.8 + exp(-dm / 70.0) * 0.2) * (1.0 - smoothstep(0.5, 1.0, d));
        // superfície do cone colada na câmera (quem está dentro do feixe) quase não soma: sem parede branca na cara
        fall *= smoothstep(0.5, 8.0, distance(cameraPosition, vWorld));
        vec3 V = normalize(cameraPosition - vWorld);
        // borda bem esfumada: só o miolo do cone acende de verdade
        float facing = pow(abs(dot(normalize(vNormalW), V)), uPower);
        // pó em ondas contínuas (sem célula/bloco: nada de quadrado aparecendo de perto)
        float dust = 0.86 + 0.08 * sin(vWorld.y * 3.1 + uTime * 1.7 + sin(vWorld.x * 1.9 + uTime * 0.6) * 1.4)
                          + 0.06 * sin(vWorld.z * 2.7 - uTime * 1.1 + sin(vWorld.y * 1.3) * 1.2);
        float a = fall * facing * dust * uGain;
        // mistura aditiva já multiplica pelo alfa: a cor vai inteira
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
}

export const CLUB_PURPLE = '#a855f7'
export const CLUB_PINK = '#ec4899'
export const CLUB_PAL = [CLUB_PURPLE, CLUB_PINK, '#22d3ee', '#6366f1']
// cor das ondas por faixa: grave, médio, agudo
export const BAND_COL = ['#ff2a55', '#35ff7a', '#3aa8ff'].map((c) => new THREE.Color(c))

// 4 cores distintas de um quadro do vídeo (sem o preto): matiz em 12 faixas, pesadas por quantidade e saturação;
// cada cor vai para o brilho cheio (luz de palco). Vídeo sem cor nenhuma vira branco/cinza claro.
export function videoPalette(img: CanvasImageSource): THREE.Color[] | null {
  const W = 48
  const H = 27
  const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!c) return null
  c.canvas.width = W
  c.canvas.height = H
  c.drawImage(img, 0, 0, W, H)
  let px: Uint8ClampedArray
  try {
    px = c.getImageData(0, 0, W, H).data
  } catch {
    return null
  }
  const bins = Array.from({ length: 13 }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
  const hsl = { h: 0, s: 0, l: 0 }
  const col = new THREE.Color()
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255
    const g = px[i + 1] / 255
    const b = px[i + 2] / 255
    const mx = Math.max(r, g, b)
    if (mx < 0.16) continue
    const mn = Math.min(r, g, b)
    const sat = (mx - mn) / mx
    col.setRGB(r, g, b, THREE.SRGBColorSpace).getHSL(hsl)
    const bin = sat < 0.18 ? 12 : Math.floor(hsl.h * 12) % 12
    const w = (sat < 0.18 ? 0.08 : 0.4 + sat) * mx
    const k = bins[bin]
    k.w += w
    k.r += r * w
    k.g += g * w
    k.b += b * w
  }
  let order = bins.map((k, i) => ({ ...k, i })).filter((k) => k.w > 0.6).sort((a, b) => b.w - a.w)
  if (!order.length) return null
  // cinza/branco só entra se o vídeo quase não tiver cor
  const hued = order.filter((k) => k.i < 12)
  if (hued.length >= 2) order = hued
  // prefere matizes que não sejam vizinhas
  const pick: typeof order = []
  for (const k of order) {
    if (pick.length >= 4) break
    if (k.i < 12 && pick.some((p) => p.i < 12 && Math.min(Math.abs(p.i - k.i), 12 - Math.abs(p.i - k.i)) < 2)) continue
    pick.push(k)
  }
  for (const k of order) if (pick.length < 4 && !pick.includes(k)) pick.push(k)
  const out = pick.map((k) => {
    const c = new THREE.Color().setRGB(k.r / k.w, k.g / k.w, k.b / k.w, THREE.SRGBColorSpace)
    // luz de palco: só a matiz do vídeo, na cor pura; o neutro vira branco
    if (k.i === 12) return c.setRGB(1, 1, 1)
    c.getHSL(hsl)
    return c.setHSL(hsl.h, 1, 0.5)
  })
  while (out.length < 4) out.push(out[out.length % Math.max(1, pick.length)].clone())
  return out
}

// Pontos de LED desenhados no shader (não em textura): borda nítida a qualquer distância, com antisserrilhado
// pelo fwidth; quando o ponto fica menor que ~1 px na tela, vira a média (sem moiré).
// q = posição em pontos (1 unidade = 1 ponto); devolve a cobertura do ponto (0 vão, 1 miolo)
export const LED_DOT_GLSL = `
float ledDot(vec2 q, float r) {
  vec2 g = fract(q) - 0.5;
  // meio redondo, meio quadrado, como LED SMD
  float d = mix(length(g), max(abs(g.x), abs(g.y)), 0.35);
  float aa = max(fwidth(q.x), fwidth(q.y));
  float dotm = 1.0 - smoothstep(r - aa * 0.75, r + aa * 0.75, d);
  float far = clamp(aa * 1.5 - 0.5, 0.0, 1.0);
  return mix(dotm, 3.3 * r * r, far);
}
float ledFar(vec2 q) {
  return clamp(max(fwidth(q.x), fwidth(q.y)) * 1.5 - 0.5, 0.0, 1.0);
}`

// telão: 320 x 180 pixels de LED (o player do YouTube roda nessa mesma resolução, ampliado por baixo da grade)
export const LED_COLS = 320

// grade do telão por cima do furo: preto no vão e na emenda dos módulos de 16 x 16, transparente no miolo
function ledWallMat() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uRes: { value: new THREE.Vector2(LED_COLS, LED_COLS * (SCREEN_PX.h / SCREEN_PX.w)) } },
    vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `
uniform vec2 uRes;
varying vec2 vUv;
${LED_DOT_GLSL}
void main() {
  vec2 q = vUv * uRes;
  float far = ledFar(q);
  float a = (1.0 - ledDot(q, 0.4)) * 0.85;
  // emenda entre módulos (some de longe junto com a grade)
  vec2 m = fract(q / 16.0);
  float e = min(min(m.x, 1.0 - m.x), min(m.y, 1.0 - m.y)) * 16.0;
  float aa = max(fwidth(q.x), fwidth(q.y));
  float seam = (1.0 - smoothstep(0.06, 0.06 + aa, e)) * (1.0 - far);
  gl_FragColor = vec4(0.0, 0.0, 0.0, max(a, seam * 0.95));
}`,
  })
}

// telão com o vídeo nosso: cada LED pega 1 cor (o centro dele no vídeo), ponto e emenda de módulo como na grade;
// acima de 1 para o bloom e dentro da cena (a distorção passa por cima)
function ledScreenMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uVideo: { value: null }, uRes: { value: new THREE.Vector2(LED_COLS, LED_COLS * (SCREEN_PX.h / SCREEN_PX.w)) }, uGain: { value: 1.7 }, uLoad: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Color('#a855f7') } },
    vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `
uniform sampler2D uVideo;
uniform vec2 uRes;
uniform float uGain;
uniform float uLoad;
uniform float uTime;
uniform vec3 uTint;
varying vec2 vUv;
${LED_DOT_GLSL}
// "sintonizando": equalizador de 24 barras espelhadas no meio do painel, subindo e descendo em onda
vec3 loading(vec2 cell) {
  vec2 c = cell - uRes * 0.5;
  float bw = uRes.x / 34.0;
  float i = floor(c.x / bw + 12.0);
  if (i < 0.0 || i > 23.0 || mod(floor(c.x), bw) > bw - 2.0) return vec3(0.0);
  float h = (0.12 + 0.3 * abs(sin(uTime * 3.2 + i * 0.55)) + 0.12 * abs(sin(uTime * 7.1 + i * 1.7))) * uRes.y * 0.5;
  if (abs(c.y) > h) return vec3(0.0);
  return mix(uTint, vec3(1.0), 0.25 * (1.0 - abs(c.y) / h)) * (0.6 + 0.4 * abs(c.y) / h);
}
void main() {
  vec2 q = vUv * uRes;
  vec3 col = texture2D(uVideo, (floor(q) + 0.5) / uRes).rgb;
  if (uLoad > 0.0) col = mix(col, loading(floor(q) + 0.5), uLoad);
  float far = ledFar(q);
  float dotm = ledDot(q, 0.42);
  vec2 m = fract(q / 16.0);
  float e = min(min(m.x, 1.0 - m.x), min(m.y, 1.0 - m.y)) * 16.0;
  float aa = max(fwidth(q.x), fwidth(q.y));
  float seam = (1.0 - smoothstep(0.06, 0.06 + aa, e)) * (1.0 - far);
  gl_FragColor = vec4(col * uGain * mix(0.02, 1.0, dotm) * (1.0 - seam * 0.9), 1.0);
}`,
  })
}

// domo de pixels sobre a cobertura: um LED em cada vértice de uma icosfera (espaçamento igual no domo todo, sem
// juntar no topo como numa esfera UV). A cor vem do vídeo em 5 faces (4 lados e o topo, como um cubo visto do centro):
// o vídeo aparece inteiro em cada uma, sem esticar muito. O preto não aparece (soma de luz).
function ledDomeGeo() {
  return geo('ledDomeIco5', () => {
    const ico = new THREE.IcosahedronGeometry(1, 90)
    const pos = ico.getAttribute('position')
    const seen = new Set<string>()
    const pts: number[] = []
    const uvs: number[] = []
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      if (y < -0.001) continue
      const k = `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`
      if (seen.has(k)) continue
      seen.add(k)
      pts.push(x, y, z)
      // face de cubo pelo eixo dominante (topo ou um dos 4 lados): projeção do centro, vídeo inteiro em cada face.
      // Lado: em cima do vídeo para o alto; topo: em cima do vídeo para o lado do telão (-z)
      const ax = Math.abs(x)
      const az = Math.abs(z)
      if (y >= ax && y >= az) uvs.push(0.5 - 0.5 * x / y, 0.5 - 0.5 * z / y)
      else if (az >= ax) uvs.push(0.5 - 0.5 * Math.sign(z) * x / az, Math.min(1, y / az))
      else uvs.push(0.5 + 0.5 * Math.sign(x) * z / ax, Math.min(1, y / ax))
    }
    ico.dispose()
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    g.setAttribute('vuv', new THREE.Float32BufferAttribute(uvs, 2))
    return g
  })
}

// manta de LED cobrindo o chão do club inteiro: um ponto a cada 8 cm, com o vídeo
// esticado nela (o alto do vídeo do lado do telão)
const MANTA_STEP = 0.08
function ledMantaGeo(W: number) {
  return geo(`ledManta|${W}|${D}`, () => {
    const nx = Math.floor(W / MANTA_STEP)
    const nz = Math.floor(D / MANTA_STEP)
    const pts: number[] = []
    const uvs: number[] = []
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * MANTA_STEP
      const z = (j + 0.5) * MANTA_STEP
      pts.push(x, 0, z)
      uvs.push(x / W, 1 - z / D)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    g.setAttribute('vuv', new THREE.Float32BufferAttribute(uvs, 2))
    return g
  })
}

function ledDomeMat() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uVideo: { value: null }, uGain: { value: 1.5 }, uSize: { value: 0.16 }, uScale: { value: 600 }, uFoot: { value: 1 } },
    vertexShader: `
attribute vec2 vuv;
uniform float uSize;
uniform float uScale;
uniform float uFoot;
varying vec2 vVuv;
varying float vFade;
void main() {
  vVuv = vuv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = uSize * uScale / max(0.1, -mv.z);
  // ponto menor que 1.5 px: fica 1.5 px e apaga na mesma proporção (sem cintilar de longe)
  gl_PointSize = max(1.5, px);
  vFade = min(1.0, px / 1.5) * mix(1.0, smoothstep(0.0, 0.06, position.y), uFoot);
}`,
    fragmentShader: `
uniform sampler2D uVideo;
uniform float uGain;
varying vec2 vVuv;
varying float vFade;
void main() {
  vec2 g = gl_PointCoord - 0.5;
  float d = length(g);
  float dotm = 1.0 - smoothstep(0.32, 0.5, d);
  if (dotm <= 0.0) discard;
  vec3 col = texture2D(uVideo, vVuv).rgb;
  gl_FragColor = vec4(col * uGain * dotm * vFade, 1.0);
}`,
    transparent: true,
    depthWrite: false,
  })
  addOnly(m)
  return m
}

// mistura aditiva que não mexe no alpha do canvas (o furo do telão continua transparente)
export function addOnly(m: THREE.Material) {
  m.blending = THREE.CustomBlending
  m.blendEquation = THREE.AddEquation
  m.blendSrc = THREE.SrcAlphaFactor
  m.blendDst = THREE.OneFactor
  m.blendSrcAlpha = THREE.ZeroFactor
  m.blendDstAlpha = THREE.OneFactor
}

export function clubBuild(group: THREE.Group, W: number, ry: number, night: boolean, own: THREE.Material[], colliders: Box2[], hits: THREE.Object3D[], roofL: number): Club {
  const mx = W / 2
  // neon acima de 1 para o bloom pegar (o corte do bloom é pelo canal mais forte)
  const neon = glow(CLUB_PURPLE, 2)
  const neonPink = glow(CLUB_PINK, 2)
  const black = std('#0b0b10', 0.5, 0.3)
  const metal = std('#2a2a33', 0.35, 0.8)
  // neon roxo no topo do parapeito, nos quatro lados
  bx(group, 0, ry + 1.12, -0.02, W, ry + 1.16, 0.02, neon, false)
  bx(group, 0, ry + 1.12, D - 0.02, W, ry + 1.16, D + 0.02, neonPink, false)
  bx(group, -0.02, ry + 1.12, 0, 0.02, ry + 1.16, D, neon, false)
  bx(group, W - 0.02, ry + 1.12, 0, W + 0.02, ry + 1.16, D, neon, false)

  // --- telão (furo transparente no canvas: o iframe do YouTube fica atrás) e treliça
  const sw = 9.6
  const sh = 5.4
  const screen = { x: mx, y: ry + 1.6 + sh / 2, z: 0.42, w: sw, h: sh }
  bx(group, mx - sw / 2 - 0.18, screen.y - sh / 2 - 0.18, 0.12, mx + sw / 2 + 0.18, screen.y + sh / 2 + 0.18, 0.38, black)
  const holeM = new THREE.MeshBasicMaterial({ color: '#000000', transparent: false, opacity: 0, blending: THREE.NoBlending, toneMapped: false })
  own.push(holeM)
  const hole = new THREE.Mesh(unitPlane(), holeM)
  hole.scale.set(sw, sh, 1)
  hole.position.set(screen.x, screen.y, screen.z)
  hole.userData.ui = true
  hole.userData.hole = true
  group.add(hole)
  // grade de painel de LED por cima do vídeo: vão escuro entre os pixels e emenda entre os módulos
  const gridM = ledWallMat()
  own.push(gridM)
  const grid = new THREE.Mesh(unitPlane(), gridM)
  grid.scale.set(sw, sh, 1)
  grid.position.set(screen.x, screen.y, screen.z + 0.004)
  grid.renderOrder = 4
  grid.userData.ui = true
  group.add(grid)
  // halo do telão: 2 m de margem em volta, 8 px por metro
  const sgc = document.createElement('canvas')
  sgc.width = Math.round((sw + 4) * 8)
  sgc.height = Math.round((sh + 4) * 8)
  const sgTex = new THREE.CanvasTexture(sgc)
  sgTex.colorSpace = THREE.SRGBColorSpace
  // soma só cor, sem mexer no alpha: em cima do furo vira luz somada ao vídeo (o canvas é pré-multiplicado)
  const sgM = new THREE.MeshBasicMaterial({ map: sgTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, fog: false })
  addOnly(sgM)
  own.push(sgM)
  const sg = new THREE.Mesh(unitPlane(), sgM)
  sg.scale.set(sw + 4, sh + 4, 1)
  sg.position.set(screen.x, screen.y, screen.z + 0.03)
  sg.renderOrder = 5
  sg.userData.ui = true
  group.add(sg)
  const screenGlow = { c: sgc.getContext('2d')!, tex: sgTex, mat: sgM }
  // telão desenhado por nós (quando o vídeo chega pelo proxy): cobre o furo do iframe
  const ledM = ledScreenMat()
  own.push(ledM)
  const ledScreen = new THREE.Mesh(unitPlane(), ledM)
  ledScreen.scale.set(sw, sh, 1)
  ledScreen.position.set(screen.x, screen.y, screen.z + 0.002)
  ledScreen.visible = false
  group.add(ledScreen)
  // domo de pixels cobrindo a cobertura inteira (cantos no piso), alto o bastante para passar por cima do telão
  const domeM = ledDomeMat()
  own.push(domeM)
  const dome = new THREE.Points(ledDomeGeo(), domeM)
  const domeR = Math.hypot(W / 2, D / 2) + 1
  dome.scale.set(domeR, 15, domeR)
  dome.position.set(mx, ry, D / 2)
  dome.visible = false
  dome.renderOrder = 6
  dome.userData.ui = true
  group.add(dome)
  const video = { mats: [ledM, domeM], screen: ledScreen, dome, hole, grid, manta: null as THREE.Points | null }
  for (const sx of [-1, 1]) {
    bx(group, mx + sx * (sw / 2 + 0.5) - 0.12, ry, 0.15, mx + sx * (sw / 2 + 0.5) + 0.12, ry + 7.6, 0.39, metal)
    colliders.push({ x0: mx + sx * (sw / 2 + 0.5) - 0.2, x1: mx + sx * (sw / 2 + 0.5) + 0.2, z0: 0.1, z1: 0.45, level: roofL })
  }
  bx(group, mx - sw / 2 - 0.8, ry + 7.4, 0.15, mx + sw / 2 + 0.8, ry + 7.65, 0.39, metal)
  // feixes de luz saindo da treliça (giram no loop)
  const beams: THREE.Object3D[] = []
  const beamMats: THREE.ShaderMaterial[] = []
  const pools: THREE.Mesh[] = []
  for (let k = 0; k < 6; k++) {
    const piv = new THREE.Group()
    piv.position.set(mx - sw / 2 + (k + 0.5) * (sw / 6), ry + 7.35, 0.6)
    const m = volumetricBeam(k % 2 ? CLUB_PINK : CLUB_PURPLE)
    own.push(m)
    beamMats.push(m)
    const cone = new THREE.Mesh(geo('clubbeamvol', () => new THREE.CylinderGeometry(0.06, 65, 250, 48, 40, true).translate(0, -125, 0)), m)
    cone.userData.ui = true
    cone.renderOrder = 3
    piv.add(cone)
    // canhão: corpo escuro e lente acesa
    cyl(piv, 0, -0.05, 0, 0.16, 0.3, black).castShadow = false
    sph(piv, 0, -0.08, 0, 0.11, k % 2 ? neonPink : neon).castShadow = false
    group.add(piv)
    beams.push(piv)
    // mancha de luz onde o feixe encosta no chão (reposicionada a cada quadro)
    const poolM = new THREE.MeshBasicMaterial({ map: beamTex(), color: k % 2 ? CLUB_PINK : CLUB_PURPLE, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    own.push(poolM)
    const pool = new THREE.Mesh(unitPlane(), poolM)
    pool.rotation.x = -Math.PI / 2
    pool.position.y = ry + 0.03
    pool.userData.ui = true
    pool.renderOrder = 2
    group.add(pool)
    pools.push(pool)
  }

  // --- caixas de som: grave, médio e agudo na frente (a frente olha para +z local); cada falante é uma fonte
  // da distorção no ritmo
  const speakers: Club['speakers'] = []
  const drivers: Club['drivers'] = []
  const spkBoxes: { x: number, z: number }[] = []
  // caixa: gabinete cinza (não preto: some no escuro), cantoneiras de metal, frente em painel separado com friso
  // neon (cor do palco), cada falante com aro cromado, borda de borracha, cone e calota; tweeter numa corneta
  const cab = std('#2c2c34', 0.6, 0.12)
  const baffle = std('#1c1c22', 0.75, 0.05)
  const chrome = std('#c9ced6', 0.22, 0.9)
  const rubber = std('#101014', 0.9)
  const paper = std('#4a4a54', 0.85)
  const dust = std('#6b6b76', 0.35, 0.4)
  const horn = std('#3a3a44', 0.4, 0.5)
  const speaker = (x: number, z: number, rot: number) => {
    const g = new THREE.Group()
    g.position.set(x, ry, z)
    g.rotation.y = rot
    rb(g, 0, 1.08, 0, 0.9, 2.1, 0.8, 0.05, cab)
    // pezinhos
    for (const fx2 of [-0.36, 0.36]) for (const fz of [-0.3, 0.3]) cyl(g, fx2, 0, fz, 0.05, 0.04, rubber)
    // cantoneiras
    for (const sx of [-1, 1]) for (const sy of [0.04, 2.12]) for (const sz of [-1, 1]) rb(g, sx * 0.43, sy, sz * 0.38, 0.08, 0.08, 0.08, 0.015, chrome)
    // frente
    bx(g, -0.42, 0.08, 0.4, 0.42, 2.08, 0.42, baffle)
    bx(g, -0.43, 0.07, 0.42, 0.43, 0.085, 0.43, neon, false)
    bx(g, -0.43, 2.075, 0.42, 0.43, 2.09, 0.43, neon, false)
    bx(g, -0.43, 0.07, 0.42, -0.415, 2.09, 0.43, neon, false)
    bx(g, 0.415, 0.07, 0.42, 0.43, 2.09, 0.43, neon, false)
    for (const [yy, r] of [[0.58, 0.28], [1.38, 0.2], [1.85, 0.09]] as const) {
      if (r < 0.1) {
        // corneta do tweeter
        const hn = rb(g, 0, yy, 0.43, 0.42, 0.24, 0.05, 0.02, horn)
        hn.castShadow = false
      }
      const ring = shade(new THREE.Mesh(geo(`spkring|${r}`, () => new THREE.TorusGeometry(r + 0.012, 0.014, 8, 40)), chrome), false)
      ring.position.set(0, yy, 0.43 + (r < 0.1 ? 0.03 : 0))
      g.add(ring)
      // parte móvel num grupo próprio (fica fora do merge e anda em z)
      const mov = new THREE.Group()
      mov.position.set(0, yy, r < 0.1 ? 0.03 : 0)
      g.add(mov)
      const sur = cyl(mov, 0, 0, 0, r, 0.02, rubber)
      sur.rotation.x = Math.PI / 2
      sur.position.set(0, 0, 0.425)
      // cone afundando para dentro da caixa
      const cn = cyl(mov, 0, 0, 0, r * 0.86, 0.06, paper, r * 0.3)
      cn.rotation.x = -Math.PI / 2
      cn.position.set(0, 0, 0.41)
      const dc = sph(mov, 0, 0, 0.43, r * 0.3, dust, 0.5)
      dc.scale.z = r * 0.12
      drivers.push({ g: mov, r, band: r >= 0.25 ? 0 : r >= 0.15 ? 1 : 2 })
      speakers.push({ p: new THREE.Vector3(x + Math.sin(rot) * 0.44, ry + yy, z + Math.cos(rot) * 0.44), r })
    }
    group.add(g)
    colliders.push({ x0: x - 0.6, x1: x + 0.6, z0: z - 0.6, z1: z + 0.6, level: roofL })
    spkBoxes.push({ x, z })
  }
  for (const sx of [-1, 1]) speaker(mx + sx * 3.6, 2.4, 0)
  // em volta do club, virando para o centro (longe do lounge do fundo e do bar)
  const cz = Math.max(13.5, D * 0.5)
  const face = (x: number, z: number) => Math.atan2(mx - x, cz - z)
  for (const [x, z] of [[0.9, 11.5], [W - 0.9, 12.5], [3.2, D - 1.1], [W - 4.2, D - 1.1]] as const) speaker(x, z, face(x, z))

  // --- palco do DJ, mesa com 2 CDJs e mixer
  const riser = 0.34
  bx(group, mx - 2.6, ry, 1.2, mx + 2.6, ry + riser, 4.25, std('#16161d', 0.6, 0.2))
  bx(group, mx - 2.6, ry + riser - 0.03, 4.22, mx + 2.6, ry + riser, 4.27, neon, false)
  const table = new THREE.Group()
  group.add(table)
  bx(table, mx - 1.7, ry + riser, 3.35, mx + 1.7, ry + riser + 0.95, 4.05, black)
  bx(table, mx - 1.75, ry + riser + 0.95, 3.3, mx + 1.75, ry + riser + 1.0, 4.1, metal)
  bx(table, mx - 1.7, ry + riser + 0.4, 4.05, mx + 1.7, ry + riser + 0.46, 4.08, neonPink, false)
  plane(table, signTex('BOOK CLUB RADIO', '#0b0b10', '#e9d5ff', 1024, 200), mx, ry + riser + 0.72, 4.09, 2.4, 0.47, '+z', own, true)
  const top = ry + riser + 1.0
  const jogs: THREE.Object3D[] = []
  for (const sx of [-1, 1]) {
    const cx = mx + sx * 0.75
    rb(table, cx, top + 0.05, 3.7, 0.55, 0.1, 0.62, 0.02, std('#1c1c22', 0.4, 0.5))
    const jog = new THREE.Group()
    jog.position.set(cx, top + 0.11, 3.75)
    cyl(jog, 0, 0, 0, 0.2, 0.025, std('#3f3f46', 0.3, 0.8))
    const ring = shade(new THREE.Mesh(geo('jogring', () => new THREE.TorusGeometry(0.2, 0.012, 8, 40)), neon), false)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.026
    jog.add(ring)
    bx(jog, -0.01, 0.026, -0.19, 0.01, 0.03, -0.1, glow('#ffffff', 1.5), false)
    table.add(jog)
    jogs.push(jog)
    for (let b = 0; b < 4; b++) bx(table, cx - 0.22 + b * 0.09, top + 0.1, 3.47, cx - 0.16 + b * 0.09, top + 0.115, 3.52, b % 2 ? neonPink : glow('#22d3ee', 1.8), false)
  }
  rb(table, mx, top + 0.05, 3.7, 0.42, 0.1, 0.6, 0.02, std('#1c1c22', 0.4, 0.5))
  for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) {
    const kn = cyl(table, mx - 0.14 + k * 0.095, top + 0.1, 3.5 + j * 0.13, 0.022, 0.03, std('#d4d4d8', 0.3, 0.7))
    kn.castShadow = false
  }
  for (let k = 0; k < 4; k++) bx(table, mx - 0.15 + k * 0.1, top + 0.1, 3.88, mx - 0.13 + k * 0.1, top + 0.112, 3.95, k < 2 ? glow('#22c55e', 2) : neonPink, false)
  tagHits(table, { kind: 'dj', label: 'Mesa do DJ', sub: 'clique para escolher a música do telão' }, hits)
  colliders.push({ x0: mx - 2.65, x1: mx + 2.65, z0: 3.3, z1: 4.3, level: roofL })

  const ledCols = Array.from({ length: 50 }, () => new THREE.Color(0, 0, 0))
  // manta de LED (com o vídeo nosso no ar): fundo escuro + pontos com o vídeo; as placas somem
  const mantaM = ledDomeMat()
  mantaM.uniforms.uFoot.value = 0
  mantaM.uniforms.uSize.value = 0.0175
  mantaM.uniforms.uGain.value = 1.4
  own.push(mantaM)
  const manta = new THREE.Points(ledMantaGeo(W), mantaM)
  manta.position.set(0, ry + 0.025, 0)
  manta.frustumCulled = false
  manta.visible = false
  manta.userData.ui = true
  group.add(manta)
  // sem fundo próprio: os pontos ficam por cima do deck de madeira

  // --- planta da GI
  const fx = 8.5
  const glows: Club['glows'] = []
  const blocks: Club['blocks'] = [
    { x0: mx - 1.7, z0: 3.35, x1: mx + 1.7, z1: 4.05, a: 0.9 },
    { x0: mx - 4.05, z0: 2.0, x1: mx - 3.15, z1: 2.8, a: 1 },
    { x0: mx + 3.15, z0: 2.0, x1: mx + 4.05, z1: 2.8, a: 1 },
  ]
  const flames: THREE.Object3D[] = []

  // --- lounge do canto do fundo: sofá encostado na parede e dois de lado, em volta da mesinha
  const spots: Club['spots'] = []
  const sofaSpots = (g: THREE.Object3D) => {
    for (const st of (g.userData.seats ?? []) as Seat[]) spots.push({ act: 'sit', x: st.x, z: st.z, rot: st.rot, lift: 0 })
  }
  sofaSpots(sofa(group, fx, ry, D - 0.9, Math.PI, '#4c1d95', hits))
  sofaSpots(sofa(group, fx - 2.6, ry, D - 2.6, Math.PI / 2, '#4c1d95', hits))
  sofaSpots(sofa(group, fx + 2.6, ry, D - 2.6, -Math.PI / 2, '#4c1d95', hits))
  rb(group, fx, ry + 0.22, D - 2.5, 1.4, 0.06, 0.8, 0.03, std('#1f2937', 0.3, 0.4))
  cyl(group, fx, ry + 0.25, D - 2.5, 0.05, 0.12, glow('#fbbf24', 1.6))
  colliders.push(
    { x0: fx - 1.05, x1: fx + 1.05, z0: D - 1.35, z1: D, level: roofL },
    { x0: fx - 3.05, x1: fx - 2.15, z0: D - 3.65, z1: D - 1.55, level: roofL },
    { x0: fx + 2.15, x1: fx + 3.05, z0: D - 3.65, z1: D - 1.55, level: roofL },
    { x0: fx - 0.75, x1: fx + 0.75, z0: D - 2.95, z1: D - 2.05, level: roofL },
  )

  // --- lounges espalhados: mesinha de centro redonda com sofás em volta
  const pit = (cx: number, cz: number, side: boolean) => {
    const tableWood = std('#6b4f3a', 0.55)
    cyl(group, cx, ry, cz, 0.32, 0.03, std('#3f3f46', 0.4, 0.6))
    cyl(group, cx, ry, cz, 0.05, 0.4, std('#3f3f46', 0.4, 0.6))
    cyl(group, cx, ry + 0.4, cz, 0.6, 0.05, tableWood)
    colliders.push({ x0: cx - 0.65, x1: cx + 0.65, z0: cz - 0.65, z1: cz + 0.65, level: roofL })
    // sofás de frente para a mesinha
    sofaSpots(sofa(group, cx, ry, cz - 2.2, 0, '#581c87', hits))
    sofaSpots(sofa(group, cx, ry, cz + 2.2, Math.PI, '#581c87', hits))
    // rodinha em pé dos lados da mesinha, virada para ela
    spots.push({ act: 'chat', x: cx + 1.5, z: cz, rot: -Math.PI / 2, lift: 0 })
    if (!side) spots.push({ act: 'chat', x: cx - 1.5, z: cz, rot: Math.PI / 2, lift: 0 })
    colliders.push({ x0: cx - 1.05, x1: cx + 1.05, z0: cz - 2.65, z1: cz - 1.75, level: roofL }, { x0: cx - 1.05, x1: cx + 1.05, z0: cz + 1.75, z1: cz + 2.65, level: roofL })
    if (side) {
      sofaSpots(sofa(group, cx - 2.3, ry, cz, Math.PI / 2, '#581c87', hits))
      colliders.push({ x0: cx - 2.75, x1: cx - 1.85, z0: cz - 1.05, z1: cz + 1.05, level: roofL })
    }
  }
  // espalhadas pela parte do meio do club (atrás da pista, longe do palco e do bar)
  const midZ = Math.max(13.5, D * 0.5)
  pit(Math.max(5.5, mx - W * 0.28), midZ, true)
  pit(Math.min(W - 3.5, mx + W * 0.28), midZ, false)
  if (D > 24) pit(mx, Math.min(D - 6.5, midZ + 6.5), false)

  // --- bar: balcão comprido com frente de ripas neon (na cor do palco), tampo de pedra preta com borda dourada,
  // apoio de pé de latão; atrás, prateleiras de vidro com garrafas contra um painel âmbar aceso, letreiro grande,
  // pendentes sobre o balcão, chopeira e banquetas de veludo. Dois bartenders andam atrás preparando drinks.
  const lamps: THREE.Vector3[] = []
  const b0 = W - 18
  const b1 = W - 6
  const cz0 = D - 3.2
  const cz1 = D - 2.4
  const ctop = 1.08
  const stoneTop = std('#3a3a42', 0.18, 0.25)
  const gold = std('#c9a227', 0.25, 0.9)
  const brass = std('#b08d57', 0.3, 0.85)
  const chromeB = std('#d4d4d8', 0.18, 0.95)
  blocks.push({ x0: b0, z0: cz0, x1: b1, z1: cz1, a: 0.9 }, { x0: b0, z0: D - 0.75, x1: b1, z1: D - 0.55, a: 1 })
  // corpo do balcão e ripas acesas na frente
  bx(group, b0, ry, cz0 + 0.06, b1, ry + ctop - 0.06, cz1, std('#4a3a42', 0.7, 0.05))
  // frente em couro capitonê: almofadas com botão
  const leather = std('#5b2c3f', 0.55, 0.05)
  for (let x = b0 + 0.3; x < b1 - 0.2; x += 0.6) for (const y of [0.34, 0.74]) {
    rb(group, x, ry + y, cz0 + 0.03, 0.56, 0.36, 0.08, 0.035, leather)
    sph(group, x, ry + y, cz0 - 0.012, 0.012, brass)
  }
  bx(group, b0, ry + 0.02, cz0 - 0.02, b1, ry + 0.05, cz0 + 0.02, neon, false)
  // tampo com borda dourada
  bx(group, b0 - 0.12, ry + ctop - 0.06, cz0 - 0.18, b1 + 0.12, ry + ctop, cz1 + 0.05, stoneTop)
  bx(group, b0 - 0.13, ry + ctop - 0.065, cz0 - 0.19, b1 + 0.13, ry + ctop - 0.04, cz0 - 0.17, gold)
  // apoio de pé de latão
  const rail = cyl(group, 0, 0, 0, 0.025, b1 - b0 - 0.2, brass)
  rail.rotation.z = Math.PI / 2
  rail.position.set((b0 + b1) / 2, ry + 0.24, cz0 - 0.22)
  for (let x = b0 + 0.4; x < b1 - 0.2; x += 1.6) bx(group, x - 0.015, ry, cz0 - 0.24, x + 0.015, ry + 0.25, cz0 - 0.03, brass)
  colliders.push({ x0: b0 - 0.15, x1: b1 + 0.15, z0: cz0 - 0.25, z1: cz1 + 0.05, level: roofL })
  // chopeira com 4 torneiras e copos no balcão
  const tapX = (b0 + b1) / 2
  // torre em aço escovado (cromo espelhado refletia o domo inteiro e virava um bloco colorido)
  bx(group, tapX - 0.45, ry + ctop, cz0 + 0.3, tapX + 0.45, ry + ctop + 0.45, cz0 + 0.42, std('#57534e', 0.55, 0.35))
  const handles = ['#f59e0b', '#16a34a', '#dc2626', '#1d4ed8']
  handles.forEach((hc, k) => {
    const hx = tapX - 0.33 + k * 0.22
    const sp = cyl(group, 0, 0, 0, 0.018, 0.12, chromeB)
    sp.rotation.x = Math.PI / 2
    sp.position.set(hx, ry + ctop + 0.3, cz0 + 0.24)
    rb(group, hx, ry + ctop + 0.52, cz0 + 0.33, 0.04, 0.16, 0.04, 0.015, std(hc, 0.4))
  })
  // em cima do balcão só o cardápio de verdade (engine: itens que dá para comprar)
  // fundo do bar: parede, armário baixo, estante de nichos no meio e galeria de quadros dos lados
  bx(group, b0 - 0.3, ry, D - 0.75, b1 + 0.3, ry + 3.55, D - 0.3, std('#5a4a46', 0.8))
  bx(group, b0 - 0.05, ry, D - 1.05, b1 + 0.05, ry + 0.9, D - 0.75, std('#5a4030', 0.6, 0.05))
  bx(group, b0 - 0.05, ry + 0.9, D - 1.1, b1 + 0.05, ry + 0.94, D - 0.75, stoneTop)
  const mid = (b0 + b1) / 2
  const sx0 = mid - 3.6
  const sx1 = mid + 3.6
  const shelfWood = std('#6b4630', 0.5)
  const lacquer = std('#24453c', 0.4, 0.1)
  const ys = [0.94, 1.42, 1.9, 2.38, 2.86]
  const cols = 5
  const cw = (sx1 - sx0) / cols
  const zb = D - 0.76
  const zf = D - 1.05
  bx(group, sx0, ry + 0.94, zb - 0.02, sx1, ry + 2.9, zb, lacquer)
  for (const y of ys) bx(group, sx0 - 0.04, ry + y - 0.03, zf, sx1 + 0.04, ry + y + 0.01, zb, shelfWood)
  for (let c = 0; c <= cols; c++) bx(group, sx0 + c * cw - 0.025, ry + 0.94, zf, sx0 + c * cw + 0.025, ry + 2.9, zb, shelfWood)
  const bottleCols = ['#14532d', '#78350f', '#e7e5e4', '#7f1d1d', '#1e3a8a', '#a16207', '#4c1d95', '#155e75', '#9f1239']
  const label = std('#efe6d2', 0.8)
  const glassC = std('#dbeafe', 0.05, 0.1, { opacity: 0.35 })
  // garrafa de vários formatos (frente para -z)
  const bottle = (x: number, y: number, z: number, kind: number, col: string) => {
    const m = std(col, 0.15, 0.1, { opacity: 0.85 })
    const yy = ry + y
    if (kind === 0) {
      // vinho: corpo, ombro e gargalo comprido
      cyl(group, x, yy, z, 0.04, 0.2, m)
      cyl(group, x, yy + 0.2, z, 0.04, 0.05, m, 0.014)
      cyl(group, x, yy + 0.25, z, 0.014, 0.1, m)
      bx(group, x - 0.03, yy + 0.06, z - 0.042, x + 0.03, yy + 0.14, z - 0.04, label)
    } else if (kind === 1) {
      // uísque: quadrada, gargalo curto e tampa
      rb(group, x, yy + 0.1, z, 0.1, 0.2, 0.06, 0.012, m)
      cyl(group, x, yy + 0.2, z, 0.016, 0.04, m)
      cyl(group, x, yy + 0.24, z, 0.022, 0.03, std('#1c1917', 0.4))
      bx(group, x - 0.035, yy + 0.07, z - 0.032, x + 0.035, yy + 0.13, z - 0.03, label)
    } else if (kind === 2) {
      // licor redondo
      sph(group, x, yy + 0.08, z, 0.075, m, 0.95)
      cyl(group, x, yy + 0.15, z, 0.016, 0.07, m)
    } else if (kind === 3) {
      // fina e alta
      cyl(group, x, yy, z, 0.028, 0.28, m)
      cyl(group, x, yy + 0.28, z, 0.012, 0.06, m)
    } else {
      // espumante com papel dourado no gargalo
      cyl(group, x, yy, z, 0.045, 0.19, m)
      cyl(group, x, yy + 0.19, z, 0.045, 0.06, m, 0.016)
      cyl(group, x, yy + 0.25, z, 0.017, 0.08, gold)
    }
  }
  const zc = (zf + zb) / 2
  for (let r = 0; r < ys.length - 1; r++) for (let c = 0; c < cols; c++) {
    const x0c = sx0 + c * cw
    const y = ys[r] + 0.01
    const theme = (r * 2 + c * 3) % 6
    if (theme === 0 || theme === 3) {
      // garrafas misturadas
      const n = 5
      for (let k = 0; k < n; k++) bottle(x0c + 0.16 + k * ((cw - 0.32) / (n - 1)), y, zc, (r + c + k * 2) % 5, bottleCols[(r * 3 + c * 5 + k) % bottleCols.length])
    } else if (theme === 1) {
      // livros (é um book club): pilha deitada e fileira em pé, com um cacto
      const spines = ['#7f1d1d', '#1e3a8a', '#14532d', '#78350f', '#4c1d95', '#0f766e', '#a16207']
      for (let k = 0; k < 4; k++) bx(group, x0c + 0.12, ry + y + k * 0.05, zc - 0.11, x0c + 0.5, ry + y + k * 0.05 + 0.045, zc + 0.1, std(spines[(k + c) % spines.length], 0.8))
      for (let k = 0; k < 9; k++) {
        const bw = 0.035 + (k % 3) * 0.008
        const bh = 0.24 + ((k * 5) % 4) * 0.025
        const bxx = x0c + 0.62 + k * 0.075
        const bk = bx(group, bxx, ry + y, zc - 0.1, bxx + bw, ry + y + bh, zc + 0.1, std(spines[(k * 3 + r) % spines.length], 0.8))
        if (k === 8) bk.rotation.z = -0.25
      }
      cyl(group, x0c + 0.3, ry + y + 0.2, zc, 0.05, 0.06, std('#9a3412', 0.9))
      cyl(group, x0c + 0.3, ry + y + 0.26, zc, 0.035, 0.12, std('#3f6212', 0.8))
    } else if (theme === 2) {
      // discos de vinil em pé e um radinho
      for (let k = 0; k < 7; k++) {
        const disc = cyl(group, 0, 0, 0, 0.15, 0.008, std('#111114', 0.35))
        disc.rotation.z = Math.PI / 2
        disc.rotation.y = 0.12 * (k % 2 ? 1 : -1)
        disc.position.set(x0c + 0.15 + k * 0.03, ry + y + 0.15, zc)
        const lab = cyl(group, 0, 0, 0, 0.05, 0.01, std(['#ec4899', '#f59e0b', '#22d3ee', '#a3e635'][k % 4], 0.6))
        lab.rotation.z = Math.PI / 2
        lab.position.set(x0c + 0.15 + k * 0.03, ry + y + 0.15, zc)
      }
      rb(group, x0c + 0.95, ry + y + 0.11, zc, 0.36, 0.22, 0.14, 0.03, std('#b45309', 0.5))
      cyl(group, 0, 0, 0, 0.06, 0.01, std('#e7e5e4', 0.6)).position.set(x0c + 0.88, ry + y + 0.12, zc - 0.075)
      bx(group, x0c + 0.98, ry + y + 0.07, zc - 0.075, x0c + 1.08, ry + y + 0.17, zc - 0.07, std('#1c1917', 0.4))
    } else if (theme === 4) {
      // copos e taças enfileirados
      for (let k = 0; k < 6; k++) {
        const gx = x0c + 0.16 + k * ((cw - 0.32) / 5)
        if (k % 2) {
          cyl(group, gx, ry + y, zc, 0.035, 0.01, glassC)
          cyl(group, gx, ry + y, zc, 0.005, 0.1, glassC)
          cyl(group, gx, ry + y + 0.1, zc, 0.012, 0.09, glassC, 0.045)
        } else cyl(group, gx, ry + y, zc, 0.04, 0.1, glassC)
      }
    } else {
      // potes de vidro com limão e laranja, e uma coqueteleira
      for (let k = 0; k < 2; k++) {
        const jx = x0c + 0.3 + k * 0.45
        cyl(group, jx, ry + y, zc, 0.11, 0.24, glassC)
        const fruit = std(k ? '#ea580c' : '#84cc16', 0.6)
        for (let f = 0; f < 5; f++) sph(group, jx + Math.cos(f * 2.1) * 0.05, ry + y + 0.05 + (f % 3) * 0.06, zc + Math.sin(f * 2.1) * 0.05, 0.04, fruit)
      }
      cyl(group, x0c + 1.12, ry + y, zc, 0.045, 0.22, std('#d4d4d8', 0.2, 0.9), 0.035)
    }
  }
  // galeria dos dois lados da estante: quadros de vários formatos, com frames do vídeo que está tocando
  const pictures: Club['pictures'] = []
  const frameMs = [gold, std('#18181b', 0.5), std('#7c4a2a', 0.6), std('#e7e5e4', 0.5)]
  const picture = (x: number, y: number, w: number, h: number, k: number) => {
    const fw = 0.05
    const fm = frameMs[k % frameMs.length]
    const zf2 = D - 0.76
    bx(group, x - w / 2 - fw, ry + y - h / 2 - fw, zf2 - 0.04, x + w / 2 + fw, ry + y + h / 2 + fw, zf2, fm)
    // passe-partout e a imagem (material normal: a luz do bar é que ilumina)
    bx(group, x - w / 2, ry + y - h / 2, zf2 - 0.045, x + w / 2, ry + y + h / 2, zf2 - 0.04, std('#f5f1e8', 0.9))
    const cv = document.createElement('canvas')
    cv.width = 256
    cv.height = Math.round((256 * h) / w)
    const c = cv.getContext('2d')!
    const g = c.createLinearGradient(0, 0, cv.width, cv.height)
    g.addColorStop(0, '#3b0764')
    g.addColorStop(1, '#0f172a')
    c.fillStyle = g
    c.fillRect(0, 0, cv.width, cv.height)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })
    own.push(m)
    const art = new THREE.Mesh(unitPlane(), m)
    const pad = 0.04
    art.scale.set(w - pad * 2, h - pad * 2, 1)
    art.position.set(x, ry + y, zf2 - 0.047)
    art.rotation.y = Math.PI
    group.add(art)
    pictures.push({ c, tex, shown: -1 })
  }
  // salão de quadros: formatos e alturas diferentes em cada lado
  const L = [
    [-2.85, 2.55, 1.1, 0.62], [-1.75, 2.75, 0.5, 0.72], [-1.15, 2.05, 0.72, 0.72], [-2.65, 1.55, 0.62, 0.84], [-1.45, 1.35, 0.9, 0.5], [-0.75, 3.05, 0.38, 0.38],
  ] as const
  L.forEach(([dx, y, w, h], i) => picture(sx0 + dx + 0.62, y, w, h, i))
  L.forEach(([dx, y, w, h], i) => picture(sx1 - dx - 0.62 + (i % 2 ? 0.1 : -0.05), y + (i % 3 === 0 ? -0.1 : 0.08), h > w ? w : w * 0.92, h, i + 2))
  // duas arandelas iluminando os quadros
  for (const gx of [sx0 - 1.8, sx1 + 1.8]) {
    cyl(group, gx, ry + 3.32, D - 0.85, 0.06, 0.1, gold)
    lamps.push(new THREE.Vector3(gx, ry + 3.0, D - 1.5))
  }
  colliders.push({ x0: b0 - 0.35, x1: b1 + 0.35, z0: D - 1.15, z1: D, level: roofL })
  // letreiro grande em cima do bar
  plane(group, signTex('BOOK CLUB BAR', '#0b0b10', '#f9a8d4', 1536, 220), (b0 + b1) / 2, ry + 3.12, D - 0.765, 4.6, 0.66, '-z', own, true)
  // pendentes sobre o balcão (luz quente de verdade nos mais perto da câmera)
  const shadeM = std('#1f1d24', 0.4, 0.6)
  const bulbM = glow('#ffd59a', 2.2)
  for (let x = b0 + 0.9; x < b1 - 0.5; x += 2.2) {
    cyl(group, x, ry + 2.75, (cz0 + cz1) / 2, 0.006, 1.6, std('#111', 0.8)).castShadow = false
    const sh = cyl(group, x, ry + 2.55, (cz0 + cz1) / 2, 0.22, 0.22, shadeM, 0.05)
    sh.castShadow = false
    sph(group, x, ry + 2.52, (cz0 + cz1) / 2, 0.07, bulbM).castShadow = false
    lamps.push(new THREE.Vector3(x, ry + 2.4, (cz0 + cz1) / 2))
  }
  // banquetas: base cromada, pé, aro de apoio e assento de veludo
  const velvet = std('#7e22ce', 0.95)
  for (let x = b0 + 0.6; x < b1 - 0.3; x += 1.1) {
    const st = new THREE.Group()
    st.position.set(x, ry, cz0 - 0.55)
    cyl(st, 0, 0, 0, 0.2, 0.03, chromeB)
    cyl(st, 0, 0, 0, 0.035, 0.74, chromeB)
    const ringS = new THREE.Mesh(geo('stoolring', () => new THREE.TorusGeometry(0.16, 0.012, 6, 24)), brass)
    ringS.rotation.x = Math.PI / 2
    ringS.position.y = 0.3
    st.add(ringS)
    cyl(st, 0, 0.72, 0, 0.21, 0.1, velvet)
    group.add(st)
    tagHits(st, { kind: 'seat', label: 'Sentar no bar', seats: [{ x, y: ry + 0.8, z: cz0 - 0.55, rot: 0, L: roofL }] }, hits)
    spots.push({ act: 'bar', x, z: cz0 - 0.55, rot: 0, lift: 0.33 })
    colliders.push({ x0: x - 0.22, x1: x + 0.22, z0: cz0 - 0.77, z1: cz0 - 0.33, level: roofL })
  }
  // atrás do balcão: dois bartenders (cada um na sua metade)
  const bartenders = [
    { x0: b0 + 0.8, x1: (b0 + b1) / 2 - 0.6, z: (cz1 + D - 1.1) / 2 },
    { x0: (b0 + b1) / 2 + 0.6, x1: b1 - 0.8, z: (cz1 + D - 1.1) / 2 },
  ]
  // vasos com folhagem nos cantos, longe do palco
  for (const [px, pz] of [[4.6, 0.7], [W - 7.5, 0.7], [W - 1, D - 1]] as const) {
    plant(group, px, ry, pz, 1.3, px * 3)
    colliders.push({ x0: px - 0.4, x1: px + 0.4, z0: pz - 0.4, z1: pz + 0.4, level: roofL })
  }
  void night
  // pista: grade de dançarinos virados para o DJ
  // pista: grade de 6 x 5 lugares (desencontrados) na frente do palco
  for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) spots.push({ act: 'dance', x: mx - 4.2 + i * 1.68 + (j % 2) * 0.5, z: 5.4 + j * 1.25, rot: Math.PI, lift: 0 })
  // palco: faixa neon rosa na frente
  blocks.push({ x0: mx - 2.6, z0: 4.2, x1: mx + 2.6, z1: 4.3, a: 1, color: '#ec4899' })
  for (const b of spkBoxes) blocks.push({ x0: b.x - 0.5, z0: b.z - 0.5, x1: b.x + 0.5, z1: b.z + 0.5, a: 0.9 })
  video.manta = manta
  video.mats.push(mantaM)
  return { boxes: spkBoxes, bar: { x0: b0, x1: b1, z: cz0, top: ry + ctop }, video, speakers, drivers, lamps, bartenders, pictures, screenGlow, neon: [neon as THREE.MeshBasicMaterial, neonPink as THREE.MeshBasicMaterial], led: { cols: ledCols }, jogs, flames, beams, beamMats, pools, spots, glows, blocks, screen, maestro: { x: mx, z: 2.75 } }
}
