// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The VS Code extension's host (vscode-extension/host.cjs), by itself: a save refused when the file changed on disk
// since it was loaded, written when kept anyway (force); the layout file beside the POU written, read, removed; the
// .TcDUT files found in the POU's folder and below (build output skipped); the webview page: its base, its content
// policy, the shim before the app's script, every script with the nonce
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createHost, findDutFiles, webviewHtml } = require('../../vscode-extension/host.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-vscode-host-'));
const pou = path.join(dir, 'SM_A.TcPOU');
fs.writeFileSync(pou, '﻿<TcPlcObject>A</TcPlcObject>');
fs.mkdirSync(path.join(dir, 'DUTs'));
fs.writeFileSync(path.join(dir, 'DUTs', 'E_A.TcDUT'), '<TcPlcObject>enum</TcPlcObject>');
fs.mkdirSync(path.join(dir, '_Boot'));
fs.writeFileSync(path.join(dir, '_Boot', 'E_Skip.TcDUT'), 'x');

(async () => {
  const posted: { type: string; [k: string]: unknown }[] = [];
  const host = createHost({ pouPath: pou, post: (m: { type: string }) => posted.push(m), ui: { version: 't', pick: async () => null, reveal: () => {}, open: () => {} } });
  await host.handle({ type: 'ready' });
  const load = posted.find((m) => m.type === 'loadPou') as { source: { content: string; dutCandidates: { relativePath: string }[] } } | undefined;
  expect(!!load && load.source.content === '<TcPlcObject>A</TcPlcObject>' && load.source.dutCandidates.map((d) => d.relativePath).join() === 'DUTs/E_A.TcDUT', `ready: loadPou, its BOM off, its enum found (build output skipped) (${JSON.stringify(load?.source.dutCandidates.map((d) => d.relativePath))})`);

  // Changed on disk since loaded: refused; kept anyway: written
  fs.writeFileSync(pou, '﻿<TcPlcObject>B (TwinCAT)</TcPlcObject>');
  posted.length = 0;
  await host.handle({ type: 'save', files: [{ path: pou, content: '<TcPlcObject>C</TcPlcObject>', baseline: '<TcPlcObject>A</TcPlcObject>' }] });
  const refused = posted.find((m) => m.type === 'saveResult') as { ok: boolean; message: string } | undefined;
  expect(!!refused && !refused.ok && /changed on disk/.test(refused.message) && fs.readFileSync(pou, 'utf8').includes('B (TwinCAT)'), `changed on disk: refused (${refused?.message})`);
  posted.length = 0;
  await host.handle({ type: 'save', files: [{ path: pou, content: '<TcPlcObject>C</TcPlcObject>', force: true }] });
  const saved = posted.find((m) => m.type === 'saveResult') as { ok: boolean; files: { content: string }[] } | undefined;
  const disk = fs.readFileSync(pou, 'utf8');
  expect(!!saved?.ok && disk === '﻿<TcPlcObject>C</TcPlcObject>' && saved.files[0].content === '<TcPlcObject>C</TcPlcObject>', 'kept anyway: written, its BOM kept');
  // (its own save: no change reported)
  posted.length = 0;
  host.changed(pou);
  expect(!posted.some((m) => m.type === 'sourceChanged'), 'its own save: not a change');

  // The layout file
  posted.length = 0;
  await host.handle({ type: 'layoutWrite', path: pou, requestId: 1, text: '{"a":1}' });
  await host.handle({ type: 'layoutRead', path: pou, requestId: 2 });
  const read = posted.find((m) => m.type === 'layoutResult' && m.requestId === 2) as { text: string } | undefined;
  expect(fs.existsSync(path.join(dir, 'SM_A.machinescope.json')) && read?.text === '{"a":1}', 'the layout: beside the POU, read back');
  await host.handle({ type: 'layoutWrite', path: pou, requestId: 3, text: null });
  expect(!fs.existsSync(path.join(dir, 'SM_A.machinescope.json')), 'the layout removed');

  // Live: said not here
  posted.length = 0;
  await host.handle({ type: 'liveStart' });
  expect(posted.some((m) => m.type === 'liveStatus' && m.state === 'error' && /not available in VS Code/.test(String(m.message))), 'live: said not available');

  // The webview page
  const html = webviewHtml('<!doctype html><html><head><title>x</title><script type="module" crossorigin src="./assets/index.js"></script></head><body></body></html>', { base: 'https://w/app', cspSource: 'https://w', nonce: 'N0' });
  const shimAt = html.indexOf('acquireVsCodeApi');
  const appAt = html.indexOf('./assets/index.js');
  expect(html.includes('<base href="https://w/app/">') && /script-src https:\/\/w 'nonce-N0'/.test(html) && shimAt > 0 && shimAt < appAt && (html.match(/<script nonce="N0"/g) ?? []).length === 2, 'the webview page: its base, its policy, the shim first, both scripts with the nonce');
  expect(findDutFiles(dir).length === 1, 'findDutFiles: one (build output skipped)');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
