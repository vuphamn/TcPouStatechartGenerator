// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The VS Code host's project messages, as the XAE extension answers them: projectPous (the POUs with a CASE; the app
// tells the state machines: doState(), another company's Execute(), a body's CASE), projectSymbols, projectUses (a
// name's uses), saveOther (a rename's other POUs: refused when changed on disk, written with their BOM), gitShow (the
// committed version; a file not committed yet said so)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { isStateMachinePou } from '../../src/utils/projectDocumentation.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createHost } = require('../../vscode-extension/host.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-vscode-project-'));
const plc = path.join(dir, 'Plc');
fs.mkdirSync(path.join(plc, 'POUs'), { recursive: true });
fs.mkdirSync(path.join(plc, 'DUTs'));
fs.writeFileSync(path.join(plc, 'Plc.plcproj'), '<?xml version="1.0" encoding="utf-8"?>\n<Project/>\n');
const pouXml = (name: string, decl: string, body: string, methods = '') =>
  `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="${name}" Id="{00000000-0000-0000-0000-000000000001}">\n    <Declaration><![CDATA[${decl}]]></Declaration>\n    <Implementation>\n      <ST><![CDATA[${body}]]></ST>\n    </Implementation>${methods}\n  </POU>\n</TcPlcObject>\n`;
const kval = pouXml('SM_A', 'FUNCTION_BLOCK SM_A\nVAR\n\tmachineState : E_A;\nEND_VAR\n', 'doState();\n', `
    <Method Name="doState" Id="{00000000-0000-0000-0000-000000000002}">
      <Declaration><![CDATA[METHOD doState\n]]></Declaration>
      <Implementation>
        <ST><![CDATA[CASE machineState OF\n\tE_A.One:\n\t\tmachineState := E_A.Two;\n\tE_A.Two:\n\t\tmachineState := E_A.One;\nEND_CASE\n]]></ST>
      </Implementation>
    </Method>`);
const body = pouXml('FB_B', 'FUNCTION_BLOCK FB_B\nVAR\n\tState : E_A;\n\tfbA : SM_A;\nEND_VAR\n', 'CASE State OF\n\tE_A.One:\n\t\tState := E_A.Two;\n\tE_A.Two:\n\t\tState := E_A.One;\nEND_CASE\nfbA();\n');
const counter = pouXml('FB_C', 'FUNCTION_BLOCK FB_C\nVAR\n\tn : INT;\nEND_VAR\n', 'CASE n OF\n\t0:\n\t\tn := 1;\n\t1:\n\t\tn := 0;\nEND_CASE\n');
const plain = pouXml('FB_D', 'FUNCTION_BLOCK FB_D\nVAR\n\tx : INT;\nEND_VAR\n', 'x := x + 1;\n');
const files: Record<string, string> = { 'SM_A.TcPOU': kval, 'FB_B.TcPOU': body, 'FB_C.TcPOU': counter, 'FB_D.TcPOU': plain };
for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(plc, 'POUs', n), '﻿' + t);
fs.writeFileSync(path.join(plc, 'DUTs', 'E_A.TcDUT'), '<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <DUT Name="E_A" Id="{00000000-0000-0000-0000-000000000003}">\n    <Declaration><![CDATA[TYPE E_A :\n(\n\tOne,\n\tTwo\n);\nEND_TYPE\n]]></Declaration>\n  </DUT>\n</TcPlcObject>\n');

let git = true;
try {
  const g = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'core.autocrlf=false', ...a], { stdio: 'pipe' });
  g('init', '-q');
  g('add', '-A');
  g('commit', '-qm', 'project');
} catch {
  git = false;
}

(async () => {
  const posted: { type: string; [k: string]: unknown }[] = [];
  const pou = path.join(plc, 'POUs', 'FB_B.TcPOU');
  const host = createHost({ pouPath: pou, post: (m: { type: string }) => posted.push(m), ui: { version: 't', pick: async () => null, reveal: () => {}, open: () => {} } });
  await host.handle({ type: 'ready' });
  const reply = async (type: string, ms = 8000) => {
    const until = Date.now() + ms;
    let m = posted.find((x) => x.type === type);
    while (!m && Date.now() < until) {
      await sleep(50);
      m = posted.find((x) => x.type === type);
    }
    return m as { [k: string]: unknown } | undefined;
  };

  // projectPous: the POUs with a CASE; the app's state machines among them
  posted.length = 0;
  await host.handle({ type: 'projectPous' });
  const pp = (await reply('projectPous')) as { project?: string; pous?: { name: string; content: string }[]; duts?: { name: string }[] } | undefined;
  const names = (pp?.pous ?? []).map((p) => p.name).sort();
  expect(pp?.project === 'Plc' && names.join() === 'FB_B.TcPOU,FB_C.TcPOU,SM_A.TcPOU' && pp?.duts?.[0]?.name === 'E_A.TcDUT', `projectPous: the POUs with a CASE, the enums (${names.join(', ')})`);
  const machines = (pp?.pous ?? []).filter((p) => isStateMachinePou(p.content)).map((p) => p.name).sort();
  expect(machines.join() === 'FB_B.TcPOU,SM_A.TcPOU', `the state machines: doState() and a body's CASE on an enum, not an INT CASE (${machines.join(', ')})`);

  // projectSymbols
  posted.length = 0;
  await host.handle({ type: 'projectSymbols' });
  const ps = (await reply('projectSymbols')) as { files?: { name: string }[]; error?: string } | undefined;
  expect(!!ps?.files?.some((f) => f.name === 'SM_A.TcPOU') && !!ps?.files?.some((f) => f.name === 'E_A.TcDUT'), `projectSymbols: the project's types (${ps?.error ?? ps?.files?.length})`);

  // projectUses: SM_A's uses in other POUs (FB_B declares fbA : SM_A)
  posted.length = 0;
  await host.handle({ type: 'projectUses', requestId: 7, name: 'SM_A' });
  const pu = (await reply('projectUses')) as { requestId?: number; files?: { name: string }[] } | undefined;
  expect(pu?.requestId === 7 && (pu?.files ?? []).some((f) => f.name === 'SM_A.TcPOU') === true, `projectUses: the files naming SM_A (${(pu?.files ?? []).map((f) => f.name).join(', ')})`);

  // saveOther: refused when changed on disk; written (BOM kept) when as read; never outside the PLC project
  const other = path.join(plc, 'POUs', 'FB_D.TcPOU');
  posted.length = 0;
  await host.handle({ type: 'saveOther', requestId: 8, files: [{ path: other, content: plain.replace('x + 1', 'x + 2'), baseline: plain.replace('x + 1', 'x + 9') }] });
  const so1 = (await reply('saveOtherResult')) as { ok?: boolean; message?: string } | undefined;
  expect(so1?.ok === false && /changed on disk/.test(so1?.message ?? '') && fs.readFileSync(other, 'utf8').includes('x + 1'), `saveOther: changed on disk, refused (${so1?.message})`);
  posted.length = 0;
  await host.handle({ type: 'saveOther', requestId: 9, files: [{ path: other, content: plain.replace('x + 1', 'x + 2'), baseline: plain }] });
  const so2 = (await reply('saveOtherResult')) as { ok?: boolean; message?: string } | undefined;
  const disk = fs.readFileSync(other, 'utf8');
  expect(so2?.ok === true && disk.startsWith('﻿') && disk.includes('x + 2'), `saveOther: written, its BOM kept (${so2?.message})`);
  const outside = path.join(dir, 'Elsewhere.TcPOU');
  fs.writeFileSync(outside, plain);
  posted.length = 0;
  await host.handle({ type: 'saveOther', requestId: 10, files: [{ path: outside, content: 'x', baseline: plain }] });
  const so3 = (await reply('saveOtherResult')) as { ok?: boolean } | undefined;
  expect(so3?.ok === false && fs.readFileSync(outside, 'utf8') === plain, 'saveOther: a file outside the PLC project is not written');

  // gitShow: the committed version; a file not committed yet said so
  if (git) {
    fs.writeFileSync(pou, '﻿' + body.replace('fbA();', 'fbA(); // changed'));
    posted.length = 0;
    await host.handle({ type: 'gitShow', path: pou, requestId: 11 });
    const gs = (await reply('gitShowResult')) as { requestId?: number; content?: string; error?: string } | undefined;
    expect(gs?.requestId === 11 && gs?.content === body, `gitShow: HEAD's version, its BOM off (${gs?.error ?? gs?.content?.length})`);
    posted.length = 0;
    await host.handle({ type: 'gitShow', path: path.join(plc, 'POUs', 'Unknown.TcPOU'), requestId: 12 });
    const gs2 = (await reply('gitShowResult')) as { error?: string } | undefined;
    expect(/Not a file loaded/.test(gs2?.error ?? ''), `gitShow: only files loaded (${gs2?.error})`);
  } else console.log('(git not available: gitShow not checked)');

  host.dispose?.();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
