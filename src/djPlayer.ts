// Telão do club: player do YouTube (IFrame API) que segue o estado do DJ vindo do servidor.
// Todo mundo calcula a mesma posição pelo relógio do servidor; quem desviar mais de 2,5 s pula para ela.
import type { DjState, Net } from './net.ts'

interface YTPlayer {
  loadVideoById(o: { videoId: string, startSeconds?: number }): void
  loadPlaylist(o: { list: string, listType: 'playlist', index?: number, startSeconds?: number }): void
  seekTo(s: number, allowSeekAhead: boolean): void
  playVideo(): void
  stopVideo(): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  getPlaylistIndex(): number
  getPlaylist(): string[] | null
  getVideoData(): { video_id?: string, title?: string }
  setVolume(v: number): void
  mute(): void
  unMute(): void
  isMuted(): boolean
}
interface YTNamespace {
  Player: new (el: HTMLElement, o: Record<string, unknown>) => YTPlayer
  PlayerState: { ENDED: number, PLAYING: number, PAUSED: number, BUFFERING: number, CUED: number }
}

let api: Promise<YTNamespace> | null = null
function loadApi(): Promise<YTNamespace> {
  const w = window as unknown as { YT?: YTNamespace & { loaded?: number }, onYouTubeIframeAPIReady?: () => void }
  if (w.YT?.Player) return Promise.resolve(w.YT)
  api ??= new Promise((resolve, reject) => {
    w.onYouTubeIframeAPIReady = () => (w.YT ? resolve(w.YT) : reject(new Error('YT')))
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.onerror = () => reject(new Error('iframe_api'))
    document.head.appendChild(s)
  })
  return api
}

export const SCREEN_PX = { w: 1280, h: 720 }
// o player roda na resolução do painel de LED (320 x 180) e é ampliado: 1 pixel do vídeo por LED
export const VIDEO_PX = { w: 320, h: 180 }

export class DjPlayer {
  // elemento que vai para a cena CSS3D (tamanho fixo em px; a escala em metros vem do objeto 3D)
  el: HTMLDivElement
  player: YTPlayer | null = null
  yt: YTNamespace | null = null
  ready = false
  token = ''
  loadedAt = 0
  volume = 0
  blocked = false
  net: Net

  constructor(net: Net) {
    this.net = net
    this.el = document.createElement('div')
    this.el.style.width = `${SCREEN_PX.w}px`
    this.el.style.height = `${SCREEN_PX.h}px`
    this.el.style.background = '#000'
    this.el.style.pointerEvents = 'none'
    const box = document.createElement('div')
    box.style.width = `${VIDEO_PX.w}px`
    box.style.height = `${VIDEO_PX.h}px`
    box.style.transformOrigin = '0 0'
    box.style.transform = `scale(${SCREEN_PX.w / VIDEO_PX.w})`
    this.el.appendChild(box)
    const inner = document.createElement('div')
    box.appendChild(inner)
    void loadApi().then((yt) => {
      this.yt = yt
      this.player = new yt.Player(inner, {
        width: VIDEO_PX.w,
        height: VIDEO_PX.h,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => {
            this.ready = true
            this.sync(this.net.dj, true)
          },
          onStateChange: (e: { data: number }) => this.onState(e.data),
        },
      })
    }).catch(() => {
      // sem acesso ao YouTube (rede ou CSP do build): o telão fica preto
    })
  }

  // Estado novo do servidor: carrega o vídeo/playlist certo na posição certa.
  sync(dj: DjState, force = false) {
    const p = this.player
    if (!p || !this.ready) return
    const c = dj.cur
    if (!c) {
      if (this.token) p.stopVideo()
      this.token = ''
      return
    }
    if (!force && c.token === this.token) return
    const pos = Math.max(0, this.net.djPosition())
    const same = c.item.kind === 'playlist'
      ? p.getPlaylistIndex?.() === c.index && (p.getPlaylist?.()?.length ?? 0) > 0
      : p.getVideoData?.()?.video_id === c.item.video
    this.token = c.token
    this.loadedAt = performance.now()
    // já está no mesmo vídeo (ex.: a playlist avançou aqui primeiro): só acerta o tempo
    if (same && !force) {
      p.seekTo(pos, true)
      return
    }
    if (c.item.kind === 'playlist' && c.item.list) p.loadPlaylist({ list: c.item.list, listType: 'playlist', index: c.index, startSeconds: pos })
    else if (c.item.video) p.loadVideoById({ videoId: c.item.video, startSeconds: pos })
  }

  onState(st: number) {
    const p = this.player
    const yt = this.yt
    const c = this.net.dj.cur
    if (!p || !yt || !c) return
    if (st === yt.PlayerState.PLAYING) this.blocked = false
    if (c.item.kind === 'playlist' && st === yt.PlayerState.PLAYING) {
      // a playlist avançou sozinha neste player: avisa o servidor (o primeiro aviso vale para todos)
      const idx = p.getPlaylistIndex()
      if (idx > c.index) this.net.send({ t: 'dj-ended', token: c.token, next: idx, len: p.getPlaylist()?.length ?? 0 })
    }
    if (st === yt.PlayerState.ENDED) {
      const len = p.getPlaylist()?.length ?? 0
      this.net.send({ t: 'dj-ended', token: c.token, next: c.index + 1, len })
    }
  }

  // ~2x por segundo: corrige desvio, aplica volume e percebe autoplay bloqueado.
  tick(volume: number) {
    const p = this.player
    const yt = this.yt
    const c = this.net.dj.cur
    if (!p || !yt || !this.ready) return
    const v = Math.round(Math.max(0, Math.min(100, volume)))
    if (v !== this.volume) {
      this.volume = v
      p.setVolume(v)
      if (v > 0 && p.isMuted()) p.unMute()
    }
    if (!c) return
    const st = p.getPlayerState()
    if (performance.now() - this.loadedAt < 4000) return
    const want = this.net.djPosition()
    const dur = p.getDuration()
    if (dur > 0 && c.item.kind === 'video' && want > dur + 3) {
      this.net.send({ t: 'dj-ended', token: c.token, next: 1, len: 1 })
      return
    }
    if (st === yt.PlayerState.PLAYING || st === yt.PlayerState.BUFFERING) {
      if (Math.abs(p.getCurrentTime() - want) > 2.5) p.seekTo(want, true)
    } else if (st === yt.PlayerState.PAUSED || st === yt.PlayerState.CUED || st === -1) {
      // o navegador bloqueou o autoplay com som: tenta de novo (vale depois de qualquer clique na página)
      this.blocked = true
      p.playVideo()
    }
  }

  // clique do usuário no painel: libera o som
  unlock() {
    const p = this.player
    if (!p) return
    p.unMute()
    p.playVideo()
    this.sync(this.net.dj, true)
  }

  videoId() {
    if (!this.ready) return ''
    return this.player?.getVideoData?.()?.video_id ?? ''
  }

  title() {
    // antes do onReady o player ainda não tem os métodos/dados
    if (!this.ready) return ''
    return this.player?.getVideoData?.()?.title ?? ''
  }

  time() {
    return this.ready ? this.player?.getCurrentTime?.() ?? 0 : 0
  }

  duration() {
    return this.ready ? this.player?.getDuration?.() ?? 0 : 0
  }
}
