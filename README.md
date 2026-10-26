# Media Lab

Browser tools for release visuals: covers, vertical videos and GIFs.
All processing runs on the user's device. Files are never uploaded, and there is no backend.

**Live:** https://ivan-lutskyi.github.io/media-lab/

| Tool | Path | What it does |
|---|---|---|
| **Destructor** | `destructor/` | Photo → abstract distorted canvas (pixel sort, slice shift, dithering, duotone, JPEG decay, typography) on Canvas 2D. Design notes: [destructor/README.md](destructor/README.md) |
| **Vertical Lab** | `vertical/` | Any video → 1080×1920 for Reels / TikTok: blurred fill instead of bars, H.264 with headroom for the platform re-encode, two-pass loudness to −14 LUFS |
| **GIF Lab** | `gif/` | Video → lightweight GIF with a palette built from the clip itself. If the result exceeds the 1 / 2 / 5 MB limit, the width shrinks and it re-encodes automatically |

The interface is in Ukrainian.

## How it works

- **No build step.** Plain HTML, CSS and ES modules. The repository is deployed as is.
- `vendor/` holds the `@ffmpeg/ffmpeg` and `@ffmpeg/util` wrappers (committed). The core itself,
  `ffmpeg-core.wasm` (~32 MB), is loaded from jsDelivr and then served from the browser cache.
- `shared/ffmpeg.js` is shared by the video tools. It loads the core, mounts the input through WORKERFS
  (so the file is not copied into wasm memory) and parses metadata and encoder stats.
- **Multithreading.** `@ffmpeg/core-mt` needs `crossOriginIsolated`. GitHub Pages cannot send COOP/COEP
  headers, so the tool pages load `coi-serviceworker.js`, which adds them and reloads the page once.
  Where isolation is unavailable (Safari), the single-threaded core is used instead.
  The service worker lives at the site root because its scope must also cover `vendor/ffmpeg/worker.js`:
  without COEP on that response the browser blocks the ffmpeg worker. As a side effect, the hub and
  Destructor also run under COEP, so Google Fonts are loaded with `crossorigin`.
- **Thread counts are explicit** (`DECODE_THREADS` / `ENCODE_THREADS` in `shared/ffmpeg.js`). With "auto",
  x264 on a many-core machine exhausts the fixed core-mt thread pool and ffmpeg hangs silently.
  2 decoder + 4 encoder threads is stable; 6 encoder threads already crashes the worker.
- x264 presets are one step faster than in the original desktop version (`medium` / `fast` / `veryfast`
  instead of `slow` / `slow` / `medium`), because encoding in wasm is several times slower than native.

## Development

```sh
npm install
npm run vendor        # after updating @ffmpeg/* or coi-serviceworker
npm run serve         # http://localhost:4848 with COOP/COEP
node scripts/serve.mjs --no-coi   # like GitHub Pages: isolation comes from the service worker
```

## Tests

```sh
npm test                                                     # server sends COOP/COEP
node test/smoke.mjs --no-coi                                 # service worker provides isolation
node test/smoke.mjs --st                                     # single-threaded fallback (like Safari)
SMOKE_URL=https://ivan-lutskyi.github.io/media-lab npm test  # against the deployed site
```

The smoke test runs in a real Chrome and needs `ffmpeg` / `ffprobe` on `PATH` plus network access for the core.
It generates a 1920×1080 clip with a tone, drives both video tools through to the download, and checks the
output with native ffprobe: dimensions, codecs, BT.709, duration, −14 LUFS, and the GIF size limit,
including the auto-fit retry on a deliberately heavy clip.

## Deployment

GitHub Pages from the root of `main`. Every push to `main` redeploys the site.
`.nojekyll` disables Jekyll processing.
