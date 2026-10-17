// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// On-call rotations (gateway/oncall.cjs): who is on call at a time (each week from its first handover, in turn; before
// its start too), its next handovers, a rotation checked; acknowledge links: made with config.publicUrl, checked (a
// changed one, an expired one refused), none without a public address
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { personAt, scheduleOf, checkRotation, createAckLinks } = require('../../gateway/oncall.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const rot = { name: 'Maintenance', every: 'week', start: '2026-10-19T07:00', people: [{ name: 'Bob', contact: '+15551234567' }, { name: 'Ann', contact: 'ann@acme.com' }, { name: 'Cy' }] };
  const at = (s: string) => Date.parse(s);
  const names = ['2026-10-19T07:00', '2026-10-26T06:59', '2026-10-26T07:00', '2026-11-02T08:00', '2026-11-09T08:00', '2026-10-19T06:59'].map((s) => personAt(rot, at(s))?.name).join(' ');
  expect(names === 'Bob Bob Ann Cy Bob Cy', `on call: ${names} (weekly at 07:00, in turn; before its start: the last of them)`);
  const plan = scheduleOf(rot, at('2026-10-20T12:00'), 3);
  expect(plan.map((p: { name: string }) => p.name).join() === 'Bob,Ann,Cy' && plan[1].from === at('2026-10-26T07:00'), `its next handovers: ${plan.map((p: { name: string; from: number }) => `${p.name} ${new Date(p.from).toISOString()}`).join(', ')}`);
  const daily = personAt({ ...rot, every: 'day' }, at('2026-10-21T08:00'));
  expect(daily?.name === 'Cy', `daily: ${daily?.name} on the third day`);
  let bad = '';
  try {
    checkRotation({ name: 'X', every: 'month', start: '2026-10-19 07:00', people: [{ name: 'a' }] }, 0);
  } catch (e) {
    bad = (e as Error).message;
  }
  const ok = checkRotation({ name: 'X', every: 'day', start: '2026-10-19 07:00', people: [{ name: 'a' }, { name: '' }] }, 0);
  expect(/every day or every week/.test(bad) && ok.start === '2026-10-19T07:00' && ok.people.length === 1, `checked: ${bad}; ${JSON.stringify(ok)}`);
  // (acknowledge links)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-ack-'));
  try {
    let conf: Record<string, unknown> = { publicUrl: 'https://gw-line2:8443/' };
    const links = createAckLinks({ baseDir: dir, getConfig: () => conf });
    const url = links.linkOf('abc123', 'Bob Smith');
    const [, id, who, exp, sig] = /\/ack\/([^/]+)\/([^/]+)\/(\d+)\/([\w-]+)$/.exec(url) ?? [];
    const good = links.check(decodeURIComponent(id), decodeURIComponent(who), exp, sig);
    const forged = links.check('abc123', 'Mallory', exp, sig);
    const old = links.check('abc123', 'Bob Smith', exp, sig, Number(exp) * 1000 + 1);
    const again = createAckLinks({ baseDir: dir, getConfig: () => conf }).check('abc123', 'Bob Smith', exp, sig);
    conf = {};
    expect(url.startsWith('https://gw-line2:8443/ack/abc123/Bob%20Smith/') && good?.who === 'Bob Smith' && forged === null && old === null && again?.id === 'abc123' && links.linkOf('abc123', 'Bob') === null, `a link: ${url.slice(0, 60)}…; checked; another name, expired: refused; its key kept (a restart); no public address: none`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
