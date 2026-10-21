// Multiplayer do Book Club Radio: WebSocket mínimo (sem dependência) pendurado no servidor HTTP do Vite em /mp.
// Sincroniza posição dos jogadores, chat e o DJ (fila do telão, com o relógio do servidor para todo mundo ver o
// mesmo ponto do vídeo).
//
// Protocolo (JSON por frame de texto):
//   cliente -> servidor  { t: 'hello', name }                           nome escolhido (sem senha), logo ao conectar
//                        { t: 'me', p: [x, y, z], yaw, L, moving, sit }  ~12x/s
//                        { t: 'chat', text }
//                        { t: 'dj-add', url, now }                      YouTube (vídeo ou playlist, com t=)
//                        { t: 'dj-play' | 'dj-remove', qid }            item da fila
//                        { t: 'dj-skip' } / { t: 'dj-seek', sec }       pular / mudar o timestamp do atual
//                        { t: 'dj-ended', token, next?, len? }          o vídeo acabou (ou a playlist avançou)
//                        { t: 'rtc', to, data }                         sinal da voz para outro jogador (oferta, resposta, ICE)
//                        { t: 'drop', kind, left, p }                   larga um item no chão
//                        { t: 'take', id, hand }                        pega um item do chão (quem pedir primeiro leva)
//                        { t: 'offer', to, oid, kind, left }            oferece um item a outro jogador
//                        { t: 'offer-reply', to, oid, ok, why }         resposta à oferta
//                        { t: 'offer-cancel', to, oid }                 desiste da oferta
//                        { t: 'door', id, open }                        abre/fecha a porta de uma cabine do banheiro
//   servidor -> cliente  { t: 'welcome', id, name }                     ao entrar
//                        { t: 'players', list: [{ id, name, look, p, yaw, L, moving, sit }], now }   ~12x/s
//                        { t: 'chat', id, name, text }
//                        { t: 'leave', id }
//                        { t: 'dj', dj, now }                           estado do telão (relógio do servidor em now)
//                        { t: 'rtc', from, data }                       sinal da voz (o áudio vai direto entre os dois)
//                        { t: 'items', list: [{ id, kind, left, p }] }  itens no chão
//                        { t: 'photos', list } / { t: 'photo', photo }  fotos do fotógrafo (todas ao entrar; cada nova)
//                        { t: 'doors', open: [id] }                     portas das cabines abertas
//                        { t: 'took', id, hand, kind?, left? }          resposta ao take (sem kind: alguém pegou antes)
//                        { t: 'offer' | 'offer-reply' | 'offer-cancel', from, name, ... }   repasse das ofertas
import { createHash } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { photoList, photosOnNew } from './photos.ts'
import { readJson, writeJson } from './store.ts'
import { warmVideo } from './video.ts'

const PATH = '/mp'
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_FRAME = 64 * 1024
const MAX_PLAYERS = 32
const CHAT_MAX = 140
// "Rádio": avisos do DJ no chat
const RADIO_ID = 1_000_000
const RADIO_NAME = 'Rádio'

// emote: nome da animação que o jogador está fazendo (ou vazio); hands: item na mão esquerda e na direita
interface State { p: [number, number, number], yaw: number, L: number, moving: boolean, sit: boolean, emote: string, hands: [string, string], vomit: boolean }
// bebidas e comida (o cliente sabe o resto: preço, goles, efeitos)
const ITEM_KINDS = new Set(['cerveja', 'drink', 'shot', 'batata'])
const itemKind = (v: unknown) => (typeof v === 'string' && ITEM_KINDS.has(v) ? v : '')
// item largado no chão: todos veem; some quando alguém pega (ou quando passa de 60, o mais velho sai)
interface FloorItem { id: number, kind: string, left: number, p: [number, number, number] }
const FLOOR_MAX = 60
// personagem escolhido na criação (índices nas paletas do cliente)
interface Avatar { skin: number, hair: number, style: number, shirt: number, pants: number, role: number }
interface Player {
  id: number
  name: string
  look: number
  sock: Duplex
  buf: Buffer
  state: State | null
  avatar: Avatar | null
  joined: number
  lastChat: number
}

function frame(text: string) {
  const data = Buffer.from(text)
  const n = data.length
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : null
  if (!head) return null
  return Buffer.concat([head, data])
}

// Lê frames completos do buffer; devolve as mensagens de texto e o resto não consumido.
function parse(buf: Buffer): { msgs: string[], rest: Buffer, close: boolean } {
  const msgs: string[] = []
  let off = 0
  let close = false
  while (buf.length - off >= 2) {
    const b0 = buf[off]
    const b1 = buf[off + 1]
    const op = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f
    let p = off + 2
    if (len === 126) {
      if (buf.length - p < 2) break
      len = buf.readUInt16BE(p)
      p += 2
    } else if (len === 127) {
      close = true
      break
    }
    if (len > MAX_FRAME || !masked) {
      close = true
      break
    }
    if (buf.length - p < 4 + len) break
    const mask = buf.subarray(p, p + 4)
    p += 4
    const data = Buffer.alloc(len)
    for (let i = 0; i < len; i++) data[i] = buf[p + i] ^ mask[i & 3]
    off = p + len
    if (op === 0x8) {
      close = true
      break
    }
    if (op === 0x1) msgs.push(data.toString('utf8'))
  }
  return { msgs, rest: buf.subarray(off), close }
}

// ---------- DJ da cobertura (telão do YouTube) ----------
interface DjItem { qid: string, kind: 'video' | 'playlist', video: string | null, list: string | null, start: number, title: string, by: string }
interface DjCur { item: DjItem, index: number, startedAt: number, offset: number, token: string }
interface Dj { queue: DjItem[], cur: DjCur | null }

const ID = /^[\w-]{6,64}$/
// Aceita youtube.com/watch?v=, youtu.be/, /shorts/, /live/, /embed/ e playlist (?list=), com t=/start= em s ou 1h2m3s.
function parseYoutube(raw: string): Omit<DjItem, 'qid' | 'title' | 'by'> | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '')
  if (host !== 'youtube.com' && host !== 'youtu.be' && host !== 'youtube-nocookie.com') return null
  let video = u.searchParams.get('v')
  if (host === 'youtu.be') video = u.pathname.slice(1).split('/')[0]
  const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/)
  if (m) video = m[1]
  const list = u.searchParams.get('list')
  const t = u.searchParams.get('t') ?? u.searchParams.get('start') ?? ''
  const tm = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/)
  const start = tm ? (Number(tm[1] ?? 0) * 3600 + Number(tm[2] ?? 0) * 60 + Number(tm[3] ?? 0)) : 0
  const okV = video && ID.test(video) ? video : null
  const okL = list && ID.test(list) ? list : null
  if (!okV && !okL) return null
  return { kind: okL ? 'playlist' : 'video', video: okV, list: okL, start }
}

// Título pelo oEmbed do YouTube (lado do servidor, sem CORS); sem rede fica o id.
async function titleOf(item: DjItem) {
  const url = item.kind === 'playlist' ? `https://www.youtube.com/playlist?list=${item.list}` : `https://www.youtube.com/watch?v=${item.video}`
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const j = (await res.json()) as { title?: string }
      if (typeof j.title === 'string') return j.title.slice(0, 120)
    }
  } catch {
    // sem título: fica o id
  }
  return item.title
}

const num = (v: unknown, lim = 1e5) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < lim ? v : 0)
// texto de chat: uma linha, sem caracteres de controle, tamanho limitado
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX) : '')

// Uma instância por processo: quando o Vite reinicia (config mudou), o servidor HTTP antigo só fecha depois que
// todas as conexões caem, então a instância anterior é derrubada aqui.
const g = globalThis as unknown as { __mpStop?: () => void }

export function attachMultiplayer(server: Server) {
  g.__mpStop?.()
  const players = new Map<number, Player>()
  let nextId = 1
  const dj: Dj = { queue: [], cur: null }
  const floor = new Map<number, FloorItem>()
  // portas das cabines que estão abertas (o resto está fechado)
  const doorsOpen = new Set<string>()
  let itemSeq = 0
  let djSeq = 0
  // DJ salvo em disco (fila, o que toca e em que segundo): reiniciar o servidor continua do mesmo ponto
  const djSave = () => {
    const c = dj.cur
    writeJson('dj.json', { queue: dj.queue, cur: c ? { item: c.item, index: c.index, pos: c.offset + (Date.now() - c.startedAt) / 1000 } : null })
  }
  {
    const saved = readJson<{ queue?: DjItem[], cur?: { item: DjItem, index: number, pos: number } | null }>('dj.json', {})
    if (Array.isArray(saved.queue)) dj.queue = saved.queue
    if (saved.cur?.item) dj.cur = { item: saved.cur.item, index: saved.cur.index ?? 0, startedAt: Date.now(), offset: Math.max(0, saved.cur.pos ?? 0), token: `${++djSeq}` }
  }
  // o que toca agora e o próximo da fila já ficam com as URLs prontas
  const djSend = () => {
    for (const it of [dj.cur?.item, dj.queue[0]]) if (it?.video) warmVideo(it.video)
    broadcast({ t: 'dj', dj, now: Date.now() })
    djSave()
  }
  const djStart = (item: DjItem | undefined, index = 0, offset?: number) => {
    dj.cur = item ? { item, index, startedAt: Date.now(), offset: offset ?? (index === 0 ? item.start : 0), token: `${++djSeq}` } : null
    djSend()
  }
  const djNext = () => djStart(dj.queue.shift())

  const send = (pl: Player, msg: unknown) => {
    const f = frame(JSON.stringify(msg))
    if (f && !pl.sock.destroyed) pl.sock.write(f)
  }
  const broadcast = (msg: unknown, except?: number) => {
    const f = frame(JSON.stringify(msg))
    if (!f) return
    for (const pl of players.values()) if (pl.id !== except && !pl.sock.destroyed) pl.sock.write(f)
  }
  const radioSay = (text: string) => broadcast({ t: 'chat', id: RADIO_ID, name: RADIO_NAME, text })
  const itemsMsg = () => ({ t: 'items', list: [...floor.values()] })
  photosOnNew((photo) => broadcast({ t: 'photo', photo }))

  const drop = (pl: Player) => {
    if (!players.delete(pl.id)) return
    pl.sock.destroy()
    broadcast({ t: 'leave', id: pl.id })
  }

  const onMessage = (pl: Player, text: string) => {
    let m: Record<string, unknown>
    try {
      m = JSON.parse(text)
    } catch {
      return
    }
    if (m.t === 'hello') {
      // nome do jogador: uma linha, até 20 caracteres; vazio fica com o nome padrão
      const nm = clean(m.name).slice(0, 20)
      if (nm && nm.toLowerCase() !== RADIO_NAME.toLowerCase()) pl.name = nm
      const a = m.avatar as Record<string, unknown> | undefined
      if (a && typeof a === 'object') {
        const i = (v: unknown, n: number) => Math.max(0, Math.min(n - 1, Math.round(num(v, 100))))
        pl.avatar = { skin: i(a.skin, 6), hair: i(a.hair, 7), style: i(a.style, 5), shirt: i(a.shirt, 10), pants: i(a.pants, 6), role: i(a.role, 8) }
      }
      send(pl, { t: 'welcome', id: pl.id, name: pl.name })
    } else if (m.t === 'me' && Array.isArray(m.p)) {
      const emote = typeof m.emote === 'string' && /^[a-z]{1,16}$/.test(m.emote) ? m.emote : ''
      const h = Array.isArray(m.hands) ? m.hands : []
      pl.state = { p: [num(m.p[0]), num(m.p[1]), num(m.p[2])], yaw: num(m.yaw, 100), L: num(m.L, 1000), moving: m.moving === true, sit: m.sit === true, emote, hands: [itemKind(h[0]), itemKind(h[1])], vomit: m.vomit === true }
    } else if (m.t === 'door' && typeof m.id === 'string' && /^[mf]\d$/.test(m.id)) {
      if (m.open === true) doorsOpen.add(m.id)
      else doorsOpen.delete(m.id)
      broadcast({ t: 'doors', open: [...doorsOpen] })
    } else if (m.t === 'drop' && Array.isArray(m.p)) {
      const kind = itemKind(m.kind)
      const left = Math.round(num(m.left, 100))
      if (!kind || left < 1 || left > 9) return
      const it: FloorItem = { id: ++itemSeq, kind, left, p: [num(m.p[0], 1000), num(m.p[1], 100), num(m.p[2], 1000)] }
      floor.set(it.id, it)
      if (floor.size > FLOOR_MAX) floor.delete(floor.keys().next().value as number)
      broadcast(itemsMsg())
    } else if (m.t === 'take') {
      const id = Math.round(num(m.id, 1e9))
      const hand = m.hand === 1 ? 1 : 0
      const it = floor.get(id)
      if (!it) {
        send(pl, { t: 'took', id, hand })
        return
      }
      floor.delete(id)
      send(pl, { t: 'took', id, hand, kind: it.kind, left: it.left })
      broadcast(itemsMsg())
    } else if ((m.t === 'offer' || m.t === 'offer-reply' || m.t === 'offer-cancel') && typeof m.oid === 'string') {
      // ofertas: o servidor só repassa para o outro jogador (com quem mandou)
      const to = players.get(Math.round(num(m.to, 1e7)))
      if (!to || to.id === pl.id) return
      const oid = m.oid.slice(0, 24)
      if (m.t === 'offer') {
        const kind = itemKind(m.kind)
        const left = Math.round(num(m.left, 100))
        if (!kind || left < 1 || left > 9) return
        send(to, { t: 'offer', from: pl.id, name: pl.name, oid, kind, left })
      } else if (m.t === 'offer-reply') send(to, { t: 'offer-reply', from: pl.id, name: pl.name, oid, ok: m.ok === true, why: clean(m.why).slice(0, 60) })
      else send(to, { t: 'offer-cancel', from: pl.id, oid })
    } else if (m.t === 'chat') {
      const now = Date.now()
      const msg = clean(m.text)
      // anti-flood: uma mensagem a cada 0,7 s
      if (!msg || now - pl.lastChat < 700) return
      pl.lastChat = now
      broadcast({ t: 'chat', id: pl.id, name: pl.name, text: msg })
    } else if (typeof m.t === 'string' && m.t.startsWith('dj-')) onDj(pl, m)
    else if (m.t === 'rtc' && m.data && typeof m.data === 'object') {
      // só repassa o sinal para o outro jogador; o áudio não passa por aqui
      const to = players.get(Math.round(num(m.to, 1e7)))
      if (to && to.id !== pl.id) send(to, { t: 'rtc', from: pl.id, data: m.data })
    }
  }

  const onDj = (pl: Player, m: Record<string, unknown>) => {
    if (m.t === 'dj-add' && typeof m.url === 'string') {
      const parsed = parseYoutube(m.url.slice(0, 500))
      if (!parsed || dj.queue.length >= 100) return
      const item: DjItem = { ...parsed, qid: `${Date.now().toString(36)}${(++djSeq).toString(36)}`, title: parsed.video ?? parsed.list ?? '', by: pl.name }
      if (m.now === true || !dj.cur) djStart(item)
      else {
        dj.queue.push(item)
        djSend()
      }
      radioSay(`${pl.name} ${m.now === true || dj.cur?.item === item ? 'botou pra tocar' : 'colocou na fila'} uma música`)
      void titleOf(item).then((t) => {
        item.title = t
        djSend()
      })
    } else if (m.t === 'dj-play') {
      const i = dj.queue.findIndex((q) => q.qid === m.qid)
      if (i >= 0) djStart(dj.queue.splice(i, 1)[0])
    } else if (m.t === 'dj-remove') {
      dj.queue = dj.queue.filter((q) => q.qid !== m.qid)
      djSend()
    } else if (m.t === 'dj-skip') djNext()
    else if (m.t === 'dj-seek' && dj.cur) {
      dj.cur.offset = Math.max(0, Math.min(86400, num(m.sec)))
      dj.cur.startedAt = Date.now()
      dj.cur.token = `${++djSeq}`
      djSend()
    } else if (m.t === 'dj-ended' && dj.cur && m.token === dj.cur.token) {
      // primeiro aviso de fim vence: playlist segue o próximo índice, vídeo passa para a fila
      const next = Math.round(num(m.next, 10000))
      const len = Math.round(num(m.len, 10000))
      if (dj.cur.item.kind === 'playlist' && next > dj.cur.index && (!len || next < len)) djStart(dj.cur.item, next, 0)
      else djNext()
    }
  }

  server.on('upgrade', (req: IncomingMessage, sock: Duplex, head: Buffer) => {
    if ((req.url ?? '').split('?')[0] !== PATH) return
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string' || players.size >= MAX_PLAYERS) {
      sock.destroy()
      return
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64')
    sock.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'))
    const id = nextId++
    const pl: Player = { id, name: `Jogador ${id}`, look: Math.floor(Math.random() * 1e9), sock, buf: Buffer.alloc(0), state: null, avatar: null, joined: Date.now(), lastChat: 0 }
    players.set(pl.id, pl)
    send(pl, { t: 'welcome', id: pl.id, name: pl.name })
    send(pl, { t: 'dj', dj, now: Date.now() })
    send(pl, itemsMsg())
    send(pl, { t: 'photos', list: photoList() })
    send(pl, { t: 'doors', open: [...doorsOpen] })
    const feed = (chunk: Buffer) => {
      pl.buf = pl.buf.length ? Buffer.concat([pl.buf, chunk]) : chunk
      const { msgs, rest, close } = parse(pl.buf)
      pl.buf = rest
      for (const t of msgs) onMessage(pl, t)
      if (close) drop(pl)
    }
    if (head.length) feed(head)
    sock.on('data', feed)
    sock.on('end', () => drop(pl))
    sock.on('close', () => drop(pl))
    sock.on('error', () => drop(pl))
  })

  const tick = setInterval(() => {
    if (!players.size) return
    const list = [...players.values()].filter((pl) => pl.state).map((pl) => ({ id: pl.id, name: pl.name, look: pl.look, avatar: pl.avatar, ...pl.state }))
    broadcast({ t: 'players', list, now: Date.now() })
  }, 80)
  // a posição anda sozinha: salva a cada 5 s
  const saveTick = setInterval(() => {
    if (dj.cur) djSave()
  }, 5000)
  if (dj.cur) for (const it of [dj.cur.item, dj.queue[0]]) if (it?.video) warmVideo(it.video)
  const stop = () => {
    clearInterval(tick)
    clearInterval(saveTick)
    djSave()
    for (const pl of players.values()) pl.sock.destroy()
    players.clear()
    if (g.__mpStop === stop) g.__mpStop = undefined
  }
  g.__mpStop = stop
  server.on('close', stop)
}
