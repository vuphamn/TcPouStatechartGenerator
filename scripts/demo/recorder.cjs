// The README's demo GIFs: the app driven in a headless browser (a cursor and a caption drawn on the page), recorded
// through the browser's screencast (a frame each time the page changes, with its time) and written as a GIF: one
// palette for the whole clip, each frame only where it changed (the rest transparent), frames closer than a
// frame's time merged.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

/** The page's cursor and caption (drawn on the page: the screencast has no mouse pointer) */
const OVERLAY = () => {
  const css = `
    #demo-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647; pointer-events: none; transform: translate(-100px, -100px); }
    #demo-cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
    .demo-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid #38bdf8; animation: demo-ripple .5s ease-out forwards; }
    .demo-ripple.right { border-color: #f59e0b; }
    @keyframes demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
    #demo-caption { position: fixed; left: 50%; bottom: 38px; transform: translateX(-50%); z-index: 2147483647; pointer-events: none; max-width: 80%; padding: 10px 20px; border-radius: 10px; background: rgba(2, 6, 23, .92); color: #f8fafc; font: 600 21px/1.35 'Segoe UI', system-ui, sans-serif; text-align: center; box-shadow: 0 6px 24px rgba(0,0,0,.45); border: 1px solid #38bdf8; transition: opacity .25s; }
    #demo-caption:empty { opacity: 0; }
    #demo-caption b { color: #7dd3fc; }`;
  const add = () => {
    if (document.getElementById('demo-cursor')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const cur = document.createElement('div');
    cur.id = 'demo-cursor';
    cur.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 1 L2 17 L6.5 13 L9.5 20 L12.5 18.7 L9.6 12 L15.5 12 Z" fill="#fff" stroke="#0f172a" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cur);
    const cap = document.createElement('div');
    cap.id = 'demo-caption';
    document.body.appendChild(cap);
    const at = (x, y) => (cur.style.transform = `translate(${x - 2}px, ${y - 1}px)`);
    window.__demoCursor = at;
    window.__demoCaption = (html) => (cap.innerHTML = html || '');
    // (at the top: where the bottom has what the scene shows)
    window.__demoCaptionAt = (where) => {
      cap.style.top = where === 'top' ? '120px' : '';
      cap.style.bottom = where === 'top' ? 'auto' : '';
    };
    addEventListener('mousemove', (e) => at(e.clientX, e.clientY), true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = `demo-ripple${e.button === 2 ? ' right' : ''}`;
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
};

/** The page driven like a person: the mouse glides, clicks show, captions say what is going on */
function driver(page) {
  let pos = { x: 640, y: 400 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const d = {
    sleep,
    /** Moments to look at (--frames: the frame shown then saved) */
    marks: [],
    mark(label) {
      d.marks.push({ label, t: Date.now() });
    },
    async setup() {
      await page.evaluateOnNewDocument(OVERLAY);
      await page.evaluate(OVERLAY);
    },
    async captionAt(where) {
      await page.evaluate((w) => window.__demoCaptionAt?.(w), where);
    },
    async caption(html, hold = 0) {
      await page.evaluate((h) => window.__demoCaption?.(h), html);
      if (hold) await sleep(hold);
    },
    async move(x, y, ms = 500) {
      const steps = Math.max(6, Math.round(ms / 16));
      const from = { ...pos };
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        await page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
        await sleep(ms / steps);
      }
      pos = { x, y };
    },
    async click(x, y, opts = {}) {
      await d.move(x, y, opts.ms ?? 450);
      await sleep(120);
      await page.mouse.click(x, y, { button: opts.button ?? 'left' });
      await sleep(opts.after ?? 350);
    },
    async drag(x0, y0, x1, y1, ms = 900) {
      await d.move(x0, y0, 400);
      await sleep(150);
      await page.mouse.down();
      const steps = Math.max(10, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        await page.mouse.move(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        await sleep(ms / steps);
      }
      await sleep(150);
      await page.mouse.up();
      pos = { x: x1, y: y1 };
      await sleep(300);
    },
    /** Where an element is on screen (its center), or null */
    async at(selector) {
      return page.evaluate((s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return r.width || r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null;
      }, selector);
    },
    async clickOn(selector, opts = {}) {
      // (scrolled into view; a moment for it to show)
      let p = null;
      for (let i = 0; i < 15 && !p; i++) {
        await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }), selector);
        p = await d.at(selector);
        if (!p) await sleep(200);
      }
      if (!p) throw new Error(`Not on screen: ${selector}`);
      await d.click(p.x + (opts.dx ?? 0), p.y + (opts.dy ?? 0), opts);
    },
    /** The cursor put somewhere without moving the mouse (an HTML drag the page gets as events) */
    async cursorTo(x, y, ms = 500) {
      const steps = Math.max(6, Math.round(ms / 16));
      const from = { ...pos };
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        await page.evaluate((x, y) => window.__demoCursor?.(x, y), from.x + (x - from.x) * t, from.y + (y - from.y) * t);
        await sleep(ms / steps);
      }
      pos = { x, y };
    },
    async type(text, delay = 55) {
      await page.keyboard.type(text, { delay });
    },
  };
  return d;
}

/** Records the page: start(), then stop() → its frames (PNG buffers and their times in ms) */
async function recorder(page, { width, height }) {
  const cdp = await page.createCDPSession();
  const frames = [];
  let on = false;
  cdp.on('Page.screencastFrame', (f) => {
    if (on) frames.push({ png: Buffer.from(f.data, 'base64'), t: f.metadata.timestamp * 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  return {
    async start() {
      on = true;
      await cdp.send('Page.startScreencast', { format: 'png', maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    },
    async stop() {
      // (the last frame shown a while)
      await new Promise((r) => setTimeout(r, 300));
      on = false;
      await cdp.send('Page.stopScreencast').catch(() => {});
      const end = Date.now();
      return { frames, end: frames.length ? Math.max(frames[frames.length - 1].t + 1500, 0) : end };
    },
  };
}

/** The frames as a GIF: one palette, each frame only where it changed, at most one frame per minFrameMs */
function writeGif(file, frames, { minFrameMs = 70, holdLastMs = 2500, colors = 255 } = {}) {
  const { GIFEncoder, quantize, applyPalette } = require('gifenc');
  if (!frames.length) throw new Error('No frames');
  // (frames closer than minFrameMs: the last of them; the first kept)
  const kept = [];
  for (const f of frames) {
    const last = kept[kept.length - 1];
    // (within a frame's time of the last kept one: its picture taken, at the kept one's time)
    if (last && f.t - last.t < minFrameMs && kept.length > 1) kept[kept.length - 1] = { png: f.png, t: last.t };
    else kept.push(f);
  }
  const read = (k) => PNG.sync.read(kept[k].png);
  const first = read(0);
  const { width, height } = first;
  // One palette for the clip: from a sample of the frames' pixels (the colours of a dialog that shows late too)
  const per = Math.max(1, Math.floor(kept.length / 40));
  const sampled = [];
  for (let k = 0; k < kept.length; k += per) sampled.push(k);
  const stride = Math.max(1, Math.round((sampled.length * width * height) / 1.5e6));
  const pick = new Uint8Array(Math.ceil((width * height) / stride) * sampled.length * 4 + 4);
  let n = 0;
  for (const k of sampled) {
    const data = (k === 0 ? first : read(k)).data;
    for (let i = 0; i < width * height; i += stride) pick.set(data.subarray(i * 4, i * 4 + 4), n++ * 4);
  }
  const palette = quantize(pick.subarray(0, n * 4), colors);
  // (the transparent index: one past the palette's colours)
  const T = palette.length;
  const full = [...palette, [255, 0, 255]];
  const gif = GIFEncoder();
  // Streamed: a frame written once the next different one is known (its delay: until then)
  let shown = null;
  let pending = null;
  const flush = (untilT) => {
    if (!pending) return;
    const delay = Math.max(20, Math.round(untilT - pending.t));
    if (!shown) gif.writeFrame(pending.index, width, height, { palette: full, delay, repeat: 0 });
    else {
      const diff = new Uint8Array(pending.index.length);
      for (let i = 0; i < diff.length; i++) diff[i] = pending.index[i] === shown[i] ? T : pending.index[i];
      gif.writeFrame(diff, width, height, { palette: full, delay, transparent: true, transparentIndex: T, dispose: 1 });
    }
    shown = pending.index;
    pending = null;
  };
  let written = 0;
  for (let k = 0; k < kept.length; k++) {
    const image = k === 0 ? first : read(k);
    if (image.width !== width || image.height !== height) throw new Error('Frames of different sizes');
    const index = applyPalette(image.data, palette);
    const base = pending?.index ?? shown;
    // (no pixel changed: the frame before it shown longer)
    if (base && index.every((v, i) => v === base[i])) continue;
    flush(kept[k].t);
    pending = { index, t: kept[k].t };
    written++;
  }
  flush((pending?.t ?? 0) + holdLastMs);
  gif.finish();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, gif.bytes());
  return { frames: written, bytes: fs.statSync(file).size, width, height };
}

module.exports = { driver, recorder, writeGif };
