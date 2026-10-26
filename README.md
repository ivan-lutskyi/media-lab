# Media Lab

Браузерні інструменти для релізів: обкладинки, вертикальні відео, GIF.
Усе рахується на пристрої користувача, файли нікуди не завантажуються. Бекенду немає.

| Інструмент | Шлях | Що робить | Звідки |
|---|---|---|---|
| **Деструктор** | `destructor/` | Фото → абстрактне полотно (піксель-сорт, дизеринг, дуотон…) на Canvas 2D | `destructor/destruktor.html`, без змін, крім посилання на хаб. Опис: [destructor/README.md](destructor/README.md) |
| **Vertical Lab** | `vertical/` | Відео → 1080×1920 під Reels/TikTok, H.264, −14 LUFS | `socials-content-formatter.mjs`: той самий конвеєр ffmpeg, але на ffmpeg.wasm замість Node-сервера |
| **GIF Lab** | `gif/` | Відео → легкий GIF з власною палітрою, автопідгонка під 1/2/5 МБ | наступник `mp4-to-lowGif` (moviepy+imageio → ffmpeg palettegen/paletteuse) |

Upscaler і video-transcribe сюди не входять: їм потрібен локальний GPU, а yt-dlp з серверних IP блокує YouTube.

## Як влаштовано

- Без збірки: чистий HTML/CSS/JS-модулі, сайт деплоїться як є.
- `vendor/` — обгортка `@ffmpeg/ffmpeg` і `@ffmpeg/util` (комітиться). Саме ядро `ffmpeg-core.wasm`
  (~32 МБ) вантажиться з jsDelivr і кешується браузером.
- `shared/ffmpeg.js` — спільне для відеоінструментів: завантаження ядра, монтування файлу через WORKERFS
  (без копіювання в пам'ять wasm), розбір метаданих і статистики.
- **Багатопотоковість.** `@ffmpeg/core-mt` потребує `crossOriginIsolated`. GitHub Pages не вміє ставити
  COOP/COEP, тому сторінки інструментів підключають `coi-serviceworker.js`. Він додає заголовки й один раз
  перезавантажує сторінку. Де ізоляції немає (Safari), використовується однопотокове ядро.
  Воркер лежить у корені, бо його скоуп має покривати і `vendor/ffmpeg/worker.js`: без COEP браузер блокує
  воркер ffmpeg. Через це під COEP працюють і хаб із Деструктором, тому шрифти Google підключено з `crossorigin`.
- **Потоки обмежено явно** (`DECODE_THREADS`/`ENCODE_THREADS` у `shared/ffmpeg.js`). З «авто» x264 на
  багатоядерних машинах вичерпує пул потоків core-mt і ffmpeg мовчки зависає.
- x264-пресети на ступінь швидші, ніж у десктопній версії (`medium`/`fast`/`veryfast` замість
  `slow`/`slow`/`medium`): у wasm кодування в кілька разів повільніше.

## Розробка

```sh
npm install
npm run vendor        # після оновлення @ffmpeg/* або coi-serviceworker
npm run serve         # http://localhost:4848, з COOP/COEP
node scripts/serve.mjs --no-coi   # як на GitHub Pages: ізоляцію дає service worker
npm test              # smoke-тест у Chrome (потрібні ffmpeg/ffprobe у PATH і мережа)
node test/smoke.mjs --no-coi
```

Тест генерує кліп 1920×1080 з тоном, проганяє обидва відеоінструменти до скачування результату і
перевіряє вихід нативним ffprobe: розмір, кодеки, BT.709, тривалість, −14 LUFS, ліміт GIF.

## Деплой

GitHub Pages з гілки `main`, корінь репозиторію. Файл `.nojekyll` вимикає обробку Jekyll.
