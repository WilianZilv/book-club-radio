// Motor do Book Club Radio: primeira pessoa no club (mundo vazio, sempre de noite), NPCs curtindo a festa,
// o DJ no palco, outros jogadores pelo multiplayer e o telão/domo/manta com o vídeo do DJ (imagem e som nossos,
// pelo proxy; o iframe do YouTube fica de relógio). A batida e as faixas (grave, médio, agudo) do som movem a
// dança, as ondas de distorção e as luzes.
import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

import { Net, type DjState, type NetChat, type NetFloorItem, type NetOffer, type NetPhoto, type NetPlayer } from '../net.ts'
import { Voice } from '../voice.ts'
import { DjPlayer, SCREEN_PX } from '../djPlayer.ts'
import { VideoFeed } from '../videoFeed.ts'
import { RadianceCascades, giHook, type GiUniforms } from '../radianceCascades.ts'
import { loadMeshyMaestro } from '../maestroMeshy.ts'
import {
  D, EYE, FONT, MAESTRO, ROLES, SHIRT, SKIN, SIT_DROP, W, beamTex, makeAvatarPerson, type Avatar, bx, compactRig, cyl, fitText, geos, glow, hash, makeMaestro, makePerson, rng, sph, std, tagHits, texMat, woodTex,
  rb, type Box2, type Hit, type PersonRig, type Seat,
} from './kit.ts'
import { BAND_COL, CLUB_PAL, addOnly, clubBuild, videoPalette, type Club, type PartyAct } from './club.ts'
import { DOOR_OPEN, OZ0, OZ1, acousticsAt, buildAnnex, inRoom, type Annex } from './annex.ts'
import { buildDecks, heightAt, type Decks } from './decks.ts'
import { EMOTES, EMOTE_LEN, animateEmote, animateMouth } from './emotes.ts'
import { Photographer, type Person } from './photographer.ts'
import { VomitFx, ringTexture } from './vomit.ts'
import { ITEMS, ITEM_KINDS, consume, isItem, itemMesh, newNeeds, stepNeeds, type Held, type ItemKind, type Needs } from './items.ts'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const FOV = 68
const FOV_ZOOM = 45
const RADIUS = 0.28
const WALK = 3.4
const RUN = 6.5
const REACH = 6

export const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

// nomes dos NPCs da festa (cada um com um boneco sorteado pelo nome)
const NPC_NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabi', 'Heitor', 'Isa', 'João', 'Kaká', 'Lia', 'Marcos', 'Nina', 'Otto', 'Paula', 'Quim', 'Rafa', 'Sofia', 'Téo', 'Úrsula', 'Vini', 'Wanda', 'Xande', 'Yara', 'Zeca', 'Bia', 'Caio']
const NPC_MAX = IS_TOUCH ? 14 : 26

// capture: 'off' (proxy funcionando), 'offer' (yt-dlp falhou: dá para capturar a aba), 'on' (capturando)
// needs: stamina, xixi, embriaguez, fome e dinheiro; hands: o que tem em cada mão; prompt: escolha de mão pendente
// (largar/oferecer com as duas ocupadas) ou oferta esperando resposta; incoming: oferta recebida (Y/N)
export interface Hud {
  hover: Hit | null, locked: boolean, tuning: boolean, mic: boolean, wheel: number | null, emote: string | null, capture: 'off' | 'offer' | 'on'
  needs: Needs, hands: (Held | null)[], prompt: string | null, incoming: { name: string, kind: ItemKind } | null, toast: string | null, peeing: boolean
}

interface World {
  group: THREE.Group
  own: THREE.Material[]
  colliders: Box2[]
  hits: THREE.Object3D[]
  club: Club
  annex: Annex
  decks: Decks
}

interface Npc {
  id: string
  name: string
  p: PersonRig
  x: number
  z: number
  rot: number
  party: PartyAct
  // piso (0 no club, 1.6 no camarote) e altura extra do assento
  y: number
  lift: number
  // 0 em pé, 1 sentado (sofá ou banqueta)
  sit: number
  phase: number
  // faixa (0 grave, 1 médio, 2 agudo) que move tronco+pernas, braços e cabeça: sorteada quando nasce
  bands: [number, number, number]
  fade: number
  blend: { key: string, t: number, from: number[], out: number[] }
  // bartender: anda entre x0 e x1 atrás do balcão
  walk?: { x0: number, x1: number, z: number }
  // mãos (esquerda, direita): 'busy' = cigarro/coqueteleira; item ganho de alguém (dá um gole de vez em quando)
  hands?: (NpcItem | 'busy' | null)[]
  bubble?: THREE.Sprite
  bubbleUntil?: number
}

interface NpcItem { kind: ItemKind, left: number, obj: THREE.Group, nextSip: number, sipUntil: number }

// pose de andar (pernas e braços balançando; parado volta ao neutro) e sentado; k = quanto chega no alvo
function poseWalk(p: PersonRig, moving: boolean, walkT: number, k: number) {
  const sw = moving ? Math.sin(walkT * 8) : 0
  p.hipL.rotation.x += (sw * 0.5 - p.hipL.rotation.x) * k
  p.hipR.rotation.x += (-sw * 0.5 - p.hipR.rotation.x) * k
  p.kneeL.rotation.x += ((moving ? Math.max(0, -sw) * 0.7 : 0) - p.kneeL.rotation.x) * k
  p.kneeR.rotation.x += ((moving ? Math.max(0, sw) * 0.7 : 0) - p.kneeR.rotation.x) * k
  p.armL.rotation.x += (-sw * 0.45 - p.armL.rotation.x) * k
  p.armR.rotation.x += (sw * 0.45 - p.armR.rotation.x) * k
  p.foreL.rotation.x = -0.25
  p.foreR.rotation.x = -0.25
  p.body.position.y = moving ? Math.abs(Math.cos(walkT * 8)) * 0.035 : 0
}

function poseSit(p: PersonRig, k: number) {
  p.hipL.rotation.x += (-Math.PI / 2 - p.hipL.rotation.x) * k
  p.hipR.rotation.x += (-Math.PI / 2 - p.hipR.rotation.x) * k
  p.kneeL.rotation.x += (Math.PI / 2 - p.kneeL.rotation.x) * k
  p.kneeR.rotation.x += (Math.PI / 2 - p.kneeR.rotation.x) * k
  p.armL.rotation.x += (-0.35 - p.armL.rotation.x) * k
  p.armR.rotation.x += (-0.35 - p.armR.rotation.x) * k
  p.body.position.y += (-SIT_DROP - p.body.position.y) * k
}

// item preso no antebraço (lado 0 esquerdo, 1 direito), logo abaixo da mão
function attachItem(p: PersonRig, side: number, kind: ItemKind) {
  const g = itemMesh(kind)
  g.position.set(0, -0.44, 0.05)
  ;(side ? p.foreR : p.foreL).add(g)
  return g
}

// segurando: antebraço para a frente e o item em pé (desfaz a rotação do braço); sip 0..1 leva até a boca e inclina
function holdPose(p: PersonRig, side: number, obj: THREE.Object3D, sip: number) {
  const arm = side ? p.armR : p.armL
  const fore = side ? p.foreR : p.foreL
  const lift = Math.sin(Math.min(1, sip) * Math.PI)
  fore.rotation.x = -1.15 - lift * 0.9
  arm.rotation.x = Math.min(arm.rotation.x, -0.15) - lift * 0.5
  obj.rotation.x = -(arm.rotation.x + fore.rotation.x) + lift * 1.1
}

interface Remote {
  rig: PersonRig
  name: string
  tx: number
  ty: number
  tz: number
  tyaw: number
  moving: boolean
  sit: boolean
  walkT: number
  init: boolean
  tag: THREE.Sprite
  bubble: THREE.Sprite
  bubbleUntil: number
  // falando agora (crachá verde)
  speaking: boolean
  // emote em curso (e desde quando) e o personagem do boneco (para refazer se mudar)
  emote: string
  emoteT0: number
  avKey: string
  // o que ele tem em cada mão (esquerda, direita) e os modelos presos nos antebraços
  hands: [string, string]
  handObjs: (THREE.Group | null)[]
  hit: Hit
  vomit: boolean
}

function turn(cur: number, target: number, k: number) {
  let d = target - cur
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return cur + d * Math.min(1, k)
}

function shuffled3(): [number, number, number] {
  const o: [number, number, number] = [0, 1, 2]
  for (let i = 2; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[o[i], o[j]] = [o[j], o[i]]
  }
  return o
}

// ---------- o mundo: piso do club, parapeito, céu vazio ----------

function buildWorld(): World {
  const group = new THREE.Group()
  const own: THREE.Material[] = []
  const colliders: Box2[] = []
  const hits: THREE.Object3D[] = []
  // chão escuro sem fim em volta (o club "flutua" no vazio)
  const voidM = new THREE.MeshStandardMaterial({ color: '#06070d', roughness: 0.9 })
  own.push(voidM)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), voidM)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(W / 2, -0.6, D / 2)
  ground.receiveShadow = true
  group.add(ground)
  // laje do club e deck de madeira
  bx(group, -0.4, -0.6, -0.4, W + 0.4, -0.01, D + 0.4, std('#1c1917', 0.8))
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(W, D), texMat(woodTex, '#d6b48a', W / 2.5, D / 2.5, 0.7, own))
  deck.rotation.x = -Math.PI / 2
  deck.position.set(W / 2, 0.002, D / 2)
  deck.receiveShadow = true
  group.add(deck)
  // parapeito com vidro e corrimão
  const parapet = std('#e7e5e4', 0.8)
  const glass = new THREE.MeshStandardMaterial({ color: '#d8ecff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.1, depthWrite: false, envMapIntensity: 0.35 })
  own.push(glass)
  const steel = std('#c0c4cc', 0.25, 0.9)
  // laterais com o vão dos corredores (fumantes à esquerda, banheiros à direita)
  bx(group, -0.25, 0, -0.25, W + 0.25, 0.5, 0, parapet)
  bx(group, -0.25, 0, D, W + 0.25, 0.5, D + 0.25, parapet)
  for (const [z0, z1] of [[0, OZ0 - 0.25], [OZ1 + 0.25, D]] as const) {
    bx(group, -0.25, 0, z0, 0, 0.5, z1, parapet)
    bx(group, W, 0, z0, W + 0.25, 0.5, z1, parapet)
    bx(group, -0.2, 0.5, z0, -0.05, 1.1, z1, glass, false)
    bx(group, W + 0.05, 0.5, z0, W + 0.2, 1.1, z1, glass, false)
    colliders.push({ x0: -0.4, x1: 0, z0, z1, level: 0 }, { x0: W, x1: W + 0.4, z0, z1, level: 0 })
  }
  for (const [x0, z0, x1, z1] of [[-0.2, -0.2, W + 0.2, -0.05], [-0.2, D + 0.05, W + 0.2, D + 0.2]]) bx(group, x0, 0.5, z0, x1, 1.1, z1, glass, false)
  bx(group, -0.22, 1.08, D + 0.02, W + 0.22, 1.14, D + 0.24, steel)
  colliders.push({ x0: -0.4, x1: W + 0.4, z0: -0.4, z1: 0, level: 0 }, { x0: -0.4, x1: W + 0.4, z0: D, z1: D + 0.4, level: 0 })
  // fio de luz no fundo, em roxo e rosa
  for (let x = 1; x < W; x += 1.2) sph(group, x, 2.6 - Math.sin((x / W) * Math.PI * 6) * 0.15, D - 0.6, 0.05, Math.round(x / 1.2) % 2 ? glow('#a855f7', 2) : glow('#ec4899', 2))
  const club = clubBuild(group, W, 0, true, own, colliders, hits, 0)
  const annex = buildAnnex(group, own, colliders, hits)
  const decks = buildDecks(group, own, colliders, hits)
  return { group, own, colliders, hits, club, annex, decks }
}

// Junta as malhas paradas por material (centenas de peças viram poucas chamadas de desenho). Fica de fora tudo
// que o Club aponta (anima ou troca de visibilidade), o que tem clique, o que é de "UI" e o transparente sem
// profundidade.
function mergeStatic(w: World) {
  const dynamic = new Set<THREE.Object3D>()
  const mark = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 3 || v instanceof THREE.Material || v instanceof THREE.Texture) return
    if (v instanceof THREE.Object3D) {
      if (v !== w.group) v.traverse((o) => dynamic.add(o))
      return
    }
    const list = v instanceof Map ? [...v.values()] : Array.isArray(v) ? v : Object.values(v)
    for (const x of list) mark(x, depth + 1)
  }
  mark(w.club, 0)
  // portas das cabines giram
  mark(w.annex.doors, 0)
  w.group.updateMatrixWorld(true)
  const buckets = new Map<string, { mat: THREE.Material, cast: boolean, receive: boolean, meshes: THREE.Mesh[] }>()
  w.group.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || dynamic.has(o) || o.userData.hit || o.userData.ui || !o.visible || o.renderOrder || !o.frustumCulled) return
    if (Array.isArray(m.material) || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return
    const g = m.geometry
    if (!g.attributes.position || !g.attributes.normal || Object.keys(g.morphAttributes).length || m.matrixWorld.determinant() < 0) return
    for (let p = o.parent; p && p !== w.group; p = p.parent) if (!p.visible || p.userData.hit) return
    const attrs = Object.keys(g.attributes).sort().join(',')
    const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${g.index ? 1 : 0}|${attrs}`
    let b = buckets.get(key)
    if (!b) {
      b = { mat: m.material, cast: m.castShadow, receive: m.receiveShadow, meshes: [] }
      buckets.set(key, b)
    }
    b.meshes.push(m)
  })
  const shared = new Set(geos.values())
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue
    const parts = b.meshes.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld))
    const merged = mergeGeometries(parts, false)
    for (const g of parts) g.dispose()
    if (!merged) continue
    merged.computeBoundingSphere()
    const mesh = new THREE.Mesh(merged, b.mat)
    mesh.castShadow = b.cast
    mesh.receiveShadow = b.receive
    mesh.matrixAutoUpdate = false
    w.group.add(mesh)
    for (const m of b.meshes) {
      if (!shared.has(m.geometry)) m.geometry.dispose()
      m.removeFromParent()
    }
  }
  // grupos vazios saem; o resto parado não recalcula matriz todo quadro
  const empty: THREE.Object3D[] = []
  w.group.traverse((o) => {
    if (o !== w.group && !(o as THREE.Mesh).isMesh && !o.children.length && !dynamic.has(o) && o.type === 'Group') empty.push(o)
  })
  for (const o of empty) o.removeFromParent()
  w.group.traverse((o) => {
    if (!dynamic.has(o)) {
      o.updateMatrix()
      o.matrixAutoUpdate = false
    }
  })
}

// Texto em sprite (canvas): crachá com o nome ou balão de chat com quebra de linha.
function drawTextSprite(sp: THREE.Sprite, text: string, kind: 'tag' | 'bubble', color = '#ffffff') {
  const m = sp.material as THREE.SpriteMaterial
  const tex = m.map as THREE.CanvasTexture
  const cv = tex.image as HTMLCanvasElement
  const c = cv.getContext('2d')!
  c.clearRect(0, 0, cv.width, cv.height)
  if (kind === 'tag') {
    c.font = `800 30px ${FONT}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    const label = fitText(c, text, cv.width - 40)
    c.lineJoin = 'round'
    c.lineWidth = 7
    c.strokeStyle = 'rgba(15,23,42,0.85)'
    c.strokeText(label, cv.width / 2, 33)
    c.fillStyle = color
    c.fillText(label, cv.width / 2, 33)
  } else {
    c.font = `600 30px ${FONT}`
    const words = text.split(' ')
    const lines: string[] = []
    let cur = ''
    for (const wd of words) {
      const t = cur ? `${cur} ${wd}` : wd
      if (c.measureText(t).width > cv.width - 60 && cur) {
        lines.push(cur)
        cur = wd
      } else cur = t
    }
    if (cur) lines.push(cur)
    const shown = lines.slice(0, 3)
    if (lines.length > 3) shown[2] = fitText(c, `${shown[2]} …`, cv.width - 60)
    const w = Math.min(cv.width - 8, Math.max(...shown.map((l) => c.measureText(l).width)) + 44)
    const h = shown.length * 38 + 26
    const x0 = (cv.width - w) / 2
    const y0 = cv.height - h - 22
    c.fillStyle = '#ffffff'
    c.beginPath()
    c.roundRect(x0, y0, w, h, 22)
    c.fill()
    c.beginPath()
    c.moveTo(cv.width / 2 - 14, y0 + h - 1)
    c.lineTo(cv.width / 2, y0 + h + 18)
    c.lineTo(cv.width / 2 + 14, y0 + h - 1)
    c.fill()
    c.fillStyle = '#0f172a'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    shown.forEach((l, i) => c.fillText(l, cv.width / 2, y0 + 13 + 19 + i * 38))
  }
  tex.needsUpdate = true
}

function textSprite(text: string, kind: 'tag' | 'bubble') {
  const cv = document.createElement('canvas')
  cv.width = kind === 'tag' ? 320 : 640
  cv.height = kind === 'tag' ? 64 : 200
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
  const sp = new THREE.Sprite(m)
  sp.scale.set(kind === 'tag' ? 1.25 : 2.6, kind === 'tag' ? 0.25 : 0.81, 1)
  sp.userData.ui = true
  if (text) drawTextSprite(sp, text, kind)
  return sp
}

// ---------- distorção no ritmo ----------

// A cada ataque de uma faixa sai uma onda do telão e de cada falante (grave vermelho, médio verde, agudo azul):
// anel na tela, onda nas superfícies (pela profundidade do SSAO) e casca esférica no ar com rastro.
function makeBeatWarp() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uC: { value: Array.from({ length: 32 }, () => new THREE.Vector2()) },
      uA: { value: new Array(32).fill(0) },
      uR: { value: new Array(32).fill(1) },
      uAspect: { value: 1 },
      tDepth: { value: null },
      uDepthOn: { value: 0 },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uW: { value: Array.from({ length: 32 }, () => new THREE.Vector3()) },
      uWA: { value: new Array(32).fill(0) },
      uPh: { value: new Array(32).fill(1) },
      uCol: { value: Array.from({ length: 32 }, () => new THREE.Color()) },
      uSpd: { value: new Array(32).fill(1) },
    },
    vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `
uniform sampler2D tDiffuse;
uniform vec2 uC[32];
uniform float uA[32];
uniform float uR[32];
uniform float uAspect;
uniform sampler2D tDepth;
uniform float uDepthOn;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uW[32];
uniform float uWA[32];
uniform float uPh[32];
uniform vec3 uCol[32];
uniform float uSpd[32];
varying vec2 vUv;
void main() {
  vec2 a = vec2(uAspect, 1.0);
  vec2 off = vec2(0.0);
  vec3 tint = vec3(0.0);
  vec4 vf = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(mat3(uCamWorld) * (vf.xyz / vf.w));
  vec3 ro = uCamWorld[3].xyz;
  float tMax = 80.0;
  vec3 wp = vec3(0.0);
  bool hit = false;
  if (uDepthOn > 0.5) {
    float z = texture2D(tDepth, vUv).x;
    if (z < 0.9999) {
      vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
      wp = (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
      tMax = length(wp - ro);
      hit = true;
    }
  }
  vec2 push = vec2(0.0);
  for (int i = 0; i < 32; i++) {
    if (uWA[i] <= 0.0) continue;
    float ph = uPh[i];
    if (ph >= 1.0) continue;
    float envW = pow(1.0 - ph, 1.5);
    // onda nas superfícies (chão, paredes, gente)
    if (hit) {
      float dist = length(wp - uW[i]);
      float b = exp(-pow((dist - ph * 18.0 * uSpd[i]) / (0.45 + ph * 1.2 * uSpd[i]), 2.0)) * envW * uWA[i];
      vec2 g = vec2(dFdx(dist), dFdy(dist));
      float gl = length(g);
      if (gl > 1e-5) push += g / gl * b;
      tint += uCol[i] * b;
    }
    // onda no ar: casca esférica; três ecos atrás da frente fazem o rastro
    float tc = clamp(dot(uW[i] - ro, rd), 0.0, tMax);
    float h = length(ro + rd * tc - uW[i]);
    vec2 gh = vec2(dFdx(h), dFdy(h));
    float ghl = length(gh);
    vec2 dirh = ghl > 1e-5 ? gh / ghl : vec2(0.0);
    for (int k = 0; k < 4; k++) {
      float Rk = ph * 14.0 * uSpd[i] - float(k) * 1.4 * uSpd[i];
      if (Rk <= 0.0) break;
      float wk = pow(0.55, float(k));
      float bb = exp(-pow((h - Rk) / (0.18 + Rk * 0.03), 2.0)) * envW * uWA[i] * wk;
      push += dirh * bb * 0.8;
      tint += uCol[i] * bb * 0.35;
    }
  }
  off += push * 0.006;
  for (int i = 0; i < 32; i++) {
    if (uA[i] <= 0.0) continue;
    float ph = uPh[i];
    if (ph >= 1.0) continue;
    float env = (1.0 - ph) * (1.0 - ph);
    float kick = exp(-ph * 9.0);
    vec2 d = (vUv - uC[i]) * a;
    float r = length(d);
    vec2 dir = r > 0.0001 ? d / r : vec2(0.0);
    float ring = exp(-pow((r - ph * 2.6 * uR[i] * uSpd[i]) / (0.09 * uR[i]), 2.0)) * env;
    // soco do grave: puxa para a fonte, só perto dela
    float near = exp(-r * r / (0.08 * uR[i] * uR[i]));
    off += (dir * ring * 0.012 - d * kick * near * 0.03) * uA[i];
  }
  vec2 uv = vUv + off / a;
  // frente de onda: aberração cromática e a cor da faixa
  vec2 ca = push * 0.004 / a;
  vec4 col = texture2D(tDiffuse, uv);
  col.r = texture2D(tDiffuse, uv + ca).r;
  col.b = texture2D(tDiffuse, uv - ca).b;
  col.rgb += min(tint, vec3(1.5)) * 0.16;
  gl_FragColor = col;
}`,
  })
}

// ---------- motor ----------

export class Engine {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 4000)
  controls: PointerLockControls
  composer: EffectComposer
  gtao: GTAOPass
  bloom: UnrealBloomPass
  beatWarp = makeBeatWarp()
  smaa: SMAAPass
  // sem luz de céu nem de lua: a noite é escura e quem ilumina são as luzes do club
  hemi = new THREE.HemisphereLight('#e0f2fe', '#57534e', 0)
  moon = new THREE.DirectionalLight('#9db4ff', 0)
  stars: THREE.Points
  world: World
  worldUi: THREE.Object3D[] = []
  pos = new THREE.Vector3(W / 2, 0, 13)
  keys = new Set<string>()
  ray = new THREE.Raycaster()
  timer = new THREE.Timer()
  raf = 0
  hover: Hit | null = null
  hoverPoint: THREE.Vector3 | null = null
  hudKey = ''
  onHud: (h: Hud) => void
  zooming = false
  seat: Seat | null = null
  jumpY = 0
  jumpV = 0
  // altura do piso sob o jogador (escada e camarote); só anda para onde ela muda até um degrau
  floorY = 0
  // meu boneco (só aparece no emote, em terceira pessoa) e o personagem escolhido
  avatar: Avatar | null = null
  selfRig: PersonRig | null = null
  // emote em curso (com a câmera de frente para mim) e a roda aberta (B segurado; sel = fatia apontada)
  emote: { name: string, t0: number, yaw: number, quat: THREE.Quaternion } | null = null
  wheel: { x: number, y: number, sel: number } | null = null
  // câmera do emote: gira em volta de mim com o mouse; k vai de 0 (primeira pessoa) a 1 (terceira) e volta
  orbit = { yaw: 0, pitch: 0.12, k: 0, leaving: false, quat: new THREE.Quaternion() }
  selfWalkT = 0
  // mãos (0 esquerda, 1 direita) e necessidades
  hands: (Held | null)[] = [null, null]
  needs: Needs = newNeeds()
  // largar/oferecer com as duas mãos ocupadas: espera o clique do lado (o atalho de novo cancela)
  pending: { act: 'drop' | 'offer', target?: Hit } | null = null
  // minha oferta esperando resposta (NPC decide sozinho, jogador responde) e a que recebi (Y aceita, N recusa)
  offering: { hand: number, oid: string, to: Hit, name: string, at: number } | null = null
  incoming: { from: number, name: string, oid: string, kind: ItemKind, left: number, at: number } | null = null
  toast: { text: string, until: number } | null = null
  // gole/mordida em andamento por mão (0 parado; sobe até 1 durante o uso)
  useAnim = [0, 0]
  // no mictório (o vaso é sentar nele)
  urinal = false
  wasPeeing = false
  exhausted = false
  warnAt = { bladder: 0, hunger: 0 }
  // itens no chão (vêm do servidor) e o cardápio em cima do balcão
  floorItems = new Map<number, { it: NetFloorItem, g: THREE.Group }>()
  floorGroup = new THREE.Group()
  // modelos nas mãos: os meus em primeira pessoa (presos na câmera) e os do meu boneco (espelho e emote)
  viewItems: (THREE.Group | null)[] = [null, null]
  viewKinds = ['', '']
  selfItems: (THREE.Group | null)[] = [null, null]
  selfKinds = ['', '']
  lastRender = 0
  // multiplayer: outros jogadores (o meu fica invisível em primeira pessoa)
  net = new Net()
  // voz por proximidade (WebRTC direto entre jogadores, tratada no Web Audio como a música)
  voice = new Voice(this.net, () => this.feed.ctx)
  remotes = new Map<number, Remote>()
  remoteGroup = new THREE.Group()
  netSentAt = 0
  chatLog: NetChat[] = []
  onChatLog: (log: NetChat[]) => void = () => {}
  onChatOpen: () => void = () => {}
  // NPCs da festa e o DJ
  npcs = new Map<string, Npc>()
  npcGroup = new THREE.Group()
  dj: DjPlayer
  djRig: PersonRig | null = null
  djHit: Hit = { kind: 'dj', id: MAESTRO, label: 'DJ', sub: 'clique para escolher a música do telão' }
  // GI 2D (radiance cascades) do club
  rc: RadianceCascades | null = null
  rcAt = 0
  giUni: GiUniforms = { uFloorTex: { value: null }, uFloorRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uFloorY: { value: 0 }, uFloorK: { value: 0 }, uGiD0: { value: null }, uGiD1: { value: null }, uGiD2: { value: null }, uGiD3: { value: null }, uGiRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uGiY: { value: new THREE.Vector2(-999, -998) }, uGiStrength: { value: 0 } }
  // telão: player do YouTube numa cena CSS3D atrás do canvas (relógio; a imagem é a nossa quando o proxy funciona)
  css = new CSS3DRenderer()
  cssScene = new THREE.Scene()
  // player achatado em 2D durante a captura da aba; capCam só serve para forçar o CSS3D a reaplicar tudo na volta
  capFlat = false
  capCam = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
  cssObj: CSS3DObject
  glowVideo = ''
  glowColor = '#5d6b9a'
  // cores do palco, do neon e da pista: vêm do vídeo (ao vivo ou dos quadros que o YouTube publica)
  pal = CLUB_PAL.map((c) => new THREE.Color(c))
  palGoal = CLUB_PAL.map((c) => new THREE.Color(c))
  palSets: (THREE.Color[] | null)[] = []
  palImgs: (HTMLImageElement | null)[] = []
  palIdx = -1
  clubAt = 0
  // música escolhida mas o som ainda não travou: telão e aviso de "sintonizando"
  tuning = false
  loadK = 0
  feed = new VideoFeed()
  beatT = -10
  // dança no ritmo: um groove por faixa, cada ataque soma 1 e o groove corre até lá freando
  groove = 0
  grooveGoal = 0
  grooveB = [0, 0, 0]
  grooveBGoal = [0, 0, 0]
  bandSeen = [-10, -10, -10]
  musicOn = false
  lastClockBeat = 0
  heard = 0
  liveAt = 0
  livePalAt = 0
  // frames guardados do vídeo (os quadros do bar mostram eles, sem repetir) e quando guardar/trocar de novo
  // fotos do fotógrafo (do servidor, mais velha primeiro) e qual está em cada quadro do bar (as que saem vão
  // para o álbum)
  photos: NetPhoto[] = []
  wall: (string | null)[] = []
  photoImgs = new Map<string, HTMLImageElement>()
  // fotógrafo (boneco com câmera), o flash e a última parada que já disparou aqui
  photographer: PersonRig | null = null
  // roteiro do fotógrafo: paradas sorteadas e, às vezes, alguém perto (NPC ou jogador) para enquadrar
  photog = new Photographer(() => this.photoPeople(), (x, z) => this.blockedAt(x, z), heightAt)
  photoCam: THREE.Group | null = null
  flash = new THREE.PointLight('#ffffff', 0, 14, 1.5)
  flashAt = -10
  shotSlot = -1
  onAlbumOpen: () => void = () => {}
  // páginas do álbum 3D (canvas) e se precisam redesenhar
  albumBook: { c: CanvasRenderingContext2D, tex: THREE.CanvasTexture, x: number, z: number, dirty: boolean } | null = null
  // vômito: minigame de segurar (círculos para mirar e clicar em 5 s), o jato e quando pode acontecer de novo
  vomitGame: { targets: { s: THREE.Sprite, done: boolean }[], until: number } | null = null
  vomitUntil = 0
  vomitCool = 0
  vomitFx = new VomitFx()
  // embriaguez suavizada para os efeitos (o gole sobe de uma vez; balanço e rastro vão chegando devagar)
  drunkFx = 0
  // rastro na visão (bêbado): mistura o quadro novo com o anterior
  trail = new AfterimagePass(0)
  ringTex = ringTexture()
  // braços em primeira pessoa (IK do ombro até o item na mão), na cor da minha camisa e pele
  fpArms: { upper: THREE.Mesh, fore: THREE.Mesh, hand: THREE.Mesh }[] = []
  // portas abertas das cabines (do servidor; aplico na hora quando eu mesmo abro)
  doorsOpen = new Set<string>()
  // TV de LED com o ponto de vista do DJ: câmera na cabeça dele, renderizada pequena a cada 3 quadros
  djTv: { rt: THREE.WebGLRenderTarget, cam: THREE.PerspectiveCamera, frame: number, q: THREE.Quaternion, init: boolean } | null = null
  floorLight = (() => {
    const c = document.createElement('canvas')
    c.width = c.height = 32
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return { c: c.getContext('2d')!, t }
  })()
  mantaCtx = (() => {
    const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    c.canvas.width = 10
    c.canvas.height = 5
    return c
  })()
  onUnlock = () => this.feed.unlock()
  djTickAt = 0
  onDjOpen: () => void = () => {}
  onDjState: (d: DjState) => void = () => {}
  attached = true
  // luzes de verdade: 4 coloridas no ritmo e a fogueira mais perto
  clubLights = Array.from({ length: 5 }, () => new THREE.PointLight('#ffffff', 0, 22, 1.3))
  // o telão é uma luz de área do tamanho da tela: cor e força vêm da média do vídeo (5x/s), quem está na frente
  // dele pega a luz de cada cena
  screenLight = new THREE.RectAreaLight('#ffffff', 0, 9.6, 5.4)
  screenGoal = { color: new THREE.Color(0, 0, 0), k: 0 }
  // luzes dos anexos (corredores, terraço, hall e banheiros): as 4 mais perto da câmera
  zoneLights = Array.from({ length: 4 }, () => new THREE.PointLight('#ffffff', 0, 9, 1.6))
  // acústica do lugar onde a câmera está (corredores e banheiros abafam e mudam o eco)
  acoustic = acousticsAt(W / 2, 13)
  // fumaça: cinzeiros e quem fuma soltam baforadas que sobem, crescem e somem
  smoke: { s: THREE.Sprite, v: THREE.Vector3, age: number, life: number }[] = []
  smokeAt = 0

  constructor(host: HTMLElement, onHud: (h: Hud) => void, name: string, avatar: Avatar | null) {
    this.onHud = onHud
    this.avatar = avatar
    this.dj = new DjPlayer(this.net)
    // vídeo mais forte que um monitor (só vale no fallback do iframe)
    this.dj.el.style.filter = 'brightness(2) saturate(1.25) contrast(1.05)'
    this.cssObj = new CSS3DObject(this.dj.el)
    // alpha: no fallback o telão é um furo transparente no canvas e o iframe do YouTube (CSS3D) fica atrás
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1 : 1.25))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.css.domElement.style.position = 'absolute'
    this.css.domElement.style.inset = '0'
    this.css.domElement.style.pointerEvents = 'none'
    this.css.domElement.style.zIndex = '0'
    host.appendChild(this.css.domElement)
    host.appendChild(this.renderer.domElement)
    this.renderer.domElement.className = 'absolute inset-0 block h-full w-full'
    this.renderer.domElement.style.zIndex = '1'
    this.cssScene.add(this.cssObj)
    // céu: fundo opaco (o canvas é transparente; sem isso o iframe apareceria no céu)
    this.scene.background = new THREE.Color('#03040a')
    this.scene.fog = new THREE.Fog('#03040a', 80, 600)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.05
    this.controls = new PointerLockControls(this.camera, this.renderer.domElement)
    this.controls.addEventListener('lock', () => this.emitHud(true))
    this.controls.addEventListener('unlock', () => {
      this.keys.clear()
      this.emitHud(true)
    })
    // lua: luz fria fraca, com sombra
    this.scene.add(this.hemi, this.moon, this.moon.target)
    this.moon.position.set(W / 2 - 60, 90, D / 2 + 40)
    this.moon.target.position.set(W / 2, 0, D / 2)
    // lua apagada: sem sombra dela (economiza o mapa de sombra)
    this.moon.castShadow = false
    this.moon.shadow.mapSize.set(4096, 4096)
    const sc = this.moon.shadow.camera
    // cobre o club e os anexos (terraço à esquerda, banheiros à direita): sem isso a lua "vaza" pelo teto deles
    sc.left = -46
    sc.right = 46
    sc.top = 46
    sc.bottom = -46
    sc.far = 300
    this.moon.shadow.radius = 5
    this.moon.shadow.blurSamples = 16
    this.moon.shadow.bias = -0.0004
    this.moon.shadow.normalBias = 0.03
    const starGeo = new THREE.BufferGeometry()
    const ps: number[] = []
    const r = rng(42)
    for (let i = 0; i < 2500; i++) {
      const u = r() * Math.PI * 2
      const v = 0.03 + r() * 0.48 * Math.PI
      ps.push(Math.cos(u) * Math.cos(v) * 600, Math.sin(v) * 600, Math.sin(u) * Math.cos(v) * 600)
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3))
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, toneMapped: false, fog: false }))
    this.scene.add(this.stars)
    for (const l of [...this.clubLights, ...this.zoneLights]) this.scene.add(l)
    RectAreaLightUniformsLib.init()
    this.scene.add(this.screenLight)
    this.scene.add(this.npcGroup, this.remoteGroup)
    try {
      this.rc = new RadianceCascades(this.renderer, 256)
      this.rc.dirs.forEach((d, k) => (this.giUni[`uGiD${k}` as 'uGiD0'].value = d.texture))
    } catch {
      this.rc = null
    }

    this.world = buildWorld()
    mergeStatic(this.world)
    this.scene.add(this.world.group)
    // balões, feixes, vidro e sombras de contato ficam fora do AO (viram parede sólida nele)
    this.world.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined
      const see = mat && !Array.isArray(mat) && mat.transparent && !mat.depthWrite
      if (o.userData.ui || see) this.worldUi.push(o)
    })
    this.hookGi(this.world.group)
    this.spawnNpcs()
    this.spawnDj()
    // os itens na mão em primeira pessoa são filhos da câmera
    this.scene.add(this.camera)
    this.scene.add(this.floorGroup)
    this.buildShop()
    // espelho do banheiro: meu boneco aparece só no reflexo (em primeira pessoa ele fica escondido); os itens
    // presos na câmera não entram no reflexo
    for (const m of this.world.annex.mirrors) {
      const orig = m.mesh.onBeforeRender.bind(m.mesh)
      m.mesh.onBeforeRender = (...args: Parameters<THREE.Object3D['onBeforeRender']>) => {
        const sr = this.selfRig
        const was = sr?.root.visible ?? false
        if (sr) sr.root.visible = true
        const vis = this.viewItems.map((v) => v?.visible ?? false)
        for (const v of this.viewItems) if (v) v.visible = false
        orig(...args)
        if (sr) sr.root.visible = was
        this.viewItems.forEach((v, i) => {
          if (v) v.visible = vis[i]
        })
      }
    }
    // portas começam fechadas: colisão ligada
    for (const d of this.world.annex.doors) this.world.colliders.push(d.box)
    this.net.onDoors = (open) => {
      this.doorsOpen = new Set(open)
    }
    this.net.onPhotos = (list) => this.setPhotos(list)
    this.net.onPhoto = (p) => this.addPhoto(p)
    this.spawnPhotographer()
    this.buildAlbumStand()
    this.buildDjTv()
    // a música sai das caixas (altura do meio delas)
    this.feed.setBoxes(this.world.club.boxes.map((b) => ({ x: b.x, y: 1.1, z: b.z })))
    this.scene.add(this.flash)
    this.scene.add(this.vomitFx.group)
    this.net.onItems = (list) => this.syncFloor(list)
    this.net.onTook = (m) => this.gotTook(m)
    this.net.onOffer = (m) => this.gotOffer(m)

    this.net.onPlayers = (list) => this.syncRemotes(list)
    this.net.onLeave = (id) => this.dropRemote(id)
    this.net.onChat = (c) => this.gotChat(c)
    this.net.onDj = (d) => {
      this.dj.sync(d)
      this.onDjState(d)
    }
    if (name) this.net.setName(name, avatar)
    this.buildSelf()

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.gtao = new GTAOPass(this.scene, this.camera, 512, 512)
    const gtaoRender = this.gtao.render.bind(this.gtao)
    this.gtao.render = (...args: Parameters<GTAOPass['render']>) => {
      const hidden: THREE.Object3D[] = []
      for (const o of this.worldUi) if (o.visible) hidden.push(o)
      for (const rm of this.remotes.values()) for (const sp of [rm.tag, rm.bubble]) if (sp.visible) hidden.push(sp)
      for (const o of hidden) o.visible = false
      gtaoRender(...args)
      for (const o of hidden) o.visible = true
    }
    this.gtao.blendIntensity = 1
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, distanceFallOff: 1, samples: 12 })
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 })
    this.gtao.enabled = !IS_TOUCH
    this.composer.addPass(this.gtao)
    // força 0.4, raio 0.4, corte 1.3: só o que brilha bem acima do branco (neon, LED, fogo) espalha
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.4, 0.4, 1.3)
    // corte pelo canal mais forte, não pela luminância: neon roxo/rosa e LED azul brilham igual ao fogo amarelo
    this.bloom.materialHighPassFilter.fragmentShader = `
uniform sampler2D tDiffuse;
uniform vec3 defaultColor;
uniform float defaultOpacity;
uniform float luminosityThreshold;
uniform float smoothWidth;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  float v = max(texel.r, max(texel.g, texel.b));
  float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
  gl_FragColor = mix(vec4(defaultColor.rgb, defaultOpacity), texel, alpha);
}`
    this.bloom.materialHighPassFilter.needsUpdate = true
    // o brilho soma cor sem fechar o furo do telão (fallback do iframe)
    addOnly(this.bloom.blendMaterial)
    this.composer.addPass(this.bloom)
    this.composer.addPass(this.beatWarp)
    // rastro: mistura (não "o mais claro vence", que só deixava rastro de luz)
    const trailMat = (this.trail as unknown as { compFsMaterial: THREE.ShaderMaterial }).compFsMaterial
    trailMat.fragmentShader = `
uniform float damp;
uniform sampler2D tOld;
uniform sampler2D tNew;
varying vec2 vUv;
void main() {
  gl_FragColor = mix(texture2D(tNew, vUv), texture2D(tOld, vUv), damp);
}`
    trailMat.needsUpdate = true
    this.trail.enabled = false
    this.composer.addPass(this.trail)
    this.composer.addPass(new OutputPass())
    this.smaa = new SMAAPass()
    this.smaa.enabled = !IS_TOUCH
    this.composer.addPass(this.smaa)

    this.camera.position.set(this.pos.x, EYE, this.pos.z)
    this.camera.rotation.set(0, 0, 0, 'YXZ')
    // troca o robô provisório pelo DJ do Meshy quando o modelo termina de carregar
    void loadMeshyMaestro().then(() => this.spawnDj(), (err) => console.warn('DJ 3D não carregou', err))
    this.renderer.domElement.addEventListener('click', this.onClick)
    document.addEventListener('mousedown', this.onHand)
    this.renderer.domElement.addEventListener('contextmenu', this.noMenu)
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
    document.addEventListener('mousemove', this.onWheelMove)
    document.addEventListener('pointerdown', this.onUnlock)
    document.addEventListener('keydown', this.onUnlock)
    this.timer.connect(document)
    this.loop()
  }

  hookGi(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material
      if (!m) return
      for (const mm of Array.isArray(m) ? m : [m]) giHook(mm, this.giUni)
    })
  }

  // ---------- NPCs e DJ ----------

  // ~70% querem a pista (o resto prefere sofá, bar e papo); lugar lotado, vai para a outra categoria
  spawnNpcs() {
    // lugares do club (no chão) e dos camarotes (em cima)
    const spots = [...this.world.club.spots.map((s) => ({ ...s, y: 0 })), ...this.world.decks.spots]
    const used = new Set<number>()
    const dance = spots.map((sp, i) => (sp.act === 'dance' ? i : -1)).filter((i) => i >= 0)
    const rest = spots.map((sp, i) => (sp.act === 'dance' ? -1 : i)).filter((i) => i >= 0)
    const take = (list: number[], h: number) => {
      for (let n = 0; n < list.length; n++) {
        const k = list[(h + n) % list.length]
        if (!used.has(k)) return k
      }
      return -1
    }
    // bartenders atrás do balcão (andam e preparam drinks)
    this.world.club.bartenders.forEach((bt, i) => {
      const id = `npc-bartender-${i}`
      const h = hash(id)
      const p = compactRig(makePerson(id, ROLES[(h + 3) % ROLES.length]))
      // coqueteleira na mão direita
      const sk = cyl(p.foreR, 0, 0, 0, 0.035, 0.16, std('#d4d4d8', 0.18, 0.95))
      sk.position.set(0, -0.36, 0.02)
      this.npcGroup.add(p.root)
      this.hookGi(p.root)
      tagHits(p.root, { kind: 'npc', id, label: i ? 'Bartender Lu' : 'Bartender Gui', sub: 'preparando drinks' }, this.world.hits)
      this.npcs.set(id, { id, name: 'Bartender', p, x: (bt.x0 + bt.x1) / 2, z: bt.z, rot: Math.PI, party: 'bartend', y: 0, lift: 0, sit: 0, phase: i * 2.3, bands: shuffled3(), fade: 0, blend: { key: '', t: 1, from: [], out: [] }, walk: bt })
    })
    const smokers = this.world.annex.smokeSpots
    NPC_NAMES.slice(0, NPC_MAX).forEach((name, ni) => {
      const id = `npc-${name}`
      const h = hash(id)
      // os primeiros vão fumar no terraço; o resto vai para a festa
      let sp: { act: PartyAct, x: number, y: number, z: number, rot: number, lift: number }
      if (ni < smokers.length) sp = { act: 'smoke', ...smokers[ni], y: 0, lift: 0 }
      else {
        const [first, second] = h % 100 < 70 ? [dance, rest] : [rest, dance]
        let k = take(first, h)
        if (k < 0) k = take(second, h)
        if (k < 0) return
        used.add(k)
        sp = spots[k]
      }
      const p = compactRig(makePerson(id, ROLES[h % ROLES.length]))
      this.npcGroup.add(p.root)
      this.hookGi(p.root)
      tagHits(p.root, { kind: 'npc', id, label: name }, this.world.hits)
      const sit = sp.act === 'sit' || sp.act === 'bar' ? 1 : 0
      if (sp.act === 'smoke') {
        // cigarro na mão direita, com brasa
        const cig = cyl(p.foreR, 0, 0, 0, 0.007, 0.08, std('#f5f5f4', 0.8))
        cig.rotation.x = Math.PI / 2
        cig.position.set(0.02, -0.29, 0.05)
        sph(p.foreR, 0.02, -0.29, 0.09, 0.009, glow('#ff6a1a', 3)).castShadow = false
      }
      this.npcs.set(id, { id, name, p, x: sp.x, z: sp.z, rot: sp.rot, party: sp.act, y: sp.y, lift: sp.lift, sit, phase: (h % 100) / 10, bands: shuffled3(), fade: 0, blend: { key: '', t: 1, from: [], out: [] } })
    })
  }

  // DJ no palco, atrás da mesa, virado para a pista
  spawnDj() {
    if (this.djRig) {
      this.npcGroup.remove(this.djRig.root)
      this.world.hits.splice(this.world.hits.indexOf(this.djRig.root), 1)
    }
    const rig = makeMaestro()
    this.djRig = rig
    this.npcGroup.add(rig.root)
    this.hookGi(rig.root)
    tagHits(rig.root, this.djHit, this.world.hits)
  }

  // ---------- entrada ----------

  resize(w: number, h: number) {
    const ww = Math.max(1, w)
    const hh = Math.max(1, h)
    this.css.setSize(ww, hh)
    this.renderer.setSize(ww, hh, false)
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.composer.setSize(ww, hh)
    this.camera.aspect = ww / hh
    this.camera.updateProjectionMatrix()
  }

  get active() {
    return this.controls.isLocked
  }

  enter() {
    this.lockMouse()
  }

  // trava com movimento bruto: no Windows o cursor escondido às vezes escapa da trava e para no canto de baixo à
  // direita, aí o movimento para esses lados zera. Sem suporte, trava do jeito normal.
  lockMouse() {
    const el = this.renderer.domElement
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true }) as unknown as Promise<void> | undefined
      p?.catch(() => (el.requestPointerLock() as unknown as Promise<void> | undefined)?.catch(() => {}))
    } catch {
      el.requestPointerLock()
    }
  }

  exit() {
    this.keys.clear()
    this.zooming = false
    this.controls.unlock()
  }

  inputMove() {
    let f = 0
    let r = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) r += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) r -= 1
    const m = Math.hypot(f, r)
    if (m > 1) {
      f /= m
      r /= m
    }
    return { f, r, mag: Math.min(1, m) }
  }

  onKey = (e: KeyboardEvent) => {
    if (!this.controls.isLocked) return
    // Enter ou T abre o chat (solta o mouse para digitar)
    if (e.type === 'keydown' && (e.code === 'Enter' || e.code === 'KeyT')) {
      e.preventDefault()
      this.keys.clear()
      this.controls.unlock()
      this.onChatOpen()
      return
    }
    if (e.type === 'keydown') {
      this.keys.add(e.code)
      if (e.code === 'KeyZ') this.zooming = true
      if (!e.repeat) {
        if (e.code === 'KeyE') this.keyOffer()
        if (e.code === 'KeyG') this.keyDrop()
        if (e.code === 'KeyY' || e.code === 'KeyN') this.answerOffer(e.code === 'KeyY')
      }
      if (e.code === 'KeyM' && !e.repeat) void this.toggleMic()
      if (e.code === 'KeyB' && !e.repeat && !this.wheel) {
        this.wheel = { x: 0, y: 0, sel: -1 }
        this.controls.enabled = false
        this.emitHud(true)
      }
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) this.jump()
      }
    } else {
      this.keys.delete(e.code)
      if (e.code === 'KeyZ') this.zooming = false
      if (e.code === 'KeyB' && this.wheel) {
        const sel = this.wheel.sel
        this.wheel = null
        this.controls.enabled = !this.emote && !this.orbit.leaving
        if (sel >= 0) this.startEmote(EMOTES[sel].id)
        this.emitHud(true)
      }
    }
  }

  // plano B do telão: grava o player desta aba (precisa de clique; devolve o erro em texto ou '')
  async startCapture() {
    // grava a caixa do player (filha plana do elemento CSS3D: o elemento com matrix3d dentro do contexto 3D não serve)
    const box = (this.dj.el.firstElementChild as HTMLElement | null) ?? this.dj.el
    box.style.isolation = 'isolate'
    const err = await this.feed.startCapture(box)
    this.emitHud(true)
    return err
  }

  stopCapture() {
    this.feed.stopCapture()
    this.emitHud(true)
  }

  // nome e personagem novos (criação de personagem): vão para o servidor e refazem o meu boneco
  setIdentity(name: string, avatar: Avatar) {
    this.avatar = avatar
    this.net.setName(name, avatar)
    this.buildSelf()
  }

  // braços de primeira pessoa: braço (manga da camisa), antebraço e mão (pele); presos na câmera
  buildArms() {
    for (const a of this.fpArms) for (const m of [a.upper, a.fore, a.hand]) m.removeFromParent()
    const av = this.avatar
    const shirt = std(av ? SHIRT[av.shirt % SHIRT.length] : '#64748b', 0.8)
    const skin = std(av ? SKIN[av.skin % SKIN.length] : '#eab98f', 0.7)
    this.fpArms = [0, 1].map(() => {
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 4, 10), shirt)
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.22, 4, 10), skin)
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin)
      hand.scale.set(1, 0.85, 1.25)
      for (const m of [upper, fore, hand]) {
        m.visible = false
        m.castShadow = false
        this.camera.add(m)
      }
      return { upper, fore, hand }
    })
  }

  buildSelf() {
    this.buildArms()
    if (this.selfRig) this.scene.remove(this.selfRig.root)
    this.selfRig = null
    if (!this.avatar) return
    const rig = makeAvatarPerson('eu', this.avatar)
    rig.root.visible = false
    rig.root.traverse((o) => {
      o.castShadow = true
    })
    this.scene.add(rig.root)
    this.hookGi(rig.root)
    this.selfRig = rig
  }

  // roda de emotes: B segurado abre (o mouse aponta a fatia em vez de girar a câmera); soltar faz o emote.
  // No emote o mouse gira a câmera em volta de mim
  onWheelMove = (e: MouseEvent) => {
    const w = this.wheel
    if (!w) {
      if (this.emote && this.controls.isLocked) {
        this.orbit.yaw -= e.movementX * 0.004
        this.orbit.pitch = Math.max(-0.3, Math.min(1.25, this.orbit.pitch + e.movementY * 0.003))
      }
      return
    }
    w.x = Math.max(-140, Math.min(140, w.x + e.movementX))
    w.y = Math.max(-140, Math.min(140, w.y + e.movementY))
    const prev = w.sel
    if (Math.hypot(w.x, w.y) > 35) {
      const a = (Math.atan2(w.x, -w.y) + Math.PI * 2) % (Math.PI * 2)
      w.sel = Math.round(a / ((Math.PI * 2) / EMOTES.length)) % EMOTES.length
    } else w.sel = -1
    if (w.sel !== prev) this.emitHud(true)
  }

  startEmote(name: string) {
    if (!this.selfRig || this.seat) return
    // emendando emotes (ou voltando no meio da transição): mantém o olhar de antes
    const quat = this.emote ? this.emote.quat : this.orbit.leaving ? this.orbit.quat.clone() : this.camera.quaternion.clone()
    const e = new THREE.Euler().setFromQuaternion(quat, 'YXZ')
    if (!this.emote && !this.orbit.leaving) {
      // começa de frente para mim
      this.orbit.yaw = e.y + Math.PI
      this.orbit.pitch = 0.12
    }
    this.emote = { name, t0: performance.now() / 1000, yaw: e.y, quat }
    this.orbit.quat.copy(quat)
    this.orbit.leaving = false
    this.controls.enabled = false
    this.emitHud(true)
  }

  // acaba o emote: a câmera volta para a primeira pessoa (stepOrbit) e só então o mouse volta a olhar
  stopEmote() {
    if (!this.emote) return
    this.emote = null
    this.orbit.leaving = true
    this.emitHud(true)
  }

  // câmera do emote: órbita em volta da cabeça; k sobe/desce suave entre a primeira pessoa e a órbita
  stepOrbit(dt: number) {
    const o = this.orbit
    if (this.emote) o.k = Math.min(1, o.k + dt * 1.8)
    else if (o.leaving) o.k = Math.max(0, o.k - dt * 2.2)
    if (o.leaving && o.k <= 0) {
      o.leaving = false
      this.camera.quaternion.copy(o.quat)
      this.controls.enabled = !this.wheel
    }
    if (o.k <= 0) return false
    const head = new THREE.Vector3(this.pos.x, this.floorY + 1.3, this.pos.z)
    const dist = 2.7
    const cp = new THREE.Vector3(
      head.x + Math.sin(o.yaw) * Math.cos(o.pitch) * dist,
      head.y + Math.sin(o.pitch) * dist,
      head.z + Math.cos(o.yaw) * Math.cos(o.pitch) * dist,
    )
    cp.y = Math.max(this.floorY + 0.25, cp.y)
    const tq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cp, head, new THREE.Vector3(0, 1, 0)))
    const ease = o.k * o.k * (3 - 2 * o.k)
    this.camera.position.lerp(cp, ease)
    this.camera.quaternion.slerpQuaternions(o.quat, tq, ease)
    return true
  }

  // microfone: precisa do Web Audio ligado (o clique/tecla já é o gesto que o navegador pede)
  async toggleMic() {
    this.feed.unlock()
    await this.voice.toggleMic()
    this.emitHud(true)
  }

  // pulo (espaço): só do chão e em pé; os outros veem pela altura que vai no 'me'
  jump() {
    this.stopEmote()
    if (this.seat || this.jumpY > 0) return
    // pulo gasta um pouco de stamina
    if (this.needs.stamina < 0.06) return this.notify('Sem fôlego')
    this.needs.stamina -= 0.06
    this.jumpV = 4.4
  }

  noMenu = (e: Event) => e.preventDefault()

  onClick = () => {
    if (!this.controls.isLocked) this.lockMouse()
  }

  // clique esquerdo = mão esquerda, direito = mão direita: confirma a escolha pendente, pega/compra com a mão
  // vazia (ou usa o que a mira aponta: sentar, DJ, mictório) e usa o item da mão cheia
  onHand = (e: MouseEvent) => {
    if (!this.controls.isLocked || this.wheel || (e.button !== 0 && e.button !== 2)) return
    if (this.vomitGame) return this.shootVomitTarget()
    const hand = e.button === 0 ? 0 : 1
    const pend = this.pending
    if (pend) {
      this.pending = null
      if (!this.hands[hand]) this.notify('Essa mão está vazia')
      else if (pend.act === 'drop') this.dropItem(hand)
      else if (pend.target) this.offerItem(hand, pend.target)
      return
    }
    if (this.hands[hand]) this.useItem(hand)
    else if (this.hover) this.pick(this.hover, hand)
  }

  pick(hit: Hit, hand = this.hands[0] ? 1 : 0) {
    if (hit.kind === 'shop' && isItem(hit.id)) return this.buy(hit.id, hand)
    if (hit.kind === 'item') return this.take(Number(hit.id), hand)
    if (hit.kind === 'door' && hit.id) {
      const open = !this.doorsOpen.has(hit.id)
      if (open) this.doorsOpen.add(hit.id)
      else this.doorsOpen.delete(hit.id)
      this.net.send({ t: 'door', id: hit.id, open })
      return
    }
    if (hit.kind === 'album') {
      this.exit()
      this.onAlbumOpen()
      return
    }
    if (hit.kind === 'use') {
      if (this.needs.bladder < 0.05) this.notify('Sem vontade agora')
      else this.urinal = true
      return
    }
    if (hit.kind === 'dj') {
      this.exit()
      this.onDjOpen()
      return
    }
    if (hit.kind === 'seat' && hit.seats?.length) {
      // senta no lugar livre mais perto de onde a mira aponta
      const aim = this.hoverPoint ?? this.pos
      const free = hit.seats.filter((st) => !this.seatTaken(st))
      if (!free.length) return
      const best = free.sort((a, b) => Math.hypot(a.x - aim.x, a.z - aim.z) - Math.hypot(b.x - aim.x, b.z - aim.z))[0]
      this.seat = best
      this.pos.set(best.x, 0, best.z)
      this.camera.rotation.set(-0.05, best.rot + Math.PI, 0, 'YXZ')
    }
  }

  // portas das cabines: giram até o alvo; a colisão sai na hora ao abrir e volta ao fechar (se ninguém estiver no vão)
  stepDoors(dt: number) {
    const cols = this.world.colliders
    for (const d of this.world.annex.doors) {
      const open = this.doorsOpen.has(d.id)
      d.pivot.rotation.y += ((open ? DOOR_OPEN : 0) - d.pivot.rotation.y) * (1 - Math.exp(-dt * 7))
      const i = cols.indexOf(d.box)
      if (open && i >= 0) cols.splice(i, 1)
      else if (!open && i < 0) {
        const b = d.box
        const inside = this.pos.x + RADIUS > b.x0 && this.pos.x - RADIUS < b.x1 && this.pos.z + RADIUS > b.z0 && this.pos.z - RADIUS < b.z1
        if (!inside) cols.push(b)
      }
    }
  }

  // ---------- itens e necessidades ----------

  stepViewItems(third: boolean) {
    for (const side of [0, 1]) {
      const kind = this.hands[side]?.kind ?? ''
      if (kind !== this.viewKinds[side]) {
        this.viewKinds[side] = kind
        this.viewItems[side]?.removeFromParent()
        this.viewItems[side] = null
        if (isItem(kind)) {
          const g = itemMesh(kind)
          this.camera.add(g)
          this.viewItems[side] = g
        }
      }
      const g = this.viewItems[side]
      if (!g) continue
      g.visible = !third
      const u = this.useAnim[side]
      const lift = Math.sin(Math.min(1, u) * Math.PI)
      const sx = side ? 1 : -1
      // pendendo um pouco no ritmo do passo; no uso vai para o meio, sobe e inclina na boca
      g.scale.setScalar(0.75)
      g.position.set(sx * (0.24 - lift * 0.17), -0.3 + lift * 0.17, -0.62 + lift * 0.3)
      g.rotation.set(lift * (this.hands[side]?.kind === 'shot' ? 1.5 : 1.15), 0, -sx * lift * 0.2)
    }
    // braços: só da mão que segura algo; IK de dois ossos do ombro (fora da tela) até a mão no item
    const UP = new THREE.Vector3(0, 1, 0)
    for (const side of [0, 1]) {
      const arm = this.fpArms[side]
      if (!arm) continue
      const g = this.viewItems[side]
      const on = !!g && !third
      arm.upper.visible = arm.fore.visible = arm.hand.visible = on
      if (!g || !on) continue
      const sx = side ? 1 : -1
      // ombro logo abaixo e à frente da câmera: o braço alcança o copo parado (antes só alcançava no gole)
      const S = new THREE.Vector3(sx * 0.27, -0.42, -0.1)
      // mão por fora e um pouco abaixo do meio do copo (segurando de lado)
      const T = new THREE.Vector3(sx * 0.06, 0.07, 0.02).applyEuler(g.rotation).multiplyScalar(0.75).add(g.position)
      const a = 0.33
      const b = 0.31
      const toT = T.clone().sub(S)
      const d = Math.min(a + b - 0.001, Math.max(0.05, toT.length()))
      const dir = toT.normalize()
      // cotovelo para baixo e para fora
      const pole = new THREE.Vector3(sx * 0.7, -1, 0.15).normalize()
      const nrm = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize()
      const cosA = (a * a + d * d - b * b) / (2 * a * d)
      const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
      const El = S.clone().addScaledVector(dir, a * cosA).addScaledVector(nrm, a * sinA)
      const Hp = S.clone().addScaledVector(dir, d)
      const bone = (m: THREE.Mesh, p0: THREE.Vector3, p1: THREE.Vector3) => {
        m.position.copy(p0).add(p1).multiplyScalar(0.5)
        m.quaternion.setFromUnitVectors(UP, p1.clone().sub(p0).normalize())
      }
      bone(arm.upper, S, El)
      bone(arm.fore, El, Hp)
      arm.hand.position.copy(Hp)
      arm.hand.quaternion.copy(arm.fore.quaternion)
    }
  }

  // ---------- vômito ----------

  // embriaguez no máximo: aparecem 4 a 6 círculos na frente (no mundo); mirar e clicar em todos em 5 s segura
  startVomitGame() {
    const cam = this.camera
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion)
    const n = 4 + Math.floor(Math.random() * 3)
    const targets = []
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.ringTex, depthTest: false, transparent: true, toneMapped: false }))
      s.renderOrder = 999
      s.position.copy(cam.position).addScaledVector(fwd, 2.2).addScaledVector(right, (Math.random() - 0.5) * 2.4).addScaledVector(up, (Math.random() - 0.5) * 1.3)
      s.scale.setScalar(0.24)
      this.scene.add(s)
      // fora do SSAO (senão vira um quadrado preto)
      this.worldUi.push(s)
      targets.push({ s, done: false })
    }
    this.vomitGame = { targets, until: performance.now() + 5000 }
    this.notify('Vai vomitar! Mira e clica nos círculos', 2500)
  }

  endVomitGame() {
    for (const t of this.vomitGame?.targets ?? []) {
      t.s.removeFromParent()
      t.s.material.dispose()
      const i = this.worldUi.indexOf(t.s)
      if (i >= 0) this.worldUi.splice(i, 1)
    }
    this.vomitGame = null
  }

  // clique durante o minigame: acerta o círculo mais perto da mira (se estiver perto o bastante)
  shootVomitTarget() {
    const g = this.vomitGame
    if (!g) return
    const cam = this.camera
    let best: (typeof g.targets)[number] | null = null
    let bestD = 1e9
    for (const t of g.targets) {
      if (t.done) continue
      const p = t.s.position.clone().project(cam)
      if (p.z > 1) continue
      const dd = Math.hypot(p.x * cam.aspect, p.y)
      if (dd < bestD) {
        bestD = dd
        best = t
      }
    }
    // raio do alvo na tela (o círculo tem ~0,24 m a ~2 m)
    if (best && bestD < 0.11) {
      best.done = true
      best.s.removeFromParent()
      if (g.targets.every((t) => t.done)) {
        this.endVomitGame()
        this.needs.drunk = 0.85
        this.vomitCool = performance.now() + 3000
        this.notify('Segurou! Melhor dar um tempo na bebida')
      }
    }
  }

  stepVomit(dt: number) {
    const now = performance.now()
    const g = this.vomitGame
    if (g) {
      const left = (g.until - now) / 5000
      for (const t of g.targets) if (!t.done) t.s.scale.setScalar(0.12 + 0.12 * Math.max(0, Math.min(1, left)))
      if (now > g.until) {
        // não segurou: vomita 4 s na direção do olhar (o controle continua comigo)
        this.endVomitGame()
        this.vomitUntil = now + 4000
        this.vomitCool = now + 3000
        this.notify('Ih, não segurou…', 2500)
      }
    }
    if (this.vomitUntil && this.vomitUntil < now) {
      // acabou: um pouco mais sóbrio, com fome e sem fôlego
      this.vomitUntil = 0
      this.needs.drunk = 0.6
      this.needs.hunger = Math.min(1, this.needs.hunger + 0.3)
      this.needs.stamina = Math.max(0, this.needs.stamina - 0.3)
    }
    // no máximo de novo (bebeu mais): minigame outra vez
    if (!this.vomitGame && !this.vomitUntil && this.needs.drunk >= 0.98 && now > this.vomitCool && this.active) this.startVomitGame()
    if (this.vomitUntil > now) {
      const q = this.orbit.k > 0 ? this.orbit.quat : this.camera.quaternion
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
      // sai da boca (abaixo da borda de baixo da tela, colada no rosto) e entra na tela subindo: direção do olhar
      // inclinada 45 graus para cima
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
      const mouth = new THREE.Vector3(this.pos.x, this.seat ? this.seat.y + 0.78 : this.floorY + EYE + this.jumpY, this.pos.z).addScaledVector(up, -0.24).addScaledVector(fwd, 0.08)
      this.vomitFx.spray(mouth, fwd.clone().applyAxisAngle(right, Math.PI / 4), 5)
    }
    // dos outros jogadores: jato da boca na direção para onde o boneco olha
    for (const rm of this.remotes.values()) {
      if (!rm.vomit) continue
      const r = rm.rig.root
      // para a frente do boneco, 45 graus para cima
      const dir = new THREE.Vector3(Math.sin(r.rotation.y), 1, Math.cos(r.rotation.y)).normalize()
      const mouth = new THREE.Vector3(r.position.x, r.position.y + (rm.sit ? 1.15 : 1.5), r.position.z).addScaledVector(dir, 0.2)
      this.vomitFx.spray(mouth, dir, 2)
    }
    this.vomitFx.update(dt, now, heightAt)
  }

  notify(text: string, ms = 2600) {
    this.toast = { text, until: performance.now() + ms }
  }

  isPeeing() {
    const onToilet = !!this.seat && this.world.annex.toilets.includes(this.seat)
    return (onToilet || this.urinal) && this.needs.bladder > 0.005
  }

  promptText() {
    const vg = this.vomitGame
    if (vg) return `Segura o vômito! Mira e clica nos círculos · ${vg.targets.filter((t) => !t.done).length} faltando · ${Math.max(0, Math.ceil((vg.until - performance.now()) / 1000))} s`
    const p = this.pending
    if (p?.act === 'drop') return 'Largar qual? Clique esquerdo ou direito · G cancela'
    if (p?.act === 'offer') return `Oferecer qual para ${p.target?.label ?? 'a pessoa'}? Clique esquerdo ou direito · E ou G cancela`
    if (this.offering) return `Esperando ${this.offering.name} responder…`
    return null
  }

  // cardápio em cima do balcão: um de cada, a mira compra para a mão do clique
  buildShop() {
    const bar = this.world.club.bar
    const g = new THREE.Group()
    ITEM_KINDS.forEach((kind, i) => {
      const it = ITEMS[kind]
      const x = bar.x0 + 0.7 + i * 0.5
      const z = bar.z - 0.06
      const m = itemMesh(kind)
      m.position.set(x, bar.top, z)
      g.add(m)
      // área de mira maior que o copo (invisível)
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.3), new THREE.MeshBasicMaterial())
      box.visible = false
      box.position.set(x, bar.top + 0.15, z)
      g.add(box)
      const hit: Hit = { kind: 'shop', id: kind, label: `${it.label} · R$ ${it.price}`, sub: 'clique esquerdo ou direito compra para essa mão' }
      tagHits(m, hit, this.world.hits)
      tagHits(box, hit, this.world.hits)
    })
    this.scene.add(g)
    this.hookGi(g)
  }

  buy(kind: ItemKind, hand: number) {
    const it = ITEMS[kind]
    if (this.hands[hand]) return this.notify('Essa mão está ocupada')
    if (this.needs.money < it.price) return this.notify(`Sem dinheiro: ${it.label} custa R$ ${it.price}`)
    this.needs.money -= it.price
    this.hands[hand] = { kind, left: it.uses }
    this.notify(`${it.label} na mão ${hand ? 'direita' : 'esquerda'} (R$ ${it.price})`)
  }

  take(id: number, hand: number) {
    if (this.hands[hand]) return this.notify('Essa mão está ocupada')
    this.net.send({ t: 'take', id, hand })
  }

  gotTook(m: { id: number, hand: number, kind?: string, left?: number }) {
    if (!isItem(m.kind)) return this.notify('Alguém pegou antes')
    const left = Math.max(1, Math.min(ITEMS[m.kind].uses, Math.round(m.left ?? 1)))
    const hand = !this.hands[m.hand] ? m.hand : !this.hands[1 - m.hand] ? 1 - m.hand : -1
    // as duas mãos encheram enquanto isso: volta para o chão
    if (hand < 0) return this.dropAt(m.kind, left)
    this.hands[hand] = { kind: m.kind, left }
  }

  // larga na frente (no piso de onde cair: chão, camarote ou escada)
  dropAt(kind: ItemKind, left: number) {
    const fwd = new THREE.Vector3()
    this.camera.getWorldDirection(fwd)
    fwd.y = 0
    fwd.normalize()
    let x = this.pos.x + fwd.x * 0.55
    let z = this.pos.z + fwd.z * 0.55
    if (this.blockedAt(x, z)) {
      x = this.pos.x
      z = this.pos.z
    }
    this.net.send({ t: 'drop', kind, left, p: [x, heightAt(x, z), z] })
  }

  dropItem(hand: number) {
    const h = this.hands[hand]
    if (!h) return
    this.cancelOffer(hand)
    this.hands[hand] = null
    this.useAnim[hand] = 0
    this.dropAt(h.kind, h.left)
  }

  useItem(hand: number) {
    const h = this.hands[hand]
    if (!h || this.useAnim[hand] > 0) return
    if (this.offering?.hand === hand) return this.notify('Esperando a resposta da oferta')
    this.useAnim[hand] = 0.001
  }

  // G: uma mão cheia larga na hora; as duas, espera o clique do lado; com escolha pendente, cancela
  keyDrop() {
    if (this.pending) {
      this.pending = null
      return
    }
    const full = [0, 1].filter((i) => this.hands[i])
    if (full.length === 1) this.dropItem(full[0])
    else if (full.length === 2) this.pending = { act: 'drop' }
  }

  // E: com item na mão e a mira numa pessoa, oferece (uma mão: na hora; duas: espera o clique do lado); E de novo
  // cancela; sem item (ou sem pessoa), usa o que a mira aponta (sentar, DJ...)
  keyOffer() {
    if (this.pending) {
      this.pending = null
      return
    }
    const hit = this.hover
    const person = hit && (hit.kind === 'npc' || hit.kind === 'player')
    const full = [0, 1].filter((i) => this.hands[i])
    if (person && full.length) {
      if (this.offering) return this.notify('Já tem uma oferta esperando resposta')
      if (full.length === 1) this.offerItem(full[0], hit)
      else this.pending = { act: 'offer', target: hit }
      return
    }
    if (hit) this.pick(hit)
  }

  offerItem(hand: number, to: Hit) {
    const h = this.hands[hand]
    if (!h || this.offering) return
    const oid = Math.random().toString(36).slice(2, 10)
    const name = to.kind === 'npc' ? (this.npcs.get(to.id ?? '')?.name ?? to.label) : to.label
    this.offering = { hand, oid, to, name, at: performance.now() }
    if (to.kind === 'player') this.net.send({ t: 'offer', to: Number(to.id), oid, kind: h.kind, left: h.left })
  }

  // desiste da oferta (largou ou usou o item, ou passou do tempo)
  cancelOffer(hand?: number) {
    const o = this.offering
    if (!o || (hand !== undefined && o.hand !== hand)) return
    if (o.to.kind === 'player') this.net.send({ t: 'offer-cancel', to: Number(o.to.id), oid: o.oid })
    this.offering = null
  }

  gotOffer(m: NetOffer) {
    const now = performance.now()
    if (m.t === 'offer') {
      if (!isItem(m.kind)) return
      const reply = (ok: boolean, why = '') => this.net.send({ t: 'offer-reply', to: m.from, oid: m.oid, ok, why })
      if (this.incoming) return reply(false, 'já tem outra oferta')
      if (this.hands[0] && this.hands[1]) {
        this.notify(`${m.name ?? 'Alguém'} te ofereceu ${ITEMS[m.kind].label}, mas suas mãos estão ocupadas`)
        return reply(false, 'mãos ocupadas')
      }
      this.incoming = { from: m.from, name: m.name ?? 'Alguém', oid: m.oid, kind: m.kind, left: Math.max(1, Math.min(ITEMS[m.kind].uses, Math.round(m.left ?? 1))), at: now }
    } else if (m.t === 'offer-cancel') {
      if (this.incoming?.oid === m.oid) {
        this.notify(`${this.incoming.name} desistiu da oferta`)
        this.incoming = null
      }
    } else {
      const o = this.offering
      if (!o || o.oid !== m.oid) return
      this.offering = null
      if (m.ok) {
        this.hands[o.hand] = null
        this.useAnim[o.hand] = 0
        this.notify(`${o.name} aceitou`)
      } else this.notify(`${o.name} recusou${m.why ? ` (${m.why})` : ''}`)
    }
  }

  // Y aceita (vai para a mão livre, a esquerda primeiro), N recusa
  answerOffer(yes: boolean) {
    const inc = this.incoming
    if (!inc) return
    this.incoming = null
    const hand = !this.hands[0] ? 0 : !this.hands[1] ? 1 : -1
    if (yes && hand >= 0) {
      this.hands[hand] = { kind: inc.kind, left: inc.left }
      this.net.send({ t: 'offer-reply', to: inc.from, oid: inc.oid, ok: true })
      this.notify(`${ITEMS[inc.kind].label} de ${inc.name} na mão ${hand ? 'direita' : 'esquerda'}`)
    } else this.net.send({ t: 'offer-reply', to: inc.from, oid: inc.oid, ok: false, why: yes ? 'mãos ocupadas' : 'não quis' })
  }

  // mãos do NPC: quem fuma tem o cigarro na direita; bartender está trabalhando
  npcHands(n: Npc) {
    n.hands ??= n.party === 'bartend' ? ['busy', 'busy'] : n.party === 'smoke' ? [null, 'busy'] : [null, null]
    return n.hands
  }

  npcSay(n: Npc, text: string) {
    if (!n.bubble) {
      n.bubble = textSprite('', 'bubble')
      n.p.root.add(n.bubble)
    }
    drawTextSprite(n.bubble, text, 'bubble')
    n.bubble.position.y = n.sit > 0.5 ? 2.35 : 2.75
    n.bubble.visible = true
    n.bubbleUntil = performance.now() + 3000
  }

  // ofertas esperando: o NPC pensa ~1 s e decide; jogador tem 15 s para responder (e eu também)
  stepOffers(time: number) {
    const now = performance.now()
    const o = this.offering
    if (o && o.to.kind === 'npc' && now - o.at > 1000) {
      this.offering = null
      const n = this.npcs.get(o.to.id ?? '')
      const h = this.hands[o.hand]
      // quem não é da festa (o fotógrafo) está trabalhando
      if (!n) this.notify(`${o.name}: valeu, mas tô trabalhando!`)
      if (n && h) {
        const hs = this.npcHands(n)
        const free = hs[1] === null ? 1 : hs[0] === null ? 0 : -1
        let text: string
        if (n.party === 'bartend') text = 'Valeu, mas tô trabalhando!'
        else if (free < 0) text = 'Tô com as mãos ocupadas'
        else if (Math.random() < 0.8) {
          text = h.kind === 'shot' ? 'Bora, saúde!' : h.kind === 'batata' ? 'Opa, valeu!' : 'Valeu, saúde!'
          hs[free] = { kind: h.kind, left: h.left, obj: attachItem(n.p, free, h.kind), nextSip: time + 2 + Math.random() * 3, sipUntil: 0 }
          this.hands[o.hand] = null
          this.useAnim[o.hand] = 0
        } else text = 'Não, valeu'
        this.npcSay(n, text)
        this.notify(`${n.name}: ${text}`)
      }
    } else if (o && now - o.at > 15000) {
      this.notify(`${o.name} não respondeu`)
      this.cancelOffer()
    }
    const inc = this.incoming
    if (inc && now - inc.at > 15000) {
      this.incoming = null
      this.net.send({ t: 'offer-reply', to: inc.from, oid: inc.oid, ok: false, why: 'não respondeu' })
    }
  }

  // itens no chão: o servidor manda a lista; cria os que chegaram, tira os que sumiram
  syncFloor(list: NetFloorItem[]) {
    const seen = new Set<number>()
    for (const it of list) {
      if (!isItem(it.kind)) continue
      seen.add(it.id)
      if (this.floorItems.has(it.id)) continue
      const g = new THREE.Group()
      g.position.set(it.p[0], it.p[1], it.p[2])
      g.rotation.y = (it.id * 2.399) % (Math.PI * 2)
      g.add(itemMesh(it.kind))
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial())
      box.visible = false
      box.position.y = 0.12
      g.add(box)
      const def = ITEMS[it.kind]
      tagHits(g, { kind: 'item', id: String(it.id), label: def.label, sub: `${it.left} de ${def.uses} · clique pega com essa mão` }, this.world.hits)
      this.hookGi(g)
      this.floorGroup.add(g)
      this.floorItems.set(it.id, { it, g })
    }
    for (const [id, f] of [...this.floorItems]) {
      if (seen.has(id)) continue
      this.floorGroup.remove(f.g)
      const i = this.world.hits.indexOf(f.g)
      if (i >= 0) this.world.hits.splice(i, 1)
      this.floorItems.delete(id)
    }
  }

  // uso dos itens (gole leva ~0,9 s; o efeito vem no meio), necessidades e avisos
  stepItems(dt: number, time: number, d: { running: boolean, moving: boolean }) {
    for (const hand of [0, 1]) {
      const u = this.useAnim[hand]
      if (u <= 0) continue
      const h = this.hands[hand]
      const nu = u + dt / 0.9
      if (h && u < 0.5 && nu >= 0.5) {
        consume(this.needs, h.kind)
        h.left--
      }
      this.useAnim[hand] = nu >= 1 ? 0 : nu
      if (nu >= 1 && h && h.left <= 0) {
        this.hands[hand] = null
        this.notify(`Acabou ${h.kind === 'batata' ? 'a batata' : `o ${ITEMS[h.kind].label.toLowerCase()}`}`)
      }
    }
    if (d.moving) this.urinal = false
    const peeing = this.isPeeing()
    if (peeing && !this.wasPeeing) this.notify('Fazendo xixi…', 1500)
    if (!peeing && this.wasPeeing && this.needs.bladder <= 0.005) this.notify('Alívio!')
    this.wasPeeing = peeing
    if (this.needs.bladder <= 0.005) this.urinal = false
    stepNeeds(this.needs, { running: d.running, moving: d.moving, sitting: !!this.seat, dancing: !!this.emote && this.emote.name !== 'aponta' && this.emote.name !== 'aceno', peeing }, dt)
    if (this.needs.stamina <= 0.001 && !this.exhausted) {
      this.exhausted = true
      this.notify('Sem fôlego')
    }
    if (this.exhausted && this.needs.stamina > 0.3) this.exhausted = false
    const now = performance.now()
    if (this.needs.bladder > 0.95 && now - this.warnAt.bladder > 20000) {
      this.warnAt.bladder = now
      this.notify('Tô apertado! Preciso de um banheiro', 3500)
    }
    if (this.needs.hunger > 0.9 && now - this.warnAt.hunger > 30000) {
      this.warnAt.hunger = now
      this.notify('Tô com fome (tem batata no bar)', 3500)
    }
    this.stepOffers(time)
  }

  // lugar ocupado: um NPC sentado ou outro jogador a menos de 35 cm
  seatTaken(st: Seat) {
    for (const n of this.npcs.values()) if (n.sit > 0.5 && Math.hypot(n.x - st.x, n.z - st.z) < 0.35) return true
    for (const rm of this.remotes.values()) if (rm.sit && Math.hypot(rm.tx - st.x, rm.tz - st.z) < 0.35) return true
    return false
  }

  blockedAt(x: number, z: number) {
    for (const b of this.world.colliders) if (x + RADIUS > b.x0 && x - RADIUS < b.x1 && z + RADIUS > b.z0 && z - RADIUS < b.z1) return true
    return false
  }

  emitHud(force = false) {
    const now = performance.now()
    if (this.toast && now > this.toast.until) this.toast = null
    const n = this.needs
    const hud: Hud = {
      hover: this.hover, locked: this.active, tuning: this.tuning, mic: this.voice.micOn, wheel: this.wheel ? this.wheel.sel : null, emote: this.emote?.name ?? null, capture: this.feed.capturing ? 'on' : this.feed.failed && this.net.dj.cur ? 'offer' : 'off',
      needs: { ...n }, hands: this.hands.map((h) => (h ? { ...h } : null)), prompt: this.promptText(), incoming: this.incoming ? { name: this.incoming.name, kind: this.incoming.kind } : null, toast: this.toast?.text ?? null, peeing: this.isPeeing(),
    }
    const q = (v: number) => Math.round(v * 50)
    const key = `${hud.hover?.kind}:${hud.hover?.id ?? hud.hover?.label ?? ''}|${hud.hover?.sub ?? ''}|${hud.locked}|${hud.tuning}|${hud.mic}|${this.wheel ? `w${this.wheel.sel}` : ''}|${hud.emote}|${hud.capture}|${q(n.stamina)},${q(n.bladder)},${q(n.drunk)},${q(n.hunger)},${n.money}|${hud.hands.map((h) => (h ? `${h.kind}${h.left}` : '-')).join(',')}|${hud.prompt}|${this.incoming?.oid}|${hud.toast}|${hud.peeing}`
    if (!force && key === this.hudKey) return
    this.hudKey = key
    this.onHud(hud)
  }

  // ---------- GI 2D ----------

  // planta do club (emissores e obstáculos) nas cascatas ~10x/s
  stepGi(time: number) {
    const rc = this.rc
    if (!rc) return
    const now = performance.now()
    if (now - this.rcAt < 100) return
    this.rcAt = now
    const S = Math.max(W, D) + 0.6
    const R = rc.R
    const k = R / S
    const c = rc.ctx
    c.clearRect(0, 0, R, R)
    const rect = (x0: number, z0: number, x1: number, z1: number, col: string) => {
      c.fillStyle = col
      c.fillRect(x0 * k, z0 * k, Math.max(1, (x1 - x0) * k), Math.max(1, (z1 - z0) * k))
    }
    const disc = (x: number, z: number, rr: number, col: string) => {
      c.fillStyle = col
      c.beginPath()
      c.arc(x * k, z * k, Math.max(1, rr * k), 0, Math.PI * 2)
      c.fill()
    }
    const occ = (a: number) => `rgba(0,0,0,${a})`
    // neon do parapeito: tubo fino (faixa com ~15% do brilho, senão o contorno apaga o fogo e o palco)
    const dim = (cc: THREE.Color) => `#${cc.clone().multiplyScalar(0.15).getHexString()}`
    const edge = dim(this.pal[0])
    rect(-0.3, -0.3, W + 0.3, 0, edge)
    rect(-0.3, -0.3, 0, D + 0.3, edge)
    rect(W, -0.3, W + 0.3, D + 0.3, edge)
    rect(-0.3, D, W + 0.3, D + 0.3, dim(this.pal[1]))
    const cl = this.world.club
    const col = new THREE.Color()
    const mx = cl.maestro.x
    for (let i = 0; i < 50; i++) {
      col.copy(cl.led.cols[i])
      if (col.r + col.g + col.b < 0.01) continue
      const x = mx - 4.5 + (i % 10)
      const z = 5.2 + Math.floor(i / 10)
      rect(x - 0.48, z - 0.48, x + 0.48, z + 0.48, `rgb(${Math.round(Math.min(1, col.r) * 255)},${Math.round(Math.min(1, col.g) * 255)},${Math.round(Math.min(1, col.b) * 255)})`)
    }
    for (const b of cl.blocks) rect(b.x0, b.z0, b.x1, b.z1, b.color ?? occ(b.a))
    // telão, canhões e manchas dos feixes no chão
    rect(cl.screen.x - cl.screen.w / 2, cl.screen.z, cl.screen.x + cl.screen.w / 2, cl.screen.z + 0.25, this.glowColor)
    cl.pools.forEach((p, i) => {
      const pc = this.pal[i % this.pal.length]
      const kk = Math.min(1, 0.3 + (p.material as THREE.MeshBasicMaterial).opacity)
      if (p.visible) disc(p.position.x, p.position.z, Math.max(0.5, p.scale.x * 0.35), `rgb(${Math.round(pc.r * 255 * kk)},${Math.round(pc.g * 255 * kk)},${Math.round(pc.b * 255 * kk)})`)
      const b = cl.beams[i]
      disc(b.position.x, b.position.z + 0.2, 0.35, `#${this.pal[i % this.pal.length].getHexString()}`)
    })
    for (const g of cl.glows) disc(g.x, g.z, g.r * (g.fire ? 0.85 + Math.sin(time * 13 + g.x) * 0.15 : 1), g.color)
    for (const sp of cl.spots) if (sp.act === 'sit') disc(sp.x, sp.z, 0.3, occ(0.2))
    // gente faz sombra
    for (const n of this.npcs.values()) disc(n.x, n.z, 0.24, occ(0.3))
    for (const rm of this.remotes.values()) disc(rm.tx, rm.tz, 0.24, occ(0.3))
    rc.compute(3)
    this.giUni.uGiRect.value.set(0, 0, S, S)
    this.giUni.uGiY.value.set(0, 8)
    this.giUni.uGiStrength.value = 1.6
  }

  // ---------- club: batida, vídeo, luzes, ondas, telão e som ----------

  stepClub(time: number) {
    const dt = Math.min(0.1, Math.max(0, time - this.clubAt))
    this.clubAt = time
    const c = this.world.club
    const beat = time * (125 / 60)
    // com o vídeo nosso a batida é a do som; sem ele, o relógio de 125 bpm. Só vale depois que o som trava
    const live = this.feed.ok && this.feed.locked
    this.tuning = this.feed.ok && !!this.net.dj.cur && !this.feed.locked
    const fired = this.feed.beat(time)
    if (fired) this.beatT = time
    {
      const st = this.dj.ready ? this.dj.player?.getPlayerState?.() : -1
      this.musicOn = live ? !this.feed.paused && this.feed.ready : st === 1
      const clockBeat = Math.floor(beat)
      const tick = live ? fired : clockBeat !== this.lastClockBeat
      this.lastClockBeat = clockBeat
      if (tick && this.musicOn) this.grooveGoal = Math.floor(this.grooveGoal) + 1
      this.groove += (this.grooveGoal - this.groove) * (1 - Math.exp(-dt * 7))
      const rate = [7, 9, 12]
      for (let b = 0; b < 3; b++) {
        const hit = live ? this.feed.bandHit[b] !== this.bandSeen[b] : tick
        this.bandSeen[b] = this.feed.bandHit[b]
        if (hit && this.musicOn) this.grooveBGoal[b] = Math.floor(this.grooveBGoal[b]) + 1
        this.grooveB[b] += (this.grooveBGoal[b] - this.grooveB[b]) * (1 - Math.exp(-dt * rate[b]))
      }
    }
    const beatPhase = live ? Math.min(1, (time - this.beatT) / 0.55) : beat - Math.floor(beat)
    const v = c.video
    // painel sempre do nosso jeito (preto sem música); o iframe só aparece se o proxy falhar
    const ours = !this.feed.failed || this.feed.capturing
    v.screen.visible = ours
    v.dome.visible = live
    v.hole.visible = !ours
    v.grid.visible = !ours
    if (v.manta) v.manta.visible = live
    for (const m of v.mats) m.uniforms.uVideo.value = this.feed.tex
    // telão: animação de carregando até o som travar e a imagem ter quadro
    const wantLoad = this.tuning || (live && this.feed.video.readyState < 2) ? 1 : 0
    this.loadK += (wantLoad - this.loadK) * Math.min(1, dt * 4)
    const su = (v.screen.material as THREE.ShaderMaterial).uniforms
    su.uLoad.value = this.loadK
    su.uTime.value = time
    su.uTint.value.copy(this.pal[0])
    const scale = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2))
    for (const pt of [v.dome, v.manta]) if (pt) (pt.material as THREE.ShaderMaterial).uniforms.uScale.value = scale
    if (live) this.liveFrame()
    const gu = this.giUni
    gu.uFloorTex.value = this.floorLight.t
    gu.uFloorRect.value.set(0, 0, W, D)
    gu.uFloorY.value = 0
    gu.uFloorK.value = live ? 1.6 : 0
    // luz do telão: anda até a cor/força da média do vídeo (sem vídeo, apaga devagar)
    {
      const sl = this.screenLight
      const sc0 = c.screen
      sl.position.set(sc0.x, sc0.y, sc0.z + 0.06)
      sl.lookAt(sc0.x, sc0.y, sc0.z + 10)
      const goal = this.screenGoal
      const k = Math.min(1, dt * 6)
      sl.color.lerp(goal.color, k)
      sl.intensity += ((live ? goal.k : 0) - sl.intensity) * k
    }
    // a paleta anda devagar até a do quadro atual do vídeo (troca em ~2 s)
    const pal = this.pal
    pal.forEach((p, i) => p.lerp(this.palGoal[i], Math.min(1, dt * 0.6)))
    c.neon[0].color.copy(pal[0]).multiplyScalar(2)
    c.neon[1].color.copy(pal[1]).multiplyScalar(2)
    // sem o vídeo no ar a pista não acende (o chão é só o deck)
    if (!live) for (const lc of c.led.cols) lc.setRGB(0, 0, 0)
    for (const j of c.jogs) j.rotation.y = time * 3.5
    c.flames.forEach((f, i) => f.scale.set(1, 0.7 + Math.abs(Math.sin(time * 9 + i * 1.7)) * 0.6 + Math.sin(time * 23 + i) * 0.1, 1))
    const pulse = live ? Math.pow(1 - beatPhase, 2) : 0.5 + 0.5 * Math.max(0, Math.sin(beat * Math.PI))
    const apex = new THREE.Vector3()
    const dir = new THREE.Vector3()
    c.beams.forEach((b, i) => {
      b.rotation.z = Math.sin(time * 0.9 + i) * 0.85
      // o cone vai para a frente (pista): mínimo de 0.6 rad da vertical (não encosta no telão), máximo quase na horizontal
      b.rotation.x = -(0.95 + Math.sin(time * 0.7 + i * 1.3) * 0.35)
      b.updateMatrixWorld()
      b.getWorldPosition(apex)
      const m = c.beamMats[i]
      m.uniforms.uApex.value.copy(apex)
      m.uniforms.uFloorY.value = c.pools[i].position.y - 0.02
      m.uniforms.uTime.value = time
      m.uniforms.uGain.value = 0.45 + 0.35 * pulse
      m.uniforms.uColor.value.copy(pal[i % pal.length])
      ;(c.pools[i].material as THREE.MeshBasicMaterial).color.copy(pal[i % pal.length])
      dir.set(0, -1, 0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()))
      const pool = c.pools[i]
      const floorY = pool.position.y
      const tHit = dir.y < -0.05 ? (floorY - apex.y) / dir.y : -1
      const hx = apex.x + dir.x * tHit
      const hz = apex.z + dir.z * tHit
      if (tHit > 0 && hx > 0 && hx < W && hz > 0 && hz < D) {
        pool.visible = true
        pool.position.x = hx
        pool.position.z = hz
        const rad = 0.15 + tHit * 0.26
        pool.scale.set(rad * 2.6, rad * 2.6 / Math.max(0.35, -dir.y), 1)
        ;(pool.material as THREE.MeshBasicMaterial).opacity = (0.3 + 0.4 * pulse) * Math.max(0.25, 1 - tHit / 30)
      } else pool.visible = false
    })
    // falantes de verdade: o cone pula para fora no ataque da faixa e volta, mais um tremor no nível dela
    {
      const f = this.feed
      const dur = [0.32, 0.22, 0.14]
      for (const dv of c.drivers) {
        const b = dv.band
        const ph = live ? Math.min(1, (time - f.bandHit[b]) / dur[b]) : 1
        const lvl = live ? f.bandLvl[b] : 0
        const kick = (1 - ph) * (1 - ph) * (0.6 + 0.6 * lvl)
        const buzz = Math.sin(time * (b === 0 ? 47 : b === 1 ? 83 : 131) + dv.r * 40) * lvl * 0.25
        const exc = dv.r * 0.32 * (kick + buzz)
        dv.g.position.z = (dv.r < 0.1 ? 0.03 : 0) + exc
        dv.g.scale.setScalar(1 + exc * 0.6)
      }
    }
    // ondas: telão (como um falante grande) e cada falante de cada caixa, cada um na sua faixa
    {
      const u = this.beatWarp.uniforms
      const el = this.renderer.domElement
      u.uAspect.value = el.clientWidth / Math.max(1, el.clientHeight)
      const playing = this.dj.ready && this.dj.player?.getPlayerState?.() === 1
      // fora do club (corredores, banheiros, terraço) as ondas somem
      const vol = (live ? (this.feed.paused ? 0 : this.heard) : playing ? this.dj.volume / 100 : 0) * this.acoustic.open
      type Src = { p: THREE.Vector3, r: number, mouth?: { band: number, ph: number, lvl: number } }
      const src: Src[] = [{ p: new THREE.Vector3(c.screen.x, c.screen.y, c.screen.z), r: 0.3 }, ...c.speakers]
      // boca de quem está falando: onda da faixa mais forte da voz dele, saindo da frente do rosto
      const actx = this.feed.ctx
      if (actx) {
        const durV = [0.45, 0.32, 0.22]
        for (const [rid, rm] of this.remotes) {
          const b = this.voice.bandsOf(rid)
          if (!b || src.length >= 32) continue
          let band = 0
          for (let k = 1; k < 3; k++) if (b.lv[k] > b.lv[band]) band = k
          // ataque da sílaba; som contínuo (vogal longa) segue pulsando enquanto estiver alto
          let since = actx.currentTime - b.hit[band]
          if (since > durV[band] && b.lv[band] > 0.35) since %= durV[band] * 1.4
          const ph = Math.min(1, since / durV[band])
          if (ph >= 1 || b.lv[band] < 0.2) continue
          const hp = rm.rig.head.getWorldPosition(new THREE.Vector3())
          const yaw = rm.rig.root.rotation.y
          hp.x += Math.sin(yaw) * 0.2
          hp.z += Math.cos(yaw) * 0.2
          // voz alcança menos: força pela distância até você
          const near = Math.max(0, 1 - hp.distanceTo(this.camera.position) / 14)
          src.push({ p: hp, r: 0.12, mouth: { band, ph, lvl: b.lv[band] * near } })
        }
      }
      const f = this.feed
      const dur = [0.55, 0.4, 0.26]
      const spd = [1, 0.75, 0.5]
      const cam = this.camera.position
      const vv = new THREE.Vector3()
      let any = false
      for (let i = 0; i < 32; i++) {
        const sp = src[i]
        if (!sp) {
          u.uA.value[i] = 0
          u.uWA.value[i] = 0
          continue
        }
        const size = sp.r / 0.28
        const band = sp.mouth ? sp.mouth.band : sp.r >= 0.25 ? 0 : sp.r >= 0.15 ? 1 : 2
        const ph = sp.mouth ? sp.mouth.ph : live ? Math.min(1, (time - f.bandHit[band]) / dur[band]) : beatPhase
        const lvl = sp.mouth ? sp.mouth.lvl : live ? 0.35 + 0.9 * f.bandLvl[band] : 1
        u.uPh.value[i] = ph
        u.uSpd.value[i] = spd[band]
        u.uCol.value[i].copy(BAND_COL[band])
        u.uW.value[i].copy(sp.p)
        // a boca vale mesmo fora do club (a onda é da pessoa, não da música)
        u.uWA.value[i] = sp.mouth ? lvl * 0.6 : vol * lvl * (band === 0 ? 1 : 0.75)
        if (u.uWA.value[i] > 0.01) any = true
        const dist = sp.p.distanceTo(cam)
        vv.copy(sp.p).project(this.camera)
        // atrás da câmera (ou muito fora da tela): sem anel
        const ok = vv.z < 1 && Math.abs(vv.x) < 3 && Math.abs(vv.y) < 3
        u.uC.value[i].set(vv.x * 0.5 + 0.5, vv.y * 0.5 + 0.5)
        u.uA.value[i] = ok ? (sp.mouth ? lvl * 0.5 : vol * lvl * (0.35 + 0.65 * size)) : 0
        u.uR.value[i] = Math.max(0.5, Math.min(2.2, 16 / Math.max(1, dist))) * (0.55 + 0.45 * size)
        if (u.uA.value[i] > 0.01) any = true
      }
      // a profundidade vem do SSAO (sem ele, só a distorção na tela)
      u.uDepthOn.value = this.gtao.enabled ? 1 : 0
      u.tDepth.value = this.gtao.depthTexture
      u.uInvProj.value.copy(this.camera.projectionMatrixInverse)
      u.uCamWorld.value.copy(this.camera.matrixWorld)
      this.beatWarp.enabled = any
    }
    // vídeo e som nossos seguem o relógio do servidor todo quadro (sem esperar o iframe); vídeo avulso já sabe o id,
    // playlist pega o id do iframe (ele resolve a lista)
    {
      const cur = this.net.dj.cur
      const vid = cur ? (cur.item.kind === 'video' ? cur.item.video ?? '' : this.dj.videoId()) : ''
      this.feed.load(vid)
      this.feed.sync(this.net.djPosition(), !!cur)
    }
    // telão: CSS3D na mesma posição do furo; fica sempre na página (o player só existe depois de entrar no DOM)
    const sc = c.screen
    this.cssObj.visible = this.attached
    this.cssObj.position.set(sc.x, sc.y, sc.z)
    this.cssObj.scale.setScalar(sc.w / SCREEN_PX.w)
    if (performance.now() - this.djTickAt > 100) {
      this.djTickAt = performance.now()
      // volume cai com a distância até o telão (no club nunca abaixo de 15%); fora dele, a acústica do lugar
      // (corredor, terraço, hall, banheiro) baixa, abafa e muda o eco, com transição pela posição
      const d = Math.hypot(this.pos.x - sc.x, this.pos.z - sc.z, sc.y - EYE)
      let vol = 100 / (1 + (Math.max(0, d - 6) / 22) ** 1.3)
      const inClub = this.pos.x > 0 && this.pos.x < W && this.pos.z > 0 && this.pos.z < D
      if (inClub) vol = Math.max(15, vol)
      const ac = acousticsAt(this.seat ? this.seat.x : this.pos.x, this.seat ? this.seat.z : this.pos.z)
      this.acoustic = ac
      vol *= ac.vol
      const p = this.dj.player
      // som pelo nosso áudio: o iframe fica mudo (também enquanto sintoniza; mudo ele toca sozinho sem clique).
      // Na captura da aba quem toca é o iframe (só com volume: sem abafar nem eco)
      const ours = this.feed.ok && !this.feed.capturing
      if (ours && this.dj.ready && p && !p.isMuted()) p.mute()
      this.dj.tick(this.attached && !ours ? vol : 0)
      this.heard = this.attached ? vol / 100 : 0
      this.feed.mix(this.heard, ac.muffle, ac.verb)
      const vid = this.feed.id
      if (vid !== this.glowVideo) {
        this.glowVideo = vid
        this.loadScreenGlow(vid)
      } else if (!live) this.pickVideoFrame()
    }
  }

  // capa e quadros do vídeo (i.ytimg libera CORS): halo do telão e paleta quando o vídeo nosso não está no ar
  loadScreenGlow(vid: string) {
    const g = this.world.club.screenGlow
    this.palSets = []
    this.palImgs = []
    this.palIdx = -1
    if (!vid) {
      g.mat.opacity = 0
      this.glowColor = '#141826'
      this.palGoal.forEach((cc, i) => cc.set(CLUB_PAL[i]))
      return
    }
    ;['mqdefault', '1', '2', '3'].forEach((name, k) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (this.glowVideo !== vid) return
        this.palImgs[k] = img
        this.palSets[k] = videoPalette(img)
        this.palIdx = -1
        this.pickVideoFrame()
      }
      img.src = `https://i.ytimg.com/vi/${vid}/${name}.jpg`
    })
  }

  // vídeo nosso no ar: o próprio quadro vira o halo e a cor do telão na GI (5x/s) e a paleta do palco (a cada 2 s)
  liveFrame() {
    const now = performance.now()
    if (now - this.liveAt < 200) return
    this.liveAt = now
    const vid = this.feed.video
    const g = this.world.club.screenGlow
    const c = g.c
    const Wc = c.canvas.width
    const Hc = c.canvas.height
    c.filter = 'none'
    c.fillStyle = '#000'
    c.fillRect(0, 0, Wc, Hc)
    c.filter = 'blur(10px) saturate(1.4)'
    c.drawImage(vid, 16, 16, Wc - 32, Hc - 32)
    c.filter = 'none'
    g.tex.needsUpdate = true
    g.mat.opacity = 0.35
    const s1 = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    s1.canvas.width = s1.canvas.height = 1
    s1.drawImage(vid, 0, 0, 1, 1)
    const [r, gg, b] = s1.getImageData(0, 0, 1, 1).data
    this.glowColor = `rgb(${r},${gg},${b})`
    {
      const cc = new THREE.Color().setRGB(r / 255, gg / 255, b / 255, THREE.SRGBColorSpace)
      const lum = 0.2126 * cc.r + 0.7152 * cc.g + 0.0722 * cc.b
      const mx = Math.max(cc.r, cc.g, cc.b, 0.02)
      this.screenGoal.color.copy(cc).multiplyScalar(1 / mx)
      this.screenGoal.k = 3 + 40 * lum
    }
    // luz que sobe da manta: o vídeo borrado em 32 x 32 sobre o chão do club
    const fl = this.floorLight
    fl.c.filter = 'blur(1.5px)'
    fl.c.drawImage(vid, 0, 0, 32, 32)
    fl.c.filter = 'none'
    fl.t.needsUpdate = true
    // 10 x 5 amostras do vídeo viram a luz de cada metro da pista na GI
    const m1 = this.mantaCtx
    m1.drawImage(vid, 0, 0, 10, 5)
    const px = m1.getImageData(0, 0, 10, 5).data
    for (let i = 0; i < 50; i++) this.world.club.led.cols[i].setRGB(px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 2] / 255, THREE.SRGBColorSpace)
    if (now - this.livePalAt > 2000) {
      this.livePalAt = now
      const set = videoPalette(vid)
      if (set) this.palGoal.forEach((cc, i) => cc.copy(set[i]))
    }
  }

  // Quadros do bar: a cada ~15 s guarda um frame do vídeo (até 30, o mais velho sai); a cada ~4 s um quadro
  // sorteado troca para um frame que nenhum outro quadro está mostrando, recortado no formato dele.
  // ---------- fotógrafo, quadros e álbum ----------

  // lista inteira (ao entrar): os quadros mostram as mais novas
  setPhotos(list: NetPhoto[]) {
    this.photos = [...list].sort((a, b) => a.at - b.at)
    const pics = this.world.club.pictures
    this.wall = pics.map(() => null)
    this.photos.slice(-pics.length).forEach((ph, i) => this.showOnWall(i, ph.id))
    if (this.albumBook) this.albumBook.dirty = true
  }

  // foto nova: entra no quadro da foto mais velha da parede (a que sai vai para o álbum)
  addPhoto(p: NetPhoto) {
    if (this.photos.some((x) => x.id === p.id)) return
    this.photos.push(p)
    const pics = this.world.club.pictures
    if (this.wall.length !== pics.length) this.wall = pics.map(() => null)
    let slot = this.wall.indexOf(null)
    if (slot < 0) {
      const order = new Map(this.photos.map((ph, i) => [ph.id, i]))
      slot = this.wall.reduce((best, id, i) => ((order.get(id ?? '') ?? -1) < (order.get(this.wall[best] ?? '') ?? -1) ? i : best), 0)
    }
    this.showOnWall(slot, p.id)
    if (this.albumBook) this.albumBook.dirty = true
  }

  // fotos do álbum: as que não estão na parede, da mais velha para a mais nova
  albumPhotos() {
    const on = new Set(this.wall)
    return this.photos.filter((p) => !on.has(p.id))
  }

  showOnWall(i: number, id: string) {
    this.wall[i] = id
    const pic = this.world.club.pictures[i]
    if (!pic) return
    const draw = (img: HTMLImageElement) => {
      if (this.wall[i] !== id) return
      const c = pic.c
      const W2 = c.canvas.width
      const H2 = c.canvas.height
      // recorte "cover" centrado: preenche o quadro sem distorcer
      const s = Math.max(W2 / img.width, H2 / img.height)
      const sw = W2 / s
      const sh = H2 / s
      c.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W2, H2)
      pic.tex.needsUpdate = true
    }
    let img = this.photoImgs.get(id)
    if (img?.complete && img.naturalWidth) return draw(img)
    if (!img) {
      img = new Image()
      img.src = `/mp/photos/${id}.jpg`
      this.photoImgs.set(id, img)
    }
    img.addEventListener('load', () => draw(img), { once: true })
  }

  spawnPhotographer() {
    const id = 'npc-fotografo'
    const p = compactRig(makePerson(id, 'revisor'))
    // câmera na mão direita: corpo, lente para a frente e o flash em cima
    const cam = new THREE.Group()
    cam.position.set(0, -0.42, 0.05)
    rb(cam, 0, 0, 0, 0.13, 0.085, 0.07, 0.012, std('#1f2937', 0.45, 0.2))
    const lens = cyl(cam, 0, 0, 0, 0.032, 0.07, std('#111827', 0.3, 0.4))
    lens.rotation.x = Math.PI / 2
    lens.position.set(0, 0, 0.065)
    rb(cam, -0.035, 0.06, 0, 0.04, 0.03, 0.03, 0.005, std('#e5e7eb', 0.3, 0.2))
    p.foreR.add(cam)
    this.photoCam = cam
    this.npcGroup.add(p.root)
    this.hookGi(p.root)
    tagHits(p.root, { kind: 'npc', id, label: 'Fotógrafo Téo', sub: 'tirando fotos da festa' }, this.world.hits)
    this.photographer = p
  }

  // TV na lateral direita, virada para a pista: moldura, pedestal e a tela com pontos de LED
  buildDjTv() {
    const rt = new THREE.WebGLRenderTarget(320, 180, { type: THREE.HalfFloatType })
    // grande-angular: pega a pista inteira do ponto de vista dele
    const cam = new THREE.PerspectiveCamera(100, 16 / 9, 0.1, 300)
    this.djTv = { rt, cam, frame: 0, q: new THREE.Quaternion(), init: false }
    const g = new THREE.Group()
    g.position.set(W - 0.45, 0, 17.5)
    g.rotation.y = -Math.PI / 2
    const tw = 3.6
    const th = 2.025
    const cy = 2.75
    const dark = std('#26262c', 0.5, 0.3)
    rb(g, 0, cy, -0.06, tw + 0.16, th + 0.16, 0.1, 0.03, dark)
    for (const sx of [-1.05, 1.05]) rb(g, sx, (cy - th / 2) / 2, -0.06, 0.08, cy - th / 2, 0.08, 0.02, dark)
    rb(g, 0, 0.03, -0.06, 2.6, 0.06, 0.55, 0.02, dark)
    // tela: cada célula de 2 x 2 pixels vira um LED redondo (cor da célula, brilho acima do branco para o bloom)
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: rt.texture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
uniform sampler2D map;
varying vec2 vUv;
void main() {
  vec2 grid = vec2(160.0, 90.0);
  vec2 cell = floor(vUv * grid);
  vec2 f = fract(vUv * grid) - 0.5;
  // brilho igual ao da cena (a captura já está na mesma escala; o tone mapping da tela vale para os dois): só a
  // máscara dos pontos de LED, nunca acima de 1x (ganho extra estourava o bloom). Como uma TV de verdade, a imagem
  // não passa do branco da tela
  vec3 c = min(texture2D(map, (cell + 0.5) / grid).rgb, vec3(1.0));
  float led = smoothstep(0.5, 0.28, length(f));
  gl_FragColor = vec4(c * (0.3 + 0.7 * led), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      toneMapped: true,
    })
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), mat)
    screen.position.set(0, cy, 0)
    g.add(screen)
    // plaquinha embaixo
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.14), glow('#f472b6', 0.9))
    tag.position.set(0, cy - th / 2 - 0.16, 0.001)
    g.add(tag)
    this.scene.add(g)
    this.world.colliders.push({ x0: W - 0.85, x1: W, z0: 17.5 - 1.4, z1: 17.5 + 1.4, level: 0 })
  }

  // renderiza o que o DJ vê (sem o próprio DJ e sem refazer as sombras). A câmera vai nos olhos dele e segue a
  // cabeça com atraso (slerp): ele balança no ritmo, e a imagem não pode tremer junto
  stepDjTv(dt: number) {
    const tv = this.djTv
    if (!tv) return
    const head = this.djRig?.head
    const mx = this.world.club.maestro
    const want = new THREE.Quaternion()
    const at = new THREE.Vector3(mx.x, 2.25, mx.z + 0.5)
    if (head) {
      // só a rotação vem da cabeça (o "head" do boneco do Meshy é um guia de rotação: a posição dele não é a da
      // cabeça de verdade, e a câmera ficava dentro do boneco); o olho fica fixo na frente do rosto
      head.updateWorldMatrix(true, false)
      head.getWorldQuaternion(want)
      // a cabeça olha para +z; a câmera, para -z
      want.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI))
    } else want.setFromRotationMatrix(new THREE.Matrix4().lookAt(at, new THREE.Vector3(mx.x, 1.2, 12), new THREE.Vector3(0, 1, 0)))
    if (!tv.init) {
      tv.q.copy(want)
      tv.init = true
    }
    tv.q.slerp(want, 1 - Math.exp(-dt * 2.5))
    tv.cam.position.copy(at)
    tv.cam.quaternion.copy(tv.q)
    if (++tv.frame % 3) return
    const dj = this.djRig
    const djVis = dj?.root.visible ?? false
    if (dj) dj.root.visible = false
    // os feixes do palco nascem do lado do DJ: olhando por dentro deles a luz aditiva soma e estoura a imagem
    const beams = this.world.club.beams
    const beamVis = beams.map((b) => b.visible)
    for (const b of beams) b.visible = false
    const vis = this.viewItems.map((v) => v?.visible ?? false)
    for (const v of this.viewItems) if (v) v.visible = false
    const sr = this.selfRig
    const selfVis = sr?.root.visible ?? false
    if (sr) sr.root.visible = true
    const auto = this.renderer.shadowMap.autoUpdate
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.setRenderTarget(tv.rt)
    this.renderer.render(this.scene, tv.cam)
    this.renderer.setRenderTarget(null)
    this.renderer.shadowMap.autoUpdate = auto
    if (dj) dj.root.visible = djVis
    beams.forEach((b, i) => {
      b.visible = beamVis[i]
    })
    if (sr) sr.root.visible = selfVis
    this.viewItems.forEach((v, i) => {
      if (v) v.visible = vis[i]
    })
  }

  // balcão do álbum no canto do fundo à direita, virado 45 graus para o centro: pedestal e o álbum aberto em cima,
  // com as fotos da primeira página de verdade (clique abre)
  buildAlbumStand() {
    const x = W - 1.3
    const z = D - 2.3
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    // frente do pedestal (+z local) apontando para o centro do club
    g.rotation.y = Math.atan2(W / 2 - x, D / 2 - z)
    const wood = std('#6b4f3a', 0.6)
    rb(g, 0, 0.5, 0, 0.9, 1, 0.55, 0.03, wood)
    rb(g, 0, 1.02, 0, 1, 0.04, 0.62, 0.015, std('#3a3a42', 0.25, 0.25))
    // álbum aberto, a borda de trás mais alta (para quem chega pela frente)
    const book = new THREE.Group()
    book.position.set(0, 1.06, 0.02)
    book.rotation.x = 0.22
    rb(book, 0, 0.012, 0, 0.7, 0.024, 0.46, 0.008, std('#7f1d1d', 0.7))
    const cv = document.createElement('canvas')
    cv.width = 1024
    cv.height = 672
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const pages = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.433), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }))
    pages.rotation.x = -Math.PI / 2
    pages.position.y = 0.026
    book.add(pages)
    g.add(book)
    this.scene.add(g)
    this.hookGi(g)
    tagHits(g, { kind: 'album', label: 'Álbum de fotos', sub: 'clique ou E para folhear as fotos antigas do fotógrafo' }, this.world.hits)
    this.world.colliders.push({ x0: x - 0.55, x1: x + 0.55, z0: z - 0.55, z1: z + 0.55, level: 0 })
    this.albumBook = { c: cv.getContext('2d')!, tex, x, z, dirty: true }
  }

  // páginas do álbum 3D: as 4 fotos mais recentes do álbum (a mesma abertura que abre ao interagir); só desenha
  // quando muda e eu estou perto ou mirando nele
  stepAlbumBook() {
    const ab = this.albumBook
    if (!ab?.dirty) return
    const near = Math.hypot(this.pos.x - ab.x, this.pos.z - ab.z) < 8 || this.hover?.kind === 'album'
    if (!near) return
    ab.dirty = false
    const c = ab.c
    const Wc = c.canvas.width
    const Hc = c.canvas.height
    c.fillStyle = '#f5efe3'
    c.fillRect(0, 0, Wc, Hc)
    // lombada
    const sp = c.createLinearGradient(Wc / 2 - 40, 0, Wc / 2 + 40, 0)
    sp.addColorStop(0, 'rgba(0,0,0,0)')
    sp.addColorStop(0.5, 'rgba(0,0,0,0.28)')
    sp.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = sp
    c.fillRect(Wc / 2 - 40, 0, 80, Hc)
    const list = [...this.albumPhotos()].sort((a, b) => b.at - a.at).slice(0, 4)
    if (!list.length) {
      c.fillStyle = '#78716c'
      c.font = `28px ${FONT}`
      c.textAlign = 'center'
      c.fillText('Ainda sem fotos antigas', Wc / 4, Hc / 2)
      c.fillText('as novas estão nos quadros', (Wc * 3) / 4, Hc / 2)
    }
    list.forEach((ph, k) => {
      // ordem igual à do álbum: página esquerda (2 fotos), depois a direita
      const page = Math.floor(k / 2)
      const row = k % 2
      const pw = 360
      const phh = 240
      const fx = page * (Wc / 2) + (Wc / 2 - pw) / 2
      const fy = 30 + row * 316
      const tilt = (row ? 1 : -1) * (page ? -0.022 : 0.02)
      c.save()
      c.translate(fx + pw / 2, fy + 150)
      c.rotate(tilt)
      c.translate(-(fx + pw / 2), -(fy + 150))
      c.shadowColor = 'rgba(0,0,0,0.25)'
      c.shadowBlur = 10
      c.fillStyle = '#ffffff'
      c.fillRect(fx - 14, fy - 14, pw + 28, phh + 58)
      c.shadowBlur = 0
      const img = this.photoImgs.get(ph.id)
      if (img?.complete && img.naturalWidth) {
        const s = Math.max(pw / img.width, phh / img.height)
        const sw = pw / s
        const sh = phh / s
        c.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, fx, fy, pw, phh)
      } else {
        c.fillStyle = '#d6d3d1'
        c.fillRect(fx, fy, pw, phh)
        if (!img) {
          const im = new Image()
          im.src = `/mp/photos/${ph.id}.jpg`
          this.photoImgs.set(ph.id, im)
          im.addEventListener('load', () => {
            if (this.albumBook) this.albumBook.dirty = true
          }, { once: true })
        }
      }
      const d = new Date(ph.at)
      c.fillStyle = '#78716c'
      c.font = `20px ui-monospace, monospace`
      c.textAlign = 'center'
      c.fillText(`${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, fx + pw / 2, fy + phh + 30)
      c.restore()
    })
    ab.tex.needsUpdate = true
  }

  // fotógrafo pelo relógio do servidor: anda, levanta a câmera, dispara (flash para todos; a foto sai de um
  // jogador só: o de menor id online)
  stepPhotographer(dt: number) {
    const p = this.photographer
    if (!p) return
    const t = this.net.serverNow() / 1000
    const st = this.photog.at(t)
    p.root.position.set(st.x, 0, st.z)
    p.root.rotation.y = turn(p.root.rotation.y, st.rot, dt * 6)
    this.photoWalkT += st.walking ? dt : 0
    poseWalk(p, st.walking, this.photoWalkT, 1 - Math.exp(-dt * 10))
    // câmera no rosto: os dois braços sobem
    if (st.aim > 0) {
      p.armR.rotation.x = -1.35 * st.aim
      p.foreR.rotation.x = -0.25 - 1.05 * st.aim
      p.armL.rotation.x = -1.2 * st.aim
      p.armL.rotation.z = -0.35 * st.aim
      p.foreL.rotation.x = -0.25 - 1.2 * st.aim
      p.head.rotation.x = 0.1 * st.aim
    } else p.armL.rotation.z = 0
    if (this.photoCam) this.photoCam.rotation.x = -(p.armR.rotation.x + p.foreR.rotation.x)
    // flash: some em ~0,25 s
    const since = t - this.flashAt
    this.flash.intensity = since < 0.25 ? 60 * (1 - since / 0.25) : 0
    if (t >= st.shootAt && t - st.shootAt < 2 && this.shotSlot !== st.slot) {
      this.shotSlot = st.slot
      this.flashAt = t
      const head = new THREE.Vector3(st.x, 1.62, st.z)
      this.flash.position.copy(head)
      this.flash.intensity = 60
      const ids = [...this.remotes.keys()]
      if (this.net.online && this.net.id && ids.every((id) => id > this.net.id)) this.takePhoto(st.slot, head, new THREE.Vector3(...st.look))
    }
  }
  photoWalkT = 0

  // quem dá para fotografar: NPCs da festa, os outros jogadores e eu (altura da cabeça, em pé ou sentado)
  photoPeople(): Person[] {
    const out: Person[] = []
    for (const n of this.npcs.values()) out.push({ id: n.id, x: n.x, z: n.z, head: n.y + (n.sit > 0.5 ? 0.9 : 1.2), face: n.p.root.rotation.y })
    for (const [id, rm] of this.remotes) out.push({ id: `p${id}`, x: rm.tx, z: rm.tz, head: rm.ty + (rm.sit ? 0.9 : 1.2), face: rm.tyaw })
    if (this.net.id) {
      // eu: virado para onde olho (o boneco tem a frente em +z; a câmera olha para -z)
      const yaw = this.seat ? this.seat.rot : new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ').y + Math.PI
      out.push({ id: `p${this.net.id}`, x: this.pos.x, z: this.pos.z, head: (this.seat ? this.seat.y - 0.47 : this.floorY) + (this.seat ? 0.9 : 1.2), face: yaw })
    }
    return out
  }

  // renderiza a foto pela câmera principal (com todos os efeitos), no ponto de vista do fotógrafo; eu apareço nela
  // (meu boneco fica visível só nessa hora) e os itens na minha mão não
  takePhoto(slot: number, from: THREE.Vector3, to: THREE.Vector3) {
    if (!this.attached || document.hidden) return
    const cam = this.camera
    const saved = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov }
    const sr = this.selfRig
    const selfVis = sr?.root.visible ?? false
    const vis = this.viewItems.map((v) => v?.visible ?? false)
    for (const v of this.viewItems) if (v) v.visible = false
    if (sr) sr.root.visible = true
    if (this.photographer) this.photographer.root.visible = false
    // um passo para a frente do rosto (a cabeça dele não entra na foto)
    const dir = to.clone().sub(from).normalize()
    cam.position.copy(from).addScaledVector(dir, 0.25)
    cam.lookAt(to)
    cam.fov = 55
    cam.updateProjectionMatrix()
    this.composer.render(0)
    const src = this.renderer.domElement
    const cw = src.width
    const ch = src.height
    let w = cw
    let h = Math.round(cw / 1.5)
    if (h > ch) {
      h = ch
      w = Math.round(ch * 1.5)
    }
    const out = document.createElement('canvas')
    out.width = 960
    out.height = 640
    out.getContext('2d')!.drawImage(src, (cw - w) / 2, (ch - h) / 2, w, h, 0, 0, 960, 640)
    cam.position.copy(saved.p)
    cam.quaternion.copy(saved.q)
    cam.fov = saved.fov
    cam.updateProjectionMatrix()
    if (sr) sr.root.visible = selfVis
    if (this.photographer) this.photographer.root.visible = true
    this.viewItems.forEach((v, i) => {
      if (v) v.visible = vis[i]
    })
    out.toBlob((b) => {
      if (b) void fetch(`/mp/photos?slot=${slot}`, { method: 'POST', body: b, headers: { 'content-type': 'image/jpeg' } }).catch(() => {})
    }, 'image/jpeg', 0.85)
  }

  // quadro publicado mais perto do momento do vídeo: halo, cor do telão na GI e paleta
  pickVideoFrame() {
    const dur = this.dj.duration()
    const t = dur > 0 ? this.dj.time() / dur : 0
    const want = t < 0.125 ? 0 : t < 0.375 ? 1 : t < 0.625 ? 2 : 3
    let k = -1
    for (const d of [0, -1, 1, -2, 2, -3, 3]) {
      const i = want + d
      if (this.palImgs[i]) {
        k = i
        break
      }
    }
    if (k < 0 || k === this.palIdx) return
    this.palIdx = k
    const img = this.palImgs[k]!
    const set = this.palSets[k]
    if (set) this.palGoal.forEach((cc, i) => cc.copy(set[i]))
    const g = this.world.club.screenGlow
    const c = g.c
    const Wc = c.canvas.width
    const Hc = c.canvas.height
    c.filter = 'none'
    c.fillStyle = '#000'
    c.fillRect(0, 0, Wc, Hc)
    c.filter = 'blur(10px) saturate(1.4)'
    c.drawImage(img, 16, 16, Wc - 32, Hc - 32)
    c.filter = 'none'
    g.tex.needsUpdate = true
    g.mat.opacity = 0.45
    const s1 = document.createElement('canvas').getContext('2d')!
    s1.canvas.width = s1.canvas.height = 1
    s1.drawImage(img, 0, 0, 1, 1)
    const [r, gg, b] = s1.getImageData(0, 0, 1, 1).data
    this.glowColor = `rgb(${r},${gg},${b})`
  }

  // anexos: as 4 luzes mais perto da câmera, o espelho do banheiro onde ela está e a fumaça
  stepAnnex(dt: number, time: number) {
    const cam = this.camera.position
    const an = this.world.annex
    // luzes dos anexos e os pendentes do bar
    const cands = [...an.lights, ...this.world.club.lamps.map((p) => ({ p, color: '#ffcf8a', intensity: 14, distance: 8 }))]
    const near = cands.map((l) => ({ l, d: l.p.distanceTo(cam) })).sort((a, b) => a.d - b.d)
    this.zoneLights.forEach((zl, i) => {
      const it = near[i]
      if (!it || it.d > 30) {
        zl.intensity = 0
        return
      }
      zl.position.copy(it.l.p)
      zl.color.set(it.l.color)
      zl.distance = it.l.distance
      // aquecedor tremula um pouco
      zl.intensity = it.l.intensity * (it.l.color === '#ff9a50' ? 0.92 + Math.sin(time * 7 + i) * 0.08 : 1)
    })
    for (const m of an.mirrors) m.mesh.visible = inRoom(m, this.pos.x, this.pos.z)
    // cinzeiros soltam um fio de fumaça
    if (time - this.smokeAt > 0.7) {
      this.smokeAt = time
      for (const a of an.ashtrays) this.puff(a, 1)
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i]
      s.age += dt
      const k = s.age / s.life
      if (k >= 1) {
        this.scene.remove(s.s)
        ;(s.s.material as THREE.SpriteMaterial).dispose()
        this.smoke.splice(i, 1)
        continue
      }
      s.s.position.addScaledVector(s.v, dt)
      s.v.x += Math.sin(time * 1.3 + i) * 0.02 * dt
      const sc = 0.12 + k * 0.7
      s.s.scale.set(sc, sc, 1)
      ;(s.s.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.22
    }
  }

  // baforada: n bolinhas de fumaça subindo
  puff(at: THREE.Vector3, n: number) {
    if (this.smoke.length > 120) return
    for (let k = 0; k < n; k++) {
      const m = new THREE.SpriteMaterial({ map: beamTex(), color: '#d4d4dc', transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
      const s = new THREE.Sprite(m)
      s.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.05, k * 0.03, (Math.random() - 0.5) * 0.05))
      s.userData.ui = true
      this.scene.add(s)
      this.smoke.push({ s, v: new THREE.Vector3((Math.random() - 0.5) * 0.08, 0.28 + Math.random() * 0.12, (Math.random() - 0.5) * 0.08), age: 0, life: 2.6 + Math.random() * 1.4 })
    }
  }

  // 4 luzes coloridas pulsando no ritmo e a fogueira mais perto da câmera (a GI 2D não passa de 1 por texel)
  placeLights() {
    const cam = this.camera.position
    const t = performance.now() / 1000
    const beat = t * (125 / 60)
    const n = this.clubLights.length - 1
    this.clubLights.forEach((l, i) => {
      if (i === n) return
      l.position.set(((i + 0.5) / n) * W, 3.2, D / 2)
      l.color.copy(this.pal[i % this.pal.length])
      l.intensity = 10 + Math.max(0, Math.sin(beat * Math.PI + i)) * 14
    })
    const fire = this.clubLights[n]
    let best: Club['glows'][number] | null = null
    for (const g of this.world.club.glows) if (g.fire && (!best || Math.hypot(g.x - cam.x, g.z - cam.z) < Math.hypot(best.x - cam.x, best.z - cam.z))) best = g
    if (best) {
      fire.position.set(best.x, 0.9, best.z)
      fire.color.set('#ff8a3d')
      fire.distance = 8
      fire.intensity = 14 + Math.sin(t * 13 + best.x) * 2 + Math.sin(t * 29) * 1
    } else fire.intensity = 0
  }

  // ---------- NPCs: pose da festa no ritmo ----------

  updateNpcs(dt: number, time: number) {
    const now = performance.now()
    for (const n of this.npcs.values()) {
      n.fade = Math.min(1, n.fade + dt / 1.2)
      this.poseNpc(n, time, dt)
      if (n.bubble?.visible && now > (n.bubbleUntil ?? 0)) n.bubble.visible = false
      n.hands?.forEach((h, side) => {
        if (!h || h === 'busy') return
        if (time > h.nextSip) {
          h.nextSip = time + 6 + Math.random() * 6
          h.sipUntil = time + 0.9
          h.left--
        }
        const sip = h.sipUntil > time ? 1 - (h.sipUntil - time) / 0.9 : 0
        holdPose(n.p, side, h.obj, sip)
        if (h.left <= 0 && h.sipUntil < time) {
          h.obj.removeFromParent()
          n.hands![side] = null
        }
      })
    }
    const r = this.djRig
    if (r) {
      const mx = this.world.club.maestro
      r.root.position.set(mx.x, 0.34, mx.z)
      r.root.rotation.y = 0
      this.poseDj(r, time)
      ;(r as PersonRig & { sync?: () => void }).sync?.()
    }
  }

  // pose-alvo da atividade e crossfade de ~0,45 s quando ela muda (a pista para sem música)
  poseNpc(n: Npc, time: number, dt: number) {
    const p = n.p
    p.root.position.set(n.x, n.y + n.lift * n.sit, n.z)
    p.root.rotation.y = n.rot
    const f = n.fade
    p.root.scale.set(1, Math.max(0.001, f * f * (3 - 2 * f)), 1)
    p.body.position.y = -SIT_DROP * n.sit
    p.hipL.rotation.x = (-Math.PI / 2) * n.sit
    p.hipR.rotation.x = (-Math.PI / 2) * n.sit
    p.kneeL.rotation.x = (Math.PI / 2) * n.sit
    p.kneeR.rotation.x = (Math.PI / 2) * n.sit
    p.upper.rotation.set(0, 0, 0)
    p.head.rotation.set(0, 0, 0)
    p.armL.rotation.set(0, 0, 0)
    p.armR.rotation.set(0, 0, 0)
    p.foreL.rotation.set(0, 0, 0)
    p.foreR.rotation.set(0, 0, 0)
    p.lens.visible = false
    // tronco+pernas, braços e cabeça em radianos (1 ciclo por ataque da faixa sorteada para cada parte)
    const lo = this.grooveB[n.bands[0]] * Math.PI * 2
    const mid = this.grooveB[n.bands[1]] * Math.PI * 2
    const hi = this.grooveB[n.bands[2]] * Math.PI * 2
    const act = n.party === 'dance' && !this.musicOn ? 'chat' : n.party
    switch (act) {
      case 'bartend': {
        // anda devagar de um lado para o outro; parado, chacoalha a coqueteleira (no ritmo, se tiver música)
        const wk = n.walk!
        const u = Math.sin(time * 0.18 + n.phase)
        n.x = wk.x0 + (wk.x1 - wk.x0) * (0.5 + 0.5 * u)
        const moving = Math.abs(Math.cos(time * 0.18 + n.phase)) > 0.35
        n.rot = moving ? (Math.cos(time * 0.18 + n.phase) > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.PI
        p.root.position.x = n.x
        p.root.rotation.y = n.rot
        if (moving) {
          const sw = Math.sin(time * 6 + n.phase)
          p.hipL.rotation.x = sw * 0.4
          p.hipR.rotation.x = -sw * 0.4
          p.kneeL.rotation.x = Math.max(0, -sw) * 0.6
          p.kneeR.rotation.x = Math.max(0, sw) * 0.6
          p.armL.rotation.x = -sw * 0.35
          p.armR.rotation.set(-1.2, 0, 0.2)
          p.foreR.rotation.x = -1.2
          break
        }
        const shake = Math.sin((this.musicOn ? mid * 2 : time * 16) + n.phase)
        p.upper.rotation.x = 0.05
        p.armR.rotation.set(-2.1 + shake * 0.22, 0, -0.35)
        p.foreR.rotation.x = -1.7 + shake * 0.15
        p.armL.rotation.set(-1.9 - shake * 0.22, 0, 0.45)
        p.foreL.rotation.x = -1.8
        p.head.rotation.x = 0.1
        p.head.rotation.y = Math.sin(time * 0.7 + n.phase) * 0.25
        break
      }
      case 'smoke': {
        // em pé, de papo; de vez em quando leva o cigarro à boca e solta a fumaça
        const drag = Math.max(0, Math.sin(time * 0.45 + n.phase * 2)) ** 8
        p.upper.rotation.x = -0.03
        p.armR.rotation.set(-0.55 - drag * 1.25, 0, 0.15 + drag * 0.2)
        p.foreR.rotation.x = -1.3 - drag * 0.9
        p.armL.rotation.set(-0.25, 0, -0.15)
        p.foreL.rotation.x = -0.5
        p.head.rotation.x = -drag * 0.15
        p.head.rotation.y = Math.sin(time * 0.6 + n.phase) * 0.3
        p.body.position.y += Math.abs(Math.sin(lo / 2)) * 0.01
        // baforada logo depois da tragada
        const k = (time * 0.45 + n.phase * 2) % (Math.PI * 2)
        if (k > Math.PI * 0.62 && k < Math.PI * 0.62 + dt * 0.45) this.puff(new THREE.Vector3(n.x + Math.sin(n.rot) * 0.2, 1.55, n.z + Math.cos(n.rot) * 0.2), 3)
        break
      }
      case 'dance': {
        const l2 = lo / 2 + n.phase
        p.body.position.y += Math.abs(Math.sin(l2)) * 0.09
        p.upper.rotation.z = Math.sin(l2) * 0.12
        p.upper.rotation.y = Math.sin(l2 / 2) * 0.25
        p.hipL.rotation.x = Math.max(0, Math.sin(l2)) * -0.35
        p.hipR.rotation.x = Math.max(0, -Math.sin(l2)) * -0.35
        p.kneeL.rotation.x += Math.max(0, Math.sin(l2)) * 0.5
        p.kneeR.rotation.x += Math.max(0, -Math.sin(l2)) * 0.5
        // braços inteiros: quem fica no alto troca a cada ~8 ataques da faixa dos braços
        const m2 = mid / 2 + n.phase
        const up = Math.sin(this.grooveB[n.bands[1]] * 0.4 + n.phase) > 0
        p.armL.rotation.x = up ? -2.6 + Math.sin(m2) * 0.3 : -0.6 + Math.sin(m2) * 0.4
        p.armR.rotation.x = up ? -0.6 - Math.sin(m2) * 0.4 : -2.6 - Math.sin(m2) * 0.3
        p.armL.rotation.z = -0.3
        p.armR.rotation.z = 0.3
        p.foreL.rotation.x = -0.5 + Math.sin(m2 * 2) * 0.25
        p.foreR.rotation.x = -0.5 - Math.sin(m2 * 2) * 0.25
        p.head.rotation.x = Math.sin(hi + n.phase) * 0.15
        p.head.rotation.z = Math.sin(hi / 2 + n.phase) * 0.08
        break
      }
      case 'sit':
        // relaxado no sofá, braço apoiado, cabeça acompanhando a música
        p.upper.rotation.x = -0.22
        p.armL.rotation.set(-0.3, 0, -0.7)
        p.foreL.rotation.x = -0.4
        p.armR.rotation.x = -0.45
        p.foreR.rotation.x = -1.2
        p.head.rotation.x = Math.sin(hi / 2 + n.phase) * 0.08
        p.head.rotation.y = Math.sin(time * 0.3 + n.phase) * 0.35
        break
      case 'bar': {
        // no balcão: de vez em quando leva o copo à boca
        const sip = Math.max(0, Math.sin(time * 0.5 + n.phase * 3)) ** 6
        p.upper.rotation.x = 0.08
        p.armL.rotation.x = -0.65
        p.foreL.rotation.x = -1.1
        p.armR.rotation.x = -0.7 - sip * 0.9
        p.foreR.rotation.x = -1.2 - sip * 1.0
        p.head.rotation.x = -sip * 0.25
        p.head.rotation.y = Math.sin(time * 0.4 + n.phase) * 0.3
        break
      }
      default:
        // rodinha em pé conversando
        p.upper.rotation.x = -0.04
        p.head.rotation.x = Math.sin(time * 4 + n.phase) * 0.07
        p.head.rotation.y = Math.sin(time * 0.8 + n.phase) * 0.25
        p.armL.rotation.x = -0.9 + Math.sin(time * 2.6 + n.phase) * 0.35
        p.armL.rotation.z = -0.3
        p.foreL.rotation.x = -0.9
        p.armR.rotation.x = -0.35
        p.foreR.rotation.x = -1.4
        p.body.position.y += Math.abs(Math.sin(lo / 2)) * 0.02
    }
    // crossfade da pose
    const joints = [p.upper, p.head, p.armL, p.armR, p.foreL, p.foreR, p.hipL, p.hipR, p.kneeL, p.kneeR]
    const tgt: number[] = []
    for (const j of joints) tgt.push(j.rotation.x, j.rotation.y, j.rotation.z)
    tgt.push(p.body.position.y)
    const b = n.blend
    if (act !== b.key) {
      b.from = b.out.length ? b.out.slice() : tgt.slice()
      b.key = act
      b.t = 0
    }
    b.t = Math.min(1, b.t + dt / 0.45)
    const w = b.t * b.t * (3 - 2 * b.t)
    const out = w >= 1 ? tgt : tgt.map((x, i) => b.from[i] + (x - b.from[i]) * w)
    joints.forEach((j, i) => j.rotation.set(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]))
    p.body.position.y = out[out.length - 1]
    b.out = out
  }

  // DJ: corpo no grave, cabeça no agudo, braço do mixer no médio; parado sem música
  poseDj(p: PersonRig, time: number) {
    const beat = this.groove * Math.PI * 2
    const on = this.musicOn ? 1 : 0
    const lo = this.grooveB[0] * Math.PI * 2
    const mid = this.grooveB[1] * Math.PI * 2
    const hi = this.grooveB[2] * Math.PI * 2
    const phone = Math.sin(time * 0.35) > 0.55
    for (const j of [p.upper, p.head, p.armL, p.armR, p.foreL, p.foreR, p.hipL, p.hipR, p.kneeL, p.kneeR]) j.rotation.set(0, 0, 0)
    p.body.position.y = Math.abs(Math.sin(lo / 2)) * 0.05 * on
    p.head.rotation.x = 0.12 + Math.sin(hi) * 0.12 * on
    p.upper.rotation.x = 0.12
    p.upper.rotation.z = Math.sin(beat / 4) * 0.05
    p.armR.rotation.x = -0.75 + Math.sin(mid / 2) * 0.08 * on
    p.armR.rotation.z = 0.12
    p.foreR.rotation.x = -0.75 + Math.sin(time * 6) * 0.15
    if (phone) {
      p.armL.rotation.set(-0.3, 0, -1.9)
      p.foreL.rotation.x = -2.2
      p.head.rotation.z = -0.15
    } else {
      p.armL.rotation.x = -0.8 + Math.sin(beat / 2 + 1) * 0.1
      p.armL.rotation.z = -0.15
      p.foreL.rotation.x = -0.7 + Math.sin(time * 3.3) * 0.2
    }
  }

  // ---------- multiplayer ----------

  stepNet(dt: number) {
    const now = performance.now()
    if (now - this.netSentAt > 80) {
      this.netSentAt = now
      const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ')
      const moving = this.active && this.inputMove().mag > 0.1
      const st = this.seat
      this.net.send({ t: 'me', p: [this.pos.x, st ? st.y - 0.47 : this.floorY + this.jumpY, this.pos.z], yaw: st ? st.rot - Math.PI : this.emote ? this.emote.yaw : e.y, L: 0, moving: moving && !st, sit: !!st, emote: this.emote?.name ?? '', hands: this.hands.map((h) => h?.kind ?? ''), vomit: this.vomitUntil > performance.now() })
    }
    const k = 1 - Math.exp(-dt * 10)
    for (const [rid, rm] of this.remotes) {
      const root = rm.rig.root
      if (!rm.init) {
        root.position.set(rm.tx, rm.ty, rm.tz)
        root.rotation.y = rm.tyaw
        rm.init = true
      }
      root.position.x += (rm.tx - root.position.x) * k
      root.position.y += (rm.ty - root.position.y) * k
      root.position.z += (rm.tz - root.position.z) * k
      root.rotation.y = turn(root.rotation.y, rm.tyaw, dt * 10)
      if (rm.bubbleUntil && now > rm.bubbleUntil) {
        rm.bubble.visible = false
        rm.bubbleUntil = 0
      }
      const p = rm.rig
      // sentado: quadril e joelho a 90 graus, corpo desce
      if (rm.sit) {
        poseSit(p, k)
        rm.handObjs.forEach((o, side) => o && holdPose(p, side, o, 0))
        rm.tag.position.y = 2.25 - SIT_DROP
        rm.bubble.position.y = 2.75 - SIT_DROP
        continue
      }
      rm.tag.position.y = 2.25
      rm.bubble.position.y = 2.75
      // boca acompanha a voz (grave abre, médio estica, agudo treme); emote substitui o andar
      const vb = this.voice.bandsOf(rid)
      animateMouth(rm.rig, vb ? vb.lv : [0, 0, 0], now / 1000, this.voice.speaking(rid))
      if (rm.emote) {
        animateEmote(rm.rig, rm.emote, now / 1000 - rm.emoteT0, { lo: this.grooveB[0] * Math.PI * 2, mid: this.grooveB[1] * Math.PI * 2, hi: this.grooveB[2] * Math.PI * 2, music: this.musicOn })
        continue
      }
      // crachá verde enquanto a pessoa fala
      const sp = this.voice.speaking(rid)
      if (sp !== rm.speaking) {
        rm.speaking = sp
        drawTextSprite(rm.tag, rm.name, 'tag', sp ? '#4ade80' : '#ffffff')
      }
      // andar: pernas e braços balançando, parado volta ao neutro; mão com item fica à frente
      rm.walkT += rm.moving ? dt : 0
      poseWalk(p, rm.moving, rm.walkT, k)
      rm.handObjs.forEach((o, side) => o && holdPose(p, side, o, 0))
    }
  }

  // boneco de cada jogador: tipo e aparência sorteados pelo servidor (look), fixos enquanto ele estiver online
  syncRemotes(list: NetPlayer[]) {
    const seen = new Set<number>()
    for (const pl of list) {
      seen.add(pl.id)
      let rm = this.remotes.get(pl.id)
      // personagem trocou: refaz o boneco
      const avKey = pl.avatar ? JSON.stringify(pl.avatar) : `look${pl.look}`
      if (rm && rm.avKey !== avKey) {
        this.dropRemote(pl.id)
        rm = undefined
      }
      if (!rm) {
        const rig = pl.avatar ? makeAvatarPerson(`jogador-${pl.id}`, pl.avatar) : makePerson(`jogador-${pl.look}`, ROLES[pl.look % ROLES.length])
        rig.root.traverse((o) => {
          o.castShadow = true
        })
        this.remoteGroup.add(rig.root)
        this.hookGi(rig.root)
        const tag = textSprite(pl.name || `Jogador ${pl.id}`, 'tag')
        tag.position.y = 2.25
        rig.root.add(tag)
        const bubble = textSprite('', 'bubble')
        bubble.position.y = 2.75
        bubble.visible = false
        rig.root.add(bubble)
        const hit: Hit = { kind: 'player', id: String(pl.id), label: pl.name || `Jogador ${pl.id}` }
        tagHits(rig.root, hit, this.world.hits)
        rm = { rig, name: pl.name || `Jogador ${pl.id}`, tx: 0, ty: 0, tz: 0, tyaw: 0, moving: false, sit: false, walkT: 0, init: false, tag, bubble, bubbleUntil: 0, speaking: false, emote: '', emoteT0: 0, avKey: '', hands: ['', ''], handObjs: [null, null], hit, vomit: false }
        rm.avKey = avKey
        this.remotes.set(pl.id, rm)
      }
      const em = pl.emote ?? ''
      if (em !== rm.emote) {
        rm.emote = em
        rm.emoteT0 = performance.now() / 1000
      }
      rm.sit = pl.sit === true
      rm.vomit = pl.vomit === true
      const nm = pl.name || `Jogador ${pl.id}`
      if (nm !== rm.name) {
        rm.name = nm
        rm.hit.label = nm
        drawTextSprite(rm.tag, nm, 'tag')
      }
      // o que ele segura em cada mão
      const hs = pl.hands ?? ['', '']
      for (const side of [0, 1]) {
        if (hs[side] === rm.hands[side]) continue
        rm.hands[side] = hs[side]
        rm.handObjs[side]?.removeFromParent()
        const k = hs[side]
        rm.handObjs[side] = isItem(k) ? attachItem(rm.rig, side, k) : null
      }
      rm.tx = pl.p[0]
      rm.ty = pl.p[1]
      rm.tz = pl.p[2]
      // a câmera olha para -z; o boneco tem a frente em +z
      rm.tyaw = pl.yaw + Math.PI
      rm.moving = pl.moving
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.dropRemote(id)
    this.voice.sync([...this.remotes.keys()])
  }

  dropRemote(id: number) {
    const rm = this.remotes.get(id)
    if (!rm) return
    this.remoteGroup.remove(rm.rig.root)
    const hi = this.world.hits.indexOf(rm.rig.root)
    if (hi >= 0) this.world.hits.splice(hi, 1)
    for (const sp of [rm.tag, rm.bubble]) {
      const sm = sp.material as THREE.SpriteMaterial
      sm.map?.dispose()
      sm.dispose()
    }
    this.remotes.delete(id)
  }

  // mensagem de chat: vai para o log da tela e, se for de outro jogador, vira balão sobre ele
  gotChat(c: NetChat) {
    this.chatLog = [...this.chatLog, c].slice(-40)
    this.onChatLog(this.chatLog)
    const rm = this.remotes.get(c.id)
    if (rm) {
      drawTextSprite(rm.bubble, c.text, 'bubble')
      rm.bubble.visible = true
      rm.bubbleUntil = performance.now() + 4000 + c.text.length * 80
    }
  }

  say(text: string) {
    const t = text.trim()
    if (t) this.net.send({ t: 'chat', text: t.slice(0, 140) })
  }

  // ---------- quadro ----------

  loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    this.timer.update()
    const dt = Math.min(0.05, this.timer.getDelta())
    const time = this.timer.getElapsed()

    // movimento com colisão, eixo por eixo para deslizar nas paredes
    const inMove = this.inputMove()
    if (this.active) {
      // correr gasta stamina (sem fôlego, ou apertado para o xixi, só anda)
      const wantRun = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
      const canRun = !this.exhausted && this.needs.stamina > 0 && this.needs.bladder < 0.95
      const speed = (wantRun && canRun ? RUN : this.needs.bladder >= 0.95 ? WALK * 0.8 : WALK) * dt
      // na volta da câmera do emote anda para onde eu olhava (não para onde a câmera em transição aponta)
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orbit.k > 0 ? this.orbit.quat : this.camera.quaternion)
      fwd.y = 0
      fwd.normalize()
      const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize()
      const mv = new THREE.Vector3()
      if (inMove.mag > 0.12) {
        mv.addScaledVector(fwd, inMove.f).addScaledVector(right, inMove.r)
        // bêbado: o passo puxa para os lados
        const dr = this.drunkFx
        if (dr > 0.05) mv.addScaledVector(right, Math.sin(time * 1.7) * dr * 0.6 + Math.sin(time * 4.3) * dr * 0.2)
      }
      if (mv.lengthSq() && this.seat) {
        // levanta: procura um ponto livre em volta, começando pela direção do movimento
        const st = this.seat
        this.seat = null
        const d0 = mv.clone().normalize()
        const base = Math.atan2(d0.x, d0.z)
        let spot: { x: number, z: number } | null = null
        search: for (const rr of [0.8, 1.1, 1.5, 2.2]) {
          for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
            const x = st.x + Math.sin(base + off) * rr
            const z = st.z + Math.cos(base + off) * rr
            if (!this.blockedAt(x, z)) {
              spot = { x, z }
              break search
            }
          }
        }
        spot ??= { x: st.x + Math.sin(st.rot) * 0.75, z: st.z + Math.cos(st.rot) * 0.75 }
        this.pos.set(spot.x, 0, spot.z)
        this.floorY = heightAt(spot.x, spot.z)
        mv.set(0, 0, 0)
      }
      if (mv.lengthSq()) {
        mv.normalize().multiplyScalar(speed * Math.max(0.35, inMove.mag))
        // cada eixo: sem colisão e com o piso mudando no máximo um degrau (sobe/desce a escada, não cai do camarote)
        const step = (x: number, z: number) => {
          if (this.blockedAt(x, z)) return false
          const h = heightAt(x, z)
          if (Math.abs(h - this.floorY) > 0.4) return false
          this.floorY = h
          return true
        }
        if (step(this.pos.x + mv.x, this.pos.z)) this.pos.x += mv.x
        if (step(this.pos.x, this.pos.z + mv.z)) this.pos.z += mv.z
      }
    }
    const moving = this.active && inMove.mag > 0.12
    const running = moving && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && !this.exhausted && this.needs.stamina > 0 && this.needs.bladder < 0.95
    this.stepItems(dt, time, { running, moving })
    if (this.emote && (moving || (EMOTE_LEN[this.emote.name] && performance.now() / 1000 - this.emote.t0 > EMOTE_LEN[this.emote.name]))) this.stopEmote()
    // zoom suave; mouse mais lento no zoom
    const fovTarget = this.zooming && this.active ? FOV_ZOOM : FOV
    if (Math.abs(this.camera.fov - fovTarget) > 0.01) {
      this.camera.fov += (fovTarget - this.camera.fov) * (1 - Math.exp(-dt * 3.5))
      this.camera.updateProjectionMatrix()
      this.controls.pointerSpeed = this.camera.fov / FOV
    }
    const bob = moving ? Math.sin(time * 9) * 0.025 : 0
    // pulo: sobe e cai com gravidade (~0,7 m)
    if (this.jumpV !== 0 || this.jumpY > 0) {
      this.jumpV -= 14 * dt
      this.jumpY += this.jumpV * dt
      if (this.jumpY <= 0) {
        this.jumpY = 0
        this.jumpV = 0
      }
    }
    if (this.seat) this.camera.position.set(this.seat.x, this.seat.y + 0.78, this.seat.z)
    else this.camera.position.set(this.pos.x, this.floorY + EYE + bob + this.jumpY, this.pos.z)
    // meu boneco: sempre na minha posição e pose (aparece no espelho e no emote; em primeira pessoa fica escondido)
    const sr = this.selfRig
    const third = this.stepOrbit(dt)
    if (sr) {
      const em = this.emote
      const look = new THREE.Euler().setFromQuaternion(third ? this.orbit.quat : this.camera.quaternion, 'YXZ')
      sr.root.visible = third
      const k = 1 - Math.exp(-dt * 10)
      if (this.seat) {
        sr.root.position.set(this.seat.x, this.seat.y - 0.47, this.seat.z)
        sr.root.rotation.y = this.seat.rot
        poseSit(sr, k)
      } else {
        sr.root.position.set(this.pos.x, this.floorY + this.jumpY, this.pos.z)
        sr.root.rotation.y = (em ? em.yaw : look.y) + Math.PI
        if (em) animateEmote(sr, em.name, performance.now() / 1000 - em.t0, { lo: this.grooveB[0] * Math.PI * 2, mid: this.grooveB[1] * Math.PI * 2, hi: this.grooveB[2] * Math.PI * 2, music: this.musicOn })
        else {
          this.selfWalkT += moving ? dt : 0
          if (sr.body.position.y < 0) sr.body.position.y = 0
          poseWalk(sr, moving, this.selfWalkT, k)
        }
      }
      // cabeça segue para onde eu olho (no espelho dá para se ver olhando)
      if (!em) sr.head.rotation.set(-look.x * 0.6, 0, 0)
      // itens nas mãos do boneco (no emote ele segura sem animar)
      for (const side of [0, 1]) {
        const kind = this.hands[side]?.kind ?? ''
        if (kind !== this.selfKinds[side]) {
          this.selfKinds[side] = kind
          this.selfItems[side]?.removeFromParent()
          this.selfItems[side] = isItem(kind) ? attachItem(sr, side, kind) : null
        }
        const o = this.selfItems[side]
        if (o && !em) holdPose(sr, side, o, this.useAnim[side])
      }
      animateMouth(sr, this.voice.myBands.lv, performance.now() / 1000, this.voice.micOn && this.voice.myLevel > 0.02)
    }
    this.stepViewItems(third)

    this.placeLights()
    this.stepAnnex(dt, time)
    this.stepPhotographer(dt)
    this.stepDoors(dt)
    this.stepAlbumBook()
    this.stepVomit(dt)
    this.stepGi(time)
    this.stepClub(time)
    this.updateNpcs(dt, time)
    this.stepNet(dt)
    {
      // ouvido na câmera; cada voz na cabeça do jogador
      const cp = this.camera.position
      const fw = new THREE.Vector3()
      this.camera.getWorldDirection(fw)
      this.feed.aimBoxes(cp.x, cp.y, cp.z)
      this.voice.update({ x: cp.x, y: cp.y, z: cp.z, fx: fw.x, fy: fw.y, fz: fw.z }, (id) => {
        const rm = this.remotes.get(id)
        if (!rm) return null
        const p = rm.rig.root.position
        return { x: p.x, y: p.y + (rm.sit ? 1.15 : 1.55), z: p.z }
      }, acousticsAt)
    }
    if (this.active) {
      this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera)
      this.ray.far = REACH
      const found = this.ray.intersectObjects(this.world.hits, true)[0]
      // peça presa depois (item na mão de alguém) não tem o hit: vale o do dono
      let ho: THREE.Object3D | null = found?.object ?? null
      while (ho && !ho.userData.hit) ho = ho.parent
      this.hover = (ho?.userData.hit as Hit | undefined) ?? null
      this.hoverPoint = found ? found.point.clone() : null
      if (this.hover?.kind === 'seat' && this.hover.seats) {
        const nn = this.hover.seats.length
        const free = this.hover.seats.filter((st) => !this.seatTaken(st)).length
        this.hover.sub = nn === 1 ? (free ? 'lugar livre' : 'ocupado') : free ? `${free} de ${nn} lugares livres` : 'todos os lugares ocupados'
      }
    } else this.hover = null
    this.emitHud()
    if (!this.attached) return
    // solto (sem andar), a cena não precisa de 60 quadros
    const now = performance.now()
    if (!this.active && now - this.lastRender < 1000 / 24) return
    this.lastRender = now
    // bêbado: a câmera balança (só no desenho; o mouse continua mandando no olhar) e o brilho espalha mais
    this.drunkFx += (this.needs.drunk - this.drunkFx) * (1 - Math.exp(-dt * 0.6))
    const dr = this.drunkFx
    const sober = this.camera.quaternion.clone()
    // rastro: começa leve a partir de ~20% e chega a 0,88 no máximo
    const trailK = Math.min(0.88, Math.max(0, (dr - 0.2) / 0.8) ** 1.3 * 0.88)
    this.trail.enabled = trailK > 0.01
    this.trail.damp = trailK
    if (dr > 0.02 && !third) {
      this.camera.rotateZ(Math.sin(time * 0.8) * 0.08 * dr)
      this.camera.rotateY(Math.sin(time * 0.53) * 0.05 * dr)
      this.camera.rotateX(Math.sin(time * 1.1) * 0.03 * dr)
    }
    this.bloom.strength = 0.4 + dr * 0.6
    this.stepDjTv(dt)
    this.composer.render(dt)
    this.camera.quaternion.copy(sober)
    // Na captura da aba o player sai do 3D: o Chrome só grava um elemento plano (fora de contexto 3D) e pintado.
    // Fica 2D no canto, atrás do canvas (opaco ali), sem o filtro de brilho (o brilho é o nosso).
    const camEl = this.css.domElement.firstElementChild?.firstElementChild as HTMLElement | null
    if (this.feed.capturing) {
      if (!this.capFlat && camEl) {
        this.capFlat = true
        camEl.style.transformStyle = 'flat'
        camEl.style.transform = 'none'
        const el = this.dj.el
        el.style.display = ''
        el.style.filter = 'none'
        el.style.transformOrigin = '0 0'
        el.style.transform = 'scale(0.5)'
        el.style.left = '0px'
        el.style.top = '0px'
      }
    } else {
      if (this.capFlat && camEl) {
        // volta ao 3D: o CSS3DRenderer só reaplica o que mudou, então passa uma vez por outra câmera e escala
        this.capFlat = false
        camEl.style.transformStyle = 'preserve-3d'
        this.dj.el.style.transformOrigin = ''
        this.dj.el.style.left = ''
        this.dj.el.style.top = ''
        this.css.render(this.cssScene, this.capCam)
        this.cssObj.scale.multiplyScalar(1.000001)
        this.cssObj.updateMatrixWorld()
      }
      this.dj.el.style.filter = 'brightness(2) saturate(1.25) contrast(1.05)'
      if (this.cssObj.visible) this.css.render(this.cssScene, this.camera)
    }
  }

  dispose() {
    this.rc?.dispose()
    this.voice.dispose()
    this.net.close()
    for (const id of [...this.remotes.keys()]) this.dropRemote(id)
    cancelAnimationFrame(this.raf)
    this.renderer.domElement.removeEventListener('click', this.onClick)
    document.removeEventListener('mousedown', this.onHand)
    this.renderer.domElement.removeEventListener('contextmenu', this.noMenu)
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
    document.removeEventListener('mousemove', this.onWheelMove)
    document.removeEventListener('pointerdown', this.onUnlock)
    document.removeEventListener('keydown', this.onUnlock)
    this.timer.dispose()
    this.controls.unlock()
    this.controls.dispose()
    for (const m of this.world.own) m.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.css.domElement.remove()
  }
}
