#!/usr/bin/env node
// The README's demo GIFs (docs/demo/*.gif): each scene of scripts/demo/scenes.cjs played in the app (the dev server
// started here, a headless browser) and recorded.
//
//   node scripts/demo-gifs.cjs [scene ...] [--out docs/demo] [--frames]   (no scene: all of them)
//   --frames: also a few of each clip's frames as PNG beside it (to look at), in <out>/frames/
//   --look: a screenshot of the app as the scenes start (layout check), no recording
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '..');
const { launchBrowser, freePort } = require(path.join(REPO, 'tests', 'lib', 'harness.cjs'));
const { driver, recorder, writeGif } = require('./demo/recorder.cjs');
const SCENES = require('./demo/scenes.cjs');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = path.resolve(REPO, opt('out', 'docs/demo'));
const VIEW = { width: 1280, height: 800 };
const GIF = { width: 960, height: 600 };
const wanted = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');

async function devServer() {
  const port = await freePort();
  const log = fs.openSync(path.join(require('os').tmpdir(), 'kms-demo-vite.log'), 'w');
  const vite = spawn(process.execPath, [path.join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort'], { cwd: REPO, stdio: ['ignore', log, log] });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(url).then((r) => r.ok).catch(() => false);
    if (ok) return { url, stop: () => (process.platform === 'win32' ? spawnSync('taskkill', ['/PID', String(vite.pid), '/T', '/F'], { stdio: 'ignore' }) : vite.kill()) };
    await new Promise((r) => setTimeout(r, 500));
  }
  vite.kill();
  throw new Error('The dev server did not start');
}

(async () => {
  const server = await devServer();
  const browser = await launchBrowser({ defaultViewport: VIEW });
  const results = [];
  try {
    const names = wanted.length ? wanted : Object.keys(SCENES).filter((k) => k !== 'helpers');
    for (const name of names) {
      const scene = SCENES[name];
      if (!scene) throw new Error(`No scene ${name} (${Object.keys(SCENES).join(', ')})`);
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => void d.accept().catch(() => {}));
      const d = driver(page);
      await d.setup();
      // (the scene's own preparation: a host stand-in, its page loaded and settled)
      await scene.prepare(page, d, server.url);
      if (args.includes('--look')) {
        fs.mkdirSync(OUT, { recursive: true });
        await page.screenshot({ path: path.join(OUT, `${name}-look.png`) });
        await page.close();
        continue;
      }
      await page.bringToFront();
      const rec = await recorder(page, GIF);
      await rec.start();
      try {
        await scene.play(page, d);
      } catch (e) {
        // (what was on screen: to see why)
        fs.mkdirSync(OUT, { recursive: true });
        await page.screenshot({ path: path.join(OUT, `${name}-error.png`) }).catch(() => {});
        throw e;
      }
      const { frames } = await rec.stop();
      if (args.includes('--frames')) console.log(`(${frames.length} screencast frames)`);
      const file = path.join(OUT, `${name}.gif`);
      const r = writeGif(file, frames, scene.gif ?? {});
      if (args.includes('--frames')) {
        const dir = path.join(OUT, 'frames');
        fs.mkdirSync(dir, { recursive: true });
        const picks = [0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.95].map((f) => frames[Math.min(frames.length - 1, Math.floor(frames.length * f))]);
        picks.forEach((f, i) => fs.writeFileSync(path.join(dir, `${name}-${i + 1}.png`), f.png));
        // (the scene's marks: the last frame before each; frame times are the screencast's, in ms like Date.now())
        for (const m of d.marks) {
          const f = [...frames].reverse().find((x) => x.t <= m.t) ?? frames[0];
          fs.writeFileSync(path.join(dir, `${name}-mark-${m.label}.png`), f.png);
        }
      }
      results.push({ name, ...r, seconds: frames.length ? ((frames[frames.length - 1].t - frames[0].t) / 1000).toFixed(1) : 0, errors: errors.length });
      console.log(`${name}: ${r.frames} frames, ${(r.bytes / 1e6).toFixed(2)} MB, ${r.width}x${r.height}${errors.length ? `, page errors: ${errors.slice(0, 2).join(' | ')}` : ''}`);
      await page.close();
    }
  } finally {
    await browser.close().catch(() => {});
    server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
