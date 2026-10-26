// GIF Lab: наступник mp4-to-lowGif. Палітра будується ffmpeg з самого кліпу (palettegen → paletteuse),
// а якщо результат не влазить у ліміт — ширина зменшується й прохід повторюється.
import {
  getFFmpeg, isMultiThread, terminate, mountInput, run, probe, parseStats, safeBase, mb,
  DECODE_THREADS,
} from '../shared/ffmpeg.js';

const MAX_TRIES = 4;
const MIN_WIDTH = 120;

const opts = { width: '280', fps: '8', colors: '64', dither: 'bayer', limit: '1' };
let file = null;
let busy = false;
let outUrl = null;
const $ = (id) => document.getElementById(id);

const DITHER = {
  bayer: 'dither=bayer:bayer_scale=3',
  floyd: 'dither=floyd_steinberg',
  none: 'dither=none',
};

function gifArgs({ src, dst, width, start, length }) {
  const vf =
    `fps=${opts.fps},scale=${width}:-2:flags=lanczos,split[a][b];` +
    // stats_mode=diff — палітра під те, що рухається; diff_mode=rectangle — перемальовуємо лише змінене.
    `[a]palettegen=max_colors=${opts.colors}:stats_mode=diff[p];` +
    `[b][p]paletteuse=${DITHER[opts.dither]}:diff_mode=rectangle`;
  const args = ['-hide_banner', '-y'];
  if (start > 0) args.push('-ss', String(start));
  if (length > 0) args.push('-t', String(length));
  args.push(...DECODE_THREADS, '-i', src, '-an', '-vf', vf, '-loop', '0', '-stats', dst);
  return args;
}

/* ─────────────────────────── UI ─────────────────────────── */

const ditherHints = {
  bayer: 'Регулярна сітка — стискається найкраще.',
  floyd: 'Найм\'якші переходи, але шум між кадрами важить більше.',
  none: 'Чисті плями кольору. Бандинг на градієнтах, зате мінімальна вага.',
};

$('engine').innerHTML = isMultiThread()
  ? 'Рушій: <b>ffmpeg.wasm, багатопотоковий</b>.'
  : 'Рушій: <b>ffmpeg.wasm, однопотоковий</b> — браузер не дав ізоляції, буде повільніше.';

document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    opts[seg.dataset.opt] = btn.dataset.v;
    if (seg.dataset.opt === 'dither') $('h-dither').textContent = ditherHints[btn.dataset.v];
  });
});

const drop = $('drop');
const input = $('file');
drop.addEventListener('click', () => input.click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
});
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });
input.addEventListener('change', () => { if (input.files[0]) pick(input.files[0]); });

function pick(f) {
  if (busy) return;
  file = f;
  $('drop-title').textContent = f.name;
  $('drop-sub').textContent = `${mb(f.size)} МБ · натисни, щоб замінити`;
  $('err').classList.add('hidden');
  $('go').disabled = false;
}

function logLine(line) {
  const log = $('log');
  log.textContent += `${line}\n`;
  log.scrollTop = log.scrollHeight;
}

function resetButton(label) {
  busy = false;
  $('go').disabled = !file;
  $('go').textContent = label;
  $('stop').classList.add('hidden');
}

function fail(msg) {
  $('err').textContent = msg;
  $('err').classList.remove('hidden');
  resetButton('Зробити GIF');
}

$('stop').addEventListener('click', () => {
  terminate();
  logLine('зупинено');
  fail('Зупинено.');
});

$('go').addEventListener('click', async () => {
  if (!file || busy) return;
  busy = true;
  $('go').disabled = true;
  $('go').textContent = 'Працює…';
  $('err').classList.add('hidden');
  $('dl').classList.add('hidden');
  $('preview').classList.add('hidden');
  $('stop').classList.remove('hidden');
  $('progress-unit').classList.remove('hidden');
  $('log').textContent = '';
  $('bar').style.width = '0';
  ['p-try', 'p-w', 'p-size'].forEach((id) => { $(id).textContent = '—'; });
  $('p-pct').textContent = '0%';
  if (outUrl) { URL.revokeObjectURL(outUrl); outUrl = null; }

  let mounted = null;
  try {
    const { ffmpeg } = await getFFmpeg(logLine);
    mounted = await mountInput(ffmpeg, file);
    const meta = await probe(ffmpeg, mounted.path);
    logLine(`джерело: ${meta.width}×${meta.height}, ${meta.fps} fps, ${meta.duration.toFixed(1)} с`);

    const start = Math.max(0, Number($('start').value) || 0);
    if (start >= meta.duration) throw new Error(`Початок (${start} с) за межами кліпу (${meta.duration.toFixed(1)} с).`);
    const length = Math.max(0, Number($('length').value) || 0);
    const span = Math.min(length || Infinity, meta.duration - start);

    const limit = Number(opts.limit) * 1048576;
    // Не розтягуємо: ширина GIF не більша за джерело.
    let width = Math.min(Number(opts.width), meta.width);
    const dst = '/out.gif';
    let data = null;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      width -= width % 2;
      $('p-try').textContent = `${attempt}`;
      $('p-w').textContent = `${width}px`;
      const args = gifArgs({ src: mounted.path, dst, width, start, length });
      logLine(`ffmpeg ${args.join(' ')}`);
      await run(ffmpeg, args, (line) => {
        const s = parseStats(line);
        if (!s) { logLine(line); return; }
        // Кожна наступна спроба — окремий відрізок шкали.
        const pct = Math.min(99, ((attempt - 1 + Math.min(1, s.time / span)) / MAX_TRIES) * 100);
        $('bar').style.width = `${pct}%`;
        $('p-pct').textContent = `${Math.round(pct)}%`;
      });
      data = await ffmpeg.readFile(dst);
      $('p-size').textContent = `${mb(data.byteLength)} МБ`;
      logLine(`спроба ${attempt}: ${width}px → ${mb(data.byteLength)} МБ`);

      if (!limit || data.byteLength <= limit) break;
      if (attempt === MAX_TRIES || width <= MIN_WIDTH) {
        logLine(`не влізло в ${opts.limit} МБ — менше кадрів/с або кольорів допоможе більше, ніж ширина`);
        break;
      }
      // Вага GIF ~ площі кадру, тобто квадрату ширини. 0.93 — запас, щоб не промахнутися знову.
      width = Math.max(MIN_WIDTH, Math.floor(width * Math.sqrt(limit / data.byteLength) * 0.93));
    }

    await ffmpeg.deleteFile(dst);
    await mounted.unmount();
    mounted = null;

    const blob = new Blob([data.buffer], { type: 'image/gif' });
    outUrl = URL.createObjectURL(blob);
    $('bar').style.width = '100%';
    $('p-pct').textContent = '100%';
    $('out').src = outUrl;
    $('preview').classList.remove('hidden');
    const a = $('dl');
    a.href = outUrl;
    a.download = `${safeBase(file.name)}.gif`;
    a.textContent = `Забрати ${mb(blob.size)} МБ`;
    a.classList.remove('hidden');
    if (limit && blob.size > limit) {
      $('err').textContent = `Вийшло ${mb(blob.size)} МБ — більше за ліміт ${opts.limit} МБ.`;
      $('err').classList.remove('hidden');
    }
    resetButton('Зробити ще раз');
  } catch (err) {
    if (!busy) return; // уже зупинено кнопкою «Стоп»
    if (mounted) await mounted.unmount();
    fail(err.message || String(err));
  }
});
