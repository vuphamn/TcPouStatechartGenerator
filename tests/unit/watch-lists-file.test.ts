// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Named watch lists beside the PLC project (shared/watchListsFile.cjs, MachineScope.watch.json): saved per POU type,
// read back, another type's kept, a list removed (the type gone with its last list), bad names and variables refused,
// no PLC project: said
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readWatchLists, saveWatchList, FILE } = require('../../shared/watchListsFile.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-watch-'));
fs.mkdirSync(path.join(root, 'Plc', 'POUs'), { recursive: true });
fs.writeFileSync(path.join(root, 'Plc', 'Plc.plcproj'), '<Project/>');
const pou = path.join(root, 'Plc', 'POUs', 'SM_Table.TcPOU');

expect(Object.keys(readWatchLists(pou, 'SM_Table').lists).length === 0, 'none yet');
let r = saveWatchList(pou, 'SM_Table', 'Clamping', ['cmd_bUnclamp', 'fbAxis.nCount', 'cmd_bUnclamp', 'bad name!']);
expect(JSON.stringify(r.lists) === JSON.stringify({ Clamping: ['cmd_bUnclamp', 'fbAxis.nCount'] }), `saved (twice and a bad variable left out): ${JSON.stringify(r.lists)}`);
saveWatchList(pou, 'SM_Table', 'Feeding', ['nFeedCount']);
saveWatchList(pou, 'SM_Other', 'All', ['bBusy']);
const file = JSON.parse(fs.readFileSync(path.join(root, 'Plc', FILE), 'utf8'));
expect(Object.keys(file.pous).join() === 'SM_Table,SM_Other' && /Commit it with the project/.test(file.note), `beside the .plcproj, per POU type (${Object.keys(file.pous).join()})`);
expect(Object.keys(readWatchLists(pou, 'SM_Table').lists).join() === 'Clamping,Feeding', 'read back');
r = saveWatchList(pou, 'SM_Other', 'All', null);
expect(Object.keys(r.lists).length === 0 && !('SM_Other' in JSON.parse(fs.readFileSync(path.join(root, 'Plc', FILE), 'utf8')).pous), 'its last list removed: the type gone');
expect(/Not a list name/.test(saveWatchList(pou, 'SM_Table', 'a/b', ['x']).error ?? '') && /Not a list name/.test(saveWatchList(pou, 'bad type', 'x', ['x']).error ?? ''), 'a bad name or type: refused');
expect(/No PLC project/.test(saveWatchList(path.join(os.tmpdir(), 'nowhere', 'X.TcPOU'), 'X', 'x', ['a']).error ?? ''), 'no PLC project: said');

fs.rmSync(root, { recursive: true, force: true });
console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
