// Fotos do fotógrafo: um jogador renderiza cada foto (o de menor id) e manda para cá; o servidor guarda em
// data/photos/<id>.jpg (índice em data/photos.json) e avisa todo mundo. Uma foto por parada do fotógrafo (slot):
// se dois mandarem a mesma, vale a primeira.
//   GET  /mp/photos             lista [{ id, at, slot }]
//   GET  /mp/photos/<id>.jpg    a foto
//   POST /mp/photos?slot=N      corpo image/jpeg (até 800 KB)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dataPath, readJson, writeJson } from './store.ts'

export const PHOTOS_PATH = '/mp/photos'
export interface Photo { id: string, at: number, slot: number }

const MAX_PHOTOS = 400
const MAX_BYTES = 800_000
let list: Photo[] = readJson<Photo[]>('photos.json', [])
const pendingSlots = new Set<number>()
let onNew: (p: Photo) => void = () => {}

export function photoList() {
  return list
}

// o multiplayer avisa os jogadores (refeito quando o Vite recarrega o servidor)
export function photosOnNew(cb: (p: Photo) => void) {
  onNew = cb
}

function save(id: string, body: Buffer, slot: number) {
  mkdirSync(dataPath('photos'), { recursive: true })
  writeFileSync(dataPath('photos', `${id}.jpg`), body)
  const p: Photo = { id, at: Date.now(), slot }
  list.push(p)
  // passou do limite: as mais velhas saem (do disco também)
  while (list.length > MAX_PHOTOS) {
    const old = list.shift()
    if (old) rmSync(dataPath('photos', `${old.id}.jpg`), { force: true })
  }
  writeJson('photos.json', list)
  onNew(p)
  return p
}

// true quando a requisição era das fotos (respondida aqui)
export function photosProxy(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? ''
  if (!url.startsWith(PHOTOS_PATH)) return false
  const [path, query = ''] = url.split('?')
  if (req.method === 'GET' && path === PHOTOS_PATH) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(list))
    return true
  }
  const m = /^\/mp\/photos\/([\w-]{1,40})\.jpg$/.exec(path)
  if (req.method === 'GET' && m) {
    try {
      const body = readFileSync(dataPath('photos', `${m[1]}.jpg`))
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' }).end(body)
    } catch {
      res.writeHead(404).end()
    }
    return true
  }
  if (req.method === 'POST' && path === PHOTOS_PATH) {
    const slot = Math.round(Number(new URLSearchParams(query).get('slot')))
    if (!Number.isFinite(slot) || slot < 0 || list.some((p) => p.slot === slot) || pendingSlots.has(slot)) {
      res.writeHead(409).end()
      req.resume()
      return true
    }
    pendingSlots.add(slot)
    const parts: Buffer[] = []
    let n = 0
    req.on('data', (c: Buffer) => {
      n += c.length
      if (n <= MAX_BYTES) parts.push(c)
    })
    req.on('end', () => {
      pendingSlots.delete(slot)
      const body = Buffer.concat(parts)
      // só JPEG (FF D8) dentro do limite
      if (n > MAX_BYTES || body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8) {
        res.writeHead(400).end()
        return
      }
      const p = save(`${slot}-${Date.now().toString(36)}`, body, slot)
      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(p))
    })
    req.on('error', () => pendingSlots.delete(slot))
    return true
  }
  res.writeHead(405).end()
  return true
}
