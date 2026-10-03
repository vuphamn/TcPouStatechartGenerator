#!/usr/bin/env node
// The README's demo GIFs (docs/demo/*.gif): each scene of scripts/demo/scenes.cjs played in the app (the dev server
// started here, a headless browser) and recorded.
//
//   node scripts/demo-gifs.cjs [scene ...] [--out docs/demo] [--frames]   (no scene: all of them)
//   --frames: also a few of each clip's frames as PNG beside it (to look at), in <out>/frames/
//   --look: a screenshot of the app as the scenes start (layout check), no recording
//   --check: each scene played to the end even when another fails; a scene that fails (something it clicks is gone:
//            the app changed), has page errors, or whose clip runs much longer or shorter than the one in docs/demo
//            (more than 35%) is flagged: listed (Markdown, for a CI run's summary: --summary <file>), exit code 1
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '..');
const { launchBrowser, freePort } = require(path.join(REPO, 'tests', 'lib', 'harness.cjs'));
const { driver, recorder, writeGif, gifInfo } = require('./demo/recorder.cjs');
const SCENES = require('./demo/scenes.cjs');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = path.resolve(REPO, opt('out', 'docs/demo'));
const VIEW = { width: 1280, height: 800 };
const GIF = { width: 960, height: 600 };
const wanted = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--summary');
const CHECK = args.includes('--check');
const COMMITTED = path.join(REPO, 'docs', 'demo');

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
  const flagged = [];
  try {
    const names = wanted.length ? wanted : Object.keys(SCENES).filter((k) => k !== 'helpers');
    for (const name of names) {
      let current = null;
      try {
      const scene = SCENES[name];
      if (!scene || name === 'helpers') throw new Error(`No scene ${name} (${Object.keys(SCENES).filter((k) => k !== 'helpers').join(', ')})`);
      const page = await browser.newPage();
      current = page;
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
      if (CHECK) {
        // (against the clip in docs/demo: much longer or shorter, something in the scene went otherwise)
        const now = gifInfo(fs.readFileSync(file));
        const was = fs.existsSync(path.join(COMMITTED, `${name}.gif`)) ? gifInfo(fs.readFileSync(path.join(COMMITTED, `${name}.gif`))) : null;
        const change = now && was && was.ms ? (now.ms - was.ms) / was.ms : 0;
        if (errors.length) flagged.push({ name, why: `page errors: ${errors.slice(0, 2).join(' | ')}` });
        else if (Math.abs(change) > 0.35) flagged.push({ name, why: `${(now.ms / 1000).toFixed(1)} s, the committed clip ${(was.ms / 1000).toFixed(1)} s (${change > 0 ? '+' : ''}${Math.round(change * 100)}%)` });
        results[results.length - 1].committed = was ? (was.ms / 1000).toFixed(1) : null;
      }
      } catch (e) {
        // (a scene that cannot be played: what it looks for is gone)
        if (!CHECK) throw e;
        flagged.push({ name, why: String(e?.message ?? e).split('\n')[0].slice(0, 300) });
        console.log(`${name}: FAILED: ${String(e?.message ?? e).split('\n')[0]}`);
        await current?.close().catch(() => {});
      }
    }
    if (CHECK) {
      const md = [
        '## Demo clips',
        '',
        flagged.length ? `**${flagged.length} clip${flagged.length === 1 ? '' : 's'} drifted from the app:** re-record them (\`npm run demo:gifs -- <name>\`, or take them from this run's \`demo-clips\` artifact) and look at them.` : 'All clips still play as recorded. The re-recorded ones are in this run\'s `demo-clips` artifact.',
        '',
        '| Clip | Now | Committed | |',
        '|---|---|---|---|',
        ...names.map((n) => {
          const r = results.find((x) => x.name === n);
          const f = flagged.find((x) => x.name === n);
          return `| ${n} | ${r ? `${r.seconds} s` : '—'} | ${r?.committed ? `${r.committed} s` : '—'} | ${f ? `⚠ ${f.why.replace(/\|/g, '/')}` : 'ok'} |`;
        }),
        '',
      ].join('\n');
      console.log('\n' + md);
      const summary = (() => {
        const i = args.indexOf('--summary');
        return i >= 0 ? args[i + 1] : null;
      })();
      if (summary) fs.appendFileSync(summary, md);
      process.exitCode = flagged.length ? 1 : 0;
    }
  } finally {
    await browser.close().catch(() => {});
    server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
