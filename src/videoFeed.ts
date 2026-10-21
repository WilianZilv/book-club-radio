// Telão do nosso jeito: imagem e som do vídeo do DJ vêm do proxy (/mp/video, mesma origem), então a página desenha
// a imagem (textura no 3D: pixels de LED, bloom, distorção, domo) e passa o som pelo Web Audio (distância, abafado,
// eco e a batida de verdade). O iframe do YouTube continua mandando: é dele o vídeo atual, o tempo e o fim; aqui só
// seguimos.
//
// Três modos, do melhor para o pior:
// 1. yt-dlp pelo servidor (fonte única, sabe o vídeo e o tempo exatos): telão e som perfeitos e sincronizados.
// 2. yt-dlp bloqueado: o jogador grava a própria aba (botão "Ligar o telão pela aba"). O Chrome grava só o elemento
//    do iframe (Element Capture, `restrictTo`, mesmo escondido atrás do canvas) e o som da aba. A imagem vira a
//    mesma textura e o som passa pela mesma análise (batida e faixas); quem toca o som continua sendo o iframe (a
//    captura não silencia a aba).
// 3. Sem captura: o iframe do YouTube puro no telão, sem efeitos nem sincronia (`ok` falso).
import * as THREE from 'three'

interface RestrictionTargetCtor { fromElement(el: Element): Promise<unknown> }
type RestrictableTrack = MediaStreamTrack & { restrictTo?: (t: unknown) => Promise<void> }

// ?mode=1|2|3 na URL força um modo (1 = o melhor, padrão; 2 = sem yt-dlp, só a captura da aba; 3 = só o iframe)
export const MODE: 1 | 2 | 3 = (() => {
  const m = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('mode') : null
  return m === '2' ? 2 : m === '3' ? 3 : 1
})()
// modos 2 e 3: nunca usa o proxy (yt-dlp), como se ele estivesse bloqueado
export const NO_PROXY = MODE >= 2

// o navegador grava um elemento da página (Chrome 132+); no modo 3 a captura não é oferecida
export const CAN_CAPTURE = MODE <= 2 && typeof window !== 'undefined' && 'RestrictionTarget' in window && !!navigator.mediaDevices?.getDisplayMedia

// parte da música sem posição (o resto sai das caixas)
const BED = 0.35

export class VideoFeed {
  video = document.createElement('video')
  audio = document.createElement('audio')
  tex: THREE.VideoTexture
  id = ''
  failed = false
  // algum quadro já saiu (só para saber; o telão é nosso desde que o vídeo começa a carregar)
  started = false
  seekAt = new Map<HTMLMediaElement, number>()
  ctx: AudioContext | null = null
  gain: GainNode | null = null
  low: BiquadFilterNode | null = null
  wet: GainNode | null = null
  dry: GainNode | null = null
  an: AnalyserNode | null = null
  bins = new Uint8Array(0)
  fbins = new Float32Array(0)
  // batida: ataques do grave (fluxo de energia acima da variação recente) dão o andamento; o relógio de batida
  // segue esse andamento e cada ataque novo acerta a fase (batida que não foi detectada continua batendo)
  prevE = 0
  hist: { t: number, f: number }[] = []
  lastOnset = 0
  onsetTimes: number[] = []
  period = 0
  nextBeat = 0
  lastFire = 0
  onsets = 0
  bpm = 0
  level = 0
  // 3 faixas (grave 20-200 Hz, médio 200-2000, agudo 2000-12000): nível 0..1 (contra o pico recente) e a hora do
  // último ataque de cada uma; o grave bate junto com o relógio da batida
  bandLvl = [0, 0, 0]
  bandHit = [-10, -10, -10]
  bandMax = [1e-4, 1e-4, 1e-4]
  bandPrev = [0, 0, 0]
  bandHist: { t: number, f: number }[][] = [[], [], []]
  // Som saindo das caixas: o mesmo sinal vai para um panner por caixa (equalpower: só volume por lado, sem atraso
  // nem filtro, então somar as cópias não embola a fase); o peso de cada caixa vem da distância até mim e os pesos
  // somam sempre 1 (o volume não muda por ter mais caixa perto). Uma parte fica sem posição (corpo da música).
  boxes: { x: number, y: number, z: number }[] = []
  boxNodes: { g: GainNode, p: PannerNode }[] = []
  bed: GainNode | null = null

  constructor() {
    for (const el of [this.video, this.audio]) {
      el.preload = 'auto'
      el.crossOrigin = 'anonymous'
      el.addEventListener('loadedmetadata', () => {
        if (this.target > 0.5) {
          this.seekAt.set(el, performance.now())
          el.currentTime = this.target + 0.2
        }
      })
      el.addEventListener('error', () => {
        if (el.getAttribute('src') && !this.failed) {
          this.failed = true
          this.failedAt = performance.now()
        }
      })
    }
    this.video.muted = true
    this.video.playsInline = true
    this.video.addEventListener('playing', () => {
      this.started = true
    })
    this.tex = new THREE.VideoTexture(this.video)
    this.tex.colorSpace = THREE.SRGBColorSpace
    this.tex.generateMipmaps = false
    this.tex.minFilter = THREE.LinearFilter
    this.tex.magFilter = THREE.LinearFilter
  }

  // o telão e o som são nossos enquanto o proxy não falhar (mesmo carregando: tela preta até o primeiro quadro);
  // depender do readyState fazia piscar para o iframe a cada buffer
  get ok() {
    return this.capturing || (!this.failed && !!this.id)
  }

  // captura da aba em curso (plano B)
  cap: MediaStream | null = null
  capSrc: MediaStreamAudioSourceNode | null = null
  get capturing() {
    return !!this.cap?.getVideoTracks().some((t) => t.readyState === 'live')
  }
  // som parado / com dados: do <audio> do proxy ou, na captura, do vídeo capturado
  get paused() {
    return this.capturing ? this.video.paused : this.audio.paused
  }
  get ready() {
    return this.capturing ? this.video.readyState >= 2 : this.audio.readyState >= 3
  }

  // Pede ao navegador para gravar esta aba (o usuário escolhe "esta aba" e o som) e restringe o vídeo ao elemento
  // do player. Precisa vir de um clique. Devolve o erro em texto ou '' se deu certo.
  async startCapture(el: HTMLElement): Promise<string> {
    if (!CAN_CAPTURE) return 'Este navegador não grava um elemento da página (precisa do Chrome 132 ou mais novo).'
    this.unlock()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser', frameRate: 30 },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'exclude',
      } as DisplayMediaStreamOptions)
    } catch {
      return 'Captura cancelada.'
    }
    const track = stream.getVideoTracks()[0] as RestrictableTrack | undefined
    try {
      const RT = (window as unknown as { RestrictionTarget: RestrictionTargetCtor }).RestrictionTarget
      if (!track?.restrictTo) throw new Error('restrictTo')
      await track.restrictTo(await RT.fromElement(el))
    } catch {
      for (const t of stream.getTracks()) t.stop()
      return 'Escolha "esta aba" na janela do navegador (outra aba ou a tela não servem).'
    }
    this.stopCapture()
    this.cap = stream
    track.addEventListener('ended', () => {
      if (this.cap === stream) this.stopCapture()
    })
    // vídeo: o mesmo <video> da textura, agora com a captura
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.srcObject = new MediaStream(stream.getVideoTracks())
    void this.video.play().catch(() => {})
    // som da aba: só análise (o iframe já toca no alto-falante)
    this.audio.pause()
    const ctx = this.ctx
    if (ctx && this.an && stream.getAudioTracks().length) {
      this.capSrc = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
      this.capSrc.connect(this.an)
    }
    this.failed = false
    this.locked = true
    this.started = true
    this.applyVol()
    return stream.getAudioTracks().length ? '' : 'Sem o som da aba: marque "compartilhar áudio da aba" para a batida funcionar.'
  }

  stopCapture() {
    const cap = this.cap
    if (!cap) return
    this.cap = null
    for (const t of cap.getTracks()) t.stop()
    this.capSrc?.disconnect()
    this.capSrc = null
    this.video.srcObject = null
    this.locked = false
    this.stableAt = 0
    this.loadAt = performance.now()
    // volta para o proxy (se ainda estiver bloqueado, falha e espera 1 min como sempre)
    if (NO_PROXY) {
      this.failed = true
      this.failedAt = performance.now()
    } else if (this.id) {
      this.video.src = `/mp/video/${this.id}?k=v`
      this.audio.src = `/mp/video/${this.id}?k=a`
    }
  }

  // falhou (proxy sem vídeo): tenta de novo a cada minuto; enquanto isso o telão usa o iframe
  failedAt = 0

  // som travado no relógio (tocando, com dados e desvio < 0,25 s por 0,4 s seguidos): até lá fica mudo e o telão
  // mostra o "sintonizando"; depois entra com fade
  locked = false
  stableAt = 0
  vol = 0
  loadAt = 0

  load(id: string) {
    if (id === this.id) return
    this.id = id
    // na captura a imagem já é a do iframe (ele troca de vídeo sozinho)
    if (this.capturing) return
    if (NO_PROXY && id) {
      this.failed = true
      this.failedAt = performance.now()
      for (const el of [this.video, this.audio]) {
        el.pause()
        el.removeAttribute('src')
      }
      return
    }
    this.failed = false
    this.started = false
    this.locked = false
    this.stableAt = 0
    this.loadAt = performance.now()
    this.applyVol()
    if (!id) {
      for (const el of [this.video, this.audio]) {
        el.pause()
        el.removeAttribute('src')
        el.load()
      }
      return
    }
    this.video.src = `/mp/video/${id}?k=v`
    this.audio.src = `/mp/video/${id}?k=a`
  }

  // Chamado todo quadro com o tempo do relógio do servidor. O som segue o relógio e a imagem segue o som (boca e
  // batida juntas). Desvio pequeno corrige acelerando/freando de leve; grande pula, com folga para o tempo do pulo
  // e no máximo 1 pulo por segundo por elemento (pular toda hora rebufferiza e trava).
  target = 0
  sync(t: number, playing: boolean) {
    this.target = t
    if (this.capturing) {
      if (this.video.paused) void this.video.play().catch(() => {})
      return
    }
    if (this.failed && this.id && !NO_PROXY && performance.now() - this.failedAt > 60_000) {
      this.failed = false
      this.locked = false
      this.stableAt = 0
      this.loadAt = performance.now()
      this.video.src = `/mp/video/${this.id}?k=v`
      this.audio.src = `/mp/video/${this.id}?k=a`
    }
    if (!this.id || this.failed) return
    const now = performance.now()
    const follow = (el: HTMLMediaElement, want: number, big: number, lead: number) => {
      if (el.readyState < 1) return
      // pulo que empacou (o Chrome às vezes deixa o seek pendurado mesmo com o trecho já baixado): pula de novo
      if (el.seeking) {
        if (now - (this.seekAt.get(el) ?? now) > 2500) {
          this.seekAt.set(el, now)
          el.currentTime = Math.max(0, want + lead)
        }
        return
      }
      const drift = el.currentTime - want
      if (Math.abs(drift) > big) {
        if (now - (this.seekAt.get(el) ?? 0) > 1000) {
          this.seekAt.set(el, now)
          el.currentTime = Math.max(0, want + lead)
          el.playbackRate = 1
        }
      } else el.playbackRate = Math.abs(drift) > 0.04 ? 1 - Math.max(-0.08, Math.min(0.08, drift * 0.5)) : 1
      if (playing && el.paused) void el.play().catch(() => {})
      else if (!playing && !el.paused) el.pause()
    }
    follow(this.audio, t, 0.8, 0.12)
    const a = this.audio
    if (!this.locked) {
      const steady = playing && !a.paused && a.readyState >= 3 && !a.seeking && Math.abs(a.currentTime - t) < 0.25
      if (!steady) this.stableAt = 0
      else if (!this.stableAt) this.stableAt = now
      else if (now - this.stableAt > 400) {
        this.locked = true
        this.applyVol()
      }
      if (!this.locked && playing && now - this.loadAt > 8000) {
        this.loadAt = now
        const src = a.src
        a.removeAttribute('src')
        a.load()
        a.src = src
      }
    }
    follow(this.video, a.readyState >= 2 && !a.paused ? a.currentTime : t, 0.5, 0.05)
  }

  // primeiro clique na página: liga o Web Audio (antes disso o navegador não deixa tocar som)
  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext()
      const src = ctx.createMediaElementSource(this.audio)
      this.an = ctx.createAnalyser()
      this.an.fftSize = 2048
      this.an.smoothingTimeConstant = 0
      this.bins = new Uint8Array(this.an.frequencyBinCount)
      this.fbins = new Float32Array(this.an.frequencyBinCount)
      this.low = ctx.createBiquadFilter()
      this.low.type = 'lowpass'
      this.low.frequency.value = 20000
      this.gain = ctx.createGain()
      this.gain.gain.value = 0
      this.dry = ctx.createGain()
      this.wet = ctx.createGain()
      this.wet.gain.value = 0
      const verb = ctx.createConvolver()
      verb.buffer = impulse(ctx, 2.4)
      // análise antes do volume (a batida não some de longe); som: abafa -> volume -> seco + eco
      src.connect(this.an)
      src.connect(this.low)
      this.low.connect(this.gain)
      this.bed = ctx.createGain()
      this.bed.gain.value = this.boxes.length ? BED : 1
      this.gain.connect(this.bed)
      this.bed.connect(this.dry)
      this.boxNodes = this.boxes.map((b) => {
        const g = ctx.createGain()
        g.gain.value = 0
        const p = ctx.createPanner()
        p.panningModel = 'equalpower'
        // a distância quem faz é o peso (g); o panner só dá a direção
        p.distanceModel = 'linear'
        p.rolloffFactor = 0
        p.positionX.value = b.x
        p.positionY.value = b.y
        p.positionZ.value = b.z
        this.gain!.connect(g)
        g.connect(p)
        p.connect(this.dry!)
        return { g, p }
      })
      this.gain.connect(verb)
      verb.connect(this.wet)
      this.dry.connect(ctx.destination)
      this.wet.connect(ctx.destination)
      this.ctx = ctx
    }
    void this.ctx.resume()
    if (this.id && !this.failed && !this.capturing) void this.audio.play().catch(() => {})
  }

  // onde estão as caixas (antes de ligar o Web Audio)
  setBoxes(list: { x: number, y: number, z: number }[]) {
    this.boxes = list
  }

  // pesos das caixas pela minha posição (o ouvinte do Web Audio já segue a câmera)
  aimBoxes(x: number, y: number, z: number) {
    const ctx = this.ctx
    if (!ctx || !this.boxNodes.length) return
    const w = this.boxes.map((b) => 1 / (1 + (Math.hypot(b.x - x, b.y - y, b.z - z) / 4) ** 2))
    const sum = w.reduce((a, v) => a + v, 0) || 1
    const t = ctx.currentTime
    this.boxNodes.forEach((n, i) => n.g.gain.setTargetAtTime((1 - BED) * (w[i] / sum), t, 0.08))
  }

  // volume atual (mudo enquanto não trava; ao travar sobe em fade)
  applyVol() {
    const ctx = this.ctx
    if (!ctx || !this.gain) return
    this.gain.gain.setTargetAtTime(this.locked ? this.vol : 0, ctx.currentTime, this.locked ? 0.35 : 0.05)
  }

  // vol 0..1; muffle 0..1 (0 = aberto, 1 = muito abafado); verb 0..1 (quanto de eco)
  mix(vol: number, muffle: number, verb: number) {
    const ctx = this.ctx
    if (!ctx || !this.gain || !this.low || !this.wet || !this.dry) return
    const t = ctx.currentTime
    this.vol = vol
    this.gain.gain.setTargetAtTime(this.locked ? vol : 0, t, this.locked ? 0.35 : 0.05)
    this.low.frequency.setTargetAtTime(20000 * Math.pow(250 / 20000, Math.min(1, Math.max(0, muffle))), t, 0.2)
    this.wet.gain.setTargetAtTime(verb * 0.9, t, 0.3)
    this.dry.gain.setTargetAtTime(1 - verb * 0.5, t, 0.3)
  }

  // chamada todo quadro: true na batida
  beat(now: number): boolean {
    const an = this.an
    if (!an || !this.ok || this.paused) {
      this.level = 0
      return false
    }
    an.getByteFrequencyData(this.bins)
    let all = 0
    for (let i = 0; i < this.bins.length; i++) all += this.bins[i]
    this.level = all / (this.bins.length * 255)
    // energia do grave (40-180 Hz) em amplitude linear e o quanto ela subiu desde o quadro anterior
    an.getFloatFrequencyData(this.fbins)
    const hz = (this.ctx?.sampleRate ?? 48000) / an.fftSize
    const lo = Math.max(1, Math.round(40 / hz))
    const hi = Math.max(lo, Math.round(180 / hz))
    let e = 0
    for (let i = lo; i <= hi; i++) {
      const m = 10 ** (this.fbins[i] / 20)
      e += m * m
    }
    e = Math.sqrt(e / (hi - lo + 1))
    const flux = Math.max(0, e - this.prevE)
    this.prevE = e
    const h = this.hist
    h.push({ t: now, f: flux })
    while (h.length && h[0].t < now - 1.5) h.shift()
    let mean = 0
    for (const x of h) mean += x.f
    mean /= h.length
    let v = 0
    for (const x of h) v += (x.f - mean) ** 2
    const sd = Math.sqrt(v / h.length)
    let onset = false
    if (h.length > 10 && flux > mean + 1.5 * sd && flux > 1e-4 && now - this.lastOnset > 0.2) {
      onset = true
      this.lastOnset = now
      this.onsetTimes.push(now)
      while (this.onsetTimes.length && this.onsetTimes[0] < now - 8) this.onsetTimes.shift()
      this.tempo()
    }
    // sem ataque por 6 s: perde o andamento
    if (now - this.lastOnset > 6) this.period = 0
    let fire = false
    const P = this.period
    if (onset) {
      if (!P) fire = true
      else {
        // ataque só corrige a fase (um quarto do erro até a batida prevista mais perto); quem bate é o relógio,
        // então contratempo e chimbal não viram batida extra
        let err = (now - this.nextBeat) % P
        if (err < 0) err += P
        if (err > P / 2) err -= P
        this.nextBeat += err * 0.25
        // a correção nunca puxa a próxima batida para perto demais da última
        this.nextBeat = Math.max(this.nextBeat, this.lastFire + P * 0.6)
      }
    }
    if (!fire && P && now >= this.nextBeat) {
      fire = true
      this.nextBeat += P
      if (this.nextBeat <= now) this.nextBeat = now + P
    }
    if (fire) {
      this.onsets++
      this.lastFire = now
      this.bandHit[0] = now
    }
    this.bands(now, hz)
    return fire
  }

  bands(now: number, hz: number) {
    const ranges = [[20, 200], [200, 2000], [2000, 12000]]
    const gap = [0.2, 0.14, 0.09]
    for (let b = 0; b < 3; b++) {
      const lo = Math.max(1, Math.round(ranges[b][0] / hz))
      const hi = Math.min(this.fbins.length - 1, Math.max(lo, Math.round(ranges[b][1] / hz)))
      let e = 0
      for (let i = lo; i <= hi; i++) {
        const m = 10 ** (this.fbins[i] / 20)
        e += m * m
      }
      e = Math.sqrt(e / (hi - lo + 1))
      this.bandMax[b] = Math.max(this.bandMax[b] * 0.997, e)
      this.bandLvl[b] = Math.min(1, e / this.bandMax[b])
      if (b === 0) continue
      const flux = Math.max(0, e - this.bandPrev[b])
      this.bandPrev[b] = e
      const h = this.bandHist[b]
      h.push({ t: now, f: flux })
      while (h.length && h[0].t < now - 1.2) h.shift()
      let mean = 0
      for (const x of h) mean += x.f
      mean /= h.length
      let v = 0
      for (const x of h) v += (x.f - mean) ** 2
      if (h.length > 10 && flux > mean + 1.6 * Math.sqrt(v / h.length) && flux > 1e-5 && now - this.bandHit[b] > gap[b]) this.bandHit[b] = now
    }
  }

  // andamento: intervalos entre ataques dobrados/divididos para 80-170 bpm; o mais comum (com vizinhos) vence
  tempo() {
    const t = this.onsetTimes
    if (t.length < 5) return
    const bins = new Map<number, number>()
    for (let i = 1; i < t.length; i++) {
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        let d = t[i] - t[j]
        while (d < 0.353) d *= 2
        while (d > 0.75) d /= 2
        const k = Math.round(d * 100)
        // ataque vizinho pesa mais que o de 3 atrás
        bins.set(k, (bins.get(k) ?? 0) + 1 / (i - j))
      }
    }
    let best = 0
    let score = 0
    for (const [k] of bins) {
      const sc = (bins.get(k) ?? 0) + 0.5 * ((bins.get(k - 1) ?? 0) + (bins.get(k + 1) ?? 0))
      if (sc > score) {
        score = sc
        best = k
      }
    }
    if (!best || score < 2) return
    const p = best / 100
    this.period = this.period ? this.period * 0.7 + p * 0.3 : p
    this.bpm = Math.round(60 / this.period)
    if (!this.nextBeat || this.nextBeat < this.lastOnset) this.nextBeat = this.lastOnset + this.period
  }
}

// eco de sala: ruído que decai (estéreo)
function impulse(ctx: AudioContext, sec: number) {
  const n = Math.floor(ctx.sampleRate * sec)
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3)
  }
  return buf
}
