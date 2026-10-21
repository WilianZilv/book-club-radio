// Álbum do fotógrafo: as fotos que saíram dos quadros do bar, num livro aberto (duas por página), da mais recente
// para a mais antiga. → (ou a seta da direita) folheia para as mais antigas, ← volta para as mais recentes, com a
// folha girando na lombada; Esc fecha.
import { useCallback, useEffect, useState } from 'react'
import { BookImage, ChevronLeft, ChevronRight, X } from 'lucide-react'

import type { NetPhoto } from './net.ts'

const PER_PAGE = 2
const FLIP_MS = 650

function when(at: number) {
  const d = new Date(at)
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

function Page({ photos, side }: { photos: NetPhoto[], side: 'left' | 'right' }) {
  return (
    <div className={`flex h-full w-full flex-col justify-center gap-5 bg-[#f5efe3] px-6 py-6 ${side === 'left' ? 'rounded-l-lg' : 'rounded-r-lg'}`}>
      {photos.map((p, i) => (
        <figure key={p.id} className="mx-auto w-[88%] bg-white p-2 pb-1 shadow-md" style={{ transform: `rotate(${(i % 2 ? 1 : -1) * (side === 'left' ? 1.2 : -1.4)}deg)` }}>
          <img src={`/mp/photos/${p.id}.jpg`} alt="" className="aspect-[3/2] w-full object-cover" draggable={false} />
          <figcaption className="py-1 text-center font-mono text-[10px] text-stone-500">{when(p.at)}</figcaption>
        </figure>
      ))}
    </div>
  )
}

export function AlbumPanel({ photos, onClose }: { photos: NetPhoto[], onClose: () => void }) {
  // páginas em pares (esquerda, direita); uma "abertura" = 4 fotos; a primeira abertura tem as mais recentes
  const newest = [...photos].sort((a, b) => b.at - a.at)
  const pages: NetPhoto[][] = []
  for (let i = 0; i < newest.length; i += PER_PAGE) pages.push(newest.slice(i, i + PER_PAGE))
  if (pages.length % 2) pages.push([])
  const spreads = Math.max(1, pages.length / 2)
  const [spread, setSpread] = useState(0)
  // folha virando: de qual abertura para qual, e se já girou (o giro começa um quadro depois de montar)
  const [flip, setFlip] = useState<{ from: number, to: number, turned: boolean } | null>(null)

  const go = useCallback((to: number) => {
    if (flip || to < 0 || to >= spreads || to === spread) return
    setFlip({ from: spread, to, turned: false })
  }, [flip, spread, spreads])

  // uma virada: gira um quadro depois de montar e termina depois da animação (o efeito só depende de qual virada é,
  // para o "turned" não cancelar o fim)
  const flipKey = flip ? `${flip.from}>${flip.to}` : ''
  useEffect(() => {
    if (!flip) return
    const to = flip.to
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setFlip((f) => (f ? { ...f, turned: true } : f))))
    const t = window.setTimeout(() => {
      setSpread(to)
      setFlip(null)
    }, FLIP_MS + 60)
    return () => {
      cancelAnimationFrame(r)
      window.clearTimeout(t)
    }
  }, [flipKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(spread + 1)
      else if (e.key === 'ArrowLeft') go(spread - 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, onClose, spread])

  const pg = (s: number, side: 0 | 1) => pages[s * 2 + side] ?? []
  // durante a virada: embaixo ficam a página que não se mexe e a que vai aparecer; a folha leva as outras duas
  const fwd = flip ? flip.to > flip.from : true
  const left = flip ? (fwd ? pg(flip.from, 0) : pg(flip.to, 0)) : pg(spread, 0)
  const right = flip ? (fwd ? pg(flip.to, 1) : pg(flip.from, 1)) : pg(spread, 1)

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/70 p-4 text-white backdrop-blur-sm">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BookImage className="size-5 text-amber-300" />
        Álbum do fotógrafo
        <button type="button" onClick={onClose} aria-label="Fechar" className="ml-3 rounded-full bg-white/10 p-1.5 hover:bg-white/20">
          <X className="size-4" />
        </button>
      </div>
      {photos.length ? (
        <div className="relative flex aspect-[1.45] rounded-xl bg-[#5b2121] p-3 shadow-2xl" style={{ perspective: '2000px', width: 'min(920px, 94vw, calc((100vh - 150px) * 1.45))' }}>
          <div className="relative flex flex-1">
            <div className="h-full w-1/2"><Page photos={left} side="left" /></div>
            <div className="h-full w-1/2"><Page photos={right} side="right" /></div>
            {/* lombada */}
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-6 -translate-x-1/2 bg-gradient-to-r from-transparent via-black/25 to-transparent" />
            {flip ? (
              <div
                className="absolute inset-y-0 w-1/2"
                style={{
                  left: fwd ? '50%' : 0,
                  transformOrigin: fwd ? 'left center' : 'right center',
                  transformStyle: 'preserve-3d',
                  transition: `transform ${FLIP_MS}ms cubic-bezier(.45,.05,.3,1)`,
                  transform: `rotateY(${flip.turned ? (fwd ? -180 : 180) : 0}deg)`,
                }}
              >
                <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
                  <Page photos={fwd ? pg(flip.from, 1) : pg(flip.from, 0)} side={fwd ? 'right' : 'left'} />
                </div>
                <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                  <Page photos={fwd ? pg(flip.to, 0) : pg(flip.to, 1)} side={fwd ? 'left' : 'right'} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="max-w-sm text-center text-sm text-white/75">Ainda não tem fotos antigas. As mais novas estão nos quadros do bar; quando forem trocadas, vêm para cá.</p>
      )}
      {photos.length ? (
        <div className="flex items-center gap-3 text-xs text-white/75">
          <button type="button" onClick={() => go(spread - 1)} disabled={spread <= 0 || !!flip} aria-label="Página anterior" className="rounded-full bg-white/10 p-2 hover:bg-white/20 disabled:opacity-30">
            <ChevronLeft className="size-4" />
          </button>
          {(flip?.to ?? spread) + 1} de {spreads} · {photos.length} fotos · ← mais recentes · → mais antigas · Esc fecha
          <button type="button" onClick={() => go(spread + 1)} disabled={spread >= spreads - 1 || !!flip} aria-label="Próxima página" className="rounded-full bg-white/10 p-2 hover:bg-white/20 disabled:opacity-30">
            <ChevronRight className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
