// Smoke-тест у справжньому Chrome: Vertical Lab і GIF Lab від завантаження файлу до скачування результату.
// Потрібні: Chrome, ffmpeg/ffprobe у PATH (для тестового кліпу й перевірки виходу), мережа (ядро з jsDelivr).
//   node test/smoke.mjs            — сервер віддає COOP/COEP
//   node test/smoke.mjs --no-coi   — як GitHub Pages: ізоляцію має дати service worker
//   SMOKE_URL=https://…/media-lab node test/smoke.mjs — проти задеплоєного сайту (режим service worker)
//   node test/smoke.mjs --st       — без заголовків і без service worker: однопотоковий фолбек (як Safari)
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const st = process.argv.includes('--st');
const REMOTE = process.env.SMOKE_URL?.replace(/\/$/, '');
const noCoi = st || Boolean(REMOTE) || process.argv.includes('--no-coi');
const PORT = 4849 + (st ? 2 : noCoi ? 1 : 0);
const BASE = REMOTE || `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'media-lab-test-'));
const clip = path.join(work, 'landscape clip.mp4');
execFileSync('ffmpeg', [
  '-v', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip,
]);

function ffprobe(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]));
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const server = REMOTE ? null : spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), ...(noCoi ? ['--no-coi'] : [])], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (server) await new Promise((resolve) => server.stdout.once('data', resolve));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: st ? 'block' : 'allow' });
const errors = [];
context.on('page', (p) => p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`)));

async function openTool(url) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${url}: ${e.message}`));
  await page.goto(BASE + url);
  if (noCoi && !st) {
    // coi-serviceworker реєструється і перезавантажує сторінку — чекаємо, поки вона стане ізольованою.
    await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 20000 }).catch(() => {});
  }
  return page;
}

async function runTool(page, label) {
  await page.setInputFiles('#file', clip);
  const t0 = Date.now();
  await page.click('#go');
  await page.waitForSelector('#dl:not(.hidden), #err:not(.hidden)', { timeout: 10 * 60 * 1000 });
  const err = await page.$eval('#err', (e) => (e.classList.contains('hidden') ? '' : e.textContent));
  if (err && !(await page.$('#dl:not(.hidden)'))) {
    check(`${label}: обробка`, false, err);
    console.log((await page.$eval('#log', (e) => e.textContent)).split('\n').slice(-15).join('\n'));
    return null;
  }
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
  const out = path.join(work, download.suggestedFilename());
  await download.saveAs(out);
  check(`${label}: обробка`, true, `${((Date.now() - t0) / 1000).toFixed(1)} с, ${download.suggestedFilename()}`);
  return out;
}

try {
  console.log(`\nрежим: ${st ? 'однопотоковий фолбек' : noCoi ? 'без COOP/COEP (service worker)' : 'COOP/COEP від сервера'}`);

  const hub = await context.newPage();
  await hub.goto(BASE + '/');
  check('хаб: три інструменти', (await hub.$$('a.tool')).length === 3);

  const des = await context.newPage();
  await des.goto(BASE + '/destructor/');
  check('деструктор: відкривається', (await des.textContent('.brand h1'))?.includes('Дестр'));

  const vert = await openTool('/vertical/');
  const isolatedV = await vert.evaluate(() => self.crossOriginIsolated);
  check(`vertical: ${st ? 'одно' : 'багато'}потоковий рушій`, isolatedV === !st, `crossOriginIsolated=${isolatedV}`);
  const vOut = await runTool(vert, 'vertical');
  if (vOut) {
    const p = ffprobe(vOut);
    const v = p.streams.find((s) => s.codec_type === 'video');
    const a = p.streams.find((s) => s.codec_type === 'audio');
    check('vertical: 1080×1920 h264 High', v.width === 1080 && v.height === 1920 && v.codec_name === 'h264' && v.profile === 'High', `${v.width}×${v.height} ${v.codec_name} ${v.profile}`);
    check('vertical: BT.709, yuv420p', v.color_primaries === 'bt709' && v.pix_fmt === 'yuv420p', `${v.color_primaries} ${v.pix_fmt}`);
    check('vertical: AAC 48 kHz стерео', a && a.codec_name === 'aac' && a.sample_rate === '48000' && a.channels === 2);
    check('vertical: тривалість ≈ 4 с', Math.abs(Number(p.format.duration) - 4) < 0.2, p.format.duration);
    const meter = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', vOut, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const lufs = Number((meter.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)[0]);
    check('vertical: гучність ≈ −14 LUFS', Math.abs(lufs + 14) < 1.5, `${lufs} LUFS`);
  }

  const gif = await openTool('/gif/');
  const gOut = await runTool(gif, 'gif');
  if (gOut) {
    const p = ffprobe(gOut);
    const v = p.streams[0];
    const size = fs.statSync(gOut).size;
    check('gif: формат gif, ширина 280', v.codec_name === 'gif' && v.width === 280, `${v.width}×${v.height}`);
    check('gif: ≤ 1 МБ', size <= 1048576, `${(size / 1048576).toFixed(2)} МБ`);
    check('gif: превʼю показано', await gif.isVisible('#preview img'));
  }

  // Важкий випадок: шум + максимальні налаштування мають перевищити 1 МБ і запустити підгонку ширини.
  for (const [opt, v] of [['width', '480'], ['fps', '15'], ['colors', '256'], ['dither', 'floyd']]) {
    await gif.click(`.seg[data-opt="${opt}"] button[data-v="${v}"]`);
  }
  const noisy = path.join(work, 'noisy.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4,noise=alls=40:allf=t',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', noisy]);
  await gif.setInputFiles('#file', noisy);
  await gif.click('#go');
  await gif.waitForSelector('#dl:not(.hidden), #err:not(.hidden)', { timeout: 5 * 60 * 1000 });
  const tries = Number(await gif.textContent('#p-try'));
  const [dl2] = await Promise.all([gif.waitForEvent('download'), gif.click('#dl')]);
  const heavy = path.join(work, 'heavy.gif');
  await dl2.saveAs(heavy);
  const heavySize = fs.statSync(heavy).size;
  check('gif: підгонка під 1 МБ', tries > 1 && heavySize <= 1048576,
    `${tries} спроби, ${ffprobe(heavy).streams[0].width}px, ${(heavySize / 1048576).toFixed(2)} МБ`);

  // Після інструментів service worker уже контролює весь сайт — Деструктор має й далі отримувати шрифти.
  const des2 = await context.newPage();
  await des2.goto(BASE + '/destructor/');
  await des2.evaluate(() => document.fonts.ready);
  const fontsOk = await des2.evaluate(() => document.fonts.check('900 34px Archivo') && [...document.fonts].some((f) => f.family.includes('Archivo') && f.status === 'loaded'));
  const controlled = await des2.evaluate(() => Boolean(navigator.serviceWorker?.controller));
  check(`деструктор: шрифти${noCoi && !st ? ' після service worker' : ''}`, fontsOk, `sw=${controlled}`);

  // serviceWorkers: 'block' у Playwright повертає з register() undefined, і coi-serviceworker падає на .scope.
  // У справжньому браузері такого не буває, тож у режимі --st цю помилку не рахуємо.
  const real = errors.filter((e) => !(st && e.includes("reading 'scope'")));
  check('без помилок JS', real.length === 0, real.join(' | '));
} finally {
  await browser.close();
  server?.kill();
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} перевірок не пройшло\n` : '\nусе пройшло\n');
process.exit(failures ? 1 : 0);
