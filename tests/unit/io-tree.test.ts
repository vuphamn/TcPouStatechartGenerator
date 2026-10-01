// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The PLC's I/O tree (shared/tcIoTree.cjs): an EtherCAT device's boxes nested as wired (EK1200 > EK1100 > EL1008),
// their PDOs and entries; the PLC instance's links (InputDst / OutputSrc) put on their entries
const { parseIoTree } = require('../../shared/tcIoTree.cjs');

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

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
