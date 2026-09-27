// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The desktop app's Save (electron/tcSourceFiles.cjs): written back with its BOM, a file changed on disk since it
// was read is a conflict (unless forced), only .TcPOU / .TcDUT files
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// @ts-ignore (CommonJS module of the desktop app)
import { saveSources, readPouWithDutCandidates } from '../../electron/tcSourceFiles.cjs';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-save-'));
  const pou = path.join(dir, 'SM_X.TcPOU');
  const dut = path.join(dir, 'E_X.TcDUT');
  fs.writeFileSync(pou, '﻿<POU>one</POU>\r\n', 'utf8');
  fs.writeFileSync(dut, '<DUT>a</DUT>', 'utf8');

  const read = await readPouWithDutCandidates(pou);
  expect(read.content === '<POU>one</POU>\r\n' && read.dutCandidates[0]?.path === dut, `read: no BOM in the text, the enum's path (${read.dutCandidates[0]?.path})`);

  let r = await saveSources([{ path: pou, content: '<POU>two</POU>\r\n', baseline: read.content }, { path: dut, content: '<DUT>b</DUT>', baseline: '<DUT>a</DUT>' }]);
  expect(r.saved.length === 2 && !r.conflicts.length && !r.errors.length, `saved both: ${JSON.stringify(r)}`);
  expect(fs.readFileSync(pou, 'utf8') === '﻿<POU>two</POU>\r\n', 'the POU with its BOM and CRLF');
  expect(fs.readFileSync(dut, 'utf8') === '<DUT>b</DUT>', 'the enum without a BOM, as it was');

  // Changed on disk meanwhile: a conflict, the file left alone; forced: written
  fs.writeFileSync(pou, '﻿<POU>changed in TwinCAT</POU>', 'utf8');
  r = await saveSources([{ path: pou, content: '<POU>three</POU>', baseline: '<POU>two</POU>\r\n' }]);
  expect(r.conflicts.length === 1 && !r.saved.length && fs.readFileSync(pou, 'utf8').includes('changed in TwinCAT'), 'changed on disk: a conflict, not written');
  r = await saveSources([{ path: pou, content: '<POU>three</POU>', baseline: '<POU>two</POU>\r\n', force: true }]);
  expect(r.saved.length === 1 && fs.readFileSync(pou, 'utf8') === '﻿<POU>three</POU>', 'forced: written');

  // Other files, relative paths: refused
  r = await saveSources([{ path: path.join(dir, 'evil.bat'), content: 'x' }, { path: 'SM_X.TcPOU', content: 'x' }]);
  expect(r.errors.length === 2 && !r.saved.length && !fs.existsSync(path.join(dir, 'evil.bat')), 'only absolute .TcPOU / .TcDUT paths');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
