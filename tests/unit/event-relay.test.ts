// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The PLC's FB_KvalEventRelay as the gateway reads it (gateway/eventRelay.cjs): its ring of 64 packed ST_KvalEvent
// (355 bytes: nSeq, nTimestamp (FILETIME), nKind, nSeverity, nEventId, sSource STRING(80), sText STRING(255)): the
// used slots, oldest first (the ring wrapped), their time, kind, severity, source and text (UTF-8)
/* eslint-disable @typescript-eslint/no-require-imports */
const { decodeEvents, EVENT_SIZE, SLOTS } = require('../../gateway/eventRelay.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const buf = Buffer.alloc(SLOTS * EVENT_SIZE);
  const put = (slot: number, seq: number, ms: number, kind: number, sev: number, id: number, source: string, text: string) => {
    const o = slot * EVENT_SIZE;
    buf.writeUInt32LE(seq, o);
    buf.writeBigUInt64LE(BigInt(ms + 11644473600000) * 10000n, o + 4);
    buf.writeUInt8(kind, o + 12);
    buf.writeUInt8(sev, o + 13);
    buf.writeUInt32LE(id, o + 14);
    buf.write(source, o + 18, 80, 'utf8');
    buf.write(text, o + 99, 255, 'utf8');
  };
  const t0 = Date.parse('2026-10-16T12:00:00.123Z');
  // (the ring wrapped: 65 in slot 0, 64 in slot 63, 2 in slot 1)
  put(63, 64, t0, 2, 3, 7, 'MAIN.fbCell.fbDoor', 'Door 2 sensor lost');
  put(0, 65, t0 + 1000, 3, 3, 7, 'MAIN.fbCell.fbDoor', 'Door 2 sensor lost');
  put(1, 2, t0 - 5000, 1, 1, 1, 'MAIN', 'Fräsen gestartet');
  const ev = decodeEvents(buf);
  const last = ev.at(-1);
  expect(EVENT_SIZE === 355 && ev.length === 3 && ev.map((e: { seq: number }) => e.seq).join() === '2,64,65' && ev[1].t === t0 && ev[1].kind === 'raised' && ev[1].severity === 'Error' && ev[1].eventId === 7 && ev[1].source === 'MAIN.fbCell.fbDoor' && ev[1].text === 'Door 2 sensor lost' && last.kind === 'cleared' && ev[0].text === 'Fräsen gestartet' && ev[0].severity === 'Info' && ev[0].kind === 'message', `the ring: ${ev.map((e: { seq: number; kind: string; severity: string; text: string }) => `${e.seq} ${e.kind} ${e.severity} "${e.text}"`).join(' | ')}`);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
