// Emotes da roda (segura B, aponta com o mouse e solta): animação procedural no boneco. As de dança seguem a música
// (grave no corpo, médio nos braços, agudo na cabeça); sem música, seguem um relógio próprio.
import type { PersonRig } from './kit.ts'

export const EMOTES = [
  { id: 'danca', label: 'Dança' },
  { id: 'aceno', label: 'Aceno' },
  { id: 'palmas', label: 'Palmas' },
  { id: 'vibra', label: 'Vibrar' },
  { id: 'robo', label: 'Robô' },
  { id: 'headbang', label: 'Headbang' },
  { id: 'floss', label: 'Floss' },
  { id: 'aponta', label: 'Apontar' },
] as const
export type EmoteId = (typeof EMOTES)[number]['id']
// quanto dura (s); 0 = até andar
export const EMOTE_LEN: Record<string, number> = { danca: 0, aceno: 3, palmas: 4, vibra: 3.5, robo: 0, headbang: 0, floss: 0, aponta: 3 }

// g: grooves em radianos (1 ciclo por ataque da faixa); music: tem música
export function animateEmote(p: PersonRig, name: string, t: number, g: { lo: number, mid: number, hi: number, music: boolean }) {
  for (const j of [p.upper, p.head, p.armL, p.armR, p.foreL, p.foreR, p.hipL, p.hipR, p.kneeL, p.kneeR]) j.rotation.set(0, 0, 0)
  p.body.position.y = 0
  // sem música, as danças seguem ~2 batidas por segundo
  const lo = g.music ? g.lo : t * Math.PI * 4
  const mid = g.music ? g.mid : t * Math.PI * 4
  const hi = g.music ? g.hi : t * Math.PI * 8
  switch (name) {
    case 'danca': {
      const l2 = lo / 2
      p.body.position.y = Math.abs(Math.sin(l2)) * 0.1
      p.upper.rotation.z = Math.sin(l2) * 0.15
      p.upper.rotation.y = Math.sin(l2 / 2) * 0.3
      p.hipL.rotation.x = Math.max(0, Math.sin(l2)) * -0.4
      p.hipR.rotation.x = Math.max(0, -Math.sin(l2)) * -0.4
      p.kneeL.rotation.x = Math.max(0, Math.sin(l2)) * 0.6
      p.kneeR.rotation.x = Math.max(0, -Math.sin(l2)) * 0.6
      const m2 = mid / 2
      p.armL.rotation.set(-2.5 + Math.sin(m2) * 0.4, 0, -0.35)
      p.armR.rotation.set(-0.7 - Math.sin(m2) * 0.5, 0, 0.35)
      p.foreL.rotation.x = -0.5
      p.foreR.rotation.x = -0.9 + Math.sin(m2 * 2) * 0.3
      p.head.rotation.x = Math.sin(hi) * 0.18
      break
    }
    case 'aceno':
      p.armR.rotation.set(-2.7, 0, 0.25 + Math.sin(t * 9) * 0.35)
      p.foreR.rotation.x = -0.35
      p.head.rotation.z = Math.sin(t * 2) * 0.08
      p.armL.rotation.z = -0.1
      break
    case 'palmas': {
      // braços para a frente, mãos batendo no meio
      const c = Math.abs(Math.sin(t * 6))
      p.armL.rotation.set(-1.25, 0, 0.55 * (1 - c) - 0.1)
      p.armR.rotation.set(-1.25, 0, -0.55 * (1 - c) + 0.1)
      p.foreL.rotation.x = -0.5
      p.foreR.rotation.x = -0.5
      p.body.position.y = Math.abs(Math.sin(t * 3)) * 0.03
      p.head.rotation.x = -0.05
      break
    }
    case 'vibra':
      // braços para o alto, pulando
      p.body.position.y = Math.abs(Math.sin(t * 5)) * 0.18
      p.armL.rotation.set(-2.9 + Math.sin(t * 10) * 0.15, 0, -0.35)
      p.armR.rotation.set(-2.9 - Math.sin(t * 10) * 0.15, 0, 0.35)
      p.foreL.rotation.x = -0.2
      p.foreR.rotation.x = -0.2
      p.kneeL.rotation.x = Math.abs(Math.sin(t * 5)) * 0.4
      p.kneeR.rotation.x = Math.abs(Math.sin(t * 5)) * 0.4
      p.head.rotation.x = -0.2
      break
    case 'robo': {
      // poses duras trocando no tempo (sem suavizar)
      const k = Math.floor((g.music ? g.lo / Math.PI : t * 2.5)) % 4
      const poses = [
        [-1.57, 0, -1.57, 0, 0.3],
        [0, -1.57, 0, -1.57, -0.3],
        [-1.57, -1.57, -1.57, 0, 0.3],
        [-0.8, 0, -0.8, -1.57, -0.3],
      ]
      const [al, fl, ar, fr, hy] = poses[k]
      p.armL.rotation.x = al
      p.foreL.rotation.x = fl
      p.armR.rotation.x = ar
      p.foreR.rotation.x = fr
      p.head.rotation.y = hy
      p.upper.rotation.y = -hy * 0.5
      break
    }
    case 'headbang':
      p.upper.rotation.x = 0.25 + Math.sin(lo) * 0.2
      p.head.rotation.x = Math.sin(hi) * 0.45
      p.armL.rotation.set(-0.5, 0, -0.2)
      p.armR.rotation.set(-2.6, 0, 0.3)
      p.foreR.rotation.x = -0.3
      p.kneeL.rotation.x = 0.15 + Math.abs(Math.sin(lo)) * 0.15
      p.kneeR.rotation.x = 0.15 + Math.abs(Math.sin(lo)) * 0.15
      break
    case 'floss': {
      // braços esticados balançando de um lado para o outro, quadril no contrário
      const s = Math.sin(mid)
      const side = Math.sign(Math.sin(mid * 0.5))
      p.armL.rotation.set(side * 0.35, 0, s * 0.55 - 0.15)
      p.armR.rotation.set(-side * 0.35, 0, s * 0.55 + 0.15)
      p.upper.rotation.z = -s * 0.15
      p.hipL.rotation.z = -s * 0.15
      p.hipR.rotation.z = -s * 0.15
      p.body.position.y = Math.abs(s) * 0.03
      break
    }
    case 'aponta':
      p.armR.rotation.set(-1.6, 0, -0.1)
      p.foreR.rotation.x = -0.05
      p.armL.rotation.set(-0.3, 0, -0.2)
      p.body.position.y = Math.abs(Math.sin(t * 4)) * 0.05
      p.head.rotation.x = -0.1
      break
  }
}

// falando: o sorriso some e a boca aparece, abrindo com o grave, esticando com o médio e tremendo com o agudo;
// calado: volta o sorriso (a boca fica até 0,35 s depois da última sílaba, sem piscar entre elas)
export function animateMouth(p: PersonRig, lv: number[], t: number, talking: boolean) {
  const m = p.mouth
  if (!m) return
  if (talking) p.talkAt = t
  const open = t - (p.talkAt ?? -10) < 0.35
  m.visible = open
  if (p.smile) p.smile.visible = !open
  if (!open) return
  m.scale.set(0.03 * (1 + lv[1] * 0.5), 0.002 + lv[0] * 0.03 + lv[2] * 0.008 * Math.abs(Math.sin(t * 40)), 0.012)
}
