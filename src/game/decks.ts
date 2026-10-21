// Camarotes: dois decks elevados nos cantos da frente do club (um de cada lado do palco), com guarda-corpo de vidro,
// escada e sofá. A altura do piso (heightAt) é o que deixa subir pela escada e segura o jogador lá em cima: o motor
// só deixa andar para onde o piso muda pouco (um degrau), então não dá para entrar embaixo nem cair pela borda.
import * as THREE from 'three'

import { W, bx, cyl, glow, rb, sofa, std, texMat, woodTex, type Box2 } from './kit.ts'
import type { PartyAct } from './club.ts'

export const DECK_H = 1.6
// pegada de cada deck e a escada (descendo para +z a partir da borda da frente)
const DZ0 = 1.5
const DZ1 = 9.5
const RUN = 3
const DECKS = [
  { x0: 0.3, x1: 6.5, sx0: 4.6, sx1: 6.1 },
  { x0: W - 6.5, x1: W - 0.3, sx0: W - 6.1, sx1: W - 4.6 },
]

export interface Decks {
  spots: { act: PartyAct, x: number, y: number, z: number, rot: number, lift: number }[]
}

// altura do piso num ponto (0 no chão do club)
export function heightAt(x: number, z: number) {
  for (const d of DECKS) {
    if (x > d.x0 && x < d.x1 && z > DZ0 && z < DZ1) return DECK_H
    if (x > d.sx0 && x < d.sx1 && z >= DZ1 && z < DZ1 + RUN) return DECK_H * (1 - (z - DZ1) / RUN)
  }
  return 0
}

export function buildDecks(group: THREE.Group, own: THREE.Material[], colliders: Box2[], hits: THREE.Object3D[]): Decks {
  const spots: Decks['spots'] = []
  const deckWood = texMat(woodTex, '#a07a52', 3, 4, 0.7, own)
  const frame = std('#26232f', 0.5, 0.4)
  const steel = std('#c0c4cc', 0.25, 0.9)
  const glass = new THREE.MeshStandardMaterial({ color: '#d8ecff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false })
  own.push(glass)
  const led = glow('#a855f7', 2)
  // guarda-corpo ao longo de um lado (de a até b no eixo dado), em cima do deck
  const rail = (x0: number, z0: number, x1: number, z1: number, y = DECK_H) => {
    bx(group, x0, y, z0, x1, y + 0.1, z1, frame)
    bx(group, x0, y + 0.1, z0, x1, y + 1.0, z1, glass, false)
    bx(group, x0 - 0.02, y + 1.0, z0 - 0.02, x1 + 0.02, y + 1.06, z1 + 0.02, steel)
    const len = Math.hypot(x1 - x0, z1 - z0)
    const n = Math.max(1, Math.round(len / 1.4))
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const px = x0 + (x1 - x0) * t
      const pz = z0 + (z1 - z0) * t
      bx(group, px - 0.03, y, pz - 0.03, px + 0.03, y + 1.06, pz + 0.03, steel)
    }
  }
  for (const d of DECKS) {
    const { x0, x1, sx0, sx1 } = d
    // piso, laje e pilares
    bx(group, x0, DECK_H - 0.18, DZ0, x1, DECK_H - 0.01, DZ1, frame)
    const top = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, DZ1 - DZ0), deckWood)
    top.rotation.x = -Math.PI / 2
    top.position.set((x0 + x1) / 2, DECK_H, (DZ0 + DZ1) / 2)
    top.receiveShadow = true
    group.add(top)
    for (const px of [x0 + 0.2, x1 - 0.2]) for (const pz of [DZ0 + 0.2, (DZ0 + DZ1) / 2, DZ1 - 0.2]) bx(group, px - 0.1, 0, pz - 0.1, px + 0.1, DECK_H - 0.18, pz + 0.1, frame)
    // fita de LED embaixo da borda
    bx(group, x0, DECK_H - 0.2, DZ1 - 0.02, x1, DECK_H - 0.17, DZ1, led, false)
    // embaixo do deck não se entra (fechado com tela escura)
    bx(group, x0 + 0.05, 0, DZ1 - 0.25, x1 - 0.05, DECK_H - 0.2, DZ1 - 0.2, std('#111015', 0.9))
    // guarda-corpo: frente com o vão da escada, laterais e fundo
    rail(x0, DZ1 - 0.04, sx0, DZ1)
    rail(sx1, DZ1 - 0.04, x1, DZ1)
    rail(x0, DZ0, x0 + 0.04, DZ1)
    rail(x1 - 0.04, DZ0, x1, DZ1)
    rail(x0, DZ0, x1, DZ0 + 0.04)
    // escada: degraus, laterais e corrimão inclinado
    const steps = 9
    for (let k = 0; k < steps; k++) {
      const y = DECK_H * (1 - (k + 1) / steps)
      const z = DZ1 + (k * RUN) / steps
      bx(group, sx0, 0, z, sx1, y + DECK_H / steps, z + RUN / steps, deckWood)
    }
    for (const sx of [sx0 - 0.06, sx1]) {
      bx(group, sx, 0, DZ1, sx + 0.06, 0.2, DZ1 + RUN, frame)
      const hr = rb(group, sx + 0.03, 0, 0, 0.05, 0.05, Math.hypot(RUN, DECK_H), 0.02, steel)
      hr.position.set(sx + 0.03, DECK_H / 2 + 0.95, DZ1 + RUN / 2)
      hr.rotation.x = Math.atan2(DECK_H, RUN)
      for (const t of [0.15, 0.5, 0.85]) cyl(group, sx + 0.03, DECK_H * (1 - t), DZ1 + RUN * t, 0.02, 0.95, steel)
    }
    colliders.push({ x0: sx0 - 0.12, x1: sx0 - 0.02, z0: DZ1, z1: DZ1 + RUN, level: 0 }, { x0: sx1 + 0.02, x1: sx1 + 0.12, z0: DZ1, z1: DZ1 + RUN, level: 0 })
    // sofá no fundo do camarote, de frente para a pista
    const left = x0 < W / 2
    const sf = sofa(group, (x0 + x1) / 2, DECK_H, DZ0 + 0.75, 0, '#6d28d9', hits)
    void sf
    // gente no camarote: dançando perto do vidro, de olho no palco
    for (const [ox, oz] of [[0.25, 0.8], [0.55, 0.65], [0.4, 0.45]] as const) {
      const sx = x0 + (x1 - x0) * (left ? ox : 1 - ox)
      spots.push({ act: 'dance', x: sx, y: DECK_H, z: DZ0 + (DZ1 - DZ0) * oz, rot: Math.PI + (left ? 0.5 : -0.5), lift: 0 })
    }
  }
  return { spots }
}
