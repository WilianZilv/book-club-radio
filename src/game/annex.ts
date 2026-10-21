// Anexos do club: dois corredores saindo pelas laterais. O da esquerda leva à área de fumantes (terraço aberto) e
// o da direita a um hall com os banheiros feminino e masculino. Também a acústica de cada lugar: o som do club vai
// abafando pelo caminho e ganha o eco de cada ambiente, com transição contínua pela posição.
import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'

import { D, W, bx, cachedTex, canvasTex, cyl, geo, glow, plane, plant, rb, seatsOf, signTex, sph, std, tagHits, texMat, woodTex, type Box2, type Seat } from './kit.ts'

// faixa em z dos dois corredores (vãos no parapeito do club)
export const OZ0 = 23.5
export const OZ1 = 26
const CH = 3
const WT = 0.15
// esquerda: corredor x [-9, 0], terraço x [-20, -9]
const CL0 = -9
const TX0 = -20
const TZ0 = 18.5
const TZ1 = 31
// direita: corredor x [W, W+9], hall x [W+9, W+12.5], banheiros x [W+12.5, W+20.5]
const CR1 = W + 9
const HX1 = W + 12.5
const RX1 = W + 20.5
const HZ0 = 16
const HZ1 = 33.5
const MASC = { z0: HZ0, z1: 24.5, d0: 19.5, d1: 21 }
const FEM = { z0: 25, z1: HZ1, d0: 28.5, d1: 30 }

export interface ZoneLight { p: THREE.Vector3, color: string, intensity: number, distance: number }
export interface Mirror { mesh: Reflector, x0: number, x1: number, z0: number, z1: number }
export interface Annex {
  // onde os NPCs fumam (em pé, perto das mesas altas)
  smokeSpots: { x: number, z: number, rot: number }[]
  // cinzeiros (fumaça sobe deles)
  ashtrays: THREE.Vector3[]
  lights: ZoneLight[]
  mirrors: Mirror[]
  // sentar num destes é usar o vaso (o xixi esvazia)
  toilets: Seat[]
  // portas das cabines: dobradiça (gira em y; aberta = OPEN rad) e a colisão de quando está fechada
  doors: StallDoor[]
}

export interface StallDoor { id: string, pivot: THREE.Group, box: Box2 }
export const DOOR_OPEN = 1.45

// azulejo escuro com rejunte claro (parede de banheiro) e piso xadrez
const wallTileTex = () => cachedTex('bath-wall', () => canvasTex(256, 256, (c) => {
  c.fillStyle = '#6b7280'
  c.fillRect(0, 0, 256, 256)
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 26 + ((x * 7 + y * 13) % 5) * 3
    c.fillStyle = `rgb(${v},${v},${v + 6})`
    c.fillRect(x * 64 + 2, y * 64 + 2, 60, 60)
    c.fillStyle = 'rgba(255,255,255,0.06)'
    c.fillRect(x * 64 + 2, y * 64 + 2, 60, 6)
  }
}).tex)
const checkerTex = () => cachedTex('bath-floor', () => canvasTex(256, 256, (c) => {
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    c.fillStyle = (x + y) % 2 ? '#f1f1f4' : '#111114'
    c.fillRect(x * 128, y * 128, 128, 128)
  }
  c.strokeStyle = 'rgba(128,128,140,0.5)'
  c.lineWidth = 3
  for (let k = 0; k <= 2; k++) {
    c.beginPath()
    c.moveTo(k * 128, 0)
    c.lineTo(k * 128, 256)
    c.moveTo(0, k * 128)
    c.lineTo(256, k * 128)
    c.stroke()
  }
}).tex)

export function buildAnnex(group: THREE.Group, own: THREE.Material[], colliders: Box2[], hits: THREE.Object3D[]): Annex {
  const lights: ZoneLight[] = []
  const mirrors: Mirror[] = []
  const toilets: Seat[] = []
  const doors: StallDoor[] = []
  const block = (x0: number, z0: number, x1: number, z1: number) => colliders.push({ x0, x1, z0, z1, level: 0 })
  const wall = (x0: number, z0: number, x1: number, z1: number, m: THREE.Material, h = CH) => {
    bx(group, x0, 0, z0, x1, h, z1, m)
    block(x0, z0, x1, z1)
  }
  const floor = (x0: number, z0: number, x1: number, z1: number, m: THREE.Material) => {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), m)
    f.rotation.x = -Math.PI / 2
    f.position.set((x0 + x1) / 2, 0.003, (z0 + z1) / 2)
    f.receiveShadow = true
    group.add(f)
  }
  const slab = (x0: number, z0: number, x1: number, z1: number) => bx(group, x0, -0.6, z0, x1, -0.01, z1, std('#1c1917', 0.8))
  const ceiling = (x0: number, z0: number, x1: number, z1: number) => bx(group, x0, CH, z0, x1, CH + 0.15, z1, std('#0e0d13', 0.9))
  // parede revestida de azulejo (plano no lado de dentro, com a repetição pelo tamanho)
  const tiled = (x0: number, z0: number, x1: number, z1: number, face: '+x' | '-x' | '+z' | '-z', color: string) => {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const m = texMat(wallTileTex, color, len / 0.6, CH / 0.6, 0.5, own)
    const p = new THREE.Mesh(new THREE.PlaneGeometry(len, CH), m)
    p.position.set((x0 + x1) / 2, CH / 2, (z0 + z1) / 2)
    p.rotation.y = face === '+z' ? 0 : face === '-z' ? Math.PI : face === '+x' ? Math.PI / 2 : -Math.PI / 2
    p.receiveShadow = true
    group.add(p)
  }
  const sign = (text: string, fg: string, x: number, y: number, z: number, w: number, face: '+x' | '-x' | '+z' | '-z') => plane(group, signTex(text, '#0b0b10', fg, 1024, 200), x, y, z, w, w * 0.195, face, own, true)

  const darkWall = std('#2a2733', 0.85)
  const panel = std('#2a1f3d', 0.95)
  const carpet = std('#1d1a26', 0.95)
  const chrome = std('#c9ced6', 0.22, 0.9)
  const porcelain = std('#f4f4f6', 0.25, 0.05)
  const neonPurple = glow('#a855f7', 2)
  const neonPink = glow('#ec4899', 2)
  const neonCyan = glow('#22d3ee', 2)
  const ledWhite = glow('#fff6e8', 1.15)

  // ---------- corredores ----------
  const corridor = (x0: number, x1: number, accent: THREE.Material, label: string, labelColor: string, signX: number, face: '+x' | '-x') => {
    slab(x0, OZ0 - WT, x1, OZ1 + WT)
    floor(x0, OZ0, x1, OZ1, carpet)
    ceiling(x0, OZ0 - WT, x1, OZ1 + WT)
    wall(x0, OZ0 - WT, x1, OZ0, darkWall)
    wall(x0, OZ1, x1, OZ1 + WT, darkWall)
    // painéis acústicos e frisos de neon no rodapé e no teto
    for (let x = x0 + 0.8; x < x1 - 0.8; x += 1.6) {
      rb(group, x, 1.5, OZ0 + 0.04, 1.2, 1.6, 0.06, 0.02, panel)
      rb(group, x, 1.5, OZ1 - 0.04, 1.2, 1.6, 0.06, 0.02, panel)
    }
    bx(group, x0, 0.05, OZ0, x1, 0.08, OZ0 + 0.03, accent, false)
    bx(group, x0, 0.05, OZ1 - 0.03, x1, 0.08, OZ1, accent, false)
    bx(group, x0, CH - 0.04, (OZ0 + OZ1) / 2 - 0.08, x1, CH, (OZ0 + OZ1) / 2 + 0.08, ledWhite, false)
    lights.push({ p: new THREE.Vector3(x0 + (x1 - x0) * 0.3, CH - 0.4, (OZ0 + OZ1) / 2), color: '#e9d5ff', intensity: 8, distance: 10 })
    lights.push({ p: new THREE.Vector3(x0 + (x1 - x0) * 0.75, CH - 0.4, (OZ0 + OZ1) / 2), color: '#e9d5ff', intensity: 8, distance: 10 })
    // portal no lado do club: batentes, verga e a placa virada para a pista
    const px = face === '+x' ? x1 : x0
    bx(group, px - 0.12, 0, OZ0 - 0.25, px + 0.12, CH + 0.4, OZ0, darkWall)
    bx(group, px - 0.12, 0, OZ1, px + 0.12, CH + 0.4, OZ1 + 0.25, darkWall)
    bx(group, px - 0.12, CH, OZ0 - 0.25, px + 0.12, CH + 0.4, OZ1 + 0.25, darkWall)
    sign(label, labelColor, signX, CH + 0.2, (OZ0 + OZ1) / 2, 2.2, face)
  }
  corridor(CL0, 0, neonPurple, 'FUMANTES', '#fdba74', 0.14, '+x')
  corridor(W, CR1, neonCyan, 'BANHEIROS', '#a5f3fc', W - 0.14, '-x')

  // ---------- área de fumantes: terraço aberto ----------
  slab(TX0 - 0.3, TZ0 - 0.3, CL0, TZ1 + 0.3)
  floor(TX0, TZ0, CL0, TZ1, texMat(woodTex, '#8a6a4a', 4, 5, 0.8, own))
  // parede do prédio do corredor, com a porta
  wall(CL0 - WT, TZ0, CL0, OZ0, darkWall, 3.4)
  wall(CL0 - WT, OZ1, CL0, TZ1, darkWall, 3.4)
  bx(group, CL0 - WT, CH, OZ0, CL0, 3.4, OZ1, darkWall)
  sign('ÁREA DE FUMANTES', '#fdba74', CL0 - WT - 0.01, 2.75, 28.2, 2.8, '-x')
  // guarda-corpo de vidro nos três lados abertos
  const glass = new THREE.MeshStandardMaterial({ color: '#d8ecff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false })
  own.push(glass)
  const rail = std('#57534e', 0.5, 0.6)
  for (const [x0, z0, x1, z1] of [[TX0 - 0.1, TZ0, TX0, TZ1], [TX0, TZ0 - 0.1, CL0, TZ0], [TX0, TZ1, CL0, TZ1 + 0.1]] as const) {
    bx(group, x0, 0, z0, x1, 0.12, z1, rail)
    bx(group, x0, 0.12, z0, x1, 1.05, z1, glass, false)
    bx(group, x0 - 0.02, 1.05, z0 - 0.02, x1 + 0.02, 1.1, z1 + 0.02, rail)
    block(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2)
  }
  // bancos encostados no guarda-corpo (dá para sentar)
  const bench = (x: number, z: number, rot: number) => {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    g.rotation.y = rot
    const wood = std('#5b3a22', 0.7)
    rb(g, 0, 0.45, 0, 1.8, 0.08, 0.5, 0.02, wood)
    rb(g, 0, 0.82, -0.23, 1.8, 0.4, 0.06, 0.02, wood)
    for (const lx of [-0.75, 0.75]) bx(g, lx - 0.04, 0, -0.22, lx + 0.04, 0.45, 0.2, rail)
    group.add(g)
    tagHits(g, { kind: 'seat', label: 'Sentar no banco', seats: seatsOf(x, 0, z, rot, [-0.5, 0.5], 0.47, 0.05) }, hits)
    const c = Math.abs(Math.cos(rot))
    block(x - (c > 0.5 ? 0.95 : 0.35), z - (c > 0.5 ? 0.35 : 0.95), x + (c > 0.5 ? 0.95 : 0.35), z + (c > 0.5 ? 0.35 : 0.95))
  }
  bench(-14.5, TZ0 + 0.45, 0)
  bench(-17.5, TZ0 + 0.45, 0)
  bench(-14.5, TZ1 - 0.45, Math.PI)
  bench(-17.5, TZ1 - 0.45, Math.PI)
  bench(TX0 + 0.45, 24.75, Math.PI / 2)
  // mesas altas
  const smokeSpots: Annex['smokeSpots'] = []
  for (const [tx, tz] of [[-12.6, 21.6], [-15.6, 27.6]] as const) {
    cyl(group, tx, 0, tz, 0.2, 0.03, rail)
    cyl(group, tx, 0, tz, 0.04, 1.05, rail)
    cyl(group, tx, 1.05, tz, 0.38, 0.04, std('#292524', 0.4, 0.3))
    block(tx - 0.4, tz - 0.4, tx + 0.4, tz + 0.4)
    smokeSpots.push({ x: tx + 0.75, z: tz, rot: -Math.PI / 2 }, { x: tx - 0.55, z: tz + 0.55, rot: Math.PI * 0.75 })
  }
  // cinzeiros de pé, com brasa
  const ashtrays: THREE.Vector3[] = []
  for (const [ax, az] of [[-10.2, 20], [-10.2, 29.5], [-19.2, 21]] as const) {
    cyl(group, ax, 0, az, 0.13, 0.03, rail)
    cyl(group, ax, 0, az, 0.05, 0.85, chrome)
    cyl(group, ax, 0.85, az, 0.16, 0.06, chrome, 0.12)
    sph(group, ax + 0.04, 0.92, az, 0.012, glow('#ff6a1a', 3)).castShadow = false
    ashtrays.push(new THREE.Vector3(ax + 0.04, 0.93, az))
    block(ax - 0.2, az - 0.2, ax + 0.2, az + 0.2)
  }
  // aquecedores de área (chama alaranjada em cima e luz quente)
  for (const [hx, hz] of [[-12, 25.5], [-17.6, 22.6]] as const) {
    cyl(group, hx, 0, hz, 0.25, 0.08, rail)
    cyl(group, hx, 0, hz, 0.05, 2.1, chrome)
    cyl(group, hx, 2.1, hz, 0.12, 0.3, std('#3f3f46', 0.4, 0.6))
    const glowRing = cyl(group, hx, 2.15, hz, 0.11, 0.22, glow('#ff7a2e', 2.2))
    glowRing.castShadow = false
    cyl(group, hx, 2.4, hz, 0.55, 0.05, chrome, 0.1)
    lights.push({ p: new THREE.Vector3(hx, 2.0, hz), color: '#ff9a50', intensity: 9, distance: 7 })
    block(hx - 0.3, hz - 0.3, hx + 0.3, hz + 0.3)
  }
  // varal de lampadinhas em zigue-zague
  const bulb = glow('#ffd59a', 2)
  for (let i = 0; i <= 18; i++) {
    const t = i / 18
    const x = TX0 + 0.4 + t * (CL0 - TX0 - 0.8)
    const zz = TZ0 + 1 + (i % 2 ? TZ1 - TZ0 - 2 : 0) * 0.5 + Math.sin(t * Math.PI * 3) * 3 + (TZ1 - TZ0 - 2) * 0.25
    const by = 2.75 - Math.abs(Math.sin(t * Math.PI * 6)) * 0.25
    sph(group, x, by, zz, 0.045, bulb).castShadow = false
    // luz de verdade em alguns pontos do varal (as lampadinhas sozinhas só brilham, não iluminam)
    if (i % 6 === 3) lights.push({ p: new THREE.Vector3(x, by - 0.1, zz), color: '#ffd59a', intensity: 6, distance: 8 })
  }
  for (const [px, pz] of [[TX0 + 0.7, TZ0 + 0.7], [TX0 + 0.7, TZ1 - 0.7], [CL0 - 0.8, TZ0 + 0.7], [CL0 - 0.8, TZ1 - 0.7]] as const) {
    plant(group, px, 0, pz, 1.2, px * 5 + pz)
    block(px - 0.4, pz - 0.4, px + 0.4, pz + 0.4)
  }

  // ---------- hall dos banheiros ----------
  slab(CR1, HZ0 - WT, RX1 + WT, HZ1 + WT)
  floor(CR1, HZ0, HX1, HZ1, carpet)
  ceiling(CR1, HZ0 - WT, HX1, HZ1 + WT)
  wall(CR1, HZ0 - WT, CR1 + WT, OZ0, darkWall)
  wall(CR1, OZ1, CR1 + WT, HZ1 + WT, darkWall)
  wall(CR1, HZ0 - WT, RX1 + WT, HZ0, darkWall)
  wall(CR1, HZ1, RX1 + WT, HZ1 + WT, darkWall)
  // parede dos banheiros com as duas portas
  wall(HX1, HZ0, HX1 + WT, MASC.d0, darkWall)
  wall(HX1, MASC.d1, HX1 + WT, FEM.d0, darkWall)
  wall(HX1, FEM.d1, HX1 + WT, HZ1, darkWall)
  for (const r of [MASC, FEM]) bx(group, HX1, 2.4, r.d0, HX1 + WT, CH, r.d1, darkWall)
  sign('MASCULINO', '#a5f3fc', HX1 - 0.01, 2.65, (MASC.d0 + MASC.d1) / 2, 1.6, '-x')
  sign('FEMININO', '#f9a8d4', HX1 - 0.01, 2.65, (FEM.d0 + FEM.d1) / 2, 1.6, '-x')
  bx(group, CR1 + WT, CH - 0.04, HZ0 + 0.5, CR1 + WT + 0.1, CH, HZ1 - 0.5, ledWhite, false)
  bx(group, CR1 + WT, 0.05, HZ0, CR1 + WT + 0.03, 0.08, HZ1, neonCyan, false)
  lights.push({ p: new THREE.Vector3((CR1 + HX1) / 2, CH - 0.4, 20.5), color: '#e0f2fe', intensity: 26, distance: 13 })
  lights.push({ p: new THREE.Vector3((CR1 + HX1) / 2, CH - 0.4, 29), color: '#e0f2fe', intensity: 26, distance: 13 })
  for (const pz of [HZ0 + 0.6, HZ1 - 0.6]) {
    plant(group, CR1 + 0.7, 0, pz, 1.1, pz * 3)
    block(CR1 + 0.3, pz - 0.4, CR1 + 1.1, pz + 0.4)
  }

  // ---------- banheiros ----------
  const room = (r: typeof MASC, men: boolean) => {
    const accent = men ? neonCyan : neonPink
    const tint = men ? '#cbd5e1' : '#f5d0fe'
    const z0 = r.z0
    const z1 = r.z1
    floor(HX1 + WT, z0, RX1, z1, texMat(checkerTex, '#ffffff', (RX1 - HX1) / 1.2, (z1 - z0) / 1.2, 0.3, own))
    ceiling(HX1, z0, RX1 + WT, z1)
    wall(RX1, z0, RX1 + WT, z1, darkWall)
    // azulejo por dentro
    tiled(HX1 + WT, z0 + 0.01, RX1, z0 + 0.01, '+z', tint)
    tiled(HX1 + WT, z1 - 0.01, RX1, z1 - 0.01, '-z', tint)
    tiled(RX1 - 0.01, z0, RX1 - 0.01, z1, '-x', tint)
    tiled(HX1 + WT + 0.01, z0, HX1 + WT + 0.01, r.d0, '+x', tint)
    tiled(HX1 + WT + 0.01, r.d1, HX1 + WT + 0.01, z1, '+x', tint)
    // neon no alto das paredes e painéis de luz no teto
    bx(group, HX1 + WT, CH - 0.12, z0, RX1, CH - 0.09, z0 + 0.03, accent, false)
    bx(group, HX1 + WT, CH - 0.12, z1 - 0.03, RX1, CH - 0.09, z1, accent, false)
    for (const cx of [HX1 + 2.5, HX1 + 5.5]) bx(group, cx - 0.6, CH - 0.03, (z0 + z1) / 2 - 0.6, cx + 0.6, CH, (z0 + z1) / 2 + 0.6, ledWhite, false)
    lights.push({ p: new THREE.Vector3(HX1 + 4, CH - 0.5, (z0 + z1) / 2), color: men ? '#e0f2fe' : '#fce7f3', intensity: 7, distance: 11 })
    // bancada com cubas e espelho de verdade, encostada na parede do meio
    const vz = men ? z1 : z0
    const s = men ? -1 : 1
    const vx0 = HX1 + 1
    const vx1 = HX1 + 5
    bx(group, vx0, 0, Math.min(vz, vz + s * 0.6), vx1, 0.85, Math.max(vz, vz + s * 0.6), std('#1f1f26', 0.5, 0.2))
    bx(group, vx0 - 0.05, 0.85, Math.min(vz, vz + s * 0.65), vx1 + 0.05, 0.9, Math.max(vz, vz + s * 0.65), std('#e7e5e4', 0.15, 0.1))
    block(vx0 - 0.05, Math.min(vz, vz + s * 0.7), vx1 + 0.05, Math.max(vz, vz + s * 0.7))
    for (const cx of [vx0 + 0.7, vx0 + 2, vx0 + 3.3]) {
      const bowl = cyl(group, cx, 0.82, vz + s * 0.33, 0.2, 0.1, porcelain, 0.16)
      bowl.castShadow = false
      cyl(group, cx, 0.86, vz + s * 0.33, 0.16, 0.05, std('#9ca3af', 0.2, 0.6))
      cyl(group, cx, 0.9, vz + s * 0.06, 0.025, 0.28, chrome)
      const spout = cyl(group, 0, 0, 0, 0.018, 0.16, chrome)
      spout.rotation.x = Math.PI / 2
      spout.position.set(cx, 1.15, vz + s * 0.13)
    }
    const mir = new Reflector(new THREE.PlaneGeometry(vx1 - vx0, 1.2), { textureWidth: 768, textureHeight: 256, color: 0xb8bcc4, clipBias: 0.003 })
    mir.position.set((vx0 + vx1) / 2, 1.65, vz + s * 0.015)
    mir.rotation.y = men ? Math.PI : 0
    mir.userData.ui = true
    mir.visible = false
    group.add(mir)
    mirrors.push({ mesh: mir, x0: HX1 + WT, x1: RX1, z0, z1 })
    // moldura de LED do espelho
    const mz = vz + s * 0.02
    bx(group, vx0 - 0.04, 1.03, Math.min(mz, mz + s * 0.02), vx1 + 0.04, 1.05, Math.max(mz, mz + s * 0.02), accent, false)
    bx(group, vx0 - 0.04, 2.25, Math.min(mz, mz + s * 0.02), vx1 + 0.04, 2.27, Math.max(mz, mz + s * 0.02), accent, false)
    // cabines (2,2 x 1,8 m): divisórias, frente com porta de abrir (vão de 0,9 m), vaso com caixa acoplada e papel.
    // Divisórias e frente têm colisão; a porta só quando fechada
    const stallX = RX1 - 2.2
    const n = men ? 3 : 4
    const sw = 1.8
    const sz0 = men ? z0 : z1 - n * sw
    const part = std('#26232f', 0.5, 0.2)
    for (let k = 0; k <= n; k++) {
      bx(group, stallX, 0.15, sz0 + k * sw - 0.025, RX1, 2.1, sz0 + k * sw + 0.025, part)
      block(stallX, sz0 + k * sw - 0.04, RX1, sz0 + k * sw + 0.04)
    }
    for (let k = 0; k < n; k++) {
      const cz = sz0 + k * sw + sw / 2
      bx(group, stallX - 0.025, 0.15, sz0 + k * sw, stallX + 0.025, 2.1, cz - 0.45, part)
      bx(group, stallX - 0.025, 0.15, cz + 0.45, stallX + 0.025, 2.1, sz0 + (k + 1) * sw, part)
      block(stallX - 0.04, sz0 + k * sw, stallX + 0.04, cz - 0.45)
      block(stallX - 0.04, cz + 0.45, stallX + 0.04, sz0 + (k + 1) * sw)
      // porta: dobradiça na ponta de baixo do vão, abre para dentro da cabine
      const door = new THREE.Group()
      door.position.set(stallX, 0, cz - 0.45)
      bx(door, -0.02, 0.15, 0.01, 0.02, 2.1, 0.89, part)
      sph(door, -0.05, 1.05, 0.8, 0.025, chrome)
      sph(door, 0.05, 1.05, 0.8, 0.025, chrome)
      group.add(door)
      const id = `${men ? 'm' : 'f'}${k}`
      tagHits(door, { kind: 'door', id, label: 'Porta da cabine', sub: 'clique ou E abre e fecha' }, hits)
      doors.push({ id, pivot: door, box: { x0: stallX - 0.05, x1: stallX + 0.05, z0: cz - 0.45, z1: cz + 0.45, level: 0 } })
      // vaso
      const tx = RX1 - 0.45
      rb(group, tx, 0.75, cz, 0.22, 0.5, 0.45, 0.04, porcelain)
      cyl(group, tx - 0.35, 0, cz, 0.17, 0.38, porcelain, 0.2)
      const seat = new THREE.Mesh(geo('toiletseat', () => new THREE.TorusGeometry(0.17, 0.035, 8, 24)), std('#e5e7eb', 0.3))
      seat.rotation.x = Math.PI / 2
      seat.position.set(tx - 0.38, 0.4, cz)
      group.add(seat)
      cyl(group, tx - 0.2, 0.78, cz + 0.55, 0.06, 0.1, std('#f8fafc', 0.9)).rotation.z = Math.PI / 2
      const st: Seat[] = seatsOf(tx - 0.38, 0, cz, -Math.PI / 2, [0], 0.42, 0)
      toilets.push(...st)
      tagHits(seat, { kind: 'seat', label: 'Vaso sanitário', sub: 'sentar para fazer xixi', seats: st }, hits)
      block(tx - 0.6, cz - 0.27, RX1, cz + 0.27)
    }
    // mictórios com divisórias (masculino) ou pufe e espelhinho (feminino)
    if (men) {
      for (let k = 0; k < 3; k++) {
        const ux = HX1 + 1.4 + k * 1.1
        rb(group, ux, 0.95, z0 + 0.2, 0.42, 0.62, 0.3, 0.12, porcelain)
        tagHits(group.children[group.children.length - 1], { kind: 'use', id: 'mictorio', label: 'Mictório', sub: 'clique para fazer xixi' }, hits)
        cyl(group, ux, 1.32, z0 + 0.06, 0.02, 0.25, chrome)
        if (k < 2) bx(group, ux + 0.53, 0.45, z0, ux + 0.57, 1.6, z0 + 0.55, part)
      }
      block(HX1 + 1, z0, HX1 + 4.6, z0 + 0.45)
    } else {
      const pouf = std('#db2777', 0.85)
      rb(group, HX1 + 2.6, 0.22, z1 - 0.45, 2.2, 0.44, 0.6, 0.12, pouf)
      tagHits(group.children[group.children.length - 1], { kind: 'seat', label: 'Sentar no pufe', seats: seatsOf(HX1 + 2.6, 0, z1 - 0.45, Math.PI, [-0.6, 0.6], 0.46, -0.05) }, hits)
      block(HX1 + 1.45, z1 - 0.8, HX1 + 3.75, z1)
    }
    // secador de mão e lixeira perto da porta
    const dz = men ? r.d0 - 1.2 : r.d1 + 1.2
    rb(group, HX1 + WT + 0.12, 1.25, dz, 0.24, 0.32, 0.28, 0.05, chrome)
    cyl(group, HX1 + 0.55, 0, dz, 0.18, 0.6, std('#3f3f46', 0.4, 0.5))
    block(HX1 + 0.3, dz - 0.25, HX1 + 0.8, dz + 0.25)
  }
  room(MASC, true)
  room(FEM, false)
  // parede entre os dois banheiros
  wall(HX1, MASC.z1, RX1, FEM.z0, darkWall)

  return { smokeSpots, ashtrays, lights, mirrors, toilets, doors }
}

// ---------- acústica ----------

export interface Acoustics {
  // fator do volume, abafamento (0 aberto .. 1 muito abafado), eco e o quanto as ondas do club ainda aparecem
  vol: number
  muffle: number
  verb: number
  open: number
}

const CLUB: Acoustics = { vol: 1, muffle: 0, verb: 0.12, open: 1 }
const CORRIDOR: Acoustics = { vol: 0.68, muffle: 0.45, verb: 0.32, open: 0.25 }
const TERRACE: Acoustics = { vol: 0.5, muffle: 0.68, verb: 0.06, open: 0 }
const HALL: Acoustics = { vol: 0.58, muffle: 0.6, verb: 0.34, open: 0 }
const BATH: Acoustics = { vol: 0.5, muffle: 0.78, verb: 0.62, open: 0 }

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const mixA = (p: Acoustics, q: Acoustics, k: number): Acoustics => ({
  vol: p.vol + (q.vol - p.vol) * k,
  muffle: p.muffle + (q.muffle - p.muffle) * k,
  verb: p.verb + (q.verb - p.verb) * k,
  open: p.open + (q.open - p.open) * k,
})

// Pela posição: do club para o corredor (abafa nos primeiros 3 m), do corredor para o terraço ou o hall (3 m em
// volta da porta) e do hall para o banheiro (1,5 m em volta da porta). Nada troca de uma vez.
export function acousticsAt(x: number, z: number): Acoustics {
  void z
  if (x < 0.5) {
    const a = mixA(CLUB, CORRIDOR, smooth(0.5, -2.5, x))
    return mixA(a, TERRACE, smooth(CL0 + 1.5, CL0 - 1.5, x))
  }
  if (x > W - 0.5) {
    let a = mixA(CLUB, CORRIDOR, smooth(W - 0.5, W + 2.5, x))
    a = mixA(a, HALL, smooth(CR1 - 1.5, CR1 + 1.5, x))
    return mixA(a, BATH, smooth(HX1 - 0.6, HX1 + 0.9, x))
  }
  return CLUB
}

// em qual banheiro (para ligar o espelho de lá)
export function inRoom(m: Mirror, x: number, z: number) {
  return x > m.x0 - 0.5 && x < m.x1 && z > m.z0 && z < m.z1
}
