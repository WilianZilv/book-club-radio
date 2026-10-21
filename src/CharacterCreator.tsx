// Criação de personagem antes de entrar: nome, pele, cabelo (cor e corte), camiseta, calça e acessório, com o
// boneco girando num preview 3D próprio. Fica salvo neste navegador.
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Dices, RotateCw } from 'lucide-react'

import { cn } from '@/lib/utils'
import { HAIR, HAIR_STYLES, PANTS3, ROLES, SHIRT, SKIN, makeAvatarPerson, type Avatar } from './game/kit.ts'

const AVATAR_KEY = 'bookclub:avatar'
const ACCESSORY = ['Fone', 'Óculos', 'Chapéu', 'Gravata', 'Boina', 'Monóculo', 'Capacete', 'Óculos de proteção']
const STYLE_NAMES = ['Franja', 'Chanel', 'Coque', 'Cacheado', 'Rabo de cavalo']

export function readAvatar(): Avatar | null {
  try {
    const a = JSON.parse(localStorage.getItem(AVATAR_KEY) ?? 'null') as Avatar | null
    if (!a || typeof a !== 'object') return null
    const n = (v: unknown, m: number) => (Number.isInteger(v) ? Math.abs(v as number) % m : 0)
    return { skin: n(a.skin, SKIN.length), hair: n(a.hair, HAIR.length), style: n(a.style, HAIR_STYLES), shirt: n(a.shirt, SHIRT.length), pants: n(a.pants, PANTS3.length), role: n(a.role, ROLES.length) }
  } catch {
    return null
  }
}

function saveAvatar(a: Avatar) {
  try {
    localStorage.setItem(AVATAR_KEY, JSON.stringify(a))
  } catch {
    // sem storage: vale só nesta aba
  }
}

const rnd = (m: number) => Math.floor(Math.random() * m)
const randomAvatar = (): Avatar => ({ skin: rnd(SKIN.length), hair: rnd(HAIR.length), style: rnd(HAIR_STYLES), shirt: rnd(SHIRT.length), pants: rnd(PANTS3.length), role: rnd(ROLES.length) })

// boneco girando (refeito a cada troca); renderer próprio, pequeno
function Preview({ avatar }: { avatar: Avatar }) {
  const host = useRef<HTMLDivElement>(null)
  const state = useRef<{ scene: THREE.Scene, rig: THREE.Object3D | null } | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight('#ffe9f5', '#2a2140', 1.6))
    const key = new THREE.DirectionalLight('#ffffff', 2.4)
    key.position.set(2, 3, 3)
    scene.add(key)
    const rim = new THREE.DirectionalLight('#d946ef', 2)
    rim.position.set(-2, 2, -2.5)
    scene.add(rim)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.7, 40), new THREE.MeshStandardMaterial({ color: '#3b2f4a', roughness: 0.8 }))
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20)
    camera.position.set(0, 1.25, 3.9)
    camera.lookAt(0, 0.95, 0)
    state.current = { scene, rig: null }
    const size = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(el)
    let raf = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      const rig = state.current?.rig
      if (rig) rig.rotation.y = Math.sin(t / 2200) * 0.9
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.dispose()
      renderer.domElement.remove()
      state.current = null
    }
  }, [])

  useEffect(() => {
    const st = state.current
    if (!st) return
    if (st.rig) st.scene.remove(st.rig)
    const rig = makeAvatarPerson('preview', avatar)
    st.scene.add(rig.root)
    st.rig = rig.root
  }, [avatar])

  return <div ref={host} className="h-72 w-full sm:h-full" />
}

function Swatches({ colors, value, onPick }: { colors: string[], value: number, onPick: (i: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c, i) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(i)}
          aria-label={`cor ${i + 1}`}
          className={cn('size-7 rounded-full ring-2 ring-offset-2 ring-offset-slate-950 transition', i === value ? 'ring-fuchsia-300' : 'ring-transparent hover:ring-white/30')}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}

function Chips({ labels, value, onPick }: { labels: string[], value: number, onPick: (i: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((l, i) => (
        <button
          key={l}
          type="button"
          onClick={() => onPick(i)}
          className={cn('rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition', i === value ? 'bg-fuchsia-400 text-fuchsia-950 ring-fuchsia-300' : 'bg-white/5 text-white/80 ring-white/10 hover:bg-white/10')}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

export function CharacterCreator({ name, onDone, onCancel }: { name: string, onDone: (name: string, avatar: Avatar) => void, onCancel?: () => void }) {
  const [draft, setDraft] = useState(name)
  const [av, setAv] = useState<Avatar>(() => readAvatar() ?? randomAvatar())
  const set = (k: keyof Avatar) => (i: number) => setAv((a) => ({ ...a, [k]: i }))
  const nm = draft.replace(/\s+/g, ' ').trim().slice(0, 20)

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/60 p-4 text-white">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!nm) return
          saveAvatar(av)
          onDone(nm, av)
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="grid w-full max-w-3xl overflow-hidden rounded-2xl bg-slate-950/92 shadow-2xl ring-1 ring-white/10 backdrop-blur sm:grid-cols-[1fr_1.25fr]"
      >
        <div className="relative bg-gradient-to-b from-fuchsia-950/40 to-slate-950">
          <Preview avatar={av} />
          <button
            type="button"
            onClick={() => setAv(randomAvatar())}
            className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-white/85 ring-1 ring-white/10 hover:bg-slate-900"
          >
            <Dices className="size-4" />
            Aleatório
          </button>
        </div>
        <div className="flex flex-col gap-3.5 px-6 py-5">
          <span className="text-lg font-bold">Seu personagem</span>
          <label className="flex flex-col gap-1.5 text-xs text-white/70">
            Nome no club
            <input
              autoFocus
              value={draft}
              maxLength={20}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="como você quer ser chamado"
              className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-white/40 focus:ring-fuchsia-300/60"
            />
          </label>
          <Field label="Pele"><Swatches colors={SKIN} value={av.skin} onPick={set('skin')} /></Field>
          <Field label="Cabelo"><Swatches colors={HAIR} value={av.hair} onPick={set('hair')} /></Field>
          <Field label="Corte"><Chips labels={STYLE_NAMES} value={av.style} onPick={set('style')} /></Field>
          <Field label="Camiseta"><Swatches colors={SHIRT} value={av.shirt} onPick={set('shirt')} /></Field>
          <Field label="Calça"><Swatches colors={PANTS3} value={av.pants} onPick={set('pants')} /></Field>
          <Field label="Acessório"><Chips labels={ACCESSORY} value={av.role} onPick={set('role')} /></Field>
          <div className="mt-1 flex gap-2">
            {onCancel ? (
              <button type="button" onClick={onCancel} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/15">
                Cancelar
              </button>
            ) : null}
            <button type="submit" disabled={!nm} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-fuchsia-400 px-3 py-2 text-sm font-bold text-fuchsia-950 disabled:opacity-40">
              <RotateCw className={cn('size-4', onCancel ? '' : 'hidden')} />
              {onCancel ? 'Salvar' : 'Entrar no club'}
            </button>
          </div>
          <span className="text-xs text-white/50">Sem senha: nome e personagem ficam salvos neste navegador e aparecem para os outros.</span>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-white/70">{label}</span>
      {children}
    </div>
  )
}
