// Itens de mão (bebidas e comida do bar) e as necessidades do jogador (stamina, xixi, embriaguez, fome, dinheiro).
// Cada mão segura um item; clique do lado usa (um gole, uma mordida), G larga, E oferece. Os números de efeito são
// por uso.
import * as THREE from 'three'
import { cyl, glow, sph, std } from './kit.ts'

export type ItemKind = 'cerveja' | 'drink' | 'shot' | 'batata'
export interface Held { kind: ItemKind, left: number }

// price em reais; uses = goles/mordidas; alcohol/bladder/food = quanto cada uso soma (food tira fome)
export const ITEMS: Record<ItemKind, { label: string, price: number, uses: number, alcohol: number, bladder: number, food: number, use: string }> = {
  cerveja: { label: 'Cerveja', price: 12, uses: 4, alcohol: 0.05, bladder: 0.08, food: 0, use: 'gole' },
  drink: { label: 'Drink', price: 22, uses: 3, alcohol: 0.08, bladder: 0.05, food: 0, use: 'gole' },
  shot: { label: 'Shot', price: 10, uses: 1, alcohol: 0.15, bladder: 0.02, food: 0, use: 'virada' },
  batata: { label: 'Porção de batata', price: 18, uses: 4, alcohol: 0, bladder: 0, food: 0.14, use: 'mordida' },
}
export const ITEM_KINDS = Object.keys(ITEMS) as ItemKind[]
export const isItem = (k: unknown): k is ItemKind => typeof k === 'string' && k in ITEMS

// O item com a base na origem (y = 0). Copo de vidro claro com o líquido dentro; cerveja e drink um pouco maiores
// que o real (na mão, em primeira pessoa, sumiam). O modelo fica num grupo interno: quem usa pode escalar o de fora.
export function itemMesh(kind: ItemKind): THREE.Group {
  const outer = new THREE.Group()
  const g = new THREE.Group()
  g.scale.setScalar(kind === 'cerveja' ? 1.4 : kind === 'drink' ? 1.45 : 1)
  outer.add(g)
  const glass = std('#e0f2fe', 0.05, 0.1, { opacity: 0.3 })
  if (kind === 'cerveja') {
    // copo americano alto: cerveja dourada com colarinho
    cyl(g, 0, 0, 0, 0.036, 0.15, glass, 0.042)
    cyl(g, 0, 0.006, 0, 0.032, 0.12, std('#f59e0b', 0.25, 0, { opacity: 0.9 }), 0.037)
    cyl(g, 0, 0.126, 0, 0.037, 0.022, std('#fef3c7', 0.9), 0.039)
  } else if (kind === 'drink') {
    // taça de coquetel: pé, haste, cone com drink rosa, limão e canudo
    cyl(g, 0, 0, 0, 0.035, 0.006, glass)
    cyl(g, 0, 0.006, 0, 0.006, 0.08, glass)
    cyl(g, 0, 0.086, 0, 0.008, 0.07, glass, 0.055)
    cyl(g, 0, 0.09, 0, 0.007, 0.055, std('#ec4899', 0.3, 0, { opacity: 0.85 }), 0.046)
    sph(g, 0.04, 0.15, 0, 0.018, std('#84cc16', 0.6), 0.4)
    const straw = cyl(g, 0, 0, 0, 0.004, 0.13, std('#f8fafc', 0.6))
    straw.rotation.z = 0.35
    straw.position.set(-0.012, 0.16, 0)
  } else if (kind === 'shot') {
    // copinho grosso com destilado âmbar
    cyl(g, 0, 0, 0, 0.022, 0.06, std('#e0f2fe', 0.05, 0.1, { opacity: 0.45 }), 0.026)
    cyl(g, 0, 0.012, 0, 0.018, 0.04, std('#b45309', 0.2, 0, { opacity: 0.9 }), 0.021)
  } else {
    // cestinha de papel com batatas fritas em pé
    cyl(g, 0, 0, 0, 0.04, 0.08, std('#dc2626', 0.7), 0.055)
    const fry = std('#facc15', 0.6)
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      const f = cyl(g, 0, 0, 0, 0.006, 0.09, fry)
      f.position.set(Math.cos(a) * 0.025, 0.1, Math.sin(a) * 0.025)
      f.rotation.set(Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25)
    }
  }
  outer.traverse((o) => {
    o.castShadow = false
  })
  return outer
}

// plaquinha do cardápio em cima do balcão (brilho fraco para achar no escuro)
export function menuDot() {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), glow('#fbbf24', 0.6))
  m.rotation.x = -Math.PI / 2
  return m
}

// Necessidades, todas de 0 a 1 (dinheiro em reais)
export interface Needs { stamina: number, bladder: number, drunk: number, hunger: number, money: number }
export const newNeeds = (): Needs => ({ stamina: 1, bladder: 0.15, drunk: 0, hunger: 0.2, money: 5000 })

// o que o jogador está fazendo agora (muda quanto cada necessidade sobe ou desce)
export interface Doing { running: boolean, moving: boolean, sitting: boolean, dancing: boolean, peeing: boolean }

export function stepNeeds(n: Needs, d: Doing, dt: number) {
  // stamina: correr gasta (~8 s do cheio ao zero), dançar gasta pouco; parado volta, sentado volta rápido;
  // com fome volta pela metade
  const regen = (d.sitting ? 0.14 : d.moving ? 0.05 : 0.08) * (n.hunger > 0.8 ? 0.5 : 1)
  n.stamina += (d.running ? -0.12 : d.dancing ? -0.015 : regen) * dt
  // xixi enche sozinho (~12 min) e com bebida; no vaso ou no mictório esvazia
  n.bladder += (d.peeing ? -0.2 : 0.0014) * dt
  // embriaguez passa devagar (~4 min do máximo ao sóbrio); fome sobe (~15 min)
  n.drunk -= 0.004 * dt
  n.hunger += 0.0011 * dt
  for (const k of ['stamina', 'bladder', 'drunk', 'hunger'] as const) n[k] = Math.max(0, Math.min(1, n[k]))
}

// um uso do item: efeitos na hora (com fome o álcool bate mais forte)
export function consume(n: Needs, kind: ItemKind) {
  const it = ITEMS[kind]
  n.drunk = Math.min(1, n.drunk + it.alcohol * (n.hunger > 0.6 ? 1.4 : 1))
  n.bladder = Math.min(1, n.bladder + it.bladder)
  n.hunger = Math.max(0, n.hunger - it.food)
}
