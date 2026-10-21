# Book Club Radio

Club em 3D, em primeira pessoa, no navegador: palco com telão de LED, domo e manta de pixels com o vídeo do DJ,
caixas de som, feixes, pista, lounges com mesinhas e sofás e bar. NPCs curtem a festa e dançam na batida da
música; outros jogadores entram pelo multiplayer; qualquer um escolhe a música no DJ.

Veio da cobertura do prédio 3D do `cursor-headless-ui`, sem o prédio, sem os brinquedos e sem o bot.

## Rodar

```
npm install
npm run dev
```

Abre em http://localhost:30101. Precisa de mouse e teclado (WASD anda, Shift corre, espaço pula, mouse olha,
botão direito dá zoom, clique ou E usa/senta, B segurado abre a roda de emotes, M liga o microfone, Enter conversa,
Esc solta). Antes de entrar, a criação de personagem (nome, pele, cabelo, roupa e acessório) fica salva no navegador.

O vídeo do telão passa pelo servidor (`/mp/video`) usando o **yt-dlp**, que precisa estar no PATH. Assim a página
desenha a imagem do jeito dela (pixels de LED, bloom, distorção, domo, manta) e ouve o som (batida, faixas grave,
médio e agudo). Sem yt-dlp o telão volta para o player do YouTube (iframe) e a batida vira um relógio de 125 bpm.
Baixar o stream do YouTube vai contra os termos do YouTube: é para uso local.

Se o YouTube passar a pedir "Sign in to confirm you're not a bot" (muitas requisições do mesmo IP), o yt-dlp
falha e o telão cai para o iframe até voltar (o servidor espera 2 min antes de tentar de novo; a página tenta a
cada minuto). Opções extras do yt-dlp podem vir do ambiente, por exemplo usar o login do seu navegador:

```
YTDLP_ARGS="--cookies-from-browser firefox" npm run dev
```

O servidor é a fonte única do vídeo: cada pedaço do arquivo do YouTube é baixado uma vez e servido da memória
para todos os jogadores.

O telão tem 3 modos, do melhor para o pior, e `?mode=` na URL força um deles:

1. yt-dlp pelo servidor (padrão): telão e som do nosso jeito, sincronizados para todos.
2. Sem yt-dlp: cada jogador liga "Ligar o telão pela aba" e o Chrome grava o player da própria aba (Chrome 132+),
   com os mesmos efeitos e a mesma batida; o som sai do próprio player do YouTube.
3. Só o player do YouTube (iframe), sem efeitos nem sincronia.

No modo 1, se o yt-dlp falhar, o telão passa sozinho para o 2 (com o botão) e, sem captura, fica no 3.

## No club

- Mãos: clique esquerdo/direito pega (ou compra no balcão do bar) e usa o item daquela mão; G larga; E oferece para
  quem a mira aponta (NPC decide sozinho, jogador aceita com Y ou recusa com N). Com as duas mãos ocupadas, o atalho
  pede o clique do lado; o atalho de novo cancela.
- Necessidades: stamina (correr), xixi (vaso ou mictório), embriaguez (bebida; no máximo vem o minigame de segurar o
  vômito), fome (batata do bar) e dinheiro.
- Fotógrafo: anda pelo club tirando fotos; as 12 mais novas ficam nos quadros do bar e as outras no álbum (balcão
  perto do bar).
- TV de LED na lateral mostra o que o DJ vê; portas das cabines do banheiro abrem e fecham.

O servidor guarda em `data/` (ou na pasta de `BCR_DATA`) o estado do DJ (reiniciar continua na mesma música e no
mesmo segundo) e as fotos.

## Estrutura

- `src/game/engine.ts`: motor (câmera, movimento, NPCs, DJ, multiplayer, GI, club no ritmo, ondas, telão e som)
- `src/game/club.ts`: o club (palco, telão, domo, manta, caixas, feixes, pista, lounges, bar)
- `src/game/kit.ts`: texturas, materiais, formas, bonecos (com o personagem escolhido) e mobília
- `src/game/emotes.ts`: emotes da roda e a boca que mexe com a voz
- `src/game/items.ts`: bebidas/comida e necessidades; `src/game/vomit.ts`: jato e poças
- `src/game/photographer.ts`: roteiro do fotógrafo; `src/AlbumPanel.tsx`: álbum de fotos
- `mp/photos.ts` e `mp/store.ts`: fotos e o que o servidor salva em disco
- `src/CharacterCreator.tsx`: criação de personagem com preview 3D
- `src/voice.ts`: voz por proximidade (WebRTC) com acústica do lugar e faixas da voz
- `src/videoFeed.ts`: vídeo e áudio do proxy, Web Audio (volume, eco) e detecção de batida por faixa
- `src/djPlayer.ts`: player do YouTube que segue o DJ do servidor (relógio do telão)
- `src/radianceCascades.ts`: iluminação global 2D (Radiance Cascades)
- `mp/server.ts`: multiplayer (WebSocket em `/mp`: jogadores, chat e DJ)
- `mp/video.ts`: proxy do vídeo (yt-dlp) com cache compartilhado
