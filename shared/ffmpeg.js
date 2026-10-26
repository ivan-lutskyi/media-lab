// Спільна обгортка над ffmpeg.wasm для Vertical Lab і GIF.
import { FFmpeg } from '../vendor/ffmpeg/index.js';
import { toBlobURL } from '../vendor/util/index.js';

const CORE_VERSION = '0.12.10';
const CDN = 'https://cdn.jsdelivr.net/npm';

// Пул потоків у core-mt фіксований під час збірки. «Авто» (ядра × 1.5) його вичерпує: ffmpeg
// мовчки зависає або падає воркер. Перевірено: 2 на декодер + 4 на x264 — стабільно, 6 на x264 — вже ні.
// Для однопотокового ядра ці прапорці нічого не змінюють.
export const DECODE_THREADS = ['-threads', '2'];
export const ENCODE_THREADS = ['-threads', '4'];

let instance = null;

/**
 * Багатопотокове ядро потребує SharedArrayBuffer, тобто crossOriginIsolated.
 * Його дає або сервер (COOP/COEP), або coi-serviceworker. Інакше — однопотокове.
 */
export function isMultiThread() {
  return self.crossOriginIsolated === true;
}

export async function getFFmpeg(onStatus = () => {}) {
  if (instance) return instance;
  const mt = isMultiThread();
  const base = `${CDN}/@ffmpeg/${mt ? 'core-mt' : 'core'}@${CORE_VERSION}/dist/esm`;
  const ffmpeg = new FFmpeg();

  onStatus(`завантаження ядра ffmpeg (${mt ? 'багатопотокове' : 'однопотокове'}, ~32 МБ, далі з кешу)…`);
  const config = {
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  };
  if (mt) config.workerURL = await toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript');
  // Якщо браузер заблокує воркер, load() не відхиляється, а просто ніколи не завершується.
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Ядро ffmpeg не запустилося за 60 с. Онови сторінку (Ctrl+F5).')), 60000);
  });
  try {
    await Promise.race([ffmpeg.load(config), timeout]);
  } catch (err) {
    ffmpeg.terminate();
    throw err;
  } finally {
    clearTimeout(timer);
  }

  instance = { ffmpeg, mt };
  return instance;
}

/** Зупиняє поточну задачу. Worker вбивається, наступний виклик getFFmpeg підніме новий. */
export function terminate() {
  if (!instance) return;
  instance.ffmpeg.terminate();
  instance = null;
}

/**
 * Монтує File через WORKERFS — без копіювання в пам'ять wasm.
 * Повертає шлях усередині ФС ffmpeg і функцію для розмонтування.
 */
export async function mountInput(ffmpeg, file) {
  const dir = '/in';
  try { await ffmpeg.createDir(dir); } catch { /* вже є */ }
  await ffmpeg.mount('WORKERFS', { files: [file] }, dir);
  return {
    path: `${dir}/${file.name}`,
    unmount: () => ffmpeg.unmount(dir).catch(() => {}),
  };
}

/** Запускає ffmpeg і збирає весь лог. Кидає помилку при ненульовому коді. */
export async function run(ffmpeg, args, onLine = () => {}) {
  const lines = [];
  const listener = ({ message }) => {
    lines.push(message);
    onLine(message);
  };
  ffmpeg.on('log', listener);
  try {
    const code = await ffmpeg.exec(args);
    if (code !== 0) {
      const tail = lines.filter((l) => l.trim()).slice(-3).join(' · ');
      throw new Error(`ffmpeg завершився з кодом ${code}${tail ? `: ${tail}` : ''}`);
    }
  } finally {
    ffmpeg.off('log', listener);
  }
  return lines.join('\n');
}

/**
 * Метадані з виводу `ffmpeg -i` — без окремого ffprobe.
 * Розміри — з урахуванням повороту з displaymatrix (вертикальне відео з телефона).
 */
export async function probe(ffmpeg, input) {
  const lines = [];
  const listener = ({ message }) => lines.push(message);
  ffmpeg.on('log', listener);
  await ffmpeg.exec(['-hide_banner', '-i', input]); // код ≠ 0 — нормально: вихідного файлу немає
  ffmpeg.off('log', listener);
  const text = lines.join('\n');

  const d = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video = text.match(/Stream #\d+:\d+.*?: Video: (\w+).*?, (\d{2,5})x(\d{2,5})/);
  if (!d || !video) throw new Error('Не вдалося прочитати файл. Схоже, це не відео.');

  const fps = text.match(/(\d+(?:\.\d+)?) fps/) || text.match(/(\d+(?:\.\d+)?) tbr/);
  const rot = text.match(/rotation of (-?\d+(?:\.\d+)?)/);
  const swapped = rot && Math.abs(Math.round(Number(rot[1]))) % 180 === 90;
  const w = Number(video[2]);
  const h = Number(video[3]);

  return {
    duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]),
    width: swapped ? h : w,
    height: swapped ? w : h,
    fps: fps ? Number(fps[1]) : 30,
    vcodec: video[1],
    hasAudio: /Stream #\d+:\d+.*?: Audio:/.test(text),
  };
}

/** Парсить рядок статистики ffmpeg: `frame= 120 fps= 14 ... time=00:00:04.00 bitrate=... speed=0.47x`. */
export function parseStats(line) {
  const t = line.match(/time=\s*(-?\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!t) return null;
  const pick = (re) => (line.match(re) || [])[1];
  return {
    time: Math.max(0, Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3])),
    fps: pick(/fps=\s*([\d.]+)/),
    bitrate: pick(/bitrate=\s*([\d.]+\S*)/),
    speed: pick(/speed=\s*([\d.]+x)/),
  };
}

export function safeBase(name) {
  const base = name.replace(/\.[^.]+$/, '');
  return base.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 60) || 'clip';
}

export function mb(bytes) {
  return (bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 2 : 1);
}
