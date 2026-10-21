// Painel do DJ (clicar no DJ ou na mesa): link do YouTube, fila e timestamp do que toca agora.
// Tudo passa pelo servidor do multiplayer, então vale para todo mundo ao mesmo tempo.
import { useEffect, useState } from 'react'
import { ListMusic, Music, Play, Plus, SkipForward, Trash2, Volume2, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { DjState, Net } from './net.ts'
import type { DjPlayer } from './djPlayer.ts'

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

// "1:23", "1:02:03", "83" ou "1h2m3s" -> segundos
function parseTime(v: string): number | null {
  const t = v.trim()
  if (!t) return null
  if (/^\d+(:\d{1,2}){0,2}$/.test(t)) return t.split(':').reduce((a, p) => a * 60 + Number(p), 0)
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  return null
}

export function DjPanel({ net, player, dj, onClose }: { net: Net, player: DjPlayer, dj: DjState, onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [ts, setTs] = useState('')
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 500)
    return () => window.clearInterval(id)
  }, [])
  const cur = dj.cur
  const pos = cur ? net.djPosition() : 0
  const dur = player.duration()
  const title = player.title() || cur?.item.title || ''
  const valid = /youtu\.?be/.test(url)
  const add = (now: boolean) => {
    if (!valid) return
    net.send({ t: 'dj-add', url, now })
    setUrl('')
    player.unlock()
  }
  const seek = (sec: number) => net.send({ t: 'dj-seek', sec })
  const tsSec = parseTime(ts)
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/40 p-4" onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex max-h-full w-full max-w-lg flex-col gap-3 overflow-hidden rounded-2xl bg-slate-950/92 p-4 text-white shadow-2xl ring-1 ring-violet-400/40 backdrop-blur">
        <div className="flex items-center gap-2">
          <Music className="size-5 text-violet-300" />
          <h2 className="flex-1 text-base font-bold">Book Club Radio · DJ</h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="rounded-full p-1 hover:bg-white/10">
            <X className="size-4" />
          </button>
        </div>

        {/* tocando agora + timestamp */}
        <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
          <div className="text-[11px] font-semibold tracking-wide text-violet-300 uppercase">Tocando agora</div>
          {cur ? (
            <>
              <div className="mt-0.5 truncate text-sm font-semibold" title={title}>{title}</div>
              <div className="text-[11px] text-white/50">
                {cur.item.kind === 'playlist' ? `playlist · faixa ${cur.index + 1}` : 'vídeo'} · por {cur.item.by}
              </div>
              <input
                type="range"
                aria-label="Posição"
                min={0}
                max={Math.max(1, Math.floor(dur || pos + 1))}
                value={Math.min(Math.floor(pos), Math.floor(dur || pos + 1))}
                onChange={(e) => seek(Number(e.target.value))}
                className="mt-2 w-full accent-violet-400"
              />
              <div className="flex items-center justify-between text-[11px] text-white/60 tabular-nums">
                <span>{fmt(pos)}</span>
                <span>{dur ? fmt(dur) : '--:--'}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={ts}
                  onChange={(e) => setTs(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tsSec !== null) {
                      seek(tsSec)
                      setTs('')
                    }
                  }}
                  placeholder="ir para (ex.: 1:23:45 ou 12m30s)"
                  className="min-w-0 flex-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-violet-400/60"
                />
                <button
                  type="button"
                  disabled={tsSec === null}
                  onClick={() => {
                    if (tsSec !== null) seek(tsSec)
                    setTs('')
                  }}
                  className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                >
                  Ir
                </button>
                <button type="button" onClick={() => net.send({ t: 'dj-skip' })} title="Pular para o próximo da fila" className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20">
                  <SkipForward className="size-4" />
                </button>
                <button type="button" onClick={() => player.unlock()} title="Ativar som (se o navegador bloqueou)" className={cn('rounded-lg p-1.5', player.blocked ? 'bg-amber-400 text-amber-950' : 'bg-white/10 hover:bg-white/20')}>
                  <Volume2 className="size-4" />
                </button>
              </div>
            </>
          ) : (
            <div className="mt-1 text-sm text-white/50">nada tocando: cole um link abaixo</div>
          )}
        </div>

        {/* adicionar */}
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add(!cur)
              if (e.key === 'Escape') onClose()
            }}
            placeholder="link do YouTube (vídeo ou playlist, pode ter &t=)"
            className="rounded-lg bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-violet-400/60"
          />
          <div className="flex gap-2">
            <button type="button" disabled={!valid} onClick={() => add(true)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-bold disabled:opacity-40">
              <Play className="size-3.5" />
              Tocar agora
            </button>
            <button type="button" disabled={!valid} onClick={() => add(false)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20 disabled:opacity-40">
              <Plus className="size-3.5" />
              Pôr na fila
            </button>
          </div>
        </div>

        {/* fila */}
        <div className="flex min-h-0 flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-white/60 uppercase">
            <ListMusic className="size-3.5" />
            Fila ({dj.queue.length})
          </div>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {dj.queue.length ? dj.queue.map((q, i) => (
              <div key={q.qid} className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs ring-1 ring-white/5">
                <span className="w-4 text-white/40 tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate" title={q.title}>
                  {q.kind === 'playlist' ? <ListMusic className="mr-1 inline size-3 text-violet-300" /> : null}
                  {q.title}
                </span>
                <span className="text-white/35">{q.by}</span>
                <button type="button" aria-label="Tocar agora" onClick={() => net.send({ t: 'dj-play', qid: q.qid })} className="rounded p-1 hover:bg-white/15">
                  <Play className="size-3.5" />
                </button>
                <button type="button" aria-label="Remover" onClick={() => net.send({ t: 'dj-remove', qid: q.qid })} className="rounded p-1 hover:bg-white/15">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )) : <div className="px-1 text-xs text-white/40">fila vazia</div>}
          </div>
        </div>
        {!net.online ? <div className="text-xs text-amber-300">sem conexão com o servidor do jogo</div> : null}
      </div>
    </div>
  )
}
