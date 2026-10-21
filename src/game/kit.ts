// Kit de construção do Book Club Radio: texturas de canvas, materiais (com ruído), formas básicas, bonecos e
// mobília. Veio do prédio 3D do cursor-headless-ui (Building3D.tsx), sem nada de prédio.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { addBaton, makeRobot } from '../robot.ts'
import { makeMeshyMaestro } from '../maestroMeshy.ts'

// ---------- medidas (metros) ----------

// mundo de um nível só: a cobertura fica no chão (y = 0); FH só separa "andares" de assento (sempre 0)
export const FH = 3.8
export const W = 31
export const D = 34
export const EYE = 1.62
export const MAESTRO = 'maestro'

export const SKIN = ['#f9d7b5', '#eab98f', '#c98e62', '#a86b45', '#7a4a2c', '#f2c7a0']
export const HAIR = ['#2b1d14', '#5b3a22', '#a0522d', '#e5c07b', '#111827', '#9ca3af', '#7c2d12']
export const SHIRT = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b', '#0ea5e9']
// tipos de boneco (cada um com o seu acessório)
export const ROLES = ['construtor', 'revisor', 'investigador', 'planejador', 'arquiteta', 'auditor', 'manutencao', 'testador']

export function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export interface Box2 { x0: number, x1: number, z0: number, z1: number, level: number }
export interface Seat { x: number, y: number, z: number, rot: number, L: number }
// shop: item do cardápio do bar (id = tipo); item: item no chão (id = id do servidor); use: mictório;
// player: outro jogador (id = id dele)
export interface Hit { kind: 'npc' | 'seat' | 'dj' | 'shop' | 'item' | 'use' | 'player' | 'album' | 'door', id?: string, label: string, sub?: string, seats?: Seat[] }

export function tagHits(obj: THREE.Object3D, hit: Hit, list: THREE.Object3D[]) {
  obj.traverse((o) => {
    o.userData.hit = hit
  })
  list.push(obj)
}

// ---------- texturas de canvas ----------

export const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'

export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, color = true) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const c = cv.getContext('2d')!
  draw(c)
  const tex = new THREE.CanvasTexture(cv)
  if (color) tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return { tex, cv, c }
}

export function fitText(c: CanvasRenderingContext2D, text: string, max: number) {
  if (c.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && c.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s}…`
}

export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const texCache = new Map<string, THREE.Texture>()
export function cachedTex(key: string, make: () => THREE.Texture) {
  let t = texCache.get(key)
  if (!t) {
    t = make()
    texCache.set(key, t)
  }
  return t
}

export function repeatTex(t: THREE.Texture, rx: number, ry: number) {
  const c = t.clone()
  c.wrapS = THREE.RepeatWrapping
  c.wrapT = THREE.RepeatWrapping
  c.repeat.set(rx, ry)
  c.needsUpdate = true
  return c
}

export const woodTex = () => cachedTex('wood', () => canvasTex(512, 512, (c) => {
  const r = rng(7)
  for (let i = 0; i < 8; i++) {
    const base = 180 + r() * 40
    c.fillStyle = `rgb(${base},${base * 0.78},${base * 0.55})`
    c.fillRect(0, i * 64, 512, 64)
    for (let k = 0; k < 40; k++) {
      c.strokeStyle = `rgba(90,60,30,${0.05 + r() * 0.08})`
      c.lineWidth = 1 + r() * 2
      const y = i * 64 + r() * 64
      c.beginPath()
      c.moveTo(0, y)
      c.bezierCurveTo(170, y + r() * 6 - 3, 340, y + r() * 6 - 3, 512, y)
      c.stroke()
    }
    c.fillStyle = 'rgba(60,40,20,0.35)'
    c.fillRect(0, i * 64, 512, 2)
    const cut = r() * 512
    c.fillRect(cut, i * 64, 2, 64)
  }
}).tex)

// ---------- materiais e geometrias ----------

export const mats = new Map<string, THREE.Material>()

// Ruído de Perlin (fbm de value noise 3D) em espaço de mundo: tira a cara de cor chapada sem depender de UV
// nem esticar com a escala da caixa. Varia cor e rugosidade. Bonecos e carros ficam lisos (o ruído "escorreria").
const NOISE_GLSL = /* glsl */ `
varying vec3 vNoiseP;
float nHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(nHash(i), nHash(i + vec3(1, 0, 0)), f.x), mix(nHash(i + vec3(0, 1, 0)), nHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(nHash(i + vec3(0, 0, 1)), nHash(i + vec3(1, 0, 1)), f.x), mix(nHash(i + vec3(0, 1, 1)), nHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 4; k++) { s += a * vNoise(p); p *= 2.03; a *= 0.5; } return s; }
`
let plainMats = false
export function withNoise(m: THREE.MeshStandardMaterial, amp = 1) {
  const a1 = (0.16 * amp).toFixed(3)
  const a2 = (0.08 * amp).toFixed(3)
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vNoiseP;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vNoiseP = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float nz = smoothstep(0.15, 0.85, fbm(vNoiseP * 5.5));
// média 1: clareia e escurece por igual, sem sujar
diffuseColor.rgb *= 1.0 + ${a1} * (nz - 0.5) + ${a2} * (vNoise(vNoiseP * 42.0) - 0.5);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance *= 1.0 + ${a1} * (nz - 0.5);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor * (0.85 + 0.3 * nz), 0.04, 1.0);`)
  }
  m.customProgramCacheKey = () => `perlin${amp}`
  return m
}

export function std(color: string, rough = 0.8, metal = 0, extra: { opacity?: number, key?: string, flat?: boolean } = {}) {
  const key = `${color}|${rough}|${metal}|${extra.key ?? ''}|${extra.opacity ?? 1}|${extra.flat ? 1 : 0}|${plainMats ? 'liso' : 'ruido'}`
  let m = mats.get(key)
  if (!m) {
    const transparent = extra.opacity !== undefined && extra.opacity < 1
    const sm = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, transparent, opacity: extra.opacity ?? 1, depthWrite: !transparent, flatShading: !!extra.flat })
    m = plainMats || transparent ? sm : withNoise(sm)
    mats.set(key, m)
  }
  return m
}
// constrói sem ruído (para o que se move)
export function plain<T>(make: () => T): T {
  const prev = plainMats
  plainMats = true
  try {
    return make()
  } finally {
    plainMats = prev
  }
}
export function glow(color: string, intensity = 1) {
  const key = `glow|${color}|${intensity}`
  let m = mats.get(key)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false })
    mats.set(key, m)
  }
  return m
}

export const geos = new Map<string, THREE.BufferGeometry>()
export function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = geos.get(key)
  if (!g) {
    g = make()
    geos.set(key, g)
  }
  return g
}
export const unitBox = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1))
export const unitSphere = () => geo('sph', () => new THREE.SphereGeometry(1, 20, 14))
export const unitCyl = () => geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 20))
// peças pequenas (rodinha, LED, parafuso) não precisam de 600 triângulos cada
export const loSphere = () => geo('sphLo', () => new THREE.SphereGeometry(1, 10, 7))
export const loCyl = () => geo('cylLo', () => new THREE.CylinderGeometry(1, 1, 1, 10))
export const unitPlane = () => geo('plane', () => new THREE.PlaneGeometry(1, 1))

export function shade<T extends THREE.Object3D>(o: T, cast = true, receive = true) {
  o.castShadow = cast
  o.receiveShadow = receive
  return o
}

// Caixa pelos cantos mínimo e máximo.
export function bx(parent: THREE.Object3D, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: THREE.Material, cast = true) {
  const mesh = shade(new THREE.Mesh(unitBox(), m), cast)
  mesh.scale.set(Math.max(0.001, x1 - x0), Math.max(0.001, y1 - y0), Math.max(0.001, z1 - z0))
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  parent.add(mesh)
  return mesh
}

// Caixa de cantos arredondados, centrada.
export function rb(parent: THREE.Object3D, cx: number, cy: number, cz: number, w: number, h: number, d: number, r: number, m: THREE.Material) {
  const k = `rb|${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}`
  // peça fina vira caixa reta: RoundedBoxGeometry com 1 segmento deforma (porta "torta", placa "estufada")
  const g = geo(k, () => (Math.min(w, h, d) < 0.08 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))))
  const mesh = shade(new THREE.Mesh(g, m))
  mesh.position.set(cx, cy, cz)
  parent.add(mesh)
  return mesh
}

export function sph(parent: THREE.Object3D, x: number, y: number, z: number, r: number, m: THREE.Material, sy = 1) {
  const mesh = shade(new THREE.Mesh(r < 0.045 ? loSphere() : unitSphere(), m))
  mesh.scale.set(r, r * sy, r)
  mesh.position.set(x, y, z)
  parent.add(mesh)
  return mesh
}

export function cyl(parent: THREE.Object3D, x: number, y0: number, z: number, r: number, h: number, m: THREE.Material, rTop?: number) {
  const g = rTop === undefined ? (r < 0.05 ? loCyl() : unitCyl()) : geo(`cyl|${(rTop / r).toFixed(3)}`, () => new THREE.CylinderGeometry(rTop / r, 1, 1, 20))
  const mesh = shade(new THREE.Mesh(g, m))
  mesh.scale.set(r, h, r)
  mesh.position.set(x, y0 + h / 2, z)
  parent.add(mesh)
  return mesh
}

export function cap(parent: THREE.Object3D, r: number, len: number, m: THREE.Material) {
  const g = geo(`cap|${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 12))
  const mesh = shade(new THREE.Mesh(g, m))
  parent.add(mesh)
  return mesh
}

// Placa plana com textura; `face` é para onde ela olha.
export function plane(parent: THREE.Object3D, tex: THREE.Texture, x: number, y: number, z: number, w: number, h: number, face: '+z' | '-z' | '+x' | '-x' | 'up', own: THREE.Material[], lit = false) {
  const m = lit
    ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })
    : new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6 })
  own.push(m)
  const mesh = new THREE.Mesh(unitPlane(), m)
  mesh.receiveShadow = !lit
  mesh.scale.set(w, h, 1)
  mesh.position.set(x, y, z)
  if (face === 'up') mesh.rotation.x = -Math.PI / 2
  else mesh.rotation.y = face === '+z' ? 0 : face === '-z' ? Math.PI : face === '+x' ? Math.PI / 2 : -Math.PI / 2
  parent.add(mesh)
  return mesh
}

// Piso com textura repetida em metros.
export function floorPlane(parent: THREE.Object3D, x0: number, z0: number, x1: number, z1: number, y: number, m: THREE.Material) {
  const mesh = new THREE.Mesh(unitPlane(), m)
  mesh.receiveShadow = true
  mesh.rotation.x = -Math.PI / 2
  mesh.scale.set(x1 - x0, z1 - z0, 1)
  mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2)
  parent.add(mesh)
  return mesh
}

export function texMat(base: () => THREE.Texture, color: string, rx: number, rz: number, rough: number, own: THREE.Material[]) {
  // piso já tem textura: ruído bem mais fraco para não parecer sujo
  const m = withNoise(new THREE.MeshStandardMaterial({ color, roughness: rough, map: repeatTex(base(), rx, rz) }), 0.3)
  own.push(m)
  return m
}

// ---------- bonecos ----------

// Boneco articulado: quadril e joelho para andar e sentar, tronco para inclinar, cotovelo para digitar.
export interface PersonRig {
  root: THREE.Object3D
  body: THREE.Object3D
  upper: THREE.Object3D
  armL: THREE.Object3D
  armR: THREE.Object3D
  foreL: THREE.Object3D
  foreR: THREE.Object3D
  head: THREE.Object3D
  hipL: THREE.Object3D
  hipR: THREE.Object3D
  kneeL: THREE.Object3D
  kneeR: THREE.Object3D
  lens: THREE.Object3D
  // boca (abre com a voz: escala em y = abertura, em x = largura); só aparece falando, no lugar do sorriso
  mouth?: THREE.Object3D
  smile?: THREE.Object3D
  // última vez (s) que a voz passou do limiar: segura a boca aberta um pouco entre as sílabas
  talkAt?: number
}

// Personagem escolhido na criação (índices nas paletas): pele, cor e penteado do cabelo, camiseta, calça e tipo
// (o tipo dá o acessório: fone, óculos, chapéu...)
export interface Avatar { skin: number, hair: number, style: number, shirt: number, pants: number, role: number }
export const HAIR_STYLES = 5

export function makeAvatarPerson(id: string, av: Avatar): PersonRig {
  return plain(() => buildPerson(id, ROLES[av.role % ROLES.length], av))
}

// O Maestro DJ é o modelo do Meshy (rig Mixamo) dirigido pela mesma pose procedural; enquanto ele carrega,
// fica o robô de formas simples (robot.ts).
export function makeMaestro(): PersonRig {
  const meshy = makeMeshyMaestro()
  if (meshy) return meshy
  const r = makeRobot()
  addBaton(r)
  r.body.scale.setScalar(1.12)
  return r
}

// Junta as malhas filhas diretas de cada grupo do boneco por material: cada parte do corpo continua articulada,
// mas vira poucas draw calls (um boneco tinha ~50 malhas).
export function compactRig<T extends { root: THREE.Object3D }>(rig: T): T {
  const groups: THREE.Object3D[] = []
  rig.root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) groups.push(o)
  })
  for (const g of groups) {
    const by = new Map<THREE.Material, THREE.Mesh[]>()
    for (const c of g.children) {
      const m = c as THREE.Mesh
      if (!m.isMesh || Array.isArray(m.material) || (m as THREE.SkinnedMesh).isSkinnedMesh || m.children.length || m.userData.ui) continue
      if (!m.visible) continue
      by.set(m.material, [...(by.get(m.material) ?? []), m])
    }
    for (const [mat, list] of by) {
      if (list.length < 2) continue
      const parts = list.map((m) => {
        m.updateMatrix()
        const geo2 = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix)
        for (const k of Object.keys(geo2.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo2.deleteAttribute(k)
        if (!geo2.attributes.uv) geo2.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo2.attributes.position.count * 2), 2))
        return geo2
      })
      const merged = mergeGeometries(parts, false)
      for (const pg of parts) pg.dispose()
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, mat)
      mesh.castShadow = list.some((m) => m.castShadow)
      mesh.receiveShadow = true
      for (const m of list) g.remove(m)
      g.add(mesh)
    }
  }
  return rig
}

export const HIP_Y = 0.9
export const SIT_DROP = 0.4
export const PANTS3 = ['#1e293b', '#334155', '#1e3a8a', '#3f3f46', '#57534e', '#164e63']
// Tronco torneado (cintura fina, peito e ombros arredondados), girado em torno de y.
const torsoGeo = () => geo('torso', () => new THREE.LatheGeometry(
  [[0.001, -0.03], [0.13, -0.025], [0.15, 0.02], [0.145, 0.14], [0.16, 0.3], [0.175, 0.42], [0.16, 0.5], [0.115, 0.56], [0.06, 0.585], [0.001, 0.59]].map(([x, y]) => new THREE.Vector2(x, y)),
  24,
))

// Boneco chibi: cabeça grande, olhos com brilho, bochecha, cabelo com volume e acessório por tipo.
export function makePerson(id: string, role: string): PersonRig {
  return plain(() => buildPerson(id, role))
}

function buildPerson(id: string, role: string, av?: Avatar): PersonRig {
  const h = hash(id)
  const skinHex = av ? SKIN[av.skin % SKIN.length] : SKIN[h % SKIN.length]
  const skin = std(skinHex, 0.6)
  const hair = std(role === MAESTRO ? '#e5e7eb' : av ? HAIR[av.hair % HAIR.length] : HAIR[(h >>> 3) % HAIR.length], 0.55)
  const shirtHex = av ? SHIRT[av.shirt % SHIRT.length] : role === MAESTRO ? '#111827' : role === 'testador' ? '#f8fafc' : SHIRT[(h >>> 7) % SHIRT.length]
  const shirt = std(shirtHex, 0.8)
  const trim = std(new THREE.Color(shirtHex).lerp(new THREE.Color('#ffffff'), 0.45).getStyle(), 0.8)
  const pantsHex = av ? PANTS3[av.pants % PANTS3.length] : PANTS3[(h >>> 13) % PANTS3.length]
  const pants = std(pantsHex, 0.85)
  const shoe = std('#111827', 0.45)
  const sole = std('#e5e7eb', 0.7)
  const ink = std('#141022', 0.35)
  const shine = glow('#ffffff', 1)
  const blush = std('#fb7185', 0.9, 0, { opacity: 0.55 })
  const style = av ? av.style % HAIR_STYLES : (h >>> 11) % 5
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  // pernas: quadril -> coxa -> joelho -> canela -> tênis
  const leg = (sx: number) => {
    const hip = new THREE.Group()
    hip.position.set(sx, HIP_Y, 0)
    const thigh = cap(hip, 0.078, 0.28, pants)
    thigh.position.y = -0.22
    const knee = new THREE.Group()
    knee.position.y = -0.45
    hip.add(knee)
    const shin = cap(knee, 0.066, 0.28, pants)
    shin.position.y = -0.2
    rb(knee, 0, -0.41, 0.045, 0.12, 0.08, 0.24, 0.035, shoe)
    rb(knee, 0, -0.445, 0.045, 0.125, 0.025, 0.245, 0.01, sole)
    body.add(hip)
    return { hip, knee }
  }
  const LL = leg(-0.09)
  const LR = leg(0.09)
  // tronco, braços e cabeça num grupo que inclina a partir do quadril
  const upper = new THREE.Group()
  upper.position.y = HIP_Y
  body.add(upper)
  const torso = shade(new THREE.Mesh(torsoGeo(), shirt))
  torso.scale.set(1, 1, 0.74)
  upper.add(torso)
  cyl(upper, 0, -0.035, 0, 0.152, 0.05, std(new THREE.Color(pantsHex).multiplyScalar(0.7).getStyle(), 0.7)).scale.z = 0.152 * 0.76
  const top = 0.6
  // gola em V
  const collar = shade(new THREE.Mesh(geo('collar', () => new THREE.TorusGeometry(0.085, 0.018, 8, 20, Math.PI)), trim))
  collar.rotation.set(Math.PI / 2 + 0.35, 0, Math.PI)
  collar.position.set(0, top - 0.06, 0.01)
  upper.add(collar)
  if (role === MAESTRO) {
    const front = cap(upper, 0.07, 0.18, std('#f8fafc', 0.6))
    front.scale.set(1, 1, 0.5)
    front.position.set(0, top - 0.18, 0.1)
    rb(upper, 0, top - 0.06, 0.14, 0.12, 0.04, 0.03, 0.01, std('#dc2626', 0.5))
  }
  if (role === 'planejador') rb(upper, 0, top - 0.2, 0.128, 0.05, 0.25, 0.015, 0.006, std('#dc2626', 0.5))
  if (role === 'manutencao') {
    // colete refletivo
    for (const y of [0.18, 0.32]) {
      const band = cyl(upper, 0, y, 0, 0.168, 0.035, glow('#facc15', 0.9))
      band.scale.z = 0.168 * 0.76
    }
  }
  if (role === 'auditor') rb(upper, 0.07, top - 0.2, 0.125, 0.05, 0.065, 0.012, 0.005, std('#f8fafc', 0.5))
  const arm = (side: number) => {
    const a = new THREE.Group()
    a.position.set(side * 0.215, top - 0.06, 0)
    sph(a, 0, 0, 0, 0.068, shirt)
    const up = cap(a, 0.054, 0.2, shirt)
    up.position.y = -0.15
    const fore = new THREE.Group()
    fore.position.y = -0.3
    a.add(fore)
    const cuff = cyl(fore, 0, -0.2, 0, 0.05, 0.04, trim)
    cuff.castShadow = false
    const sleeve = cap(fore, 0.048, 0.16, shirt)
    sleeve.position.y = -0.1
    sph(fore, 0, -0.27, 0, 0.058, skin, 1.1)
    upper.add(a)
    return { a, fore }
  }
  const AL = arm(-1)
  const AR = arm(1)
  if (role === MAESTRO) {
    const baton = cyl(AR.fore, 0, 0, 0, 0.006, 0.38, std('#f8fafc', 0.3))
    baton.rotation.x = Math.PI / 2
    baton.position.set(0, -0.28, 0.18)
  }
  // lupa presa na mão: cabo sai da palma no sentido dos dedos (-y do antebraço) e o aro fica além dela
  const lens = new THREE.Group()
  lens.position.set(0, -0.27, 0.01)
  cyl(lens, 0, -0.13, 0, 0.013, 0.14, std('#78350f', 0.6))
  const ring = shade(new THREE.Mesh(geo('lensring2', () => new THREE.TorusGeometry(0.068, 0.011, 8, 28)), std('#d4d4d8', 0.3, 0.8)))
  ring.position.y = -0.2
  lens.add(ring)
  const disc = new THREE.Mesh(unitCyl(), std('#bae6fd', 0.05, 0, { opacity: 0.45 }))
  disc.scale.set(0.064, 0.004, 0.064)
  disc.rotation.x = Math.PI / 2
  disc.position.y = -0.2
  lens.add(disc)
  lens.visible = role === 'investigador'
  AR.fore.add(lens)
  // cabeça grande (chibi)
  const R = 0.175
  const head = new THREE.Group()
  head.position.set(0, top + 0.21, 0)
  upper.add(head)
  cyl(upper, 0, top - 0.04, 0, 0.05, 0.1, skin)
  sph(head, 0, 0, 0, R, skin, 1.0)
  for (const ex of [-1, 1]) {
    sph(head, ex * R * 0.98, -0.005, -0.005, 0.034, skin)
    const eye = sph(head, ex * 0.062, 0.006, R * 0.9, 0.028, ink, 1.3)
    eye.scale.z = 0.016
    eye.castShadow = false
    sph(head, ex * 0.062 + 0.01, 0.022, R * 0.9 + 0.014, 0.0085, shine).castShadow = false
    const b = sph(head, ex * 0.098, -0.045, R * 0.8, 0.026, blush, 0.6)
    b.scale.z = 0.01
    b.castShadow = false
  }
  // sobrancelhas e sorriso
  for (const ex of [-1, 1]) {
    const brow = rb(head, ex * 0.062, 0.062, R * 0.88, 0.045, 0.011, 0.012, 0.005, hair)
    brow.rotation.z = ex * -0.12
  }
  const smile = shade(new THREE.Mesh(geo('smile', () => new THREE.TorusGeometry(0.026, 0.0055, 6, 14, Math.PI)), ink), false)
  smile.rotation.z = Math.PI
  smile.position.set(0, -0.05, R * 0.94)
  // num grupo próprio: fora do merge do compactRig (some quando a pessoa fala)
  const smileG = new THREE.Group()
  smileG.add(smile)
  head.add(smileG)
  // boca: elipse escura num grupo próprio (fora do merge do compactRig), quase fechada até a voz abrir
  const mouthG = new THREE.Group()
  mouthG.position.set(0, -0.058, R * 0.93)
  head.add(mouthG)
  const mouth = new THREE.Mesh(loSphere(), std('#3b0a14', 0.6))
  mouth.scale.set(0.03, 0.002, 0.012)
  mouth.castShadow = false
  mouth.visible = false
  mouthG.add(mouth)
  // cabelo: calota que cobre topo e nuca, mais o penteado
  const capHair = sph(head, 0, 0.045, -0.022, R * 1.07, hair, 0.92)
  capHair.scale.z = R * 1.08
  if (style === 0) {
    const fringe = sph(head, 0.045, 0.12, 0.09, 0.1, hair, 0.45)
    fringe.rotation.z = -0.35
  }
  if (style === 1) {
    rb(head, 0, -0.075, -0.075, 0.33, 0.3, 0.16, 0.07, hair)
    for (const sx of [-1, 1]) rb(head, sx * 0.16, -0.06, -0.035, 0.05, 0.2, 0.09, 0.022, hair)
    sph(head, -0.03, 0.12, 0.09, 0.1, hair, 0.4)
  }
  if (style === 2) {
    sph(head, 0, 0.215, -0.08, 0.075, hair)
    sph(head, 0, 0.12, 0.1, 0.09, hair, 0.35)
  }
  if (style === 3) for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2
    sph(head, Math.cos(a) * 0.12, 0.12 + (k % 2) * 0.03, Math.sin(a) * 0.1 - 0.03, 0.062, hair)
  }
  if (style === 4) {
    // rabo de cavalo
    sph(head, 0, 0.09, 0.1, 0.1, hair, 0.4)
    const tail = cap(head, 0.045, 0.16, hair)
    tail.position.set(0, -0.02, -0.21)
    tail.rotation.x = 0.35
  }
  // acessórios desenhados para a cabeça antiga (raio 0.13): ganham a escala da nova
  const acc = new THREE.Group()
  acc.scale.setScalar(R / 0.13)
  head.add(acc)
  const dark = std('#1f2937', 0.4, 0.3)
  if (role === 'construtor') {
    const band = shade(new THREE.Mesh(geo('band', () => new THREE.TorusGeometry(0.152, 0.016, 8, 24, Math.PI)), dark))
    // o arco do torus já vai de orelha a orelha (plano XY): sem girar em Y
    acc.add(band)
    for (const sx of [-0.15, 0.15]) {
      const cup = cyl(acc, 0, 0, 0, 0.055, 0.05, std('#f59e0b', 0.5))
      cup.rotation.z = Math.PI / 2
      cup.position.set(sx, 0, 0)
    }
  }
  if (role === 'revisor' || role === MAESTRO) {
    for (const sx of [-0.047, 0.047]) {
      const g2 = shade(new THREE.Mesh(geo('glass', () => new THREE.TorusGeometry(0.034, 0.006, 6, 18)), dark))
      g2.position.set(sx, 0.006, 0.128)
      acc.add(g2)
    }
    rb(acc, 0, 0.006, 0.13, 0.03, 0.006, 0.006, 0.002, dark)
  }
  if (role === 'auditor') {
    const mono = shade(new THREE.Mesh(geo('glass', () => new THREE.TorusGeometry(0.034, 0.006, 6, 18)), std('#d4a017', 0.3, 0.8)))
    mono.position.set(0.047, 0.006, 0.128)
    acc.add(mono)
  }
  if (role === 'investigador') {
    cyl(acc, 0, 0.08, 0, 0.22, 0.015, std('#78350f', 0.8))
    cyl(acc, 0, 0.08, 0, 0.14, 0.13, std('#92400e', 0.8), 0.12)
    cyl(acc, 0, 0.1, 0, 0.142, 0.03, std('#451a03', 0.8))
  }
  if (role === 'arquiteta') {
    sph(acc, 0.02, 0.13, -0.01, 0.15, std('#a21caf', 0.8), 0.3)
    sph(acc, 0.02, 0.18, -0.01, 0.02, std('#a21caf', 0.8))
  }
  if (role === 'manutencao') {
    const hat = std('#f97316', 0.45)
    sph(acc, 0, 0.06, 0, 0.145, hat, 0.75)
    cyl(acc, 0, 0.045, 0.02, 0.17, 0.012, hat)
    rb(acc, 0, 0.16, 0, 0.03, 0.03, 0.2, 0.01, hat)
  }
  if (role === 'testador') {
    rb(acc, 0, 0.012, 0.11, 0.2, 0.06, 0.05, 0.022, std('#86efac', 0.1, 0, { opacity: 0.55 }))
    const strap = shade(new THREE.Mesh(geo('band3', () => new THREE.TorusGeometry(0.135, 0.008, 6, 24)), dark))
    strap.rotation.x = Math.PI / 2
    strap.position.y = 0.012
    acc.add(strap)
  }
  if (role === 'triador') {
    const band = shade(new THREE.Mesh(geo('band2', () => new THREE.TorusGeometry(0.15, 0.01, 8, 24, Math.PI)), std('#e5e7eb', 0.4)))
    // o arco do torus já vai de orelha a orelha (plano XY): sem girar em Y
    acc.add(band)
    const mic = cyl(acc, 0, 0, 0, 0.008, 0.14, dark)
    mic.rotation.x = Math.PI / 2.6
    mic.position.set(-0.13, -0.05, 0.06)
    sph(acc, -0.1, -0.07, 0.12, 0.018, dark)
  }
  contact(root, 1.0, 1.0, 0, 0.04, 0.8)
  return { root, body, upper, armL: AL.a, armR: AR.a, foreL: AL.fore, foreR: AR.fore, head, hipL: LL.hip, hipR: LR.hip, kneeL: LL.knee, kneeR: LR.knee, lens, mouth, smile: smileG }
}

// ---------- mobília ----------

// Sombra de contato: mancha escura e suave no chão embaixo do objeto (ancora móveis e bonecos sem AO)
const contactTex = (() => {
  let t: THREE.Texture | null = null
  return () => {
    if (t) return t
    const cv = document.createElement('canvas')
    cv.width = cv.height = 128
    const c = cv.getContext('2d')!
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(0,0,0,0.85)')
    g.addColorStop(0.45, 'rgba(0,0,0,0.5)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 128, 128)
    t = new THREE.CanvasTexture(cv)
    return t
  }
})()
export function contact(parent: THREE.Object3D, w: number, d: number, x = 0, z = 0, opacity = 0.7, y = 0.012) {
  const key = `contact|${opacity}`
  let m = mats.get(key) as THREE.MeshBasicMaterial | undefined
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: contactTex(), color: '#000000', transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 })
    mats.set(key, m)
  }
  const mesh = new THREE.Mesh(unitPlane(), m)
  mesh.rotation.x = -Math.PI / 2
  mesh.scale.set(w, d, 1)
  mesh.position.set(x, y, z)
  mesh.renderOrder = 1
  parent.add(mesh)
  return mesh
}

export function chair(parent: THREE.Object3D, accent: string) {
  const g = new THREE.Group()
  const frame = std('#1f2937', 0.5, 0.4)
  const fabric = std(accent, 0.9)
  rb(g, 0, 0.46, -0.02, 0.48, 0.08, 0.46, 0.03, fabric)
  rb(g, 0, 0.8, -0.27, 0.46, 0.52, 0.07, 0.03, fabric)
  cyl(g, 0, 0.12, 0, 0.03, 0.32, frame)
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2
    const leg = rb(g, Math.cos(a) * 0.14, 0.1, Math.sin(a) * 0.14, 0.3, 0.03, 0.04, 0.012, frame)
    leg.rotation.y = -a
    sph(g, Math.cos(a) * 0.28, 0.04, Math.sin(a) * 0.28, 0.035, frame)
  }
  contact(g, 0.9, 0.9)
  parent.add(g)
  return g
}

export function plant(parent: THREE.Object3D, x: number, y: number, z: number, scale = 1, seed = 1) {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  g.scale.setScalar(scale)
  cyl(g, 0, 0, 0, 0.2, 0.42, std('#e7e5e4', 0.6), 0.24)
  cyl(g, 0, 0.42, 0, 0.21, 0.03, std('#57534e', 0.9))
  const r = rng(seed)
  foliage(g, r, [[0, 0.78, 0, 0.3], [0.08, 1.02, -0.05, 0.22], [-0.09, 0.95, 0.07, 0.2]], 210, 0.22, 0.36, true)
  parent.add(g)
  return g
}

// Assentos do móvel em coordenadas de mundo: deslocamentos locais (frente em +z) girados pelo móvel.
export function seatsOf(x: number, y: number, z: number, rotY: number, offs: number[], seatY: number, front: number): Seat[] {
  const c = Math.cos(rotY)
  const s2 = Math.sin(rotY)
  return offs.map((ox) => ({ x: x + ox * c + front * s2, y: y + seatY, z: z - ox * s2 + front * c, rot: rotY, L: Math.round(y / FH) }))
}

export function sofa(parent: THREE.Object3D, x: number, y: number, z: number, rotY: number, color: string, hits?: THREE.Object3D[]) {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  g.rotation.y = rotY
  const f = std(color, 0.95)
  const cushion = std(color, 0.9, 0, { key: 'cushion' })
  contact(g, 2.7, 1.5, 0, -0.05, 0.7)
  rb(g, 0, 0.25, 0, 2.0, 0.3, 0.85, 0.08, f)
  rb(g, 0, 0.6, -0.33, 2.0, 0.55, 0.2, 0.08, f)
  rb(g, -0.93, 0.45, 0, 0.18, 0.45, 0.85, 0.07, f)
  rb(g, 0.93, 0.45, 0, 0.18, 0.45, 0.85, 0.07, f)
  // três almofadas = três lugares
  for (const cx of [-0.58, 0, 0.58]) rb(g, cx, 0.45, 0.02, 0.56, 0.12, 0.7, 0.05, cushion)
  parent.add(g)
  const seats = seatsOf(x, y, z, rotY, [-0.6, 0, 0.6], 0.47, 0.12)
  g.userData.seats = seats
  if (hits) tagHits(g, { kind: 'seat', label: 'Sentar no sofá', seats }, hits)
  return g
}

// Folhagem: textura de ramo com folhas (recorte alfa), cartões espalhados em cachos, normal esférica para
// sombrear como copa e farfalhar de vento no shader (posição de mundo, então funciona mesmo depois do merge).
export const leafTime = { value: 0 }
const leafTex = () => cachedTex('leaves', () => canvasTex(256, 256, (c) => {
  const r = rng(404)
  c.clearRect(0, 0, 256, 256)
  for (let k = 0; k < 46; k++) {
    const t = r()
    const y = 236 - t * 212
    const side = k % 2 ? 1 : -1
    const x = 128 + side * r() * 92 * (1 - t * 0.35)
    const L = 30 + r() * 26
    const g = 120 + Math.floor(r() * 80)
    c.fillStyle = `rgb(${Math.floor(g * 0.35)},${g},${Math.floor(g * 0.3)})`
    c.save()
    c.translate(x, y)
    c.rotate(side * (0.5 + r() * 0.6))
    c.beginPath()
    c.moveTo(0, 0)
    c.quadraticCurveTo(L * 0.45, -L * 0.35, 0, -L)
    c.quadraticCurveTo(-L * 0.45, -L * 0.35, 0, 0)
    c.fill()
    c.restore()
  }
}).tex)
// duas versões: com vento (árvores e arbustos de fora) e parada (plantas de vaso, dentro do prédio)
export const leafMs = new Map<boolean, THREE.MeshStandardMaterial>()
function leafMat(still = false) {
  const hit = leafMs.get(still)
  if (hit) return hit
  const m = new THREE.MeshStandardMaterial({ map: leafTex(), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.75 })
  if (still) {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
normal = normalize(vNormal);`)
    }
    m.customProgramCacheKey = () => 'leavesStill'
    leafMs.set(true, m)
    return m
  }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = leafTime
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 lw = (modelMatrix * vec4(transformed, 1.0)).xyz;
transformed += vec3(
  sin(uTime * 2.1 + lw.x * 0.9 + lw.y * 1.3) * 0.045 + sin(uTime * 5.7 + lw.z * 2.3) * 0.015,
  sin(uTime * 3.3 + lw.z * 1.1) * 0.02,
  cos(uTime * 1.7 + lw.z * 0.8 + lw.y) * 0.04);`)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
normal = normalize(vNormal);`)
  }
  m.customProgramCacheKey = () => 'leaves'
  leafMs.set(false, m)
  return m
}

function canopyGeo(r: () => number, clusters: [number, number, number, number][], perUnit = 80, size0 = 0.9, size1 = 1.4) {
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const greens = ['#3f8f2a', '#4ea33a', '#2f7a22', '#5bb043', '#3a8530'].map((h) => new THREE.Color(h))
  // centro da copa: média dos cachos (a normal esférica sai dele)
  const center = new THREE.Vector3()
  for (const [cx, cy, cz] of clusters) center.add(new THREE.Vector3(cx, cy, cz))
  center.divideScalar(clusters.length)
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
  for (const [cx, cy, cz, cr] of clusters) {
    const n = Math.round(perUnit * cr)
    for (let k = 0; k < n; k++) {
      const u = r() * 2 - 1
      const t = r() * Math.PI * 2
      const rad = cr * (0.45 + 0.55 * Math.cbrt(r()))
      const sx = Math.sqrt(1 - u * u)
      const p = new THREE.Vector3(cx + sx * Math.cos(t) * rad, cy + u * rad * 0.85, cz + sx * Math.sin(t) * rad)
      const size = size0 + r() * (size1 - size0)
      q.setFromEuler(e.set(r() * Math.PI, r() * Math.PI * 2, r() * Math.PI))
      const nrm = p.clone().sub(center).normalize()
      // cartões de dentro da copa mais escuros (oclusão "pintada")
      const base = greens[Math.floor(r() * greens.length)].clone().multiplyScalar(0.62 + 0.38 * (rad / cr))
      const i0 = pos.length / 3
      for (const [a, b] of corners) {
        const v = new THREE.Vector3(a * size, b * size, 0).applyQuaternion(q).add(p)
        pos.push(v.x, v.y, v.z)
        nor.push(nrm.x, nrm.y, nrm.z)
        uv.push(a + 0.5, b + 0.5)
        col.push(base.r, base.g, base.b)
      }
      idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  return g
}

// Folhagem solta (arbusto, planta de vaso): mesmos cartões e vento das árvores.
export function foliage(parent: THREE.Object3D, r: () => number, clusters: [number, number, number, number][], perUnit: number, size0: number, size1: number, still = false) {
  const m = new THREE.Mesh(canopyGeo(r, clusters, perUnit, size0, size1), leafMat(still))
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}

// Halo da lâmpada à noite: sprite radial aditivo (sempre de frente para a câmera), fora do AO.
// queda gaussiana (exp(-4r²)), sem borda nem núcleo marcado
const haloTex = () => cachedTex('halo', () => canvasTex(128, 128, (c) => {
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    g.addColorStop(t, `rgba(255,255,255,${Math.exp(-4.5 * t * t) * (1 - t)})`)
  }
  c.fillStyle = g
  c.fillRect(0, 0, 128, 128)
}).tex)
const haloMs = new Map<number, THREE.SpriteMaterial>()
export function halo(parent: THREE.Object3D, x: number, y: number, z: number, size: number, opacity: number) {
  let m = haloMs.get(opacity)
  if (!m) {
    m = new THREE.SpriteMaterial({ map: haloTex(), color: '#ffd9a0', transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    haloMs.set(opacity, m)
  }
  const sp = new THREE.Sprite(m)
  sp.scale.set(size, size, 1)
  sp.position.set(x, y, z)
  sp.userData.ui = true
  parent.add(sp)
  return sp
}

// mancha radial (centro claro, borda some) para luz projetada no chão
export const beamTex = () => cachedTex('beam', () => canvasTex(128, 128, (c) => {
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = g
  c.fillRect(0, 0, 128, 128)
}).tex)

// placa com texto (fundo arredondado)
export function signTex(text: string, bg: string, fg: string, w = 1024, h = 160) {
  return canvasTex(w, h, (c) => {
    c.fillStyle = bg
    c.beginPath()
    c.roundRect(0, 0, w, h, h * 0.18)
    c.fill()
    const x = h * 0.28
    c.fillStyle = fg
    c.font = `800 ${Math.round(h * 0.44)}px ${FONT}`
    c.textBaseline = 'middle'
    c.fillText(fitText(c, text, w - x - h * 0.25), x, h / 2 + h * 0.03)
  }).tex
}
