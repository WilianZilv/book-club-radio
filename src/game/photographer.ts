// Fotógrafo: anda o tempo todo pelo club e pela área de fumantes, um trecho de LEG segundos por foto. Cada trecho
// sorteia (pelo número dele, igual em todo mundo) uma parada; em metade das vezes ele escolhe alguém perto dela (NPC
// ou jogador), para na frente da pessoa e enquadra o rosto. O caminho sai de uma busca (A*) numa grade do chão livre
// do club, do corredor da esquerda e do terraço, então ele contorna sofás, mesas e bancos.

// paradas (x, z) e para onde a câmera aponta (x, y, z); as do terraço/corredor têm x < 0
export const PHOTO_STOPS: { x: number, z: number, look: [number, number, number] }[] = [
  { x: 15.5, z: 12.5, look: [15.5, 2.2, 2.8] },
  { x: 21.5, z: 11.8, look: [15.5, 1.3, 8] },
  { x: 9.5, z: 11.8, look: [15.5, 1.3, 8] },
  { x: 23, z: 18, look: [15.5, 1.4, 9] },
  { x: 8, z: 18, look: [15.5, 1.3, 8] },
  { x: 15.5, z: 20, look: [15.5, 2.4, 3] },
  { x: 19, z: 27.6, look: [19, 1.3, 30.6] },
  { x: 12, z: 27.4, look: [15, 1.3, 30.6] },
  { x: 26, z: 22, look: [20, 1.3, 27] },
  { x: 5, z: 24.75, look: [12, 1.4, 20] },
  { x: -4, z: 24.75, look: [8, 1.5, 24.75] },
  { x: -11.5, z: 21, look: [-15, 1.3, 24.75] },
  { x: -11.5, z: 28.5, look: [-15, 1.3, 24] },
  { x: -14.5, z: 24.75, look: [-17.5, 1.2, 21] },
]
const LEG = 26
// grade de busca: células de 0,5 m sobre club, corredor e terraço
const CELL = 0.5
const GX0 = -20.5
const GZ0 = -0.5
const GW = 106
const GH = 71
// quanto tempo depois de parar ele dispara (antes: levanta a câmera; depois: confere a foto)
export const SHOOT_AT = 2.3
const NEAR = 8
const FRAME_DIST = 2.3

// face: para onde a pessoa está virada (ângulo do boneco, frente em +z), para ele fotografar de frente
export interface Person { id: string, x: number, z: number, head: number, face?: number }
export interface PhotographerState {
  x: number
  z: number
  // para onde o corpo vira (frente do boneco em +z)
  rot: number
  walking: boolean
  // 0 câmera baixa, 1 câmera no rosto
  aim: number
  // trecho atual (número global) e a hora (s, relógio do servidor) do disparo dele
  slot: number
  shootAt: number
  look: [number, number, number]
}

interface Leg { stop: number, x: number, z: number, look: [number, number, number] }
type P = { x: number, z: number }

// sorteio estável pelo número do trecho (todo cliente chega no mesmo)
function hash(k: number, salt: number) {
  let h = (k * 374761393 + salt * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

const terrace = (p: { x: number }) => p.x < 0.5

export class Photographer {
  legs = new Map<number, Leg>()
  routes = new Map<number, P[]>()
  // pessoas que dá para fotografar (NPCs e jogadores), se um ponto do chão está livre e a altura do piso
  people: () => Person[]
  blocked: (x: number, z: number) => boolean
  floorAt: (x: number, z: number) => number
  grid: Uint8Array | null = null

  constructor(people: () => Person[], blocked: (x: number, z: number) => boolean, floorAt: (x: number, z: number) => number) {
    this.people = people
    this.blocked = blocked
    this.floorAt = floorAt
  }

  // chão onde ele pode andar: dentro do club, do corredor da esquerda ou do terraço; livre; no nível do chão
  walkable(x: number, z: number) {
    const zone = (x > 0.3 && x < 30.7 && z > 0.3 && z < 33.7) || (x > -9.2 && x <= 0.3 && z > 23.7 && z < 25.8) || (x > -19.7 && x <= -9.2 && z > 18.8 && z < 30.7)
    return zone && !this.blocked(x, z) && this.floorAt(x, z) < 0.05
  }

  cellOk(i: number, j: number) {
    if (i < 0 || j < 0 || i >= GW || j >= GH) return false
    if (!this.grid) {
      this.grid = new Uint8Array(GW * GH)
      for (let jj = 0; jj < GH; jj++) for (let ii = 0; ii < GW; ii++) this.grid[jj * GW + ii] = this.walkable(GX0 + (ii + 0.5) * CELL, GZ0 + (jj + 0.5) * CELL) ? 1 : 0
    }
    return this.grid[j * GW + i] === 1
  }

  // A* de a até b na grade (8 vizinhos, sem cortar canto) e encurtado em linhas retas livres
  findPath(a: P, b: P): P[] | null {
    const ci = (x: number) => Math.floor((x - GX0) / CELL)
    const cj = (z: number) => Math.floor((z - GZ0) / CELL)
    const near = (x: number, z: number) => {
      let best: [number, number] | null = null
      let bd = 1e9
      const i0 = ci(x)
      const j0 = cj(z)
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        if (!this.cellOk(i0 + di, j0 + dj)) continue
        const d = di * di + dj * dj
        if (d < bd) {
          bd = d
          best = [i0 + di, j0 + dj]
        }
      }
      return best
    }
    const s = near(a.x, a.z)
    const g = near(b.x, b.z)
    if (!s || !g) return null
    const key = (i: number, j: number) => j * GW + i
    const goal = key(g[0], g[1])
    const gs = new Map<number, number>([[key(s[0], s[1]), 0]])
    const from = new Map<number, number>()
    const open: [number, number][] = [[0, key(s[0], s[1])]]
    const closed = new Set<number>()
    while (open.length) {
      let bi = 0
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i
      const [, cur] = open.splice(bi, 1)[0]
      if (cur === goal) break
      if (closed.has(cur)) continue
      closed.add(cur)
      const i = cur % GW
      const j = Math.floor(cur / GW)
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue
        const ni = i + di
        const nj = j + dj
        if (!this.cellOk(ni, nj) || (di && dj && (!this.cellOk(i + di, j) || !this.cellOk(i, j + dj)))) continue
        const nk = key(ni, nj)
        const ng = (gs.get(cur) ?? 0) + (di && dj ? 1.414 : 1)
        if (ng >= (gs.get(nk) ?? 1e9)) continue
        gs.set(nk, ng)
        from.set(nk, cur)
        open.push([ng + Math.hypot(g[0] - ni, g[1] - nj), nk])
      }
    }
    if (!gs.has(goal)) return null
    const cells: P[] = []
    for (let c: number | undefined = goal; c !== undefined; c = from.get(c)) cells.push({ x: GX0 + ((c % GW) + 0.5) * CELL, z: GZ0 + (Math.floor(c / GW) + 0.5) * CELL })
    cells.reverse()
    const pts = [a, ...cells, b]
    // encurta: de cada ponto, pula para o mais longe que dá para ver em linha reta
    const out: P[] = [pts[0]]
    let i = 0
    while (i < pts.length - 1) {
      let j = pts.length - 1
      while (j > i + 1 && !this.clear(pts[i], pts[j])) j--
      out.push(pts[j])
      i = j
    }
    return out
  }

  clear(a: P, b: P) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25)
    for (let i = 1; i < n; i++) if (this.blocked(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n)) return false
    return true
  }

  // parada do trecho k: a sorteada (nunca a mesma do trecho anterior) ou, metade das vezes, alguém perto dela
  leg(k: number): Leg {
    const hit = this.legs.get(k)
    if (hit) return hit
    const n = PHOTO_STOPS.length
    const base = (k: number) => hash(k, 1) % n
    let stop = base(k)
    if (stop === base(k - 1)) stop = (stop + 1) % n
    const s = PHOTO_STOPS[stop]
    let leg: Leg = { stop, x: s.x, z: s.z, look: s.look }
    if (hash(k, 2) % 100 < 50) {
      // gente perto da parada, do mesmo lado (club ou terraço), no chão (camarote não: ele não sobe escada)
      const near = this.people()
        .filter((p) => Math.hypot(p.x - s.x, p.z - s.z) < NEAR && terrace(p) === terrace(s) && p.head < 2.2 && p.x < 31)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
      if (near.length) {
        const who = near[hash(k, 3) % near.length]
        // fica a FRAME_DIST da pessoa, de frente para ela (sem saber para onde ela olha, do lado de onde ele vem);
        // sem chão livre ali, vai girando em volta
        const a0 = who.face ?? Math.atan2(s.x - who.x, s.z - who.z)
        for (let i = 0; i < 12; i++) {
          const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6)
          const x = who.x + Math.sin(a) * FRAME_DIST
          const z = who.z + Math.cos(a) * FRAME_DIST
          if (!this.walkable(x, z)) continue
          leg = { stop, x, z, look: [who.x, who.head, who.z] }
          break
        }
      }
    }
    this.legs.set(k, leg)
    // guarda só os trechos recentes
    for (const key of this.legs.keys()) if (key < k - 4) this.legs.delete(key)
    return leg
  }

  // caminho do trecho k: da parada do anterior até a deste (A* contornando tudo; sem caminho, vai reto)
  route(k: number): P[] {
    const hit = this.routes.get(k)
    if (hit) return hit
    const a = this.leg(k - 1)
    const b = this.leg(k)
    const pts = this.findPath({ x: a.x, z: a.z }, { x: b.x, z: b.z }) ?? [{ x: a.x, z: a.z }, { x: b.x, z: b.z }]
    this.routes.set(k, pts)
    for (const key of this.routes.keys()) if (key < k - 4) this.routes.delete(key)
    return pts
  }

  at(t: number): PhotographerState {
    const k = Math.floor(t / LEG)
    const tt = t - k * LEG
    const pts = this.route(k)
    const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.z - pts[i].z))
    const total = lens.reduce((a, b) => a + b, 0)
    // longe (terraço): anda mais rápido para ainda sobrar a parada
    const speed = Math.max(1.05, total / (LEG - 7.5))
    const walk = total / speed
    const leg = this.leg(k)
    const shootAt = k * LEG + walk + SHOOT_AT
    if (tt < walk && total > 0.01) {
      let d = tt * speed
      for (let i = 0; i < lens.length; i++) {
        if (d <= lens[i] || i === lens.length - 1) {
          const f = lens[i] ? Math.min(1, d / lens[i]) : 1
          const a = pts[i]
          const b = pts[i + 1]
          return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, rot: Math.atan2(b.x - a.x, b.z - a.z), walking: true, aim: 0, slot: k, shootAt, look: leg.look }
        }
        d -= lens[i]
      }
    }
    const p = tt - walk
    const pause = LEG - walk
    // levanta a câmera em ~0,8 s, segura e abaixa no fim da parada
    const aim = Math.max(0, Math.min(1, p / 0.8, (pause - p) / 0.6))
    return { x: leg.x, z: leg.z, rot: Math.atan2(leg.look[0] - leg.x, leg.look[2] - leg.z), walking: false, aim, slot: k, shootAt, look: leg.look }
  }
}
