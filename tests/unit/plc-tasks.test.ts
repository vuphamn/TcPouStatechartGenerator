// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The Solution view's Tasks (vscode-extension/plcTree.cjs readTasks): the .tsproj's real-time tasks (cycle in 100 ns,
// priority, AMS port) merged with the PLC projects' task objects (.TcTTO: cycle in µs, priority, the programs called);
// a task only in a .TcTTO; by priority
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readTasks } = require('../../vscode-extension/plcTree.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-tasks-'));
fs.mkdirSync(path.join(root, 'Plc'), { recursive: true });
fs.writeFileSync(path.join(root, 'Cell.tsproj'), `<?xml version="1.0"?>
<TcSmProject TcSmVersion="1.0" TcVersion="3.1.4026.27">
	<Project ProjectGUID="{00000000-0000-0000-0000-000000000001}">
		<System>
			<Tasks>
				<Task Id="3" Priority="20" CycleTime="100000" AmsPort="350" AdtTasks="true">
					<Name>PlcTask</Name>
				</Task>
				<Task Id="4" Priority="10" CycleTime="10000" AmsPort="351">
					<Name>FastTask</Name>
				</Task>
			</Tasks>
		</System>
	</Project>
</TcSmProject>
`);
fs.writeFileSync(path.join(root, 'Plc', 'Plc.plcproj'), '<Project/>');
const tto = (name: string, us: number, prio: number, calls: string[]) => `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <Task Name="${name}" Id="{00000000-0000-0000-0000-000000000002}">
    <CycleTime>${us}</CycleTime>
    <Priority>${prio}</Priority>
${calls.map((c) => `    <PouCall>\n      <Name>${c}</Name>\n    </PouCall>`).join('\n')}
  </Task>
</TcPlcObject>
`;
fs.writeFileSync(path.join(root, 'Plc', 'PlcTask.TcTTO'), tto('PlcTask', 10000, 20, ['MAIN', 'P_Io']));
fs.writeFileSync(path.join(root, 'Plc', 'SlowTask.TcTTO'), tto('SlowTask', 100000, 30, ['P_Log']));

const tasks = readTasks(root) as { name: string; cycleMs?: number; priority?: number; adsPort?: number; calls: string[]; plc?: string; ttoFile?: string }[];
const by = Object.fromEntries(tasks.map((t) => [t.name, t]));
expect(tasks.map((t) => t.name).join() === 'FastTask,PlcTask,SlowTask', `by priority (${tasks.map((t) => `${t.name}:${t.priority}`).join(', ')})`);
expect(by.PlcTask.cycleMs === 10 && by.PlcTask.adsPort === 350 && by.PlcTask.calls.join() === 'MAIN,P_Io' && by.PlcTask.plc === 'Plc' && /PlcTask\.TcTTO$/.test(by.PlcTask.ttoFile ?? ''), `the .tsproj's task with its .TcTTO (${JSON.stringify(by.PlcTask)})`);
expect(by.FastTask.cycleMs === 1 && by.FastTask.calls.length === 0, 'a task only in the .tsproj: 1 ms, no programs');
expect(by.SlowTask.cycleMs === 100 && by.SlowTask.priority === 30 && by.SlowTask.calls.join() === 'P_Log', 'a task only in a .TcTTO: its cycle in µs');
expect(readTasks(path.join(root, 'nowhere')).length === 0, 'no project: none');

fs.rmSync(root, { recursive: true, force: true });
console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
