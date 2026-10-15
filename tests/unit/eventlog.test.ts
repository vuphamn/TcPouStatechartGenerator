// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// TwinCAT logged events (gateway/eventlog.cjs): an export of the Logged Events window parsed, whatever its separator,
// its date format (ISO; d.m.y; m/d/y with AM/PM) and its columns' order; quoted fields; lines not understood counted.
/* eslint-disable @typescript-eslint/no-require-imports */
const { parseLoggedEvents, timeOf } = require('../../gateway/eventlog.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const us = parseLoggedEvents('"Severity","Source","Time Raised","Text"\r\n"Error","Door1","10/15/2026 3:59:31.250 PM","Door 1, sensor ""S12"" lost"\r\n"Info","Main","10/15/2026 9:05:00 AM","Shift started"\r\n');
expect(us.events.length === 2 && us.events[0].t === new Date(2026, 9, 15, 15, 59, 31, 250).getTime() && us.events[0].text === 'Door 1, sensor "S12" lost' && us.events[1].t === new Date(2026, 9, 15, 9, 5, 0).getTime(), `en-US, commas, quotes: ${us.events.map((e: { text: string }) => e.text).join(' | ')}`);
const de = parseLoggedEvents('Text;Zeit;Severity;Source\nTür 1 offen;15.10.2026 15:59:31,5;Warning;Door1\nkaputt;keine Zeit;Error;x\n');
expect(de.events.length === 1 && de.events[0].t === new Date(2026, 9, 15, 15, 59, 31, 500).getTime() && de.skipped === 1 && de.events[0].severity === 'Warning', `d.m.y, semicolons, its columns elsewhere: ${de.events.length} (${de.skipped} not understood)`);
const iso = parseLoggedEvents('Time\tText\n2026-10-15 15:59:31.125\tStarted\n');
expect(iso.events[0]?.t === new Date(2026, 9, 15, 15, 59, 31, 125).getTime(), 'ISO, tabs');
expect(timeOf('13/10/2026 08:00:00', false) === new Date(2026, 9, 13, 8).getTime() && timeOf('3/4/2026 12:30:00 AM', false) === new Date(2026, 2, 4, 0, 30).getTime(), 'a day above 12 first; 12 AM is midnight');
let err = '';
try {
  parseLoggedEvents('A;B\n1;2\n');
} catch (e) {
  err = (e as Error).message;
}
expect(/a time and a text/.test(err), `its columns not found: ${err}`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
