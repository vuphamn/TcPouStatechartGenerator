// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The PLC project's sources read from the PLC's boot folder (shared/tcSources.cjs, over a stand-in ADS client: the
// system service's file open / read / close), unpacked; a POU of them opened with the project's enums
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readPlcSources, unzip, builtTypes, libraryTypesOf } = require('../../shared/tcSources.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { writeZip } = require('../lib/zip.cjs');
import { plcPous, plcPouSource } from '../../src/utils/plcSources.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const files: Record<string, string> = {
  'POUs/Line/SM_Line.TcPOU': '<POU Name="SM_Line">…</POU>',
  'POUs/Line/E_Line_States.TcDUT': '<DUT Name="E_Line_States">…</DUT>',
  'GVLs/GVL_IO.TcGVL': '<GVL Name="GVL_IO">…</GVL>',
  'Plant.plcproj': '<Project/>',
  'Docs/readme.md': 'x',
};
// A stand-in client: the boot folder, opened only for reading with the boot path (E_OpenPath 4), read in chunks
function client(boot: Record<string, Buffer>, calls: string[] = []) {
  const open = new Map<number, { data: Buffer; at: number }>();
  let next = 7;
  return {
    calls,
    async readWriteRaw(ig: number, io: number, size: number, value: Buffer, target?: { adsPort?: number }) {
      calls.push(`${ig}@${target?.adsPort}`);
      if (target?.adsPort !== 10000) throw Object.assign(new Error('wrong port'), { adsError: { errorCode: 6, errorStr: 'wrong port' } });
      if (ig === 120) {
        const name = value.toString('latin1').replace(/\0+$/, '');
        if (io >> 16 !== 4 || !(io & 1) || !(io & 0x10) || !boot[name]) throw Object.assign(new Error('Not found'), { adsError: { errorCode: 1804, errorStr: 'Not found (files, ...)' } });
        const b = Buffer.alloc(4);
        b.writeUInt32LE(next);
        open.set(next++, { data: boot[name], at: 0 });
        return b;
      }
      const f = open.get(io);
      if (!f) throw new Error('bad handle');
      if (ig === 121) {
        open.delete(io);
        return Buffer.alloc(0);
      }
      const chunk = f.data.subarray(f.at, f.at + size);
      f.at += chunk.length;
      return chunk;
    },
    open,
  };
}

(async () => {
  // 1. The zip: stored / deflated files, directories left out, only what is asked for
  const zip: Buffer = writeZip(files);
  const all = unzip(zip);
  expect(all.length === 5 && all.find((f: { path: string }) => f.path === 'POUs/Line/SM_Line.TcPOU')?.data.toString() === files['POUs/Line/SM_Line.TcPOU'], `unzip: ${all.map((f: { path: string }) => f.path).join(', ')}`);

  // 2. From the PLC: the project of port 851 (two PLC projects on it), its sources (not the other files)
  const info = { project: { name: 'Plant' }, sub_projects: [{ name: 'Other', file: 'Plc/Port_852.json' }, { name: 'PlantPlc', file: 'Plc/Port_851.json' }] };
  const big = Buffer.concat([zip, Buffer.alloc(0)]);
  const c = client({ 'CurrentProjectInfo.json': Buffer.from('﻿' + JSON.stringify(info)), 'CurrentConfig/PlantPlc.tpzip': big });
  const r = await readPlcSources(c, 851);
  expect(!r.error && r.project === 'Plant' && r.plcProject === 'PlantPlc' && r.files.map((f: { path: string }) => f.path).sort().join() === 'GVLs/GVL_IO.TcGVL,POUs/Line/E_Line_States.TcDUT,POUs/Line/SM_Line.TcPOU', `readPlcSources: ${r.error ?? `${r.plcProject}: ${r.files.map((f: { path: string }) => f.path).join(', ')}`}`);
  expect(c.open.size === 0 && c.calls.every((x) => x.endsWith('@10000')), `each file closed again, all on the system service (${c.calls.length} calls)`);

  // 3. The PLC keeps no sources (downloaded without them) / no project information
  const none = await readPlcSources(client({ 'CurrentProjectInfo.json': Buffer.from(JSON.stringify(info)) }), 851);
  expect(/keeps no sources of PlantPlc/.test(none.error ?? ''), `no sources: ${none.error}`);
  const noInfo = await readPlcSources(client({}), 851);
  expect(/no project information/.test(noInfo.error ?? ''), `no project information: ${noInfo.error}`);

  // 4. A POU of them: its enums offered with it; the list of POUs
  const src = plcPouSource(r.files, 'sm_line');
  expect(!!src && src.name === 'SM_Line.TcPOU' && src.dutCandidates?.length === 1 && src.dutCandidates[0].relativePath === 'POUs/Line/E_Line_States.TcDUT', `plcPouSource: ${src?.name} with ${src?.dutCandidates?.map((d) => d.name).join(', ')}`);
  expect(plcPouSource(r.files, 'SM_Nope') === null, 'a type not in them: null');
  expect(JSON.stringify(plcPous(r.files)) === JSON.stringify([{ name: 'SM_Line', folder: 'POUs/Line', path: 'POUs/Line/SM_Line.TcPOU' }]), `plcPous: ${JSON.stringify(plcPous(r.files))}`);

  // 5. Another PLC project named (a second PLC on the target); all of them listed
  const other = await readPlcSources(client({ 'CurrentProjectInfo.json': Buffer.from(JSON.stringify(info)), 'CurrentConfig/Other.tpzip': writeZip({ 'POUs/FB_Other.TcPOU': '<POU Name="FB_Other"/>' }) }), 851, { plcProject: 'other' });
  expect(other.plcProject === 'Other' && other.files?.length === 1 && JSON.stringify(other.projects) === '[{"name":"Other","port":852},{"name":"PlantPlc","port":851}]', `plcProject: ${other.error ?? other.plcProject}, ${JSON.stringify(other.projects)}`);
  expect(/no PLC project Nope/.test((await readPlcSources(c, 851, { plcProject: 'Nope' })).error ?? ''), 'an unknown PLC project: said');

  // 6. The .tmc: the types as built (size, own members), the library of each library type
  const tmc = '<DataTypes><DataType><Name>SM_Line</Name><BitSize>64</BitSize><ExtendsType>Base</ExtendsType><SubItem><Name>bGo</Name><Type>BOOL</Type></SubItem><SubItem><Name>machineState</Name></SubItem></DataType><DataType><Name Namespace="Tc2_MC2">MC_Power</Name><BitSize>8</BitSize></DataType><DataType><Name GUID="{x}" Namespace="Tc2_System">T_AmsNetID</Name></DataType></DataTypes>';
  const bt = builtTypes(tmc, new Set(['sm_line']));
  expect(JSON.stringify([...bt.values()]) === '[{"name":"SM_Line","size":8,"members":["bGo","machineState"]}]', `builtTypes: ${JSON.stringify([...bt.values()])}`);
  expect(JSON.stringify(libraryTypesOf(tmc)) === '{"mc_power":"Tc2_MC2","t_amsnetid":"Tc2_System"}', `libraryTypesOf: ${JSON.stringify(libraryTypesOf(tmc))}`);

  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
