// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The PLC's I/O tree (shared/tcIoTree.cjs): an EtherCAT device's boxes nested as wired (EK1200 > EK1100 > EL1008),
// their PDOs and entries; the PLC instance's links (InputDst / OutputSrc) put on their entries
// (the parser itself: shared/ioTreeParse.mjs, the page's too; Node's side: shared/tcIoTree.cjs with xmldom)
const { readIoFolder, parseIoTree: parseIoTreeNode } = require('../../shared/tcIoTree.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DOMParser } = require('@xmldom/xmldom');
import { parseIoTreeWith, portAOf } from '../../shared/ioTreeParse.mjs';
import { boxStates, stateEvents } from '../../src/components/IoNetworkView.tsx';
import { deviceLinks, durationText } from '../../src/components/IoBoxProperties.tsx';
import { recentEventsOf } from '../../src/components/IoTreePanel.tsx';
import { TERMINAL_FACES, contactPos, faceFor, faceOf } from '../../src/data/terminalFaces.ts';
import { compareIoTrees } from '../../src/utils/ioCompare.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findDevice, deviceImages, candidates } = require('../../shared/tcDeviceInfo.cjs');
const parseIoTree = (files: Record<string, string>) => parseIoTreeWith(files, (t: string) => new DOMParser({ onError: () => {} }).parseFromString(t, 'text/xml'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { describeState, readMasters, readEcatStates } = require('../../shared/tcEcat.cjs');
import fs from 'fs';
import os from 'os';
import path from 'path';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const IO = `<?xml version="1.0"?>
<TcSmItem>
  <Device Id="1" DevType="111" AmsNetId="10.10.10.221.2.1" RemoteName="Main EtherCAT Port (EtherCAT)">
    <Name>__FILENAME__</Name>
    <Box Id="1" BoxType="9099">
      <Name>Main (EK1200)</Name>
      <EtherCAT VendorId="#x2"/>
      <Box Id="2" BoxType="9099">
        <Name>Frame Node (EK1100)</Name>
        <EtherCAT VendorId="#x2"/>
        <Box Id="3" BoxType="9099">
          <Name>Term 3 (EL1008)</Name>
          <EtherCAT VendorId="#x2">
            <Pdo Name="Channel 1" Index="#x1a00">
              <Entry Name="Input" Index="#x6000" Sub="#x01"><Type>BIT</Type></Entry>
            </Pdo>
            <Pdo Name="Channel 2" Index="#x1a01">
              <Entry Name="Input" Index="#x6010" Sub="#x01"><Type>BIT</Type></Entry>
            </Pdo>
          </EtherCAT>
        </Box>
        <Box Id="4" BoxType="9099">
          <Name>Term 4 (EL2008)</Name>
          <EtherCAT VendorId="#x2">
            <Pdo Name="Channel 1" Index="#x1600" InOut="1">
              <Entry Name="Output" Index="#x7000" Sub="#x01"><Type>BIT</Type></Entry>
            </Pdo>
          </EtherCAT>
        </Box>
      </Box>
    </Box>
  </Device>
</TcSmItem>`;
const PLC = `<?xml version="1.0"?>
<TcSmItem>
  <Mappings>
    <OwnerA Name="InputDst" Prefix="TIPC^Plant^Plant Instance" Type="1">
      <OwnerB Name="TIID^Main EtherCAT Port (EtherCAT)^Main (EK1200)^Frame Node (EK1100)^Term 3 (EL1008)">
        <Link VarA="MAIN.fbCyl.di_extended" TypeA="BOOL" VarB="Channel 2^Input"/>
      </OwnerB>
    </OwnerA>
    <OwnerA Name="OutputSrc" Prefix="TIPC^Plant^Plant Instance" Type="2">
      <OwnerB Name="TIID^Main EtherCAT Port (EtherCAT)^Main (EK1200)^Frame Node (EK1100)^Term 4 (EL2008)">
        <Link VarA="MAIN.fbCyl.do_extend" TypeA="BOOL" VarB="Channel 1^Output"/>
      </OwnerB>
    </OwnerA>
  </Mappings>
</TcSmItem>`;

const r = parseIoTree({ '_Config/IO/Main EtherCAT Port (EtherCAT).xti': IO, '_Config/Plant/Plant Instance.xti': PLC, 'Plant.tsproj': '<TcSmProject/>' });
const dev = r.devices[0];
expect(r.devices.length === 1 && dev.name === 'Main EtherCAT Port (EtherCAT)' && dev.netId === '10.10.10.221.2.1', `the device: ${dev?.name} (${dev?.netId})`);
const ek1200 = dev.boxes[0];
const ek1100 = ek1200?.boxes[0];
expect(ek1200?.product === 'EK1200' && ek1100?.product === 'EK1100' && ek1100.boxes.map((b: { product: string }) => b.product).join() === 'EL1008,EL2008', 'nested as wired: EK1200 > EK1100 > EL1008, EL2008');
const el1008 = ek1100.boxes[0];
expect(el1008.pdos.length === 2 && el1008.pdos[1].entries[0].path === 'Main EtherCAT Port (EtherCAT)^Main (EK1200)^Frame Node (EK1100)^Term 3 (EL1008)^Channel 2^Input' && el1008.pdos[0].dir === 'in', "the terminal's PDOs and entries, their paths");
expect(el1008.pdos[1].entries[0].link === 'MAIN.fbCyl.di_extended' && !el1008.pdos[0].entries[0].link, 'an input linked to its PLC variable (the other not)');
const el2008 = ek1100.boxes[1];
expect(el2008.pdos[0].dir === 'out' && el2008.pdos[0].entries[0].link === 'MAIN.fbCyl.do_extend', 'an output linked');
expect(r.links.length === 2 && r.links.every((l: { dir: string }) => l.dir === 'in' || l.dir === 'out'), `the links: ${r.links.length}`);
expect(parseIoTree({ 'bad.xti': '<not xml' }).devices.length === 0, 'not XML: nothing, no error');

// The cabling (the Network view): each box's Id, its place among the master's slaves, where its port A goes
// (PortABoxInfo #xPPBBBBBB: port PP of box BBBBBB; #x00ffffff: the master); a disabled box: no place
const NET = `<?xml version="1.0"?>
<TcSmItem><Device Id="1" AmsNetId="5.6.7.8.2.1" RemoteName="Net (EtherCAT)">
  <Box Id="1"><Name>Main (EK1200)</Name><EtherCAT PortABoxInfo="#x00ffffff"/>
    <Box Id="2"><Name>Junction (EK1122)</Name><EtherCAT PortABoxInfo="#x01000001"/></Box>
    <Box Id="7" Disabled="true"><Name>Spare (EL1008)</Name><EtherCAT PortABoxInfo="#x01000002"/></Box>
  </Box>
  <Box Id="3"><Name>Drive 1 (i550)</Name><EtherCAT PortABoxInfo="#x03000002"/></Box>
  <Box Id="4"><Name>Drive 2 (i550)</Name><EtherCAT PortABoxInfo="#x01000003"/></Box>
</Device></TcSmItem>`;
const net = parseIoTree({ '_Config/IO/Net.xti': NET });
const flat: { name: string; id?: number; slave?: number | null; portA?: { box?: number; port: number; master?: boolean }; disabled?: boolean }[] = [];
const walk = (bs: { boxes: unknown[] }[]) => bs.forEach((b) => (flat.push(b as (typeof flat)[number]), walk(b.boxes as { boxes: unknown[] }[])));
walk(net.devices[0].boxes);
const at = (n: string) => flat.find((b) => b.name.startsWith(n));
expect(at('Main')?.id === 1 && at('Main')?.slave === 0 && at('Main')?.portA?.master === true, `the coupler: on the master (${JSON.stringify(at('Main'))})`);
expect(at('Junction')?.portA?.box === 1 && at('Junction')?.portA?.port === 1 && at('Junction')?.slave === 1, `the junction: on the coupler's port B (${JSON.stringify(at('Junction')?.portA)})`);
expect(at('Spare')?.disabled === true && at('Spare')?.slave === null, `a disabled box: no place among the slaves (${at('Spare')?.slave})`);
expect(at('Drive 1')?.portA?.box === 2 && at('Drive 1')?.portA?.port === 3 && at('Drive 1')?.slave === 2 && at('Drive 2')?.portA?.box === 3 && at('Drive 2')?.slave === 3, `the drives: on the junction's port D, one after the other (${JSON.stringify([at('Drive 1')?.portA, at('Drive 2')?.portA])})`);
expect(portAOf('#x00ffffff')?.master === true && portAOf('junk') === null && JSON.stringify(portAOf('#x0200000c')) === '{"box":12,"port":2}', 'PortABoxInfo read');

// A project folder on this computer (offline): its .tsproj found one level down, its _Config's .xti files read
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-io-'));
fs.mkdirSync(path.join(dir, 'Line', '_Config', 'IO'), { recursive: true });
fs.writeFileSync(path.join(dir, 'Line', 'Line.tsproj'), '<TcSmProject/>');
fs.writeFileSync(path.join(dir, 'Line', '_Config', 'IO', 'Net.xti'), NET);
fs.writeFileSync(path.join(dir, 'Line', '_Config', 'IO', 'Net.xti.bak'), '<TcSmItem><Device RemoteName="Old"/></TcSmItem>');

// The EtherCAT master's states (shared/tcEcat.cjs): its state word (the low nibble; error flags), its link state
const op = describeState(8, 0);
const bad = describeState(0x14, 0x21);
expect(op.name === 'OP' && op.ok && bad.name === 'SAFEOP' && !bad.ok && bad.flags.join() === 'error' && bad.link.join() === 'not present' && bad.ports.join() === 'B', `describeState: ${op.name}; ${JSON.stringify(bad)}`);

(async () => {
  const off = await readIoFolder(dir);
  expect(!off.error && off.project === 'Line' && off.folder === path.join(dir, 'Line') && off.devices.length === 1 && off.devices[0].name === 'Net (EtherCAT)', `readIoFolder: ${off.error ?? `${off.project}: ${off.devices.map((d: { name: string }) => d.name).join()}`}`);
  expect(/No TwinCAT project/.test((await readIoFolder(os.tmpdir() + '/kss-no-such-folder')).error ?? ''), 'a folder without a .tsproj: said');
  fs.rmSync(dir, { recursive: true, force: true });
  // (Node's side: the same tree)
  expect(JSON.stringify(await parseIoTreeNode({ '_Config/IO/Net.xti': NET })) === JSON.stringify(net), 'tcIoTree.cjs: the same tree');
  // (each box: what the project says of its device; its EtherCAT address by default)
  expect(at('Main')?.address === 1001 && at('Drive 2')?.address === 1004, `addresses: ${at('Main')?.address}, ${at('Drive 2')?.address}`);
  // (only the connected PLC's own devices; IG 6: the count, IG 9: two bytes each, on port 0xFFFF at the device)
  const calls: string[] = [];
  const client = {
    async readRaw(ig: number, io: number, size: number, target: { amsNetId: string; adsPort: number }) {
      calls.push(`${ig}@${target.amsNetId}:${target.adsPort}`);
      if (ig === 6) return Buffer.from([2, 0]);
      // (the addresses; the CRC counters: 4 x UDINT a slave)
      if (ig === 7) return Buffer.from([0xe9, 0x03, 0xea, 0x03]);
      if (ig === 0x12) {
        const b = Buffer.alloc(32);
        b.writeUInt32LE(5, 16 + 4);
        return b;
      }
      return Buffer.from([8, 0, 2, 0x04]).subarray(0, size);
    },
  };
  const r = await readMasters(client, '5.6.7.8.1.1', ['5.6.7.8.2.1', '9.9.9.9.2.1']);
  const m = r.masters['5.6.7.8.2.1'];
  expect(m.count === 2 && m.slaves.map((x: { name: string }) => x.name).join() === 'OP,PREOP' && !m.slaves[1].ok && /Not a device/.test(r.masters['9.9.9.9.2.1'].error), `readMasters: ${JSON.stringify(r)}`);
  expect(calls.join() === `6@5.6.7.8.2.1:${0xffff},9@5.6.7.8.2.1:${0xffff},7@5.6.7.8.2.1:${0xffff},18@5.6.7.8.2.1:${0xffff}`, `asked: ${calls.join()}`);
  expect(m.slaves[0].address === 1001 && m.slaves[1].address === 1002 && m.slaves[1].crc.join() === '0,5,0,0', `the addresses and CRC counters: ${JSON.stringify(m.slaves.map((x: { address: number; crc: number[] }) => [x.address, x.crc]))}`);

  // The boxes' states: by address when every one is a box's (a box missing mid-chain does not shift the others)
  const dev = net.devices[0];
  const st = (name: string, address: number) => ({ index: 0, name, ok: name === 'OP', flags: [], link: [], ports: [], address });
  const byAddr = boxStates([dev], { masters: { '5.6.7.8.2.1': { count: 3, slaves: [st('OP', 1001), st('OP', 1003), st('SAFEOP', 1004)] } } }, () => undefined);
  const name = (n: string) => [...byAddr].find(([p]) => p.endsWith(n))?.[1]?.name;
  expect(name('Main (EK1200)') === 'OP' && name('Junction (EK1122)') === 'missing' && name('Drive 1 (i550)') === 'OP' && name('Drive 2 (i550)') === 'SAFEOP', `by address: ${JSON.stringify([...byAddr].map(([p, s]) => [p.split('^').pop(), s.name]))}`);
  const byOrder = boxStates([dev], { masters: { '5.6.7.8.2.1': { count: 2, slaves: [st('OP', 1), st('PREOP', 2)] } } }, () => undefined);
  expect([...byOrder].find(([p]) => p.endsWith('Junction (EK1122)'))?.[1]?.name === 'PREOP', 'addresses that are no box\'s: by order');
  // What changed between two reads: a state, CRC errors counted
  const names = new Map([...byAddr.keys()].map((p) => [p, p.split('^').pop()!]));
  const before = new Map([...byAddr].map(([p, s]) => [p, { ...s, crc: [0, 0, 0, 0] }]));
  const after = new Map([...before].map(([p, s]) => [p, p.endsWith('Drive 2 (i550)') ? { ...s, name: 'OP', ok: true } : p.endsWith('Main (EK1200)') ? { ...s, crc: [0, 3, 0, 0] } : s]));
  const evs = stateEvents(before, after, names, 1);
  expect(evs.length === 2 && evs.some((e) => e.kind === 'state' && e.ok && /Drive 2 \(i550\): SAFEOP → OP/.test(e.text)) && evs.some((e) => e.kind === 'crc' && /3 CRC errors on port B \(3 counted\)/.test(e.text)), `stateEvents: ${evs.map((e) => e.text).join(' | ')}`);
  expect(stateEvents(new Map(), byAddr, names).every((e) => !e.ok) && stateEvents(new Map(), byAddr, names).length === 2, 'the first read: only what is wrong');

  // TwinCAT's device descriptions (ESI): the family's file found, the device by its product code and revision
  const esi = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-esi-'));
  fs.writeFileSync(path.join(esi, 'Beckhoff EL1xxx.xml'), '<?xml version="1.0" encoding="ISO-8859-1"?><EtherCATInfo><Vendor><Id>2</Id><Name>Beckhoff Automation GmbH &amp; Co. KG</Name></Vendor><Descriptions><Groups><Group><Type>DigIn</Type><Name LcId="1033">Digital Input Terminals (EL1xxx)</Name></Group></Groups><Devices>'
    + '<Device Physics="YY"><Type ProductCode="#x03f03052" RevisionNo="#x00100000">EL1008</Type><Name LcId="1031"><![CDATA[EL1008 8K. Dig. Eingang]]></Name><Name LcId="1033"><![CDATA[EL1008 8Ch. Dig. Input 24V, 3ms]]></Name><URL LcId="1033"><![CDATA[http://www.beckhoff.com/EL1008]]></URL><GroupType>DigIn</GroupType></Device>'
    + '<Device Physics="YY"><Type ProductCode="#x03f03052" RevisionNo="#x00110000">EL1008</Type><Name LcId="1033"><![CDATA[EL1008 (rev 11)]]></Name><GroupType>DigIn</GroupType></Device>'
    + '</Devices></Descriptions></EtherCATInfo>');
  fs.writeFileSync(path.join(esi, 'Beckhoff EL19xx.xml'), '<EtherCATInfo><Descriptions><Devices></Devices></Descriptions></EtherCATInfo>');
  process.env.KSS_ESI_DIR = esi;
  expect(candidates(esi, 'EL1904').map((f: string) => path.basename(f)).join() === 'Beckhoff EL19xx.xml,Beckhoff EL1xxx.xml', 'the most specific family first');
  const d1 = findDevice({ type: 'EL1008 8Ch. Dig. Input', productCode: '#x03f03052', revision: '#x00100000' });
  expect(d1?.name === 'EL1008 8Ch. Dig. Input 24V, 3ms' && d1.group === 'Digital Input Terminals (EL1xxx)' && d1.vendor === 'Beckhoff Automation GmbH & Co. KG' && d1.url === 'https://www.beckhoff.com/EL1008' && d1.revision === 'same', `findDevice: ${JSON.stringify(d1)}`);
  expect(findDevice({ type: 'EL1008', productCode: '#x03f03052', revision: '#x00110000' })?.name === 'EL1008 (rev 11)', 'its revision');
  expect(findDevice({ type: 'EL1008', productCode: '#x03f03052', revision: '#x00990000' })?.revision === 'other' && findDevice({ type: 'EL2008', productCode: '#x07d83052' }) === null, 'another revision: the newest, said; not there: null');
  delete process.env.KSS_ESI_DIR;
  fs.rmSync(esi, { recursive: true, force: true });
  // The user's pictures: those named for the type (not those of a longer type's name)
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-docs-'));
  const pics = path.join(docs, 'Kval MachineScope', 'Devices');
  fs.mkdirSync(pics, { recursive: true });
  for (const f of ['EL1008.png', 'el1008 front.jpg', 'EL1008-back.webp', 'EL10080.png', 'EL1008.txt']) fs.writeFileSync(path.join(pics, f), 'x');
  const imgs = deviceImages(docs, 'EL1008');
  expect(imgs.map((i: { name: string }) => i.name).join() === 'EL1008-back.webp,EL1008.png,el1008 front.jpg' && imgs[1].dataUrl.startsWith('data:image/png;base64,'), `deviceImages: ${imgs.map((i: { name: string }) => i.name).join(', ')}`);
  expect(deviceImages(docs, '../x').length === 0, 'a name with a path: none');
  fs.rmSync(docs, { recursive: true, force: true });
  // Links: Beckhoff's product page (TwinCAT's own when known), its search, its manual; another vendor's: a web search
  const beck = deviceLinks({ name: 'T (EL6070-0033)', product: 'EL6070-0033', path: 'x', boxes: [], pdos: [], info: { type: 'EL6070-0033 1Ch. Licence key', vendorId: 2 } });
  expect(beck.map((l) => `${l.kind}=${l.url}`).join(' ') === 'product=https://www.beckhoff.com/el6070-0033 search=https://www.beckhoff.com/en-us/search-results/?q=EL6070-0033 manual=https://document.beckhoff.com/el6070.pdf?target=el6070&lang=en-us', `Beckhoff's links: ${beck.map((l) => l.url).join(' ')}`);
  // The front views' table: each type once, each contact in its grid once, a source each; found by the box's type
  const types = TERMINAL_FACES.map((f) => f.type);
  expect(new Set(types).size === types.length && types.length >= 23, `the fronts: ${types.length} types, each once`);
  const bad = TERMINAL_FACES.filter((f) => {
    const pos = f.contacts.map((c) => contactPos(c.n));
    return !f.source.length || new Set(pos).size !== pos.length || pos.some((p) => p < 1 || p > f.columns * f.rows) || f.leds.some((l) => l.at && (l.at[0] >= Math.max(1, f.ledColumns) || l.at[0] < 0));
  }).map((f) => f.type);
  expect(bad.length === 0, `each front's contacts within its grid, a source each (${bad.join(', ') || 'all fine'})`);
  expect(faceFor('ELM3142-0000')?.type === 'ELM3142-0000' && faceFor('EL6070-0033')?.type === 'EL6070-0033' && faceFor('EL9227-5500')?.rows === 4 && faceFor('EL7041') === null, 'faceFor: by the type, a variant\'s own');
  expect(faceOf({ name: 'SI (EL1904)', product: 'EL1904', path: 'x', boxes: [], pdos: [], info: { type: 'EL1904, 4 Ch. Safety Input 24V, TwinSAFE' } })?.type === 'EL1904' && contactPos("3'") === 11 && contactPos(16) === 16, 'faceOf: a TwinSAFE terminal\'s; a second block\'s contact');
  // (the drives' and other vendors' fronts: by their base type)
  expect(faceFor('AX5106-0000-0203')?.type === 'AX5106' && faceFor('AX8206-0000-0105')?.type === 'AX8206' && faceFor('EX260-SEC3')?.type === 'EX260-SEC3' && faceOf({ name: 'Feed (Inverter i550 Cabinet)', product: 'x', path: 'x', boxes: [], pdos: [], info: { type: 'i550 Inverter FW V05.02.xx' } })?.type === 'i550', 'faceFor: a variant down to its base type; the i550 by its type\'s first word');

  // A project that keeps its I/O in its .tsproj (no _Config\IO): found there; a device kept in an .xti (File=): not twice
  const TSPROJ = `<?xml version="1.0"?><TcSmProject><Project><Io><Device File="Other (EtherCAT).xti" Id="2"/><Device Id="1" AmsNetId="5.6.7.8.3.1" RemoteName="Inline (EtherCAT)"><Name>Inline (EtherCAT)</Name><Box Id="1"><Name>K (EK1100)</Name><EtherCAT Type="EK1100" PortABoxInfo="#x00ffffff"/></Box></Device></Io></Project></TcSmProject>`;
  const inline = parseIoTree({ 'Line.tsproj': TSPROJ });
  expect(inline.devices.map((d: { name: string }) => d.name).join() === 'Inline (EtherCAT)' && inline.devices[0].boxes[0].product === 'EK1100', `the .tsproj's own I/O: ${JSON.stringify(inline.devices.map((d: { name: string }) => d.name))}`);

  // The PLC's I/O and the project's compared: a box added, one missing, another revision, cabled elsewhere
  const mk = (boxes: object[]) => ({ devices: [{ name: 'D', netId: null, boxes }], links: [] });
  const bx = (id: number, name: string, extra: object = {}) => ({ name, product: '', path: `D^${name}`, id, boxes: [], pdos: [], info: { type: name.split(' ')[0], productCode: '#x1', revision: '#x10' }, portA: { master: true, port: 0 }, ...extra });
  const diffs = compareIoTrees(
    mk([bx(1, 'EK1100 K'), bx(2, 'EL1008 A', { portA: { box: 1, port: 1 } }), bx(3, 'EL2008 B', { info: { type: 'EL2008', productCode: '#x1', revision: '#x11' } }), bx(4, 'EL9410 P')]) as never,
    mk([bx(1, 'EK1100 K'), bx(2, 'EL1008 A', { portA: { box: 1, port: 3 } }), bx(3, 'EL2008 B'), bx(5, 'EL1088 Q')]) as never
  );
  expect(diffs.map((d) => d.kind).join() === 'cabling,device,only-plc,only-project' && /revision #x11 on the PLC, #x10 in the project/.test(diffs[1].text) && /port B on the PLC.*port D in the project/.test(diffs[0].text), `compareIoTrees: ${diffs.map((d) => d.text).join(' | ')}`);
  expect(compareIoTrees(mk([bx(1, 'EK1100 K')]) as never, mk([bx(1, 'EK1100 K')]) as never).length === 0, 'the same: no differences');

  // A state's time; a device's events in the last hour
  expect([5e3, 192e3, 2 * 3600e3 + 5 * 60e3, 3 * 86400e3 + 3600e3].map(durationText).join(' | ') === '5 s | 3 min 12 s | 2 h 05 min | 3 d 1 h', `durationText: ${[5e3, 192e3, 2 * 3600e3 + 5 * 60e3, 3 * 86400e3 + 3600e3].map(durationText).join(' | ')}`);
  const now = 10 * 3600e3;
  const evAt = (at: number, path: string) => ({ at, path, box: 'b', kind: 'state' as const, text: '', ok: false });
  expect(recentEventsOf([evAt(now - 60e3, 'Line^T1'), evAt(now - 2 * 3600e3, 'Line^T2'), evAt(now - 60e3, 'Other^T1'), evAt(now - 60e3, 'Line2^T1')], 'Line', now).length === 1, 'the last hour, this device only');
  // (a TwinSAFE terminal's type: "EL1904, 4 Ch. Safety Input" -> EL1904)
  const safe = deviceLinks({ name: 'SI (EL1904)', product: 'EL1904', path: 'x', boxes: [], pdos: [], info: { type: 'EL1904, 4 Ch. Safety Input 24V, TwinSAFE', vendorId: 2 } });
  expect(safe[0].url === 'https://www.beckhoff.com/el1904' && safe[2].url.startsWith('https://document.beckhoff.com/el1904.pdf'), `a TwinSAFE terminal's links: ${safe.map((l) => l.url).join(' ')}`);
  const lenze = deviceLinks({ name: 'Feed (Inverter i550 Cabinet)', product: 'Inverter i550 Cabinet', path: 'x', boxes: [], pdos: [], info: { type: 'i550 Inverter FW V05.02.xx', vendorId: 0x3b, supplier: 'Lenze i550' } });
  expect(lenze.length === 1 && lenze[0].kind === 'web' && /q=Lenze%20i550%20i550%20Inverter/.test(lenze[0].url), `another vendor: ${lenze.map((l) => l.url).join(' ')}`);
  const failing = await readEcatStates({ async readRaw() { throw Object.assign(new Error('x'), { adsError: { errorStr: 'Target port not found' } }); } }, '5.6.7.8.2.1');
  expect(/Target port not found \(the EtherCAT master at 5\.6\.7\.8\.2\.1\)/.test(failing.error ?? ''), `no master answering: ${failing.error}`);

  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();

