// Vertical Lab: той самий конвеєр, що й у socials-content-formatter.mjs, але ffmpeg крутиться в браузері.
import {
  getFFmpeg, isMultiThread, terminate, mountInput, run, probe, parseStats, safeBase, mb,
  DECODE_THREADS, ENCODE_THREADS,
} from '../shared/ffmpeg.js';

const MAX_SECONDS = 5 * 60;

const opts = { fit: 'blur', fps: 'source', quality: 'high', grain: '2', loudness: 'on' };
let file = null;
let busy = false;
let outUrl = null;
const $ = (id) => document.getElementById(id);

/* ─────────────────────────── ffmpeg ─────────────────────────── */

function buildFilter({ fit, grain }) {
  const S = 'scale=1080:1920';
  const LZ = ':flags=lanczos';
  let chain;

  if (fit === 'crop') {
    chain = `${S}:force_original_aspect_ratio=increase${LZ},crop=1080:1920`;
  } else if (fit === 'black') {
    chain =
      `${S}:force_original_aspect_ratio=decrease${LZ},` +
      `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black`;
  } else {
    // Розмите тло з самого кадру — жодних чорних смуг, кадр не ріжеться.
    chain =
      `split=2[bg][fg];` +
      `[bg]${S}:force_original_aspect_ratio=increase${LZ},crop=1080:1920,` +
      `gblur=sigma=42,eq=brightness=-0.12:saturation=1.15[bgo];` +
      `[fg]${S}:force_original_aspect_ratio=decrease${LZ}[fgo];` +
      `[bgo][fgo]overlay=(W-w)/2:(H-h)/2`;
  }

  chain += ',setsar=1';
  // Дрібне зерно ламає бандинг на градієнтах — платформи «розмазують» їх при своєму реенкоді.
  if (grain > 0) chain += `,noise=alls=${grain}:allf=t+u`;
  chain += ',format=yuv420p';
  return chain;
}

async function measureLoudness(ffmpeg, src, onLine, log) {
  const out = await run(ffmpeg, [
    '-hide_banner', '-i', src, '-vn', '-sn',
    '-af', 'loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json',
    '-f', 'null', '-',
  ], onLine);
  const match = out.match(/\{[\s\S]*"target_offset"[\s\S]*?\}/);
  if (!match) return null;
  const m = JSON.parse(match[0]);
  log(`заміряно: ${Number(m.input_i).toFixed(1)} LUFS → ціль −14 LUFS`);
  return (
    `loudnorm=I=-14:TP=-1.0:LRA=11:` +
    `measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
    `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:` +
    `offset=${m.target_offset}:linear=true:print_format=summary`
  );
}

function encodeArgs({ src, dst, meta, audioFilter }) {
  const fps = opts.fps === 'source' ? Math.min(Math.round(meta.fps) || 30, 60) : Number(opts.fps);
  const gop = fps * 2; // закритий GOP 2 с — так люблять пакувальники обох платформ
  const crf = { max: 16, high: 18, light: 20 }[opts.quality] ?? 18;
  const maxrate = { max: 20, high: 16, light: 12 }[opts.quality] ?? 16;
  // На ступінь швидше, ніж нативна версія (slow/slow/medium): wasm-x264 у рази повільніший.
  const preset = { max: 'medium', high: 'fast', light: 'veryfast' }[opts.quality] ?? 'fast';

  const args = ['-hide_banner', '-y', ...DECODE_THREADS, '-i', src, '-map', '0:v:0'];
  if (meta.hasAudio) args.push('-map', '0:a:0');

  args.push(
    '-vf', buildFilter({ fit: opts.fit, grain: Number(opts.grain) }),
    '-r', String(fps),
    '-c:v', 'libx264',
    ...ENCODE_THREADS,
    '-preset', preset,
    '-profile:v', 'high',
    '-level', '4.2',
    '-crf', String(crf),
    '-maxrate', `${maxrate}M`,
    '-bufsize', `${maxrate * 2}M`,
    '-x264-params',
    `keyint=${gop}:min-keyint=${gop}:scenecut=0:bframes=3:ref=4:aq-mode=3:aq-strength=1.1`,
    // Явні теги BT.709: без них iOS/Safari вгадують колірний простір і кадр «вигорає».
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-color_range', 'tv',
  );

  if (meta.hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2');
    if (audioFilter) args.push('-af', audioFilter);
  }

  args.push(
    '-map_metadata', '-1',       // геодані та сміття з камери — геть
    '-movflags', '+faststart',   // moov на початок: миттєвий старт прев'ю в аплоадері
    '-stats',
    dst,
  );
  return args;
}

/* ─────────────────────────── UI ─────────────────────────── */

const fitHints = {
  blur: 'Горизонтальний кадр лягає на розмите тло з себе самого.',
  crop: 'Заповнює екран, але ріже боки. Перевір, чи не зникає щось важливе.',
  black: 'Чесні чорні смуги. Безпечно, але з\'їдає площу кадру.',
};

$('engine').innerHTML = isMultiThread()
  ? 'Рушій: <b>ffmpeg.wasm, багатопотоковий</b>.'
  : 'Рушій: <b>ffmpeg.wasm, однопотоковий</b> — браузер не дав ізоляції, кодування буде повільнішим.';

document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    opts[seg.dataset.opt] = btn.dataset.v;
    if (seg.dataset.opt === 'fit') $('h-fit').textContent = fitHints[btn.dataset.v];
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
  setNode('load', 'done');
}

function setNode(name, state) {
  const el = $(`n-${name}`);
  el.classList.remove('on', 'done');
  if (state) el.classList.add(state);
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
  ['analyze', 'encode'].forEach((n) => setNode(n, null));
  resetButton('Запустити');
}

function showProgress(duration) {
  return (line) => {
    const s = parseStats(line);
    if (!s) return;
    const pct = Math.min(99, (s.time / duration) * 100);
    $('bar').style.width = `${pct}%`;
    $('p-pct').textContent = `${Math.round(pct)}%`;
    $('p-speed').textContent = s.speed || '—';
    $('p-br').textContent = s.bitrate || '—';
    $('p-fps').textContent = s.fps || '—';
  };
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
  $('stop').classList.remove('hidden');
  $('progress-unit').classList.remove('hidden');
  $('log').textContent = '';
  $('bar').style.width = '0';
  ['p-speed', 'p-br', 'p-fps'].forEach((id) => { $(id).textContent = '—'; });
  $('p-pct').textContent = '0%';
  ['analyze', 'encode', 'done'].forEach((n) => setNode(n, null));
  setNode('load', 'on');
  if (outUrl) { URL.revokeObjectURL(outUrl); outUrl = null; }

  let mounted = null;
  try {
    const { ffmpeg } = await getFFmpeg(logLine);
    mounted = await mountInput(ffmpeg, file);
    const meta = await probe(ffmpeg, mounted.path);
    if (meta.duration > MAX_SECONDS + 1) {
      throw new Error(`Задовго: ${Math.round(meta.duration)} с. Ліміт — 5 хвилин.`);
    }
    logLine(`джерело: ${meta.width}×${meta.height}, ${meta.fps} fps, ${meta.duration.toFixed(1)} с, ${meta.vcodec}${meta.hasAudio ? ' + аудіо' : ', без аудіо'}`);
    setNode('load', 'done');

    let audioFilter = null;
    if (opts.loudness === 'on' && meta.hasAudio) {
      setNode('analyze', 'on');
      logLine('аналіз гучності (прохід 1 з 2)…');
      audioFilter = await measureLoudness(ffmpeg, mounted.path, showProgress(meta.duration), logLine);
    }
    setNode('analyze', 'done');

    setNode('encode', 'on');
    const dst = '/out.mp4';
    const args = encodeArgs({ src: mounted.path, dst, meta, audioFilter });
    logLine(`ffmpeg ${args.join(' ')}`);
    const onStats = showProgress(meta.duration);
    await run(ffmpeg, args, (line) => {
      onStats(line);
      if (!line.startsWith('frame=')) logLine(line);
    });

    const out = await probe(ffmpeg, dst);
    const data = await ffmpeg.readFile(dst);
    await ffmpeg.deleteFile(dst);
    await mounted.unmount();
    mounted = null;

    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    outUrl = URL.createObjectURL(blob);
    setNode('encode', 'done');
    setNode('done', 'done');
    $('bar').style.width = '100%';
    $('p-pct').textContent = '100%';
    $('p-br').textContent = `${Math.round((blob.size * 8) / out.duration / 1000)}kbit/s`;
    $('p-fps').textContent = String(Math.round(out.fps));

    const a = $('dl');
    a.href = outUrl;
    a.download = `${safeBase(file.name)}-vertical.mp4`;
    a.textContent = `Забрати ${mb(blob.size)} МБ`;
    a.classList.remove('hidden');
    resetButton('Запустити ще раз');
  } catch (err) {
    if (!busy) return; // уже зупинено кнопкою «Стоп»
    if (mounted) await mounted.unmount();
    fail(err.message || String(err));
  }
});
