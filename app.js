// Si Dios Quiere — step 1: separate the hands from the background; step 2: colour each layer.
import { FilesetResolver, InteractiveSegmenterLegacy as InteractiveSegmenter } from './vendor/mediapipe/vision_bundle.mjs';

const $ = (id) => document.getElementById(id);
const WORK_MAX = 1600;   // long edge used while editing
const EXPORT_MAX = 4000; // long edge for the downloaded PNG

// ---------- state ----------
let photo = null;          // HTMLImageElement
let W = 0, H = 0;          // working size
let photoCanvas = null;    // photo at working size
let maskCanvas = null;     // white = hands, black = background (working size)
let maskCtx = null;
const undo = [];
let tool = 'add-click';
let view = 'select';

const view$ = $('view');
const viewCtx = view$.getContext('2d');

const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const setStatus = (t) => { $('status').textContent = t; };

// ---------- AI model (self-hosted, loaded once) ----------
let segmenterPromise = null;
function getSegmenter() {
  if (!segmenterPromise) {
    setStatus('Loading AI model…');
    segmenterPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm', import.meta.url).href);
      const seg = await InteractiveSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: new URL('./models/magic_touch.tflite', import.meta.url).href, delegate: 'CPU' },
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      setStatus('AI model ready — click on the hands.');
      return seg;
    })().catch((err) => {
      console.error(err);
      setStatus('AI model failed to load: ' + err.message + ' (the brush still works).');
      segmenterPromise = null;
      throw err;
    });
  }
  return segmenterPromise;
}

// Returns a Float32Array (W*H, 0..1) of "this is the object you clicked".
async function segmentAt(nx, ny) {
  const seg = await getSegmenter();
  return new Promise((resolve, reject) => {
    try {
      seg.segment(photoCanvas, { keypoint: { x: nx, y: ny } }, (result) => {
        const masks = result.confidenceMasks || [];
        if (!masks.length) return reject(new Error('no mask returned'));
        // Pick the mask that is "on" where the user clicked (handles fg/bg ordering either way).
        let best = null, bestVal = -1;
        for (const m of masks) {
          const a = m.getAsFloat32Array();
          const px = Math.min(m.width - 1, Math.floor(nx * m.width)), py = Math.min(m.height - 1, Math.floor(ny * m.height));
          const v = a[py * m.width + px];
          if (v > bestVal) { bestVal = v; best = { a: a.slice(), w: m.width, h: m.height }; }
        }
        if (bestVal < 0.5) for (let i = 0; i < best.a.length; i++) best.a[i] = 1 - best.a[i];
        resolve(resample(best.a, best.w, best.h, W, H));
      });
    } catch (e) { reject(e); }
  });
}

function resample(arr, w, h, tw, th) {
  if (w === tw && h === th) return arr;
  const src = makeCanvas(w, h), sctx = ctx2d(src), img = sctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = arr[i] * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  sctx.putImageData(img, 0, 0);
  const dst = makeCanvas(tw, th), dctx = ctx2d(dst);
  dctx.imageSmoothingQuality = 'high';
  dctx.drawImage(src, 0, 0, tw, th);
  const d = dctx.getImageData(0, 0, tw, th).data, out = new Float32Array(tw * th);
  for (let i = 0; i < tw * th; i++) out[i] = d[i * 4] / 255;
  return out;
}

// ---------- loading a photo ----------
$('file').addEventListener('change', (e) => { if (e.target.files[0]) loadPhoto(e.target.files[0]); });

// drag a photo onto the Photo box
const fileBox = $('file').closest('.file');
let dragDepth = 0;
fileBox.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; fileBox.classList.add('drag'); });
fileBox.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; fileBox.classList.remove('drag'); } });
fileBox.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
fileBox.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; fileBox.classList.remove('drag');
  const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
  if (f) loadPhoto(f); else alert('That isn\'t an image file.');
});
// a photo dropped anywhere else shouldn't make the browser navigate away from the page
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

async function loadPhoto(f) {
  const img = new Image();
  img.src = URL.createObjectURL(f);
  try { await img.decode(); } catch { alert('Could not read that image.'); return; }
  photo = img;
  $('fileName').textContent = f.name;
  const s = Math.min(1, WORK_MAX / Math.max(img.width, img.height));
  W = Math.round(img.width * s); H = Math.round(img.height * s);
  photoCanvas = makeCanvas(W, H);
  ctx2d(photoCanvas).drawImage(img, 0, 0, W, H);
  maskCanvas = makeCanvas(W, H); maskCtx = ctx2d(maskCanvas);
  maskCtx.fillStyle = '#000'; maskCtx.fillRect(0, 0, W, H);
  undo.length = 0;
  view$.width = W; view$.height = H; view$.hidden = false;
  $('drop').hidden = true;
  setView('select');
  getSegmenter().catch(() => {});
}

function luminance(canvas) {
  const d = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
  const out = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < out.length; i++) out[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  return out;
}

// ---------- mask editing ----------
function pushUndo() {
  undo.push(maskCtx.getImageData(0, 0, W, H));
  if (undo.length > 30) undo.shift();
}
function combineMask(sel, mode) {
  const img = maskCtx.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < W * H; i++) {
    const a = smoothstep(0.3, 0.7, sel[i]) * 255;
    const cur = d[i * 4];
    const v = mode === 'add' ? Math.max(cur, a) : Math.min(cur, 255 - a);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  maskCtx.putImageData(img, 0, 0);
}

$('undo').onclick = () => { if (undo.length) { maskCtx.putImageData(undo.pop(), 0, 0); redraw(); } };
$('clear').onclick = () => { if (!maskCtx) return; pushUndo(); maskCtx.fillStyle = '#000'; maskCtx.fillRect(0, 0, W, H); redraw(); };
$('invert').onclick = () => {
  if (!maskCtx) return;
  pushUndo();
  const img = maskCtx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 - img.data[i];
  maskCtx.putImageData(img, 0, 0); redraw();
};

document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => {
  tool = b.dataset.tool;
  document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('on', x === b));
  if (view !== 'select') setView('select');
  updateBoxCursor();
}));
function updateBoxCursor() {
  $('box').classList.toggle('tool-brush', tool.endsWith('brush'));
  $('box').classList.toggle('tool-click', tool.endsWith('click'));
}
updateBoxCursor();

for (const [id, out] of [['brush', 'brushVal'], ['soft', 'softVal']]) {
  $(id).addEventListener('input', () => { $(out).textContent = $(id).value; if (id === 'soft') redraw(); });
}

// pointer handling on the canvas
let drawing = false, last = null;
function toImage(e) {
  const r = view$.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H, nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height, k: W / r.width };
}
function brushStroke(a, b) {
  maskCtx.strokeStyle = tool === 'add-brush' ? '#fff' : '#000';
  maskCtx.lineCap = 'round';
  maskCtx.lineWidth = parseInt($('brush').value) * a.k;
  maskCtx.beginPath(); maskCtx.moveTo(a.x, a.y); maskCtx.lineTo(b.x, b.y); maskCtx.stroke();
}
view$.addEventListener('pointerdown', async (e) => {
  if (!photo || view !== 'select') return;
  const p = toImage(e);
  if (tool.endsWith('brush')) {
    drawing = true; last = p; view$.setPointerCapture(e.pointerId);
    pushUndo(); brushStroke(p, p); redraw();
    return;
  }
  $('busy').style.display = 'flex';
  try {
    const sel = await segmentAt(p.nx, p.ny);
    pushUndo();
    combineMask(sel, tool === 'add-click' ? 'add' : 'sub');
    redraw();
  } catch (err) {
    console.error(err);
    setStatus('Selection failed: ' + err.message);
  } finally { $('busy').style.display = 'none'; }
});
view$.addEventListener('pointermove', (e) => {
  moveCursor(e);
  if (!drawing) return;
  const p = toImage(e); brushStroke(last, p); last = p; redraw();
});
const endStroke = () => { drawing = false; };
view$.addEventListener('pointerup', endStroke);
view$.addEventListener('pointercancel', endStroke);
view$.addEventListener('pointerleave', () => { $('cursor').style.display = 'none'; });
function moveCursor(e) {
  const c = $('cursor');
  if (!tool.endsWith('brush') || view !== 'select' || e.pointerType === 'touch') { c.style.display = 'none'; return; }
  const box = $('box').getBoundingClientRect(), s = parseInt($('brush').value);
  Object.assign(c.style, { display: 'block', width: s + 'px', height: s + 'px', left: (e.clientX - box.left) + 'px', top: (e.clientY - box.top) + 'px' });
}

// ---------- views ----------
document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
function setView(v) {
  view = v;
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('hint').textContent = v === 'select'
    ? 'Blue = hands · dimmed = background'
    : v === 'result' ? 'Hands and background coloured separately' : 'Original photo';
  redraw();
}

// Mask values (0..1) at w×h, with edge softness applied.
function maskAt(w, h) {
  const c = makeCanvas(w, h), cx = ctx2d(c);
  const soft = parseInt($('soft').value) * w / 1000;
  cx.filter = soft > 0 ? `blur(${soft}px)` : 'none';
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(maskCanvas, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

let raf = 0;
function redraw() {
  if (!photo || raf) return;
  raf = requestAnimationFrame(() => { raf = 0; draw(); });
}
function draw() {
  if (view === 'original') { viewCtx.drawImage(photoCanvas, 0, 0); return; }
  const mask = maskAt(W, H);
  if (view === 'result') { viewCtx.putImageData(composite(photoCanvas, mask), 0, 0); return; }
  // selection overlay
  const src = ctx2d(photoCanvas).getImageData(0, 0, W, H), d = src.data;
  for (let i = 0; i < W * H; i++) {
    const m = mask[i], j = i * 4;
    // background: darkened; hands: light blue tint
    const r = d[j], g = d[j + 1], b = d[j + 2];
    const dr = r * 0.35, dg = g * 0.35, db = b * 0.35;
    const hr = r * 0.7 + 47 * 0.3, hg = g * 0.7 + 107 * 0.3, hb = b * 0.7 + 255 * 0.3;
    d[j] = dr + (hr - dr) * m; d[j + 1] = dg + (hg - dg) * m; d[j + 2] = db + (hb - db) * m;
  }
  viewCtx.putImageData(src, 0, 0);
}

// ---------- step 2: print layers (background → hands → ink) ----------
let film = 'halftone';
function showResult() { if (view !== 'result') setView('result'); else redraw(); }
const colours = () => ({
  bg: $('bgColor').value.toUpperCase(),
  hands: $('handsColor').value.toUpperCase(),
  ink: ($('inkLink').checked ? $('bgColor') : $('inkColor')).value.toUpperCase(),
});
function syncInkLink() {
  const linked = $('inkLink').checked;
  if (linked) $('inkColor').value = $('bgColor').value;
  $('inkColor').disabled = linked;
  $('inkHex').disabled = linked;
  $('inkHex').value = $('inkColor').value.toUpperCase();
  $('inkHex').classList.remove('bad');
}
for (const [id, hexId] of [['bgColor', 'bgHex'], ['handsColor', 'handsHex'], ['inkColor', 'inkHex']]) {
  const pick = $(id), hex = $(hexId);
  pick.addEventListener('input', () => { hex.value = pick.value.toUpperCase(); hex.classList.remove('bad'); syncInkLink(); showResult(); });
  // typing a hex code updates the colour as soon as it's valid (#RGB or #RRGGBB, # optional)
  const parse = (text, allowShort) => {
    let v = text.trim().replace(/^#?/, '#');
    if (allowShort && /^#[0-9a-f]{3}$/i.test(v)) v = '#' + [...v.slice(1)].map((c) => c + c).join('');
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
  };
  const apply = (v) => { pick.value = v; syncInkLink(); showResult(); };
  hex.addEventListener('input', () => {
    const v = parse(hex.value, false);
    hex.classList.toggle('bad', !v && hex.value.replace('#', '').length >= 6);
    if (v) apply(v);
  });
  hex.addEventListener('change', () => { // on Enter/leaving the field: also accept #RGB, else restore
    const v = parse(hex.value, true);
    if (v) apply(v);
    hex.value = pick.value.toUpperCase(); hex.classList.remove('bad');
  });
  hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') hex.blur(); });
}
$('inkLink').addEventListener('change', () => { syncInkLink(); showResult(); });

// ---------- locks, random colours, shuffle ----------
// A locked layer keeps its colour when random/shuffle is used. With "same colour as
// background" on, the ink simply follows the background, so its own lock is off.
const LAYERS = [['bgColor', 'bgHex'], ['handsColor', 'handsHex'], ['inkColor', 'inkHex']];
const locked = { bgColor: false, handsColor: false, inkColor: false };
document.querySelectorAll('.lock').forEach((btn) => btn.addEventListener('click', () => {
  locked[btn.dataset.layer] = !locked[btn.dataset.layer];
  refreshLocks();
}));
// layers that random/shuffle may change
const freeLayers = () => ['bgColor', 'handsColor', 'inkColor']
  .filter((id) => !locked[id] && !(id === 'inkColor' && $('inkLink').checked));
function refreshLocks() {
  document.querySelectorAll('.lock').forEach((btn) => {
    const id = btn.dataset.layer, follows = id === 'inkColor' && $('inkLink').checked;
    btn.disabled = follows;
    btn.setAttribute('aria-pressed', String(locked[id] && !follows));
    btn.textContent = locked[id] && !follows ? '🔒' : '🔓';
    btn.title = follows ? 'Follows the background colour' : locked[id] ? 'Locked — click to unlock' : 'Lock this colour';
  });
  const free = freeLayers();
  $('randomColours').disabled = free.length === 0;
  $('shuffleColours').disabled = free.length < 2;
}
$('inkLink').addEventListener('change', refreshLocks);
function setColours(values) { // values: {id: '#rrggbb'}
  for (const [id, v] of Object.entries(values)) $(id).value = v;
  for (const [id, hexId] of LAYERS) $(hexId).value = $(id).value.toUpperCase();
  syncInkLink(); showResult();
}

// New random colours for the unlocked layers. Each one is kept clearly different
// (in colour and lightness) from every other layer so the print stays readable.
function randomHex() {
  const h = Math.random() * 360, s = 0.45 + Math.random() * 0.5, l = 0.18 + Math.random() * 0.64;
  const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function farApart(a, b) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const dist = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return dist > 140 && Math.abs(lum(A) - lum(B)) > 40;
}
$('randomColours').addEventListener('click', randomizeColours);
function randomizeColours() {
  const free = freeLayers();
  if (!free.length) return;
  const fixed = ['bgColor', 'handsColor', 'inkColor']
    .filter((id) => !free.includes(id) && !(id === 'inkColor' && $('inkLink').checked))
    .map((id) => $(id).value);
  let best = null;
  for (let tries = 0; tries < 300 && !best; tries++) {
    const pick = free.map(randomHex), all = [...fixed, ...pick];
    if (all.every((a, i) => all.every((b, k) => k <= i || farApart(a, b)))) best = pick;
  }
  if (!best) best = free.map(randomHex); // locked colours too close to satisfy: just pick freely
  setColours(Object.fromEntries(free.map((id, i) => [id, best[i]])));
}

// Swap the current colours between the unlocked layers (always a new arrangement).
$('shuffleColours').addEventListener('click', () => {
  const ids = freeLayers();
  const now = ids.map((id) => $(id).value.toLowerCase());
  if (ids.length < 2 || new Set(now).size < 2) return; // nothing to swap
  let next;
  do {
    next = [...now];
    for (let i = next.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [next[i], next[j]] = [next[j], next[i]]; }
  } while (next.every((v, i) => v === now[i]));
  setColours(Object.fromEntries(ids.map((id, i) => [id, next[i]])));
});
refreshLocks();
document.querySelectorAll('#filmSeg button').forEach((b) => b.addEventListener('click', () => {
  film = b.dataset.film;
  document.querySelectorAll('#filmSeg button').forEach((x) => x.classList.toggle('on', x === b));
  $('dotRow').hidden = film !== 'halftone';
  showResult();
}));
for (const [id, out] of [['inkHands', 'inkHandsVal'], ['inkBg', 'inkBgVal'], ['inkSmooth', 'inkSmoothVal'], ['dotSize', 'dotSizeVal']]) {
  $(id).addEventListener('input', () => { $(out).textContent = $(id).value; showResult(); });
}

// ---------- randomizing the ink film sliders within a chosen range ----------
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const rollers = [];
document.querySelectorAll('input[data-rnd]').forEach((el) => {
  const [lo, hi] = el.dataset.rnd.split(',').map(Number);
  const row = el.closest('.row'), lbl = row.querySelector('.lbl');
  const dice = document.createElement('button');
  dice.type = 'button'; dice.className = 'dice'; dice.textContent = '🎲'; dice.title = 'Random value inside the range';
  lbl.querySelector('span').after(dice);

  const dual = document.createElement('div'); dual.className = 'dual';
  dual.innerHTML = '<div class="track"></div><div class="fill"></div>';
  const mk = (v) => { const r = document.createElement('input'); r.type = 'range'; r.min = el.min; r.max = el.max; r.value = v; r.setAttribute('aria-label', 'Random range'); dual.appendChild(r); return r; };
  const rMin = mk(lo), rMax = mk(hi);
  const txt = document.createElement('div'); txt.className = 'range-txt';
  el.after(dual, txt);

  const span = Number(el.max) - Number(el.min);
  const paint = () => {
    const a = Number(rMin.value), b = Number(rMax.value);
    const fill = dual.querySelector('.fill');
    fill.style.left = ((a - el.min) / span * 100) + '%';
    fill.style.width = Math.max(0.8, (b - a) / span * 100) + '%';
    txt.textContent = a === b ? `Locked at ${a}` : `Random range ${a}–${b}`;
  };
  rMin.addEventListener('input', () => { if (+rMin.value > +rMax.value) rMax.value = rMin.value; paint(); });
  rMax.addEventListener('input', () => { if (+rMax.value < +rMin.value) rMin.value = rMax.value; paint(); });
  paint();

  const roll = () => { el.value = randInt(+rMin.value, +rMax.value); el.dispatchEvent(new Event('input')); };
  dice.addEventListener('click', roll);
  rollers.push({ el, roll });
});
function rollInkFilm() { for (const r of rollers) if (!r.el.closest('.row').hidden) r.roll(); }
$('rollInk').addEventListener('click', rollInkFilm);
// Everything at once: new colours for unlocked layers + every ink film slider within its range.
$('randomAll').addEventListener('click', () => { randomizeColours(); rollInkFilm(); });

// Luminance after a blur: blur first, then threshold, gives the clumpy shapes of an
// enlarged photo stencil instead of pixel noise.
function blurredLuminance(srcCanvas, px) {
  const w = srcCanvas.width, h = srcCanvas.height;
  if (px <= 0) return luminance(srcCanvas);
  const c = makeCanvas(w, h), cx = ctx2d(c);
  cx.filter = `blur(${px}px)`;
  cx.drawImage(srcCanvas, 0, 0);
  return luminance(c);
}

// How much ink (0..1) lands on each pixel. Everything is sized relative to a
// 1000px-wide image so the preview and the full-size download match.
function inkCoverage(srcCanvas, mask) {
  const w = srcCanvas.width, h = srcCanvas.height, scale = w / 1000;
  const L = blurredLuminance(srcCanvas, parseInt($('inkSmooth').value) * scale);
  const out = new Float32Array(w * h);
  // "Ink on hands/background" = share of that layer that gets ink, read from the
  // layer's own tones, so a darker or brighter shot on another day behaves the same.
  // Still one film — like retouching the film by area before burning the screen.
  const layerTone = (inHands, q) => {
    const hist = new Uint32Array(256); let n = 0;
    for (let i = 0; i < L.length; i++) if ((mask[i] >= 0.5) === inHands) { hist[Math.min(255, (L[i] * 255) | 0)]++; n++; }
    if (!n || q <= 0) return -1; // empty layer (e.g. no hands selected yet) or no ink wanted
    const tone = (p) => { let acc = 0; for (let b = 0; b < 256; b++) { acc += hist[b]; if (acc >= p * n) return b / 255; } return 1; };
    const lo = tone(0.02), hi = Math.max(lo + 0.02, tone(0.98));
    return { thr: tone(q), lo, hi };
  };
  const H_ = layerTone(true, parseInt($('inkHands').value) / 100);
  const B_ = layerTone(false, parseInt($('inkBg').value) / 100);
  // per pixel: normalise tone within its layer, then compare with that layer's threshold
  const rel = new Float32Array(w * h); // >0 means "darker than the threshold" -> ink
  for (let i = 0; i < L.length; i++) {
    const m = mask[i];
    const rh = H_ === -1 ? -1 : (H_.thr - L[i]) / (H_.hi - H_.lo);
    const rb = B_ === -1 ? -1 : (B_.thr - L[i]) / (B_.hi - B_.lo);
    rel[i] = rb + (rh - rb) * m;
  }
  if (film === 'solid') {
    const aa = 0.015; // a hair of anti-aliasing on the stencil edge
    for (let i = 0; i < out.length; i++) out[i] = smoothstep(-aa, aa, rel[i]);
    return out;
  }
  // halftone: a 45° dot screen; darker tones get bigger dots
  const cell = Math.max(2, parseInt($('dotSize').value) * scale);
  const c = Math.SQRT1_2, edge = 0.6 / cell;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const cov = Math.min(1, Math.max(0, 0.5 + rel[i] * 1.6));
      if (cov <= 0) continue;
      const u = (x * c + y * c) / cell, v = (y * c - x * c) / cell;
      const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
      const r = Math.sqrt(cov) * 0.7072; // dot radius that covers `cov` of the cell
      out[i] = smoothstep(r + edge, r - edge, Math.sqrt(fu * fu + fv * fv));
    }
  }
  return out;
}

// The three screens at w×h: hands coverage (0..1) and ink coverage (0..1).
function layersAt(srcCanvas, mask) {
  return { hands: mask, ink: inkCoverage(srcCanvas, mask) };
}

// Print order: background flood → hands → ink, each opaque.
function composite(srcCanvas, mask) {
  const w = srcCanvas.width, h = srcCanvas.height, col = colours();
  const { ink } = layersAt(srcCanvas, mask);
  const B = hexToRgb(col.bg), Hc = hexToRgb(col.hands), K = hexToRgb(col.ink);
  const out = new ImageData(w, h), d = out.data;
  for (let i = 0; i < w * h; i++) {
    const m = mask[i], a = ink[i], j = i * 4;
    for (let c = 0; c < 3; c++) {
      const v = B[c] + (Hc[c] - B[c]) * m;
      d[j + c] = v + (K[c] - v) * a;
    }
    d[j + 3] = 255;
  }
  return out;
}

// ---------- downloads ----------
function exportSize() {
  const s = Math.min(1, EXPORT_MAX / Math.max(photo.width, photo.height));
  return { w: Math.round(photo.width * s), h: Math.round(photo.height * s) };
}
function exportSource() {
  const { w, h } = exportSize();
  const c = makeCanvas(w, h); ctx2d(c).drawImage(photo, 0, 0, w, h);
  return c;
}
async function busyButton(btn, label, fn) {
  if (!photo) return alert('Load a photo first.');
  const txt = btn.textContent; btn.disabled = true; btn.textContent = label;
  await new Promise((r) => setTimeout(r, 20));
  try { await fn(); } catch (e) { console.error(e); alert('Export failed: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = txt; }
}
function save(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const canvasBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));

$('download').addEventListener('click', () => busyButton($('download'), 'Preparing…', async () => {
  const c = exportSource(), w = c.width, h = c.height;
  ctx2d(c).putImageData(composite(c, maskAt(w, h)), 0, 0);
  save(new Blob([await pngBytes(c, 300)], { type: 'image/png' }), 'si-dios-quiere.png');
}));

// One colour layer as a transparent PNG (for Photoshop/Procreate etc.).
function colourLayerCanvas(w, h, rgb, alpha) {
  const c = makeCanvas(w, h), img = new ImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) {
    const j = i * 4; d[j] = rgb[0]; d[j + 1] = rgb[1]; d[j + 2] = rgb[2];
    d[j + 3] = alpha ? Math.round(alpha[i] * 255) : 255;
  }
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}

// A film: black = ink goes through, white = blocked. Hard edges, white margin,
// registration crosshairs in the margin, and the screen's name.
function filmCanvas(w, h, inkAt, title) {
  const m = Math.round(Math.max(w, h) * 0.06);
  const c = makeCanvas(w + 2 * m, h + 2 * m), cx = ctx2d(c);
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
  const img = cx.getImageData(m, m, w, h), d = img.data;
  for (let i = 0; i < w * h; i++) if (inkAt(i)) { const j = i * 4; d[j] = d[j + 1] = d[j + 2] = 0; }
  cx.putImageData(img, m, m);
  const len = m * 0.35, lw = Math.max(2, Math.round(m / 60));
  cx.strokeStyle = '#000'; cx.lineWidth = lw;
  const marks = [[m / 2, m / 2], [c.width - m / 2, m / 2], [m / 2, c.height - m / 2], [c.width - m / 2, c.height - m / 2],
    [c.width / 2, m / 2], [c.width / 2, c.height - m / 2], [m / 2, c.height / 2], [c.width - m / 2, c.height / 2]];
  for (const [x, y] of marks) {
    cx.beginPath(); cx.moveTo(x - len, y); cx.lineTo(x + len, y); cx.moveTo(x, y - len); cx.lineTo(x, y + len); cx.stroke();
    cx.beginPath(); cx.arc(x, y, len * 0.45, 0, Math.PI * 2); cx.stroke();
  }
  cx.fillStyle = '#000'; cx.font = `${Math.round(m * 0.22)}px sans-serif`;
  cx.fillText(title, m, c.height - m * 0.25);
  return c;
}

// Shrinks the hands area by `px` (used so the background screen slightly
// overlaps under the hands — a "trap" — and no bare paper shows at the edge).
function erode(mask, w, h, px) {
  const src = makeCanvas(w, h), img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = mask[i] >= 0.5 ? 255 : 0; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx2d(src).putImageData(img, 0, 0);
  const c = makeCanvas(w, h), cx = ctx2d(c);
  cx.filter = `blur(${px}px)`; cx.drawImage(src, 0, 0);
  const d = cx.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = d[i * 4] > 250 ? 1 : 0;
  return out;
}

$('downloadKit').addEventListener('click', () => busyButton($('downloadKit'), 'Preparing files…', async () => {
  const src = exportSource(), w = src.width, h = src.height;
  const mask = maskAt(w, h), { ink } = layersAt(src, mask), col = colours();
  const files = [];
  const add = async (name, c) => files.push({ name, data: await pngBytes(c, 300) });
  const trapPx = Math.max(2, Math.round(w / 600)); // ≈0.4 mm at 300 DPI on a 2000px image
  const handsCore = erode(mask, w, h, trapPx);

  const preview = makeCanvas(w, h); ctx2d(preview).putImageData(composite(src, mask), 0, 0);
  await add('preview.png', preview);
  await add('layers/1-background.png', colourLayerCanvas(w, h, hexToRgb(col.bg), null));
  await add('layers/2-hands.png', colourLayerCanvas(w, h, hexToRgb(col.hands), mask));
  await add('layers/3-ink.png', colourLayerCanvas(w, h, hexToRgb(col.ink), ink));
  await add('films/film-1-background.png', filmCanvas(w, h, (i) => !handsCore[i], `1 BACKGROUND  ${col.bg}`));
  await add('films/film-2-hands.png', filmCanvas(w, h, (i) => mask[i] >= 0.5, `2 HANDS  ${col.hands}`));
  await add('films/film-3-ink.png', filmCanvas(w, h, (i) => ink[i] >= 0.5, `3 INK  ${col.ink}`));

  const inch = (px) => (px / 300).toFixed(2), cm = (px) => (px / 300 * 2.54).toFixed(1);
  const cellPx = parseInt($('dotSize').value) * w / 1000;
  const lines = [
    'SI DIOS QUIERE — PRINT RECIPE', new Date().toString(), '',
    `Image size: ${w} x ${h} px = ${cm(w)} x ${cm(h)} cm (${inch(w)} x ${inch(h)} in) at 300 DPI.`,
    'Films include a white margin with registration marks; print every film at 100% so the marks line up.', '',
    'PRINT ORDER',
    `  1. film-1-background.png   colour ${col.bg}`,
    `     Everything except the hands. It reaches ${trapPx}px (~${(trapPx / 300 * 25.4).toFixed(1)} mm) under the hands so no paper shows at the edge.`,
    `  2. film-2-hands.png        colour ${col.hands}`,
    `  3. film-3-ink.png          colour ${col.ink}${$('inkLink').checked ? '  (same as background)' : ''}`,
    `     ${film === 'halftone' ? `Halftone dots, ${cellPx.toFixed(1)}px cell ≈ ${(300 / cellPx).toFixed(0)} lines per inch at 45°.` : 'Solid stencil.'}` +
      ` Ink on hands ${$('inkHands').value}%, ink on background ${$('inkBg').value}%.`,
    '',
    'FILMS (films/): black = ink passes through, white = blocked. Print them on transparency film, or use them as',
    '  positives for photo-emulsion screens. You can also cut stencils from them by hand.',
    'LAYERS (layers/): each screen as a transparent PNG in its colour. Stack 1 → 2 → 3 in any editor to rebuild preview.png.',
    'Hex colours are screen references. Match the real inks by eye.',
  ];
  files.push({ name: 'recipe.txt', data: new TextEncoder().encode(lines.join('\n')) });
  save(makeZip(files), 'si-dios-quiere-print-files.zip');
}));

// ---------- PNG with DPI + a tiny zip writer (store, no compression) ----------
let crcTable = null;
function crc32(buf) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = -1; for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 255];
  return (c ^ -1) >>> 0;
}
const cat = (arrs) => { const o = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0)); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
const be32 = (n) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const le16 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255]);
const le32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
// Canvas PNGs have no physical size; add a pHYs chunk so they open at 300 DPI.
async function pngBytes(canvas, dpi) {
  const bytes = new Uint8Array(await (await canvasBlob(canvas)).arrayBuffer());
  const ppm = Math.round(dpi / 0.0254), type = new TextEncoder().encode('pHYs');
  const body = cat([be32(ppm), be32(ppm), new Uint8Array([1])]);
  const chunk = cat([be32(body.length), type, body, be32(crc32(cat([type, body])))]);
  const at = 8 + 8 + 13 + 4; // signature + IHDR
  return cat([bytes.subarray(0, at), chunk, bytes.subarray(at)]);
}
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const local = cat([le32(0x04034b50), le16(20), le16(0x0800), le16(0), le16(0), le16(0x21), le32(crc), le32(n), le32(n), le16(name.length), le16(0), name]);
    parts.push(local, f.data);
    central.push(cat([le32(0x02014b50), le16(20), le16(20), le16(0x0800), le16(0), le16(0), le16(0x21), le32(crc), le32(n), le32(n), le16(name.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(off), name]));
    off += local.length + n;
  }
  const cd = cat(central);
  const end = cat([le32(0x06054b50), le16(0), le16(0), le16(files.length), le16(files.length), le32(cd.length), le32(off), le16(0)]);
  return new Blob([...parts, cd, end], { type: 'application/zip' });
}
