// Telão: o vídeo do YouTube passa por aqui (mesma origem) para a página poder desenhar e ouvir ele do jeito dela
// (pixels de LED, bloom, distorção, batida de verdade). O YouTube separa imagem e som: /mp/video/<id>?k=v é a
// imagem (240p basta para o painel de 320 x 180) e ?k=a o áudio. O yt-dlp acha as URLs do googlevideo (em cache).
// Fonte única: o servidor baixa cada pedaço do arquivo do YouTube uma vez só, guarda em memória e serve todos os
// jogadores dessa cópia (eles tocam juntos pelo relógio do DJ, então pedem os mesmos pedaços). Sem yt-dlp: 502 e o
// telão volta para o iframe do YouTube.
import { execFile } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const VIDEO_PATH = '/mp/video/'
const TTL = 3 * 3600_000
// pedaço por requisição: pedido sem fim ("bytes=X-") o YouTube entrega a conta-gotas (~tempo real); pedaço
// fechado vem a toda velocidade, e o navegador pede o próximo sozinho
const CHUNK = 3 * 1024 * 1024
// arquivos https inteiros (não m3u8): o navegador toca direto com Range. Imagem: H.264 antes de VP9/AV1.
const FORMATS = { v: '133/134/242/243/395/396/160/bv[height<=480][protocol=https]', a: '140/251/139/250/ba[protocol=https]' }
const cache = new Map<string, { url: string, at: number }>()
// falha recente (YouTube pedindo login/bloqueando): não insiste por 2 min (insistir piora o bloqueio)
const failedAt = new Map<string, number>()
const pending = new Map<string, Promise<string>>()

function resolve(id: string, k: 'v' | 'a'): Promise<string> {
  const key = `${id}:${k}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.url)
  let p = pending.get(key)
  if (p) return p
  if (Date.now() - (failedAt.get(key) ?? 0) < 120_000) return Promise.reject(new Error('falhou há pouco'))
  p = new Promise<string>((ok, fail) => {
    // YTDLP_ARGS: opções extras do yt-dlp vindas do ambiente (ex.: --cookies-from-browser firefox), fora do código
    const extra = (process.env.YTDLP_ARGS ?? '').split(' ').filter(Boolean)
    execFile('yt-dlp', [...extra, '-f', FORMATS[k], '-g', '--no-playlist', '--no-warnings', `https://www.youtube.com/watch?v=${id}`], { timeout: 45_000 }, (err, out) => {
      const url = out?.trim().split('\n')[0]
      if (err || !url?.startsWith('http')) {
        failedAt.set(key, Date.now())
        return fail(err ?? new Error('sem formato'))
      }
      cache.set(key, { url, at: Date.now() })
      ok(url)
    })
  }).finally(() => pending.delete(key))
  pending.set(key, p)
  return p
}

// arquivo de um vídeo (imagem ou som) em pedaços de CHUNK bytes; cada pedaço é baixado uma vez (a promessa fica no
// mapa, então pedidos ao mesmo tempo esperam o mesmo download)
interface Media { size: number, type: string, chunks: Map<number, Promise<Buffer>>, used: number }
const media = new Map<string, Media>()
// arquivos guardados (atual e próximo, imagem e som, com folga); o menos usado sai
const MAX_MEDIA = 6
// pedaços para trás do último pedido que ainda ficam (DJ voltando um pouco)
const KEEP_BEHIND = 4

function mediaOf(id: string, k: 'v' | 'a') {
  const key = `${id}:${k}`
  let m = media.get(key)
  if (!m) {
    m = { size: 0, type: '', chunks: new Map(), used: 0 }
    media.set(key, m)
    if (media.size > MAX_MEDIA) {
      const old = [...media.entries()].filter(([kk]) => kk !== key).sort((a, b) => a[1].used - b[1].used)[0]
      if (old) media.delete(old[0])
    }
  }
  m.used = Date.now()
  return m
}

async function download(id: string, k: 'v' | 'a', i: number, retry = true): Promise<{ buf: Buffer, size: number, type: string }> {
  const url = await resolve(id, k)
  const start = i * CHUNK
  const up = await fetch(url, { headers: { range: `bytes=${start}-${start + CHUNK - 1}` } })
  // URL vencida: resolve de novo uma vez
  if ((up.status === 403 || up.status === 410) && retry) {
    cache.delete(`${id}:${k}`)
    return download(id, k, i, false)
  }
  if (up.status !== 206 && up.status !== 200) throw new Error(`youtube ${up.status}`)
  const size = Number(/\/(\d+)$/.exec(up.headers.get('content-range') ?? '')?.[1] ?? up.headers.get('content-length') ?? 0)
  return { buf: Buffer.from(await up.arrayBuffer()), size, type: up.headers.get('content-type') ?? (k === 'a' ? 'audio/mp4' : 'video/mp4') }
}

function chunk(m: Media, id: string, k: 'v' | 'a', i: number): Promise<Buffer> {
  let p = m.chunks.get(i)
  if (!p) {
    p = download(id, k, i).then((d) => {
      m.size ||= d.size
      m.type ||= d.type
      return d.buf
    })
    // falhou: some do mapa para o próximo pedido tentar de novo
    p.catch(() => {
      if (m.chunks.get(i) === p) m.chunks.delete(i)
    })
    m.chunks.set(i, p)
  }
  return p
}

// adianta o yt-dlp e o começo do arquivo (imagem e som) de um vídeo que vai tocar
export function warmVideo(id: string) {
  if (!/^[\w-]{11}$/.test(id)) return
  for (const k of ['v', 'a'] as const) chunk(mediaOf(id, k), id, k, 0).catch(() => {})
}

// true quando a requisição era do telão (respondida aqui)
export function videoProxy(req: IncomingMessage, res: ServerResponse): boolean {
  if (!req.url?.startsWith(VIDEO_PATH)) return false
  const [id, query = ''] = req.url.slice(VIDEO_PATH.length).split('?')
  const k = new URLSearchParams(query).get('k') === 'a' ? 'a' : 'v'
  if (!/^[\w-]{11}$/.test(id) || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(400).end()
    return true
  }
  const go = async (): Promise<void> => {
    const m = mediaOf(id, k)
    const r = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
    const start = r ? Number(r[1]) : 0
    const i = Math.floor(start / CHUNK)
    const buf = await chunk(m, id, k, i)
    if (start >= m.size) {
      res.writeHead(416, { 'content-range': `bytes */${m.size}` }).end()
      return
    }
    // responde só até o fim deste pedaço (o navegador pede o resto); já busca os 2 seguintes para todo mundo
    const from = start - i * CHUNK
    const want = r && r[2] ? Number(r[2]) - i * CHUNK + 1 : buf.length
    const body = buf.subarray(from, Math.min(buf.length, want))
    for (let j = i + 1; j <= i + 2 && j * CHUNK < m.size; j++) chunk(m, id, k, j).catch(() => {})
    for (const j of m.chunks.keys()) if (j < i - KEEP_BEHIND) m.chunks.delete(j)
    res.writeHead(206, {
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
      'content-type': m.type,
      'content-length': String(body.length),
      'content-range': `bytes ${start}-${start + body.length - 1}/${m.size}`,
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
  go().catch(() => {
    if (!res.headersSent) res.writeHead(502).end()
    else res.destroy()
  })
  return true
}
