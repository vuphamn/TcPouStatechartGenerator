// Screenshot comparisons: a view's PNG against its baseline in tests/baselines (compared in the browser: both drawn
// on a canvas, a pixel differing when a channel is off by more than THRESHOLD; the view differs when more than
// MAX_RATIO of its pixels do, or its size changed by more than 4 px). A diff image goes to tests/.output/screens.
//   KSS_UPDATE_BASELINES=1   write the baselines anew (after a change of the look that is meant)
//   no baseline yet          written, and reported as new (not a failure)
//   CI                       skipped: another machine's fonts and rendering differ (KSS_SCREENSHOTS=1 compares)
const fs = require('fs');
const path = require('path');
const { TESTS, OUT } = require('./harness.cjs');

const BASELINES = path.join(TESTS, 'baselines');
const SCREENS = path.join(OUT, 'screens');
const THRESHOLD = 48;
const MAX_RATIO = 0.01;

const skipped = () => !!process.env.CI && process.env.KSS_SCREENSHOTS !== '1';

/**
 * The view (a PNG buffer) compared with its baseline, in a page of the browser.
 * { status: 'same' | 'differs' | 'new' | 'updated' | 'skipped', ratio?, size?, note }
 */
async function compareShot(browser, name, png) {
  fs.mkdirSync(SCREENS, { recursive: true });
  fs.writeFileSync(path.join(SCREENS, `${name}.png`), png);
  const base = path.join(BASELINES, `${name}.png`);
  if (skipped()) return { status: 'skipped', note: `${name}: not compared on CI (its fonts and rendering differ; KSS_SCREENSHOTS=1 compares)` };
  if (process.env.KSS_UPDATE_BASELINES === '1' || !fs.existsSync(base)) {
    const had = fs.existsSync(base);
    fs.mkdirSync(BASELINES, { recursive: true });
    fs.writeFileSync(base, png);
    return { status: had ? 'updated' : 'new', note: `${name}: baseline ${had ? 'written anew' : 'written (none yet)'}: tests/baselines/${name}.png` };
  }
  const page = await browser.newPage();
  try {
    const r = await page.evaluate(
      async (a, b, THRESHOLD) => {
        const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
        const [x, y] = await Promise.all([load(a), load(b)]);
        const w = Math.min(x.width, y.width);
        const h = Math.min(x.height, y.height);
        const pixels = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
        const p = pixels(x);
        const q = pixels(y);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.drawImage(y, 0, 0);
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(0, 0, w, h);
        const out = g.getImageData(0, 0, w, h);
        let off = 0;
        const close = (i, j) => Math.abs(p[i] - q[j]) <= THRESHOLD && Math.abs(p[i + 1] - q[j + 1]) <= THRESHOLD && Math.abs(p[i + 2] - q[j + 2]) <= THRESHOLD;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (close(i, i)) continue;
            // (the view drawn a pixel aside, a sub-pixel position: a close pixel next to it is the same)
            let near = false;
            for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx >= 0 && yy >= 0 && xx < w && yy < h) near = close(i, (yy * w + xx) * 4);
            }
            if (near) continue;
            off++;
            out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 64; out.data[i + 3] = 255;
          }
        }
        g.putImageData(out, 0, 0);
        return { off, total: w * h, sizes: [x.width, x.height, y.width, y.height], diff: c.toDataURL('image/png') };
      },
      `data:image/png;base64,${fs.readFileSync(base).toString('base64')}`,
      `data:image/png;base64,${png.toString('base64')}`,
      THRESHOLD
    );
    const ratio = r.off / Math.max(1, r.total);
    const [bw, bh, cw, ch] = r.sizes;
    const resized = Math.abs(bw - cw) > 4 || Math.abs(bh - ch) > 4;
    const diffFile = path.join(SCREENS, `${name}.diff.png`);
    fs.writeFileSync(diffFile, Buffer.from(r.diff.split(',')[1], 'base64'));
    const same = !resized && ratio <= MAX_RATIO;
    return {
      status: same ? 'same' : 'differs',
      ratio,
      note: `${name}: ${(ratio * 100).toFixed(2)}% of the pixels differ${resized ? `, its size ${cw}x${ch} (the baseline ${bw}x${bh})` : ''}${same ? '' : `: tests/.output/screens/${name}.png, .diff.png (the look meant to change: KSS_UPDATE_BASELINES=1)`}`,
    };
  } finally {
    await page.close();
  }
}

module.exports = { compareShot, BASELINES, SCREENS };
