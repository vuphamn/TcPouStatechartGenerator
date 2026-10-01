// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The PLC's I/O tree (shared/tcIoTree.cjs): an EtherCAT device's boxes nested as wired (EK1200 > EK1100 > EL1008),
// their PDOs and entries; the PLC instance's links (InputDst / OutputSrc) put on their entries
const { parseIoTree, readIoFolder, portAOf } = require('../../shared/tcIoTree.cjs');
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
const off = readIoFolder(dir);
expect(!off.error && off.project === 'Line' && off.folder === path.join(dir, 'Line') && off.devices.length === 1 && off.devices[0].name === 'Net (EtherCAT)', `readIoFolder: ${off.error ?? `${off.project}: ${off.devices.map((d: { name: string }) => d.name).join()}`}`);
expect(/No TwinCAT project/.test(readIoFolder(os.tmpdir() + '/kss-no-such-folder').error ?? ''), 'a folder without a .tsproj: said');
fs.rmSync(dir, { recursive: true, force: true });

// The EtherCAT master's states (shared/tcEcat.cjs): its state word (the low nibble; error flags), its link state
const op = describeState(8, 0);
const bad = describeState(0x14, 0x21);
expect(op.name === 'OP' && op.ok && bad.name === 'SAFEOP' && !bad.ok && bad.flags.join() === 'error' && bad.link.join() === 'not present' && bad.ports.join() === 'B', `describeState: ${op.name}; ${JSON.stringify(bad)}`);

(async () => {
  // (only the connected PLC's own devices; IG 6: the count, IG 9: two bytes each, on port 0xFFFF at the device)
  const calls: string[] = [];
  const client = {
    async readRaw(ig: number, io: number, size: number, target: { amsNetId: string; adsPort: number }) {
      calls.push(`${ig}@${target.amsNetId}:${target.adsPort}`);
      if (ig === 6) return Buffer.from([2, 0]);
      return Buffer.from([8, 0, 2, 0x04]).subarray(0, size);
    },
  };
  const r = await readMasters(client, '5.6.7.8.1.1', ['5.6.7.8.2.1', '9.9.9.9.2.1']);
  const m = r.masters['5.6.7.8.2.1'];
  expect(m.count === 2 && m.slaves.map((x: { name: string }) => x.name).join() === 'OP,PREOP' && !m.slaves[1].ok && /Not a device/.test(r.masters['9.9.9.9.2.1'].error), `readMasters: ${JSON.stringify(r)}`);
  expect(calls.join() === `6@5.6.7.8.2.1:${0xffff},9@5.6.7.8.2.1:${0xffff}`, `asked: ${calls.join()}`);
  const failing = await readEcatStates({ async readRaw() { throw Object.assign(new Error('x'), { adsError: { errorStr: 'Target port not found' } }); } }, '5.6.7.8.2.1');
  expect(/Target port not found \(the EtherCAT master at 5\.6\.7\.8\.2\.1\)/.test(failing.error ?? ''), `no master answering: ${failing.error}`);

  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();

