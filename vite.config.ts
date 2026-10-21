import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import type { Server } from 'node:http'
import { attachMultiplayer } from './mp/server.ts'
import { photosProxy } from './mp/photos.ts'
import { videoProxy } from './mp/video.ts'

// Multiplayer (WebSocket em /mp) e vídeo do telão (/mp/video, via yt-dlp) no mesmo servidor do dev: um túnel só
// serve site, jogo e vídeo.
const multiplayer = (): Plugin => ({
  name: 'multiplayer',
  configureServer(server) {
    if (server.httpServer) attachMultiplayer(server.httpServer as Server)
    server.middlewares.use((req, res, next) => {
      if (!videoProxy(req, res) && !photosProxy(req, res)) next()
    })
  },
})

export default defineConfig({
  server: {
    port: 30101,
    strictPort: true,
    // túnel rápido do Cloudflare (cloudflared tunnel --url) chega com Host *.trycloudflare.com
    allowedHosts: ['.trycloudflare.com'],
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [tailwindcss(), multiplayer()],
})
