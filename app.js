// Si Dios Quiere — step 1: separate the hands from the background; step 2: colour each layer.
import { FilesetResolver, InteractiveSegmenterLegacy as InteractiveSegmenter } from './vendor/mediapipe/vision_bundle.mjs';

const $ = (id) => document.getElementById(id);
const WORK_MAX = 1600;   // long edge used while editing
const EXPORT_MAX = 4000; // long edge for the downloaded PNG

// ---------- state ----------
let photo = null;          // HTMLImageElement
let W = 0, H = 0;          // working size
let photoCanvas = null;    // photo at working size
let lum = null;            // Float32Array 0..1 luminance at working size
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
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  img.src = URL.createObjectURL(f);
  try { await img.decode(); } catch { alert('Could not read that image.'); return; }
  photo = img;
  $('fileName').textContent = f.name;
  const s = Math.min(1, WORK_MAX / Math.max(img.width, img.height));
  W = Math.round(img.width * s); H = Math.round(img.height * s);
  photoCanvas = makeCanvas(W, H);
  ctx2d(photoCanvas).drawImage(img, 0, 0, W, H);
  lum = luminance(photoCanvas);
  maskCanvas = makeCanvas(W, H); maskCtx = ctx2d(maskCanvas);
  maskCtx.fillStyle = '#000'; maskCtx.fillRect(0, 0, W, H);
  undo.length = 0;
  view$.width = W; view$.height = H; view$.hidden = false;
  $('drop').hidden = true;
  setView('select');
  getSegmenter().catch(() => {});
});

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
  if (view === 'result') { viewCtx.putImageData(composite(photoCanvas, lum, mask), 0, 0); return; }
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

// ---------- step 2: colouring ----------
function bindColour(id, hexId) {
  $(id).addEventListener('input', () => { $(hexId).textContent = $(id).value.toUpperCase(); if (view !== 'result') setView('result'); else redraw(); });
}
bindColour('handsColor', 'handsHex');
bindColour('bgColor', 'bgHex');
for (const id of ['handsMode', 'bgMode']) $(id).addEventListener('change', () => { if (view !== 'result') setView('result'); else redraw(); });

// "Keep shading": the layer's average tone becomes exactly the chosen colour;
// darker tones go towards black, lighter tones towards white.
function colourLayer(rgb, mode, l, mean) {
  if (mode === 'flat') return rgb;
  if (l <= mean) { const k = l / mean; return [rgb[0] * k, rgb[1] * k, rgb[2] * k]; }
  const k = (l - mean) / (1 - mean);
  return [rgb[0] + (255 - rgb[0]) * k, rgb[1] + (255 - rgb[1]) * k, rgb[2] + (255 - rgb[2]) * k];
}
function composite(srcCanvas, L, mask) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = ctx2d(srcCanvas).getImageData(0, 0, w, h), d = out.data;
  // average tone of each layer, weighted by the mask
  let sh = 0, wh = 0, sb = 0, wb = 0;
  for (let i = 0; i < w * h; i++) { const m = mask[i]; sh += L[i] * m; wh += m; sb += L[i] * (1 - m); wb += 1 - m; }
  const meanH = Math.min(0.95, Math.max(0.05, wh ? sh / wh : 0.5));
  const meanB = Math.min(0.95, Math.max(0.05, wb ? sb / wb : 0.5));
  const hRgb = hexToRgb($('handsColor').value), bRgb = hexToRgb($('bgColor').value);
  const hMode = $('handsMode').value, bMode = $('bgMode').value;
  for (let i = 0; i < w * h; i++) {
    const j = i * 4, l = L[i], m = mask[i];
    const orig = [d[j], d[j + 1], d[j + 2]];
    const hc = hMode === 'none' ? orig : colourLayer(hRgb, hMode, l, meanH);
    const bc = bMode === 'none' ? orig : colourLayer(bRgb, bMode, l, meanB);
    d[j] = bc[0] + (hc[0] - bc[0]) * m;
    d[j + 1] = bc[1] + (hc[1] - bc[1]) * m;
    d[j + 2] = bc[2] + (hc[2] - bc[2]) * m;
  }
  return out;
}

$('download').addEventListener('click', async () => {
  if (!photo) return alert('Load a photo first.');
  const btn = $('download'); btn.disabled = true; btn.textContent = 'Preparing…';
  await new Promise((r) => setTimeout(r, 20));
  try {
    const s = Math.min(1, EXPORT_MAX / Math.max(photo.width, photo.height));
    const w = Math.round(photo.width * s), h = Math.round(photo.height * s);
    const c = makeCanvas(w, h); ctx2d(c).drawImage(photo, 0, 0, w, h);
    ctx2d(c).putImageData(composite(c, luminance(c), maskAt(w, h)), 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'si-dios-quiere.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally { btn.disabled = false; btn.textContent = 'Download PNG'; }
});
