// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The remembered PLCs kept up to date by Browse: what a search found (TwinCAT, OS, when), a changed DHCP address;
// never their names, nor an address typed on purpose (a host name, a forwarded port); the same list when nothing is new
import { refreshRemembered } from '../../src/utils/rememberedPlcs.ts';
import type { FoundPlc, RememberedPlc } from '../../src/utils/plcDiscovery.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const list: RememberedPlc[] = [
  { name: 'Door line (mine)', netId: '192.168.1.15.1.1', ip: '10.0.0.75', port: '', localNetId: '', used: 3 },
  { name: 'Forwarded', netId: '5.6.7.8.1.1', ip: 'gateway.local:48999', port: '', localNetId: '', used: 2 },
  { name: 'Away', netId: '9.9.9.9.1.1', ip: '9.9.9.9', port: '', localNetId: '', used: 1 },
];
const found: FoundPlc[] = [
  { netId: '192.168.1.15.1.1', ip: '10.0.0.80', name: 'vu-dell', twincat: '3.1.4024', os: 'Windows 10.0.19045' },
  { netId: '5.6.7.8.1.1', ip: '10.0.0.9', name: 'cx', twincat: '3.1.4026' },
];
const now = 1_000_000;
const next = refreshRemembered(list, found, now);
const door = next[0];
expect(door.name === 'Door line (mine)' && door.ip === '10.0.0.80' && door.twincat === '3.1.4024' && door.os === 'Windows 10.0.19045' && door.seen === now, `found: its new address (DHCP), TwinCAT, OS, when; the name kept (${JSON.stringify(door)})`);
expect(next[1].ip === 'gateway.local:48999' && next[1].twincat === '3.1.4026', `an address typed on purpose (host:port): kept (${next[1].ip})`);
expect(next[2] === list[2], 'not found: left as it was');
expect(refreshRemembered(next, found, now + 1000) === next, 'nothing new (a second later): the same list');
expect(refreshRemembered(next, found, now + 120000) !== next && refreshRemembered(next, found, now + 120000)[0].seen === now + 120000, 'found again later: seen updated');
expect(refreshRemembered(list, [{ netId: '192.168.1.15.1.1', ip: '10.0.0.75', name: 'x', source: 'project' }], now) === list, 'the project\'s target (not found on the network): not counted');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
