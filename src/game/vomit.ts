// Vômito: jato de gotas saindo da boca na direção do olhar, caindo com gravidade; parte das gotas vira poça no
// chão (some devagar). Serve para mim e para os outros jogadores (cada um vê o jato de quem está vomitando).
import * as THREE from 'three'

const MAX_DROPS = 420
const MAX_PUDDLES = 40

export class VomitFx {
  group = new THREE.Group()
  drops: THREE.InstancedMesh
  pos: THREE.Vector3[] = []
  vel: THREE.Vector3[] = []
  life: number[] = []
  // idade da gota: nasce pequena (colada no rosto ela tamparia a tela) e cresce no primeiro quarto de segundo
  age: number[] = []
  next = 0
  puddles: { m: THREE.Mesh, at: number }[] = []
  puddleMat = new THREE.MeshStandardMaterial({ color: '#9aa53a', roughness: 0.25, metalness: 0, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
  m = new THREE.Matrix4()

  constructor() {
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ color: '#a3a83c', roughness: 0.35 }), MAX_DROPS)
    this.drops.frustumCulled = false
    for (let i = 0; i < MAX_DROPS; i++) {
      this.pos.push(new THREE.Vector3())
      this.vel.push(new THREE.Vector3())
      this.life.push(0)
      this.age.push(0)
      this.drops.setMatrixAt(i, this.m.makeScale(0, 0, 0))
    }
    this.group.add(this.drops)
  }

  // n gotas saindo de `from` na direção `dir` (normalizada), com espalhamento
  spray(from: THREE.Vector3, dir: THREE.Vector3, n: number) {
    for (let k = 0; k < n; k++) {
      const i = this.next
      this.next = (this.next + 1) % MAX_DROPS
      this.pos[i].copy(from)
      // jato forte (vai longe) e pouco espalhado
      this.vel[i].copy(dir).multiplyScalar(4.4 + Math.random() * 1.8)
      this.vel[i].x += (Math.random() - 0.5) * 0.6
      this.vel[i].y += (Math.random() - 0.5) * 0.5
      this.vel[i].z += (Math.random() - 0.5) * 0.6
      this.life[i] = 2.5
      this.age[i] = 0
    }
  }

  // floorAt(x, z): altura do piso ali
  update(dt: number, now: number, floorAt: (x: number, z: number) => number) {
    for (let i = 0; i < MAX_DROPS; i++) {
      if (this.life[i] <= 0) continue
      const p = this.pos[i]
      const v = this.vel[i]
      v.y -= 9.8 * dt
      p.addScaledVector(v, dt)
      this.life[i] -= dt
      const fy = floorAt(p.x, p.z)
      if (p.y <= fy + 0.01 || this.life[i] <= 0) {
        this.life[i] = 0
        this.drops.setMatrixAt(i, this.m.makeScale(0, 0, 0))
        if (p.y <= fy + 0.05 && Math.random() < 0.18) this.puddle(p.x, fy, p.z, now)
        continue
      }
      this.age[i] += dt
      const s = (0.009 + (i % 5) * 0.0025) * (0.25 + 0.75 * Math.min(1, this.age[i] / 0.25))
      this.drops.setMatrixAt(i, this.m.makeScale(s, s, s).setPosition(p))
    }
    this.drops.instanceMatrix.needsUpdate = true
    // poças somem em ~90 s
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const pd = this.puddles[i]
      const age = (now - pd.at) / 1000
      if (age > 90) {
        pd.m.removeFromParent()
        pd.m.geometry.dispose()
        this.puddles.splice(i, 1)
      } else if (age > 60) pd.m.scale.setScalar(pd.m.userData.s * (1 - (age - 60) / 30))
    }
  }

  puddle(x: number, y: number, z: number, now: number) {
    if (this.puddles.length >= MAX_PUDDLES) {
      const old = this.puddles.shift()
      old?.m.removeFromParent()
      old?.m.geometry.dispose()
    }
    const g = new THREE.CircleGeometry(1, 14)
    // borda irregular
    const pos = g.attributes.position
    for (let i = 1; i < pos.count; i++) {
      const k = 0.75 + Math.random() * 0.4
      pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k)
    }
    const m = new THREE.Mesh(g, this.puddleMat)
    m.rotation.x = -Math.PI / 2
    const s = 0.08 + Math.random() * 0.14
    m.userData.s = s
    m.scale.setScalar(s)
    m.position.set(x, y + 0.006, z)
    m.receiveShadow = true
    this.group.add(m)
    this.puddles.push({ m, at: now })
  }
}

// textura do alvo do minigame (anel com centro)
export function ringTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.strokeStyle = '#fde047'
  g.lineWidth = 12
  g.beginPath()
  g.arc(64, 64, 50, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = '#fde047'
  g.beginPath()
  g.arc(64, 64, 12, 0, Math.PI * 2)
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
