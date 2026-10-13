// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Commissioning beside the PLC project (shared/commissioningFile.cjs): the list kept per POU type, a state set logged
// with the user the host names; the webhook's checks (shared/webhook.cjs); blame of the POU's body (methodBlame.ts)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { methodBlame } from '../../src/utils/methodBlame.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCommissioning, saveCommissioning } = require('../../shared/commissioningFile.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { postWebhook } = require('../../shared/webhook.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-comm-'));
  try {
    fs.writeFileSync(path.join(dir, 'P.plcproj'), '<Project/>');
    fs.mkdirSync(path.join(dir, 'POUs'));
    const pou = path.join(dir, 'POUs', 'SM_A.TcPOU');
    expect(readCommissioning(pou, 'SM_A').allowed.length === 0, 'nothing kept yet');
    const a = saveCommissioning(pou, 'SM_A', { allowed: ['IDLE', 'not a name!', 'RUN'] }, 'ann');
    expect(JSON.stringify(a.allowed) === '["IDLE","RUN"]', `the list kept, bad names left out (${JSON.stringify(a.allowed)})`);
    const b = saveCommissioning(pou, 'SM_A', { entry: { state: 'RUN', from: 'IDLE', plc: '5.1.2.3.1.1:851', ok: true, user: 'mallory' } }, 'ann');
    expect(b.log.length === 1 && b.log[0].user === 'ann' && b.log[0].state === 'RUN' && /^\d{4}-\d\d-\d\dT/.test(b.log[0].t) && JSON.stringify(b.allowed) === '["IDLE","RUN"]', `a state set logged with the host's user, not the page's (${b.log[0]?.user})`);
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'MachineScope.commissioning.json'), 'utf8'));
    expect(!!file.note && file.pous.SM_A.log.length === 1 && readCommissioning(pou, 'SM_B').log.length === 0, 'one file beside the project, per POU type');
    expect(!!saveCommissioning(pou, 'not a type', {}, 'x').error && !!saveCommissioning('relative.TcPOU', 'SM_A', {}, 'x').error, 'a bad POU type or path: said');
    for (let i = 0; i < 510; i++) saveCommissioning(pou, 'SM_A', { entry: { state: 'RUN', from: 'IDLE', ok: true } }, 'bob');
    expect(readCommissioning(pou, 'SM_A').log.length === 500, 'the log kept to its last 500');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // The webhook: https only, a URL
  expect((await postWebhook('http://hooks.example/x', 'a')).error === 'Only an https:// webhook' && (await postWebhook('not a url', 'a')).error === 'Not a URL', 'a webhook: https only');

  // Blame of the POU's body: its <ST> before any method
  const file = ['<POU Name="SM_A" Id="{1}">', '<Declaration><![CDATA[FUNCTION_BLOCK SM_A]]></Declaration>', '<Implementation>', '<ST><![CDATA[doState();', 'x := 1;]]></ST>', '</Implementation>', '<Method Name="doState" Id="{2}">', '<Implementation>', '<ST><![CDATA[y := 2;]]></ST>'];
  const blame = file.map((text, i) => ({ hash: i === 4 ? 'bbbbbbb' : 'aaaaaaa', author: 'A', date: i === 4 ? '2026-10-02' : '2026-10-01', summary: 's', text }));
  const body = methodBlame(blame, '', 'doState();\nx := 1;');
  expect(!('error' in body) && body.get(1)?.hash === 'aaaaaaa' && body.get(2)?.hash === 'bbbbbbb' && body.size === 2, "the POU's body blamed, not its method's lines");
  const none = methodBlame([{ hash: 'a', author: '', date: '', summary: '', text: '<POU Name="X">' }, { hash: 'a', author: '', date: '', summary: '', text: '<Method Name="M">' }], '', '');
  expect('error' in none, 'a body with no Structured Text before its methods: said');

  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
