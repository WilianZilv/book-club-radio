// Robô do Maestro: capacete creme, viseira preta com olhos âmbar, fones azul-marinho com aro dourado,
// terno azul-marinho com frisos dourados e placas creme. Formas básicas presas a ossos (rig rígido);
// `skinRobot` junta tudo numa SkinnedMesh com esqueleto para exportar.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface RobotRig {
  root: THREE.Bone
  body: THREE.Bone
  upper: THREE.Bone
  armL: THREE.Bone
  armR: THREE.Bone
  foreL: THREE.Bone
  foreR: THREE.Bone
  handL: THREE.Bone
  handR: THREE.Bone
  head: THREE.Bone
  neck: THREE.Bone
  hipL: THREE.Bone
  hipR: THREE.Bone
  kneeL: THREE.Bone
  kneeR: THREE.Bone
  lens: THREE.Group
  bones: THREE.Bone[]
}

const HIP = 0.9

let mats: Record<string, THREE.Material> | null = null
function M() {
  if (!mats) {
    mats = {
      cream: new THREE.MeshStandardMaterial({ name: 'cream', color: '#ebe5d8', roughness: 0.32, metalness: 0.08 }),
      creamShade: new THREE.MeshStandardMaterial({ name: 'creamShade', color: '#d8d0bf', roughness: 0.38, metalness: 0.08 }),
      navy: new THREE.MeshStandardMaterial({ name: 'navy', color: '#1a1e31', roughness: 0.55, metalness: 0.15 }),
      joint: new THREE.MeshStandardMaterial({ name: 'joint', color: '#2a2e40', roughness: 0.4, metalness: 0.55 }),
      gold: new THREE.MeshStandardMaterial({ name: 'gold', color: '#d6a44a', roughness: 0.28, metalness: 0.9 }),
      visor: new THREE.MeshStandardMaterial({ name: 'visor', color: '#05070d', roughness: 0.08, metalness: 0.7 }),
      eye: new THREE.MeshStandardMaterial({ name: 'eye', color: '#ffb020', emissive: '#ffa51a', emissiveIntensity: 3.2, roughness: 0.3 }),
      baton: new THREE.MeshStandardMaterial({ name: 'baton', color: '#f8fafc', roughness: 0.3 }),
    }
  }
  return mats
}

function bone(name: string, parent: THREE.Object3D | null, x = 0, y = 0, z = 0) {
  const b = new THREE.Bone()
  b.name = name
  b.position.set(x, y, z)
  parent?.add(b)
  return b
}

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.scale.set(sx, sy, sz)
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}

const sphere = (r: number, w = 28, h = 18) => new THREE.SphereGeometry(r, w, h)
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 8, 18)
const cylinder = (rt: number, rb: number, h: number, seg = 28) => new THREE.CylinderGeometry(rt, rb, h, seg)
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, r)
const torus = (r: number, t: number, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 10, 40, arc)

function hand(parent: THREE.Bone, side: number) {
  const m = M()
  part(parent, rbox(0.1, 0.11, 0.055, 0.02), m.joint, 0, -0.04, 0)
  part(parent, rbox(0.104, 0.05, 0.059, 0.018), m.cream, 0, -0.005, 0)
  for (let k = 0; k < 4; k++) {
    const fx = (k - 1.5) * 0.024
    const f = part(parent, capsule(0.011, 0.045), m.joint, fx, -0.12, 0.004)
    f.rotation.x = 0.15
    part(parent, sphere(0.012, 10, 8), m.cream, fx, -0.098, 0.006)
  }
  const th = part(parent, capsule(0.012, 0.04), m.joint, side * -0.055, -0.05, 0.02)
  th.rotation.z = side * -0.6
}

// Monta o robô em pé, braços para baixo (pose de repouso). Altura ~1,85 m.
export function makeRobot(): RobotRig {
  const m = M()
  const root = bone('Root', null)
  const body = bone('Body', root)
  const hips = bone('Hips', body, 0, HIP, 0)
  const upper = bone('Spine', hips)
  // quadril e cintura
  part(hips, rbox(0.34, 0.16, 0.22, 0.06), m.navy, 0, 0.0, 0)
  part(hips, torus(0.165, 0.014), m.gold, 0, 0.08, 0, 1, 1, 0.68).rotation.x = Math.PI / 2
  // tronco: terno azul com gola alta e frisos dourados
  const torso = part(upper, capsule(0.18, 0.3), m.navy, 0, 0.3, 0, 1, 1, 0.74)
  torso.name = 'torso'
  part(upper, rbox(0.3, 0.26, 0.05, 0.03), m.navy, 0, 0.38, 0.1)
  for (const s of [-1, 1]) {
    const lapel = part(upper, rbox(0.012, 0.34, 0.012, 0.004), m.gold, s * 0.055, 0.36, 0.128)
    lapel.rotation.z = s * 0.28
    const side = part(upper, rbox(0.012, 0.3, 0.012, 0.004), m.gold, s * 0.15, 0.3, 0.1)
    side.rotation.z = s * -0.05
  }
  part(upper, cylinder(0.085, 0.1, 0.11), m.navy, 0, 0.62, 0)
  part(upper, torus(0.088, 0.008), m.gold, 0, 0.675, 0).rotation.x = Math.PI / 2
  part(upper, rbox(0.22, 0.12, 0.2, 0.05), m.cream, 0, 0.5, -0.04)
  // pescoço e cabeça
  const neck = bone('Neck', upper, 0, 0.66, 0)
  for (let k = 0; k < 3; k++) part(neck, cylinder(0.045, 0.05, 0.03), m.joint, 0, 0.02 + k * 0.035, 0)
  const head = bone('Head', neck, 0, 0.16, 0)
  part(head, sphere(0.17, 40, 28), m.cream, 0, 0.02, -0.005, 1, 1.12, 1.06)
  part(head, rbox(0.06, 0.18, 0.2, 0.03), m.creamShade, 0, 0.12, -0.04).rotation.x = -0.25
  const visor = new THREE.SphereGeometry(0.174, 40, 20, Math.PI / 2 - 1.15, 2.3, Math.PI * 0.3, Math.PI * 0.36)
  part(head, visor, m.visor, 0, 0.015, 0.012, 1.0, 1.12, 1.07)
  for (const s of [-1, 1]) {
    const eye = part(head, rbox(0.072, 0.018, 0.02, 0.008), m.eye, s * 0.058, 0.01, 0.192)
    eye.rotation.z = s * 0.22
    eye.rotation.y = s * 0.32
    // fones laterais com aro dourado
    const pod = part(head, cylinder(0.072, 0.072, 0.06), m.navy, s * 0.17, 0.0, -0.01)
    pod.rotation.z = Math.PI / 2
    const ring = part(head, torus(0.06, 0.009), m.gold, s * 0.2, 0.0, -0.01)
    ring.rotation.y = Math.PI / 2
    const cap = part(head, cylinder(0.045, 0.045, 0.02), m.joint, s * 0.205, 0.0, -0.01)
    cap.rotation.z = Math.PI / 2
  }
  // braços: ombreira creme, braço creme, cotovelo escuro, antebraço creme, mão articulada
  const arm = (s: number, name: string) => {
    const sh = bone(`Shoulder.${name}`, upper, s * 0.24, 0.56, 0)
    part(sh, sphere(0.12), m.cream, s * 0.02, 0.02, 0, 1.1, 0.85, 1.05)
    part(sh, torus(0.1, 0.008, Math.PI), m.gold, s * 0.02, -0.03, 0, 1, 1, 1).rotation.set(Math.PI / 2, 0, 0)
    part(sh, capsule(0.064, 0.18), m.cream, 0, -0.17, 0)
    part(sh, cylinder(0.052, 0.058, 0.05), m.joint, 0, -0.04, 0)
    const fore = bone(`Elbow.${name}`, sh, 0, -0.3, 0)
    part(fore, sphere(0.058), m.joint, 0, 0, 0)
    part(fore, capsule(0.057, 0.15), m.cream, 0, -0.13, 0)
    part(fore, cylinder(0.05, 0.05, 0.04), m.joint, 0, -0.23, 0)
    const hd = bone(`Hand.${name}`, fore, 0, -0.27, 0)
    hand(hd, s)
    return { sh, fore, hd }
  }
  const AL = arm(-1, 'L')
  const AR = arm(1, 'R')
  // pernas: calça azul, placas creme na coxa e canela, joelho escuro, bota creme
  const leg = (s: number, name: string) => {
    const hip = bone(`UpperLeg.${name}`, body, s * 0.1, HIP, 0)
    part(hip, capsule(0.078, 0.3), m.navy, 0, -0.22, 0)
    part(hip, rbox(0.13, 0.24, 0.06, 0.025), m.cream, 0, -0.22, 0.05)
    const knee = bone(`Knee.${name}`, hip, 0, -0.45, 0)
    part(knee, sphere(0.065), m.joint, 0, 0, 0.01)
    part(knee, capsule(0.066, 0.27), m.cream, 0, -0.2, 0)
    part(knee, rbox(0.03, 0.2, 0.02, 0.008), m.gold, 0, -0.2, 0.065)
    part(knee, rbox(0.13, 0.08, 0.25, 0.03), m.cream, 0, -0.41, 0.045)
    part(knee, rbox(0.13, 0.025, 0.25, 0.01), m.joint, 0, -0.455, 0.045)
    return { hip, knee }
  }
  const LL = leg(-1, 'L')
  const LR = leg(1, 'R')
  const lens = new THREE.Group()
  lens.visible = false
  AR.fore.add(lens)
  const bones: THREE.Bone[] = []
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone)
  })
  return { root, body, upper, armL: AL.sh, armR: AR.sh, foreL: AL.fore, foreR: AR.fore, handL: AL.hd, handR: AR.hd, head, neck, hipL: LL.hip, hipR: LR.hip, kneeL: LL.knee, kneeR: LR.knee, lens, bones }
}

// Batuta na mão direita (opcional, só para o Maestro reger).
export function addBaton(rig: RobotRig) {
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.36, 10), M().baton)
  b.rotation.x = Math.PI / 2
  b.position.set(0, -0.1, 0.17)
  b.castShadow = true
  rig.handR.add(b)
  return b
}

// T-pose: braços abertos na horizontal.
export function tPose(rig: RobotRig) {
  rig.armL.rotation.set(0, 0, -Math.PI / 2)
  rig.armR.rotation.set(0, 0, Math.PI / 2)
  for (const b of [rig.foreL, rig.foreR, rig.handL, rig.handR, rig.head, rig.upper, rig.hipL, rig.hipR, rig.kneeL, rig.kneeR]) b.rotation.set(0, 0, 0)
}

// Junta as peças numa SkinnedMesh (cada peça com peso 1 no seu osso) para exportar o rig.
export function skinRobot(rig: RobotRig) {
  rig.root.updateMatrixWorld(true)
  const geos: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const boneIndex = new Map(rig.bones.map((b, i) => [b, i]))
  const parts: THREE.Mesh[] = []
  rig.root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && mesh.visible) parts.push(mesh)
  })
  for (const mesh of parts) {
    let owner: THREE.Object3D | null = mesh.parent
    while (owner && !(owner as THREE.Bone).isBone) owner = owner.parent
    const idx = boneIndex.get(owner as THREE.Bone) ?? 0
    // tudo sem índice e sem grupos internos, senão o merge recusa misturar RoundedBox com o resto
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
    g.clearGroups()
    g.applyMatrix4(mesh.matrixWorld)
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k)
    const n = g.attributes.position.count
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? idx : 0)), 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4))
    geos.push(g)
    materials.push(mesh.material as THREE.Material)
  }
  const merged = mergeGeometries(geos, true)
  if (!merged) throw new Error('não deu para juntar as peças do robô')
  // um material por grupo, sem repetir
  const uniq: THREE.Material[] = []
  merged.groups.forEach((gr, i) => {
    const mt = materials[i]
    let k = uniq.indexOf(mt)
    if (k < 0) {
      uniq.push(mt)
      k = uniq.length - 1
    }
    gr.materialIndex = k
  })
  // remove as peças rígidas: daqui pra frente quem desenha é a malha com pele
  for (const mesh of parts) mesh.parent?.remove(mesh)
  const skinned = new THREE.SkinnedMesh(merged, uniq)
  skinned.name = 'MaestroRobot'
  skinned.castShadow = true
  skinned.receiveShadow = true
  const holder = new THREE.Group()
  holder.name = 'MaestroRobotRig'
  holder.add(rig.root, skinned)
  holder.updateMatrixWorld(true)
  skinned.bind(new THREE.Skeleton(rig.bones))
  return { holder, skinned }
}
