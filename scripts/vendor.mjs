// Копіює ffmpeg.wasm-обгортку і coi-serviceworker з node_modules у репозиторій.
// Результат комітиться: сайт деплоїться як є, без збірки.
// Саме ядро (ffmpeg-core.wasm, ~32 МБ) не вендоримо — воно вантажиться з jsDelivr.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const nm = (p) => path.join(root, 'node_modules', p);

function copyJs(fromDir, toDir) {
  fs.rmSync(toDir, { recursive: true, force: true });
  fs.mkdirSync(toDir, { recursive: true });
  for (const f of fs.readdirSync(fromDir)) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(fromDir, f), path.join(toDir, f));
  }
}

copyJs(nm('@ffmpeg/ffmpeg/dist/esm'), path.join(root, 'vendor/ffmpeg'));
copyJs(nm('@ffmpeg/util/dist/esm'), path.join(root, 'vendor/util'));

// Service worker — у корені: його скоуп має покривати і сторінки інструментів, і vendor/ffmpeg/worker.js.
// Воркер поза скоупом приходить без COEP, і браузер блокує його (ERR_BLOCKED_BY_RESPONSE).
fs.copyFileSync(nm('coi-serviceworker/coi-serviceworker.min.js'), path.join(root, 'coi-serviceworker.js'));
for (const tool of ['vertical', 'gif']) fs.rmSync(path.join(root, tool, 'coi-serviceworker.js'), { force: true });

console.log('vendor: ok');
