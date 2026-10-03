#!/usr/bin/env node
// A demo clip from the real screen (the XAE edition in TcXaeShell, the installer: what the headless recorder of
// scripts/demo-gifs.cjs cannot show): a window recorded while you use it, then written as a GIF the same way.
//
//   node scripts/record-screen.cjs --out docs/demo/xae.gif [--title "TcXaeShell"] [--process TcXaeShell]
//                                  [--seconds 60] [--fps 8] [--width 960]
//
// Recording starts after a 3 s countdown; press Enter to stop (or it stops after --seconds). Windows only. No window
// given: the primary screen. Keep the window where it is while recording.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const { writeGif } = require('./demo/recorder.cjs');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const out = opt('out');
if (!out || process.platform !== 'win32') {
  console.error('Usage (Windows): node scripts/record-screen.cjs --out docs/demo/<name>.gif [--title <part of the window title>] [--process <name>] [--seconds 60] [--fps 8] [--width 960]');
  process.exit(2);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-screen-'));

(async () => {
  for (let s = 3; s > 0; s--) {
    process.stdout.write(`Recording in ${s}…\r`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('Recording: press Enter to stop.');
  const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'demo', 'capture-screen.ps1'), '-Out', dir, ...(opt('title') ? ['-Title', opt('title')] : []), ...(opt('process') ? ['-Process', opt('process')] : []), '-Seconds', opt('seconds', '60'), '-Fps', opt('fps', '8'), '-MaxWidth', opt('width', '960')], { stdio: ['ignore', 'inherit', 'inherit'] });
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', () => fs.writeFileSync(path.join(dir, 'stop'), ''));
  const code = await new Promise((r) => ps.on('exit', r));
  rl.close();
  if (code !== 0) throw new Error('The capture failed (see above)');
  const files = fs.readdirSync(dir).filter((f) => /^\d+\.png$/.test(f)).sort();
  if (!files.length) throw new Error('No frames captured');
  const frames = files.map((f) => ({ png: fs.readFileSync(path.join(dir, f)), t: Number(f.slice(0, -4)) }));
  const r = writeGif(path.resolve(out), frames, { minFrameMs: 100 });
  console.log(`${out}: ${r.frames} frames, ${(r.bytes / 1e6).toFixed(2)} MB, ${r.width}x${r.height}, ${((frames[frames.length - 1].t - frames[0].t) / 1000).toFixed(1)} s`);
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => {
  console.error(e.message || e);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(1);
});
