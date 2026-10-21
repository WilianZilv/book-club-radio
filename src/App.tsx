// Book Club Radio: tela cheia com o club em primeira pessoa, nome do jogador, mira, chat e o painel do DJ.
import { useEffect, useRef, useState } from 'react'
import { Beer, GlassWater, Hand, Keyboard, Martini, MonitorUp, Popcorn, Toilet, Utensils, Wallet, Wine, X, Zap, Mic, MicOff, MousePointerClick, Music, Music2, PartyPopper, Radio, Bot, Skull, Sparkles, Pointer, UserPen, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { AlbumPanel } from './AlbumPanel.tsx'
import { CharacterCreator, readAvatar } from './CharacterCreator.tsx'
import { DjPanel } from './DjPanel.tsx'
import { EMOTES } from './game/emotes.ts'
import { ITEMS, type Held, type ItemKind, type Needs } from './game/items.ts'
import { CAN_CAPTURE } from './videoFeed.ts'
import { Engine, IS_TOUCH, type Hud } from './game/engine.ts'
import type { Avatar, Hit } from './game/kit.ts'
import type { DjState, NetChat, NetPhoto } from './net.ts'

const NAME_KEY = 'bookclub:nome'
function readName() {
  try {
    return (localStorage.getItem(NAME_KEY) ?? '').trim().slice(0, 20)
  } catch {
    return ''
  }
}

const EMOTE_ICON: Record<string, LucideIcon> = { danca: Music, aceno: Hand, palmas: Sparkles, vibra: PartyPopper, robo: Bot, headbang: Skull, floss: Music2, aponta: Pointer }

// roda de emotes (B segurado): fatias em volta do centro, a apontada pelo mouse acende
function EmoteWheel({ sel }: { sel: number }) {
  const n = EMOTES.length
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 z-30 size-80 -translate-x-1/2 -translate-y-1/2">
      <div className="absolute inset-0 rounded-full bg-slate-950/70 shadow-2xl ring-1 ring-white/10 backdrop-blur" />
      <div className="absolute inset-[34%] flex items-center justify-center rounded-full bg-slate-950/85 text-center text-xs font-semibold text-white/80 ring-1 ring-white/10">
        {sel >= 0 ? EMOTES[sel].label : 'solte o B para escolher'}
      </div>
      {EMOTES.map((e, i) => {
        const a = (i / n) * Math.PI * 2
        const Icon = EMOTE_ICON[e.id] ?? Music
        return (
          <div
            key={e.id}
            className={cn('absolute flex size-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-semibold transition', i === sel ? 'scale-110 bg-fuchsia-400 text-fuchsia-950' : 'bg-white/5 text-white/80')}
            style={{ left: `${50 + Math.sin(a) * 38}%`, top: `${50 - Math.cos(a) * 38}%` }}
          >
            <Icon className="size-5" />
            {e.label}
          </div>
        )
      })}
    </div>
  )
}

function hoverLabel(hit: Hit, holding: boolean) {
  if (hit.kind === 'dj') return { title: 'DJ · Book Club Radio', sub: 'clique para escolher a música do telão' }
  if (hit.kind === 'seat') return { title: hit.label, sub: `${hit.sub ? `${hit.sub} · ` : ''}E para sentar · ande para levantar` }
  if ((hit.kind === 'npc' || hit.kind === 'player') && holding) return { title: hit.label, sub: 'E oferece o que está na mão' }
  return { title: hit.label, sub: hit.sub }
}

const ITEM_ICON: Record<ItemKind, LucideIcon> = { cerveja: Beer, drink: Martini, shot: GlassWater, batata: Popcorn }

// stamina, xixi, embriaguez e fome em barras; dinheiro embaixo. Barra alta de xixi/fome/embriaguez fica âmbar/vermelha
function NeedsPanel({ n }: { n: Needs }) {
  const rows: { icon: LucideIcon, label: string, v: number, bad: boolean, color: string }[] = [
    { icon: Zap, label: 'Stamina', v: n.stamina, bad: n.stamina < 0.2, color: 'bg-emerald-400' },
    { icon: Toilet, label: 'Xixi', v: n.bladder, bad: n.bladder > 0.8, color: 'bg-sky-400' },
    { icon: Wine, label: 'Embriaguez', v: n.drunk, bad: n.drunk > 0.7, color: 'bg-fuchsia-400' },
    { icon: Utensils, label: 'Fome', v: n.hunger, bad: n.hunger > 0.8, color: 'bg-amber-400' },
  ]
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-20 flex w-44 flex-col gap-1.5 rounded-xl bg-slate-950/70 px-3 py-2.5 text-[11px] text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
      {rows.map(({ icon: Icon, label, v, bad, color }) => (
        <div key={label} className="flex items-center gap-2" title={label}>
          <Icon className={cn('size-3.5 shrink-0', bad ? 'text-red-400' : 'text-white/70')} />
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className={cn('h-full rounded-full transition-[width] duration-500', bad ? 'bg-red-400' : color)} style={{ width: `${Math.round(v * 100)}%` }} />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-0.5 font-semibold">
        <Wallet className="size-3.5 text-white/70" />
        R$ {n.money}
      </div>
    </div>
  )
}

// as duas mãos: o item (com quantos goles faltam) ou vazia
function HandsBar({ hands }: { hands: (Held | null)[] }) {
  return (
    <div className="pointer-events-none flex gap-2">
      {hands.map((h, side) => {
        const Icon = h ? ITEM_ICON[h.kind] : Hand
        return (
          <div key={side} className={cn('flex w-40 items-center gap-2 rounded-xl px-3 py-2 text-xs shadow-lg ring-1 backdrop-blur', h ? 'bg-slate-950/80 text-white ring-white/15' : 'bg-slate-950/50 text-white/50 ring-white/5')}>
            <Icon className={cn('size-5 shrink-0', side === 0 && !h ? '-scale-x-100' : '')} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{h ? ITEMS[h.kind].label : 'Vazia'}</div>
              <div className="text-[10px] text-white/55">{side ? 'clique direito' : 'clique esquerdo'}</div>
            </div>
            {h ? (
              <div className="flex gap-0.5">
                {Array.from({ length: ITEMS[h.kind].uses }, (_, i) => (
                  <span key={i} className={cn('size-1.5 rounded-full', i < h.left ? 'bg-amber-300' : 'bg-white/15')} />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export default function App() {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<Engine | null>(null)
  const [hud, setHud] = useState<Hud>({ hover: null, locked: false, tuning: false, mic: false, wheel: null, emote: null, capture: 'off', needs: { stamina: 1, bladder: 0, drunk: 0, hunger: 0, money: 0 }, hands: [null, null], prompt: null, incoming: null, toast: null, peeing: false })
  const [failed, setFailed] = useState(false)
  // aviso da captura da aba (erro ou dica), some sozinho
  const [capMsg, setCapMsg] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [chatText, setChatText] = useState('')
  const [chat, setChat] = useState<NetChat[]>([])
  const [clock, setClock] = useState(() => Date.now())
  const [djOpen, setDjOpen] = useState(false)
  // álbum aberto: as fotos dele (as que já saíram dos quadros)
  const [album, setAlbum] = useState<NetPhoto[] | null>(null)
  const [djState, setDjState] = useState<DjState>({ queue: [], cur: null })
  const [name, setNameState] = useState(readName)
  // sem personagem salvo: a criação aparece antes de entrar; depois dá para editar pelo botão
  const [hasAvatar, setHasAvatar] = useState(() => !!readAvatar())
  const [editing, setEditing] = useState(false)

  const saveIdentity = (nm: string, av: Avatar) => {
    try {
      localStorage.setItem(NAME_KEY, nm)
    } catch {
      // sem storage: vale só nesta aba
    }
    setNameState(nm)
    setHasAvatar(true)
    setEditing(false)
    engine.current?.setIdentity(nm, av)
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    let eng: Engine
    try {
      const av = readAvatar()
      eng = new Engine(el, setHud, av ? readName() : '', av)
    } catch {
      setFailed(true)
      return
    }
    eng.onChatLog = (log) => setChat(log)
    eng.onChatOpen = () => setChatOpen(true)
    eng.onDjOpen = () => setDjOpen(true)
    eng.onAlbumOpen = () => setAlbum(eng.albumPhotos())
    eng.onDjState = (d) => setDjState(d)
    engine.current = eng
    if (import.meta.env.DEV) (window as unknown as { __club?: Engine }).__club = eng
    const ro = new ResizeObserver(() => eng.resize(el.clientWidth, el.clientHeight))
    ro.observe(el)
    eng.resize(el.clientWidth, el.clientHeight)
    return () => {
      ro.disconnect()
      eng.dispose()
      engine.current = null
    }
  }, [])

  // relógio para sumir mensagens antigas do log
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  if (failed) return <p className="m-auto p-10 text-center text-sm text-white/80">Este navegador não conseguiu iniciar o WebGL.</p>

  const hover = hud.hover
  const hoverText = hover ? hoverLabel(hover, hud.hands.some(Boolean)) : null
  const inGame = !!name && hasAvatar && !editing
  const closeChat = (relock: boolean) => {
    setChatOpen(false)
    setChatText('')
    if (relock) engine.current?.enter()
  }
  const shownChat = chatOpen ? chat.slice(-12) : chat.filter((c) => clock - c.at < 15000).slice(-6)
  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      {/* isolate: o z-index do canvas (acima do iframe do telão) não passa por cima da mira e do HUD */}
      <div ref={host} className="absolute inset-0 isolate" />
      {hud.tuning ? (
        <div className="pointer-events-none absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950/75 px-4 py-1.5 text-xs font-semibold text-fuchsia-200 shadow-lg ring-1 ring-fuchsia-400/30 backdrop-blur">
          <Radio className="size-4 animate-pulse" />
          Sintonizando a rádio…
        </div>
      ) : null}
      {/* microfone da voz por proximidade (tecla M dentro do jogo) */}
      <button
        type="button"
        onClick={() => void engine.current?.toggleMic()}
        title={hud.mic ? 'Microfone ligado: quem está perto te ouve (M desliga)' : 'Ligar o microfone: voz por proximidade (M)'}
        className={cn('absolute top-3 right-3 z-30 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg ring-1 ring-white/10 backdrop-blur', hud.mic ? 'bg-emerald-400 text-emerald-950' : 'bg-slate-950/70 text-white/80 hover:bg-slate-950/85')}
      >
        {hud.mic ? <Mic className="size-4" /> : <MicOff className="size-4" />}
        {hud.mic ? 'Microfone ligado' : 'Microfone'}
      </button>
      {/* plano B do telão: o YouTube bloqueou o yt-dlp; gravando o player desta aba, o telão volta a ser nosso */}
      {hud.capture === 'offer' && CAN_CAPTURE ? (
        <button
          type="button"
          onClick={() => {
            void engine.current?.startCapture().then((err) => {
              setCapMsg(err)
              if (err) window.setTimeout(() => setCapMsg(''), 7000)
            })
          }}
          title="O YouTube bloqueou o nosso player. Grave o player desta aba (escolha esta aba e marque o som) para o telão, o domo e a batida voltarem."
          className="absolute top-14 right-3 z-30 flex items-center gap-1.5 rounded-full bg-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-950 shadow-lg ring-1 ring-amber-100/40 hover:bg-amber-200"
        >
          <MonitorUp className="size-4" />
          Ligar o telão pela aba
        </button>
      ) : null}
      {hud.capture === 'on' ? (
        <button
          type="button"
          onClick={() => engine.current?.stopCapture()}
          title="Parar de gravar a aba (o telão volta a tentar o yt-dlp)"
          className="absolute top-14 right-3 z-30 flex items-center gap-1.5 rounded-full bg-slate-950/70 px-3 py-1.5 text-xs font-semibold text-white/80 shadow-lg ring-1 ring-white/10 backdrop-blur hover:bg-slate-950/85"
        >
          <MonitorUp className="size-4 text-emerald-300" />
          Telão pela aba
          <X className="size-3.5" />
        </button>
      ) : null}
      {capMsg ? (
        <div className="pointer-events-none absolute top-24 right-3 z-30 max-w-xs rounded-xl bg-slate-950/85 px-3 py-2 text-xs text-white shadow-lg ring-1 ring-white/10 backdrop-blur">{capMsg}</div>
      ) : null}
      {hud.wheel !== null ? <EmoteWheel sel={hud.wheel} /> : null}
      {album ? (
        <AlbumPanel
          photos={album}
          onClose={() => {
            setAlbum(null)
            engine.current?.enter()
          }}
        />
      ) : null}
      {djOpen && engine.current ? (
        <DjPanel
          net={engine.current.net}
          player={engine.current.dj}
          dj={djState}
          onClose={() => {
            setDjOpen(false)
            engine.current?.enter()
          }}
        />
      ) : null}
      {/* chat: log no canto e caixa de texto (Enter abre, Enter envia, Esc fecha) */}
      <div className="absolute bottom-3 left-3 z-20 flex w-[min(420px,calc(100%-24px))] flex-col gap-1">
        {shownChat.map((c, i) => (
          <div key={`${c.at}-${i}`} className="w-fit max-w-full rounded-lg bg-slate-950/70 px-2.5 py-1 text-xs text-white shadow ring-1 ring-white/10 backdrop-blur">
            <span className={cn('mr-1.5 font-bold', c.mine ? 'text-amber-300' : c.name === 'Rádio' ? 'text-fuchsia-300' : 'text-sky-300')}>{c.mine ? 'Você' : c.name}</span>
            {c.text}
          </div>
        ))}
        {chatOpen ? (
          <input
            autoFocus
            value={chatText}
            maxLength={140}
            placeholder="Mensagem (Enter envia, Esc fecha)"
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                engine.current?.say(chatText)
                closeChat(true)
              } else if (e.key === 'Escape') closeChat(false)
            }}
            className="rounded-lg bg-slate-950/85 px-3 py-2 text-sm text-white shadow-lg ring-1 ring-amber-300/60 outline-none placeholder:text-white/40"
          />
        ) : null}
      </div>
      {inGame ? (
        <>
          <NeedsPanel n={hud.needs} />
          {/* mãos embaixo no centro; em cima delas: aviso, escolha de mão pendente e oferta recebida */}
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
            {hud.incoming ? (
              <div className="rounded-xl bg-fuchsia-950/85 px-4 py-2 text-center text-xs text-white shadow-lg ring-1 ring-fuchsia-300/40 backdrop-blur">
                <b>{hud.incoming.name}</b> te oferece {ITEMS[hud.incoming.kind].label.toLowerCase()} · <b className="text-fuchsia-200">Y</b> aceita · <b className="text-fuchsia-200">N</b> recusa
              </div>
            ) : null}
            {hud.prompt ? <div className="rounded-xl bg-amber-300 px-4 py-1.5 text-xs font-semibold text-amber-950 shadow-lg">{hud.prompt}</div> : null}
            {hud.toast ? <div className="rounded-xl bg-slate-950/85 px-4 py-1.5 text-xs text-white shadow-lg ring-1 ring-white/10 backdrop-blur">{hud.toast}</div> : null}
            <HandsBar hands={hud.hands} />
          </div>
        </>
      ) : null}
      {hud.locked ? (
        <>
          <div className="pointer-events-none absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
            <div className={hover ? 'size-4 rounded-full border-2 border-amber-300 shadow' : 'size-1.5 rounded-full bg-white shadow ring-1 ring-black/40'} />
          </div>
          {hoverText ? (
            <div className="pointer-events-none absolute top-[calc(50%+22px)] left-1/2 z-20 max-w-sm -translate-x-1/2 rounded-xl bg-slate-950/80 px-3 py-1.5 text-center text-xs text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
              <div className="font-semibold">{hoverText.title}</div>
              {hoverText.sub ? <div className="text-white/70">{hoverText.sub}</div> : null}
            </div>
          ) : null}
        </>
      ) : chatOpen || djOpen || album ? null : !name || !hasAvatar || editing ? (
        // antes de entrar: criar o personagem (sem senha), salvo neste navegador
        <CharacterCreator name={name} onDone={saveIdentity} onCancel={name && hasAvatar ? () => setEditing(false) : undefined} />
      ) : (
        <button type="button" onClick={() => engine.current?.enter()} className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-slate-950/80 px-8 py-5 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <MousePointerClick className="size-7 text-fuchsia-300" />
            <span className="text-base font-semibold">{IS_TOUCH ? 'Este jogo precisa de mouse e teclado' : 'Clique para entrar no club'}</span>
            <div className="flex items-center gap-2 text-xs text-white/70">
              <Keyboard className="size-4" />
              WASD anda · Shift corre · espaço pula · mouse olha · Z zoom · clique esquerdo/direito pega e usa com cada mão · G larga · E oferece/senta · B emotes · M microfone · Enter conversa · Esc solta
            </div>
            <span className="text-xs text-white/50">entrando como <b className="text-fuchsia-300">{name}</b></span>
          </div>
          {/* editar personagem (span: não dá para ter botão dentro de botão) */}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-slate-950/80 px-3.5 py-1.5 text-xs font-semibold text-white/85 ring-1 ring-white/10 hover:bg-slate-900"
          >
            <UserPen className="size-4" />
            Editar personagem
          </span>
        </button>
      )}
    </div>
  )
}
