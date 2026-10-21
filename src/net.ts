// Cliente do multiplayer (servidor em mp/server.ts, rota /mp). Reconecta sozinho; sem servidor, o club segue
// igual, só sem os outros jogadores e sem DJ.

export interface NetAvatar { skin: number, hair: number, style: number, shirt: number, pants: number, role: number }
export interface NetPlayer { id: number, name: string, look: number, avatar?: NetAvatar | null, p: [number, number, number], yaw: number, L: number, moving: boolean, sit: boolean, emote?: string, hands?: [string, string], vomit?: boolean }
// item no chão (o servidor guarda; quem pega primeiro leva)
export interface NetFloorItem { id: number, kind: string, left: number, p: [number, number, number] }
// foto do fotógrafo (arquivo em /mp/photos/<id>.jpg)
export interface NetPhoto { id: string, at: number, slot: number }
// ofertas entre jogadores (repassadas pelo servidor)
export interface NetOffer { t: 'offer' | 'offer-reply' | 'offer-cancel', from: number, name?: string, oid: string, kind?: string, left?: number, ok?: boolean, why?: string }
export interface NetChat { id: number, name: string, text: string, at: number, mine: boolean }
export interface DjItem { qid: string, kind: 'video' | 'playlist', video: string | null, list: string | null, start: number, title: string, by: string }
export interface DjState { queue: DjItem[], cur: { item: DjItem, index: number, startedAt: number, offset: number, token: string } | null }

export class Net {
  ws: WebSocket | null = null
  id = 0
  name = ''
  // nome escolhido pelo jogador (localStorage); sem nome não conecta
  wanted = ''
  // personagem escolhido (vai no hello)
  avatar: NetAvatar | null = null
  closed = false
  retry = 1000
  onPlayers: (list: NetPlayer[]) => void = () => {}
  onLeave: (id: number) => void = () => {}
  onChat: (c: NetChat) => void = () => {}
  onDj: (dj: DjState) => void = () => {}
  // sinalização da voz (oferta/resposta/ICE de outro jogador)
  onRtc: (from: number, data: unknown) => void = () => {}
  onItems: (list: NetFloorItem[]) => void = () => {}
  onTook: (m: { id: number, hand: number, kind?: string, left?: number }) => void = () => {}
  onOffer: (m: NetOffer) => void = () => {}
  onPhotos: (list: NetPhoto[]) => void = () => {}
  onDoors: (open: string[]) => void = () => {}
  onPhoto: (p: NetPhoto) => void = () => {}
  dj: DjState = { queue: [], cur: null }
  // relógio do servidor menos o local (para todo mundo calcular a mesma posição do vídeo)
  clockSkew = 0
  skewSet = false

  get online() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  setName(name: string, avatar?: NetAvatar | null) {
    this.wanted = name
    if (avatar !== undefined) this.avatar = avatar
    if (this.online) this.send({ t: 'hello', name, avatar: this.avatar })
    else if (!this.ws) this.connect()
  }

  connect() {
    if (this.closed || !this.wanted || this.ws) return
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/mp`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.later()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.retry = 1000
      ws.send(JSON.stringify({ t: 'hello', name: this.wanted, avatar: this.avatar }))
    }
    ws.onmessage = (e) => {
      let m: Record<string, unknown>
      try {
        m = JSON.parse(String(e.data))
      } catch {
        return
      }
      if (m.t === 'welcome') {
        this.id = Number(m.id)
        this.name = String(m.name ?? '')
      } else if (m.t === 'players' && Array.isArray(m.list)) {
        if (typeof m.now === 'number') this.sampleClock(m.now)
        this.onPlayers((m.list as NetPlayer[]).filter((p) => p.id !== this.id))
      }
      else if (m.t === 'leave') this.onLeave(Number(m.id))
      else if (m.t === 'rtc' && m.data) this.onRtc(Number(m.from), m.data)
      else if (m.t === 'items' && Array.isArray(m.list)) this.onItems(m.list as NetFloorItem[])
      else if (m.t === 'photos' && Array.isArray(m.list)) this.onPhotos(m.list as NetPhoto[])
      else if (m.t === 'doors' && Array.isArray(m.open)) this.onDoors((m.open as unknown[]).filter((x): x is string => typeof x === 'string'))
      else if (m.t === 'photo' && m.photo) this.onPhoto(m.photo as NetPhoto)
      else if (m.t === 'took') this.onTook(m as unknown as { id: number, hand: number, kind?: string, left?: number })
      else if ((m.t === 'offer' || m.t === 'offer-reply' || m.t === 'offer-cancel') && typeof m.oid === 'string') this.onOffer(m as unknown as NetOffer)
      else if (m.t === 'dj' && m.dj && typeof m.now === 'number') {
        this.sampleClock(m.now)
        this.dj = m.dj as DjState
        this.onDj(this.dj)
      }
      else if (m.t === 'chat' && typeof m.text === 'string') {
        const id = Number(m.id)
        this.onChat({ id, name: String(m.name ?? ''), text: m.text, at: Date.now(), mine: id === this.id })
      }
    }
    ws.onclose = () => {
      this.ws = null
      this.later()
    }
    ws.onerror = () => ws.close()
  }

  later() {
    if (this.closed) return
    window.setTimeout(() => this.connect(), this.retry)
    this.retry = Math.min(15000, this.retry * 2)
  }

  send(msg: unknown) {
    if (this.online) this.ws?.send(JSON.stringify(msg))
  }

  // relógio do servidor: mensagem atrasada só faz a amostra ficar menor, então vale a maior que já chegou
  sampleClock(serverNow: number) {
    const s = serverNow - Date.now()
    if (!this.skewSet || s > this.clockSkew) this.clockSkew = s
    this.skewSet = true
  }

  serverNow() {
    return Date.now() + this.clockSkew
  }

  // posição (s) em que o vídeo atual deve estar agora
  djPosition() {
    const c = this.dj.cur
    return c ? c.offset + (this.serverNow() - c.startedAt) / 1000 : 0
  }

  close() {
    this.closed = true
    this.ws?.close()
  }
}
