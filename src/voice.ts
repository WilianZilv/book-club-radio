// Voz por proximidade: cada par de jogadores tem uma conexão WebRTC direta (o servidor só apresenta um ao outro,
// o áudio não passa por ele). A voz de cada um entra no Web Audio como a música: posição 3D (HRTF), queda com a
// distância, parede entre os dois abafando e o eco do lugar onde a voz soa (banheiro de azulejo, corredor...).
import type { Net } from './net.ts'
import type { Acoustics } from './game/annex.ts'

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }

interface Peer {
  pc: RTCPeerConnection
  // canal de áudio: quem oferece cria; quem responde usa o que veio na oferta
  tx: RTCRtpTransceiver | null
  // nós de áudio (quando a voz chega e o AudioContext existe)
  el: HTMLAudioElement | null
  stream: MediaStream | null
  src: MediaStreamAudioSourceNode | null
  low: BiquadFilterNode | null
  pan: PannerNode | null
  gain: GainNode | null
  send: GainNode | null
  an: AnalyserNode | null
  buf: Uint8Array<ArrayBuffer>
  level: number
  openedAt: number
  // faixas da voz (grave, médio, agudo): nível 0..1 e a hora do último ataque de cada uma (boca e ondas)
  bands: Bands
}

export interface Bands { lv: number[], peak: number[], prev: number[], hit: number[], f: Uint8Array<ArrayBuffer> }
const newBands = (): Bands => ({ lv: [0, 0, 0], peak: [0.05, 0.05, 0.05], prev: [0, 0, 0], hit: [-10, -10, -10], f: new Uint8Array(256) })

// grave 90-300 Hz, médio 300-2000, agudo 2000-6000 (fft de 512: ~94 Hz por faixa); nível contra o pico recente e
// ataque quando a faixa sobe rápido
function analyze(an: AnalyserNode, b: Bands, now: number, sampleRate: number) {
  an.getByteFrequencyData(b.f)
  const hz = sampleRate / an.fftSize
  const rng = [[90, 300], [300, 2000], [2000, 6000]]
  for (let k = 0; k < 3; k++) {
    const lo = Math.max(1, Math.round(rng[k][0] / hz))
    const hi = Math.min(b.f.length - 1, Math.round(rng[k][1] / hz))
    let e = 0
    for (let i = lo; i <= hi; i++) e += b.f[i]
    e /= (hi - lo + 1) * 255
    b.peak[k] = Math.max(b.peak[k] * 0.995, e, 0.05)
    const lv = Math.min(1, e / b.peak[k]) * Math.min(1, e * 6)
    if (lv - b.prev[k] > 0.25 && lv > 0.35 && now - b.hit[k] > 0.12) b.hit[k] = now
    b.prev[k] = lv
    b.lv[k] += (lv - b.lv[k]) * 0.5
  }
}

export class Voice {
  net: Net
  getCtx: () => AudioContext | null
  peers = new Map<number, Peer>()
  mic: MediaStream | null = null
  micOn = false
  // eco das vozes (um só, a quantidade de cada voz depende do lugar dela)
  verb: ConvolverNode | null = null
  verbOut: GainNode | null = null
  myLevel = 0
  myAn: AnalyserNode | null = null
  myBuf: Uint8Array<ArrayBuffer> = new Uint8Array(512)
  myBands = newBands()
  // minha voz no eco do lugar (só o eco, sem a voz seca: não vira retorno de microfone)
  mySrc: MediaStreamAudioSourceNode | null = null
  mySend: GainNode | null = null

  constructor(net: Net, getCtx: () => AudioContext | null) {
    this.net = net
    this.getCtx = getCtx
    net.onRtc = (from, data) => void this.signal(from, data as Record<string, unknown>)
  }

  // liga/desliga o microfone (precisa de clique: o navegador pede a permissão)
  async toggleMic() {
    if (this.micOn) {
      this.micOn = false
      for (const t of this.mic?.getTracks() ?? []) t.stop()
      this.mic = null
      this.myAn = null
      this.mySrc?.disconnect()
      this.mySend?.disconnect()
      this.mySrc = null
      this.mySend = null
      for (const p of this.peers.values()) void p.tx?.sender.replaceTrack(null)
      return false
    }
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch {
      return false
    }
    this.micOn = true
    const track = this.mic.getAudioTracks()[0]
    for (const p of this.peers.values()) void p.tx?.sender.replaceTrack(track)
    const ctx = this.getCtx()
    if (ctx) {
      this.myAn = ctx.createAnalyser()
      this.myAn.fftSize = 512
      this.mySrc = ctx.createMediaStreamSource(this.mic)
      this.mySrc.connect(this.myAn)
      // um pouco de atraso antes do eco: soa como a sala respondendo, não como o próprio microfone
      const pre = ctx.createDelay(0.2)
      pre.delayTime.value = 0.04
      this.mySend = ctx.createGain()
      this.mySend.gain.value = 0
      this.mySrc.connect(pre)
      pre.connect(this.mySend)
      this.mySend.connect(this.ensureVerb(ctx))
    }
    return true
  }

  // mantém uma conexão com cada jogador online (quem tem o id menor faz a oferta)
  sync(ids: number[]) {
    const want = new Set(ids)
    for (const id of ids) if (!this.peers.has(id)) {
      const mine = !!this.net.id && this.net.id < id
      const p = this.open(id, mine)
      if (mine) void this.offer(id, p)
    }
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.close(id)
  }

  open(id: number, offerer: boolean): Peer {
    const pc = new RTCPeerConnection(ICE)
    const tx = offerer ? pc.addTransceiver('audio', { direction: 'sendrecv' }) : null
    const track = this.mic?.getAudioTracks()[0]
    if (tx && track) void tx.sender.replaceTrack(track)
    const p: Peer = { pc, tx, el: null, stream: null, src: null, low: null, pan: null, gain: null, send: null, an: null, buf: new Uint8Array(512), level: 0, openedAt: performance.now(), bands: newBands() }
    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.send({ t: 'rtc', to: id, data: { ice: e.candidate.toJSON() } })
    }
    pc.ontrack = (e) => {
      p.stream = e.streams[0] ?? new MediaStream([e.track])
      // o Chrome só entrega o áudio de WebRTC ao Web Audio se o stream também estiver num <audio> (mudo)
      p.el = new Audio()
      p.el.muted = true
      p.el.srcObject = p.stream
      void p.el.play().catch(() => {})
      this.wire(p)
    }
    this.peers.set(id, p)
    return p
  }

  async offer(id: number, p: Peer) {
    const o = await p.pc.createOffer()
    await p.pc.setLocalDescription(o)
    this.net.send({ t: 'rtc', to: id, data: { sdp: p.pc.localDescription?.toJSON() } })
  }

  async signal(from: number, data: Record<string, unknown>) {
    let p = this.peers.get(from)
    if (!p) p = this.open(from, false)
    try {
      if (data.sdp) {
        const d = data.sdp as RTCSessionDescriptionInit
        await p.pc.setRemoteDescription(d)
        if (d.type === 'offer') {
          // o canal da oferta: manda e recebe, com o meu microfone (se estiver ligado)
          p.tx = p.pc.getTransceivers()[0] ?? null
          if (p.tx) {
            p.tx.direction = 'sendrecv'
            const track = this.mic?.getAudioTracks()[0]
            if (track) await p.tx.sender.replaceTrack(track)
          }
          const a = await p.pc.createAnswer()
          await p.pc.setLocalDescription(a)
          this.net.send({ t: 'rtc', to: from, data: { sdp: p.pc.localDescription?.toJSON() } })
        }
      } else if (data.ice) await p.pc.addIceCandidate(data.ice as RTCIceCandidateInit)
    } catch {
      // sinal fora de ordem: a próxima rodada de ICE resolve ou a conexão é refeita quando o jogador volta
    }
  }

  close(id: number) {
    const p = this.peers.get(id)
    if (!p) return
    p.pc.close()
    for (const n of [p.src, p.low, p.pan, p.gain, p.send]) n?.disconnect()
    p.el?.pause()
    this.peers.delete(id)
  }

  ensureVerb(ctx: AudioContext) {
    if (!this.verb) {
      this.verb = ctx.createConvolver()
      this.verb.buffer = impulse(ctx, 1.6)
      this.verbOut = ctx.createGain()
      this.verbOut.gain.value = 0.9
      this.verb.connect(this.verbOut)
      this.verbOut.connect(ctx.destination)
    }
    return this.verb
  }

  // voz -> abafa (parede) -> posição 3D -> volume -> saída seca + envio para o eco
  wire(p: Peer) {
    const ctx = this.getCtx()
    if (!ctx || !p.stream || p.src) return
    this.ensureVerb(ctx)
    p.src = ctx.createMediaStreamSource(p.stream)
    p.an = ctx.createAnalyser()
    p.an.fftSize = 512
    p.low = ctx.createBiquadFilter()
    p.low.type = 'lowpass'
    p.low.frequency.value = 20000
    p.pan = ctx.createPanner()
    p.pan.panningModel = 'HRTF'
    p.pan.distanceModel = 'inverse'
    p.pan.refDistance = 1.8
    p.pan.rolloffFactor = 1.1
    p.pan.maxDistance = 60
    p.gain = ctx.createGain()
    p.send = ctx.createGain()
    p.send.gain.value = 0
    p.src.connect(p.an)
    p.src.connect(p.low)
    p.low.connect(p.pan)
    p.pan.connect(p.gain)
    p.gain.connect(ctx.destination)
    p.gain.connect(p.send)
    p.send.connect(this.ensureVerb(ctx))
  }

  // todo quadro: ouvido na câmera, cada voz na cabeça do jogador; parede entre os dois abafa (diferença do quanto
  // cada lugar é fechado), o eco é o do lugar da voz e de quem ouve
  update(ear: { x: number, y: number, z: number, fx: number, fy: number, fz: number }, at: (id: number) => { x: number, y: number, z: number } | null, acoustics: (x: number, z: number) => Acoustics) {
    const ctx = this.getCtx()
    if (!ctx) return
    const L = ctx.listener
    const t = ctx.currentTime
    if (L.positionX) {
      L.positionX.setTargetAtTime(ear.x, t, 0.03)
      L.positionY.setTargetAtTime(ear.y, t, 0.03)
      L.positionZ.setTargetAtTime(ear.z, t, 0.03)
      L.forwardX.setTargetAtTime(ear.fx, t, 0.03)
      L.forwardY.setTargetAtTime(ear.fy, t, 0.03)
      L.forwardZ.setTargetAtTime(ear.fz, t, 0.03)
      L.upX.value = 0
      L.upY.value = 1
      L.upZ.value = 0
    }
    const me = acoustics(ear.x, ear.z)
    // meu eco: só onde a sala devolve som (banheiro, hall, corredor); no club e no terraço quase nada
    this.mySend?.gain.setTargetAtTime(Math.max(0, me.verb - 0.1) * 0.9, t, 0.2)
    const now = performance.now()
    for (const [id, p] of [...this.peers]) {
      // conexão que falhou (rede, ou o outro lado sem resposta): fecha; o próximo sync() abre de novo
      if ((p.pc.connectionState === 'failed' || p.pc.connectionState === 'closed') && now - p.openedAt > 8000) {
        this.close(id)
        continue
      }
      if (!p.src && p.stream) this.wire(p)
      const pos = at(id)
      if (!pos || !p.pan || !p.low || !p.send || !p.gain || !p.an) continue
      p.pan.positionX.setTargetAtTime(pos.x, t, 0.05)
      p.pan.positionY.setTargetAtTime(pos.y, t, 0.05)
      p.pan.positionZ.setTargetAtTime(pos.z, t, 0.05)
      const them = acoustics(pos.x, pos.z)
      const wall = Math.abs(me.muffle - them.muffle)
      p.low.frequency.setTargetAtTime(20000 * Math.pow(350 / 20000, Math.min(1, wall * 1.3)), t, 0.1)
      p.gain.gain.setTargetAtTime(1.7 * (1 - wall * 0.55), t, 0.1)
      p.send.gain.setTargetAtTime(Math.max(me.verb, them.verb) * 0.7, t, 0.15)
      // nível de fala (para o crachá ficar verde)
      p.an.getByteTimeDomainData(p.buf)
      let s = 0
      for (let i = 0; i < p.buf.length; i++) s += ((p.buf[i] - 128) / 128) ** 2
      p.level += (Math.sqrt(s / p.buf.length) - p.level) * 0.3
      analyze(p.an, p.bands, t, ctx.sampleRate)
    }
    if (this.myAn) {
      this.myAn.getByteTimeDomainData(this.myBuf)
      let s = 0
      for (let i = 0; i < this.myBuf.length; i++) s += ((this.myBuf[i] - 128) / 128) ** 2
      this.myLevel += (Math.sqrt(s / this.myBuf.length) - this.myLevel) * 0.3
      analyze(this.myAn, this.myBands, t, ctx.sampleRate)
    } else {
      this.myLevel = 0
      for (let k = 0; k < 3; k++) this.myBands.lv[k] *= 0.8
    }
  }

  bandsOf(id: number) {
    return this.peers.get(id)?.bands ?? null
  }

  speaking(id: number) {
    return (this.peers.get(id)?.level ?? 0) > 0.02
  }

  dispose() {
    for (const id of [...this.peers.keys()]) this.close(id)
    for (const tr of this.mic?.getTracks() ?? []) tr.stop()
  }
}

// eco de sala: ruído que decai (estéreo)
function impulse(ctx: AudioContext, sec: number) {
  const n = Math.floor(ctx.sampleRate * sec)
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.5)
  }
  return buf
}
