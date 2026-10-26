// Живі превʼю на головній: кожен «екран» у мініатюрі робить те, що робить інструмент.
// Низька роздільність, ~15 кадрів/с, пауза поза екраном. При prefers-reduced-motion — один статичний кадр.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FRAME_MS = 1000 / 15;

/** Детермінований хеш → [0, 1): ті самі смуги на тому самому такті, як сід у Деструкторі. */
function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

function hex(c) {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}

/**
 * Запускає draw(t) по кадрах, лише поки canvas видно на екрані.
 * Повертає redraw() — перемалювати останній кадр (після зміни розміру canvas, яка його очищає).
 */
function animate(canvas, draw) {
  let t = reduced ? 2.4 : 0;
  const redraw = () => draw(t);
  if (reduced) { redraw(); return redraw; }
  let visible = false;
  let last = 0;
  const t0 = performance.now();
  const loop = (now) => {
    if (!visible) return;
    requestAnimationFrame(loop);
    if (now - last < FRAME_MS || document.hidden) return;
    last = now;
    t = (now - t0) / 1000;
    redraw();
  };
  new IntersectionObserver(([e]) => {
    const was = visible;
    visible = e.isIntersecting;
    if (visible && !was) requestAnimationFrame(loop);
  }).observe(canvas);
  redraw();
  return redraw;
}

/** Canvas у CSS-пікселях з урахуванням DPR; стежить за власним розміром, а не за вікном. */
function hiDpi(canvas, ctx) {
  const size = { w: 0, h: 0 };
  let redraw = null;
  const fit = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    size.w = canvas.clientWidth;
    size.h = canvas.clientHeight;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw?.();
  };
  fit();
  new ResizeObserver(fit).observe(canvas);
  return { size, onRedraw: (fn) => { redraw = fn; } };
}

/* ─────────────── осцилограф у шапці ─────────────── */

function scope(canvas) {
  const ctx = canvas.getContext('2d');
  const { size, onRedraw } = hiDpi(canvas, ctx);

  onRedraw(animate(canvas, (t) => {
    const { w, h } = size;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += 40) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    ctx.moveTo(0, h / 2 + 0.5); ctx.lineTo(w, h / 2 + 0.5);
    ctx.stroke();

    // Кік раз на такт + бас + шум: схоже на техно-доріжку, а не на синус.
    const wave = (x, phase) => {
      const u = x / w;
      const beat = ((u * 4 + t * 0.5) % 1);
      const kick = Math.exp(-beat * 9) * Math.sin(beat * 60);
      const bass = Math.sin(u * 38 + t * 3.1 + phase) * 0.35;
      const hiss = (hash(Math.floor(x / 2), Math.floor(t * 15)) - 0.5) * 0.25;
      return h / 2 - (kick * 0.75 + bass * 0.4 + hiss) * h * 0.42;
    };
    for (const [color, glow, phase] of [['rgba(240,160,44,.25)', 6, 0.6], ['#f0a02c', 0, 0]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = glow ? 4 : 1.4;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const y = wave(x, phase);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }));
}

/* ─────────────── 01 · Деструктор ─────────────── */

function destructor(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const img = ctx.createImageData(W, H);
  const lum = new Float32Array(W * H);
  const tmp = new Float32Array(W * H);
  // Фірмова палітра Деструктора: чорнило, ризо-рожевий, папір.
  const palette = [hex('#14110F'), hex('#FF3D6E'), hex('#EDE9E0')];

  animate(canvas, (t) => {
    // База: дві «неонові плями», що повільно дрейфують, поверх хвилястого поля.
    const bx = W * (0.32 + 0.12 * Math.sin(t * 0.4));
    const by = H * (0.45 + 0.15 * Math.cos(t * 0.33));
    const cx = W * (0.7 + 0.1 * Math.cos(t * 0.27));
    const cy = H * (0.55 + 0.18 * Math.sin(t * 0.36));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const field = 0.32 + 0.22 * Math.sin(x * 0.07 + t * 0.6) * Math.cos(y * 0.11 - t * 0.45);
        const b1 = Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / 260);
        const b2 = Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 420) * 0.8;
        lum[y * W + x] = Math.min(1, field + b1 + b2);
      }
    }

    // Зсув смуг: набір смуг міняється двічі на секунду.
    const tick = Math.floor(t * 2);
    const band = 5;
    for (let y0 = 0; y0 < H; y0 += band) {
      const r = hash(y0, tick);
      const shift = r < 0.35 ? Math.round((hash(tick, y0) - 0.5) * 50) : 0;
      for (let y = y0; y < Math.min(H, y0 + band); y++) {
        for (let x = 0; x < W; x++) tmp[y * W + x] = lum[y * W + (((x - shift) % W) + W) % W];
      }
    }

    // Піксель-сорт по колонках: відрізки в межах порогу яскравості.
    const lo = 0.3;
    const hi = 0.82;
    const run = [];
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H) {
        if (tmp[y * W + x] < lo || tmp[y * W + x] > hi) { y++; continue; }
        const start = y;
        run.length = 0;
        while (y < H && tmp[y * W + x] >= lo && tmp[y * W + x] <= hi) run.push(tmp[y++ * W + x]);
        run.sort((a, b) => b - a);
        for (let i = 0; i < run.length; i++) tmp[(start + i) * W + x] = run[i];
      }
    }

    // Байєр 4×4 у три рівні → дуотон із акцентом.
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = tmp[y * W + x] * 2 + BAYER4[(y & 3) * 4 + (x & 3)] - 0.5;
        const c = palette[Math.max(0, Math.min(2, Math.round(v)))];
        const i = (y * W + x) * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Типографіка лягає останньою — як у справжньому конвеєрі.
    ctx.fillStyle = '#EDE9E0';
    ctx.fillRect(6, 6, 46, 9);
    ctx.fillStyle = '#14110F';
    ctx.font = '700 8px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('RELEASE', 8, 7);
  });
}

/* ─────────────── 02 · Vertical Lab ─────────────── */

/** Умовний «кліп»: захід сонця з паралаксом гір. */
function scene(ctx, x, y, w, h, t) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, '#2a1b2e');
  sky.addColorStop(0.55, '#e2543b');
  sky.addColorStop(1, '#f0a02c');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffd58a';
  ctx.beginPath();
  ctx.arc(x + w * 0.62, y + h * (0.62 + 0.04 * Math.sin(t * 0.5)), h * 0.17, 0, Math.PI * 2);
  ctx.fill();
  const layers = [['#5b2a33', 0.62, 0.5, 9], ['#331a22', 0.74, 1.1, 13], ['#170f12', 0.86, 2.0, 19]];
  for (const [color, base, speed, freq] of layers) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      const ridge = Math.sin(u * freq + t * speed * 0.3) * 0.05 + Math.sin(u * freq * 2.3 + t * speed * 0.17) * 0.03;
      ctx.lineTo(x + u * w, y + h * (base + ridge));
    }
    ctx.lineTo(x + w, y + h);
    ctx.fill();
  }
  ctx.restore();
}

function vertical(canvas) {
  const ctx = canvas.getContext('2d');
  // Розмиття без ctx.filter (якого немає в частині Safari): кадр у 16×9 і назад із згладжуванням.
  const tiny = document.createElement('canvas');
  tiny.width = 16;
  tiny.height = 9;
  const tctx = tiny.getContext('2d');
  const hud = document.getElementById('hud-vertical');
  const { size, onRedraw } = hiDpi(canvas, ctx);

  onRedraw(animate(canvas, (t) => {
    const { w: W, h: H } = size;
    ctx.clearRect(0, 0, W, H);

    // Джерело 16:9 ліворуч.
    const sw = W * 0.42;
    const sh = (sw * 9) / 16;
    const sx = W * 0.07;
    const sy = H * 0.5 - sh / 2 - H * 0.06;
    scene(ctx, sx, sy, sw, sh, t);
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);

    // Метр гучності під джерелом: стрибає й осідає на мітці −14 LUFS.
    const my = sy + sh + 10;
    const level = 0.62 + 0.08 * Math.sin(t * 5.3) * Math.sin(t * 1.7) + (hash(Math.floor(t * 15), 7) - 0.5) * 0.06;
    const segs = 16;
    const gap = 2;
    const segW = (sw - gap * (segs - 1)) / segs;
    for (let i = 0; i < segs; i++) {
      const on = i / segs < level;
      ctx.fillStyle = on ? (i > 12 ? '#e2543b' : i > 9 ? '#f0a02c' : '#9bb87a') : 'rgba(255,255,255,.07)';
      ctx.fillRect(sx + i * (segW + gap), my, segW, 5);
    }
    const mark = sx + sw * 0.625;
    ctx.fillStyle = '#efe6d9';
    ctx.fillRect(mark, my - 3, 1, 11);

    // Стрілка.
    const ax = sx + sw + W * 0.045;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.strokeStyle = `rgba(240,160,44,${0.45 + 0.4 * pulse})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ax, H / 2 - H * 0.06);
    ctx.lineTo(ax + W * 0.07, H / 2 - H * 0.06);
    ctx.moveTo(ax + W * 0.07 - 5, H / 2 - H * 0.06 - 4);
    ctx.lineTo(ax + W * 0.07, H / 2 - H * 0.06);
    ctx.lineTo(ax + W * 0.07 - 5, H / 2 - H * 0.06 + 4);
    ctx.stroke();

    // Телефон 9:16 праворуч: розмите тло з того самого кадру + чесно вписаний кадр.
    const ph = H * 0.84;
    const pw = (ph * 9) / 16;
    const px = W * 0.93 - pw;
    const py = (H - ph) / 2;
    tctx.clearRect(0, 0, 16, 9);
    scene(tctx, 0, 0, 16, 9, t);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(px, py, pw, ph, 6) : ctx.rect(px, py, pw, ph);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    // cover: висота телефону, ширина за 16:9, центровано
    const cw = (ph * 16) / 9;
    ctx.drawImage(tiny, px + pw / 2 - cw / 2, py, cw, ph);
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(px, py, pw, ph);
    const fh = (pw * 9) / 16;
    scene(ctx, px, py + ph / 2 - fh / 2, pw, fh, t);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(px, py, pw, ph, 6) : ctx.rect(px, py, pw, ph);
    ctx.stroke();

    if (hud) hud.textContent = `16:9 → 9:16 · ${(-14 + (level - 0.62) * 20).toFixed(1)} LUFS`;
  }));
}

/* ─────────────── 03 · GIF Lab ─────────────── */

function gif(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const img = ctx.createImageData(W, H);
  // Шість кольорів — як палітра, зібрана з кліпу.
  const palette = ['#120e0c', '#3a2418', '#7a3f1d', '#c86a22', '#f0a02c', '#ffe2a8'].map(hex);
  const hud = document.getElementById('hud-gif');
  const FRAMES = 12;

  animate(canvas, (t) => {
    // GIF «смикається» на 8 кадрах/с — квантуємо час, як це робить fps-фільтр.
    const frame = Math.floor(t * 8) % FRAMES;
    const ph = (frame / FRAMES) * Math.PI * 2;
    const cx = W / 2 + Math.cos(ph) * 22;
    const bounce = Math.abs(Math.sin(ph));
    const cy = H * 0.72 - bounce * 26;
    const r = 13;
    const lx = Math.cos(ph * 0.5 - 0.8);
    const ly = -0.7;
    const lz = 0.6;

    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = 0.08 + (y / H) * 0.22; // тло
        if (y > H * 0.78) {
          // підлога в клітинку + тінь
          v = ((Math.floor(x / 6) + Math.floor(y / 4)) & 1) ? 0.3 : 0.22;
          const sd = ((x - cx) / (r * (1.1 - bounce * 0.4))) ** 2 + ((y - H * 0.86) / 3.2) ** 2;
          if (sd < 1) v *= 0.35 + 0.4 * bounce;
        }
        const dx = (x - cx) / r;
        const dy = (y - cy) / r;
        const dd = dx * dx + dy * dy;
        if (dd < 1) {
          const dz = Math.sqrt(1 - dd);
          const lambert = Math.max(0, dx * lx + dy * ly + dz * lz);
          const spec = Math.pow(Math.max(0, lambert), 18);
          v = 0.12 + lambert * 0.75 + spec * 0.5;
        }
        const q = v * (palette.length - 1) + BAYER4[(y & 3) * 4 + (x & 3)] - 0.5;
        const c = palette[Math.max(0, Math.min(palette.length - 1, Math.round(q)))];
        const i = (y * W + x) * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (hud) hud.textContent = `кадр ${String(frame + 1).padStart(2, '0')}/${FRAMES} · ${palette.length} кольорів · 0.74 МБ`;
  });
}

scope(document.getElementById('scope'));
destructor(document.getElementById('pv-destructor'));
vertical(document.getElementById('pv-vertical'));
gif(document.getElementById('pv-gif'));
