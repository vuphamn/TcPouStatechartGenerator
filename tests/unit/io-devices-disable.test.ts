// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The VS Code Solution view's I/O (vscode-extension/ioTree.cjs): the devices and their boxes read from the .tsproj
// (inline, or a device in its own _Config/IO/*.xti), nested as on the bus; disabled ones and their children; Disable /
// Enable: Disabled="true" put in or taken out of that element only (the rest of the file byte for byte as it was)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readIoTree, setDisabled } = require('../../vscode-extension/ioTree.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
type N = { kind: string; id: string; name: string; disabled: boolean; parentDisabled: string | null; children: N[]; file: string; missing?: string };
const flat = (ns: N[], d = 0): string[] => ns.flatMap((n) => [`${'  '.repeat(d)}${n.kind}#${n.id} ${n.name}${n.disabled ? ' [off]' : n.parentDisabled ? ` [with ${n.parentDisabled}]` : ''}`, ...flat(n.children, d + 1)]);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-io-'));
try {
  // ---- A device in its own .xti (BOM, CRLF), its boxes nested; a drive's device inside a box (no Id); &amp;
  fs.mkdirSync(path.join(dir, 'A', '_Config', 'IO'), { recursive: true });
  const tsprojA = path.join(dir, 'A', 'A.tsproj');
  fs.writeFileSync(tsprojA, '\uFEFF<?xml version="1.0"?>\r\n<TcSmProject>\r\n\t<Project>\r\n\t\t<Io>\r\n\t\t\t<Device File="Variable Storage (NOV-DP-RAM).xti" Id="6"/>\r\n\t\t\t<Device File="Main EtherCAT Port (EtherCAT).xti" Id="1"/>\r\n\t\t\t<Device File="Gone (EtherCAT).xti" Id="9"/>\r\n\t\t</Io>\r\n\t</Project>\r\n</TcSmProject>\r\n');
  fs.writeFileSync(path.join(dir, 'A', '_Config', 'IO', 'Variable Storage (NOV-DP-RAM).xti'), '\uFEFF<TcSmItem>\r\n\t<Device Id="6" Disabled="true" DevType="121">\r\n\t\t<Name>__FILENAME__</Name>\r\n\t\t<Box Id="48" BoxType="9104"><Name>Retain Handler</Name></Box>\r\n\t</Device>\r\n</TcSmItem>\r\n');
  const xti = path.join(dir, 'A', '_Config', 'IO', 'Main EtherCAT Port (EtherCAT).xti');
  const xtiText = '\uFEFF<TcSmItem>\r\n\t<Device Id="1" DevType="111" DevFlags="#x0003">\r\n\t\t<Name>__FILENAME__</Name>\r\n\t\t<Box Id="1" BoxType="9099">\r\n\t\t\t<Name>Main (EK1200)</Name>\r\n\t\t\t<EtherCAT><Pdo><Name>Channel 1</Name></Pdo></EtherCAT>\r\n\t\t\t<Box Id="2" BoxType="9099"><Name>I-0000 to I-0007 (EL1088)</Name></Box>\r\n\t\t\t<Box Id="13" BoxType="9099">\r\n\t\t\t\t<Name>Machine I/O, VFD&apos;s, &amp; Servo&apos;s (EK1122)</Name>\r\n\t\t\t\t<Box Id="24" Disabled="true" BoxType="9099">\r\n\t\t\t\t\t<Name>Servo Supply 1 (AX8640)</Name>\r\n\t\t\t\t\t<Box Id="25" BoxType="9099">\r\n\t\t\t\t\t\t<Name>Hinge X (AX8206)</Name>\r\n\t\t\t\t\t\t<Device><Name>DMInverterTypeDevice</Name><Box><Name>inner</Name></Box></Device>\r\n\t\t\t\t\t</Box>\r\n\t\t\t\t</Box>\r\n\t\t\t\t<Box Id="30" BoxType="9099"/>\r\n\t\t\t</Box>\r\n\t\t</Box>\r\n\t</Device>\r\n</TcSmItem>\r\n';
  fs.writeFileSync(xti, xtiText);
  const a = readIoTree(tsprojA) as N[];
  const shown = flat(a).join('\n');
  expect(
    shown ===
      [
        'device#6 Variable Storage (NOV-DP-RAM) [off]',
        '  box#48 Retain Handler [with Variable Storage (NOV-DP-RAM)]',
        'device#1 Main EtherCAT Port (EtherCAT)',
        '  box#1 Main (EK1200)',
        '    box#2 I-0000 to I-0007 (EL1088)',
        "    box#13 Machine I/O, VFD's, & Servo's (EK1122)",
        '      box#24 Servo Supply 1 (AX8640) [off]',
        '        box#25 Hinge X (AX8206) [with Servo Supply 1 (AX8640)]',
        '      box#30 Box 30',
        'device#9 Gone (EtherCAT)',
      ].join('\n'),
    `the tree, as XAE shows it:\n${shown}`
  );
  expect(a[0].file.endsWith('Variable Storage (NOV-DP-RAM).xti') && a[1].children[0].file === xti && !!a[2].missing, "each from its device's file; a missing file: said");

  // ---- Disable a box, enable it again: only its start tag changed
  let r = setDisabled(xti, 'box', '2', true);
  const after = fs.readFileSync(xti, 'utf8');
  expect(r.ok && r.changed && after === xtiText.replace('<Box Id="2" BoxType="9099">', '<Box Id="2" Disabled="true" BoxType="9099">'), 'Disable: Disabled="true" after its Id, nothing else (BOM, CRLF kept)');
  expect(readIoTree(tsprojA)[1].children[0].children[0].disabled === true, 'read back: disabled');
  r = setDisabled(xti, 'box', '2', true);
  expect(r.ok && !r.changed, 'disabled again: nothing to change');
  r = setDisabled(xti, 'box', '2', false);
  expect(r.ok && r.changed && fs.readFileSync(xti, 'utf8') === xtiText, 'Enable: the file as it was');
  r = setDisabled(xti, 'box', '24', false);
  expect(r.ok && /<Box Id="24" BoxType="9099">/.test(fs.readFileSync(xti, 'utf8')), 'a disabled box enabled');
  r = setDisabled(xti, 'device', '1', true);
  expect(r.ok && /<Device Id="1" Disabled="true" DevType="111"/.test(fs.readFileSync(xti, 'utf8')) && readIoTree(tsprojA)[1].children[0].parentDisabled === 'Main EtherCAT Port (EtherCAT)', 'a device disabled: its boxes with it');
  expect(!setDisabled(xti, 'box', '99', true).ok && /not found/.test(setDisabled(xti, 'box', '99', true).error), 'an unknown one: said, nothing written');

  // ---- Devices inline in the .tsproj (no own files)
  const tsprojB = path.join(dir, 'B.tsproj');
  fs.writeFileSync(tsprojB, '<TcSmProject><Project><Io>\n<Device Id="1" DevType="111"><Name>Main EtherCAT Port (CX9020) (EtherCAT)</Name>\n<Box Id="7" Disabled="true" BoxType="9099"><Name>I-0030 (EL1088)</Name></Box>\n<Box Id="8" BoxType="9099"><Name>I-0040 (EL1088)</Name></Box>\n</Device>\n<Device Id="4" DevType="121"><Name>Variable Storage</Name></Device>\n</Io></Project></TcSmProject>\n');
  const b = readIoTree(tsprojB) as N[];
  expect(flat(b).join('|') === 'device#1 Main EtherCAT Port (CX9020) (EtherCAT)|  box#7 I-0030 (EL1088) [off]|  box#8 I-0040 (EL1088)|device#4 Variable Storage' && b[0].file === tsprojB, 'inline devices: read from the .tsproj');
  expect(setDisabled(tsprojB, 'box', '8', true).ok && setDisabled(tsprojB, 'box', '7', false).ok && flat(readIoTree(tsprojB)).join('|') === 'device#1 Main EtherCAT Port (CX9020) (EtherCAT)|  box#7 I-0030 (EL1088)|  box#8 I-0040 (EL1088) [off]|device#4 Variable Storage', 'inline: disabled and enabled in the .tsproj');
  fs.writeFileSync(path.join(dir, 'C.tsproj'), '<TcSmProject/>');
  expect(JSON.stringify(readIoTree(path.join(dir, 'C.tsproj'))) === '[]', 'no <Io>: none');

  // ---- A real project (this computer's machines, when there): read; toggled on a copy only
  const real = 'C:/dev/working/machines/202_dev/202/Beckhoff/Commander_3';
  if (fs.existsSync(path.join(real, 'Commander_3.tsproj'))) {
    const copy = path.join(dir, 'Commander_3');
    fs.mkdirSync(path.join(copy, '_Config', 'IO'), { recursive: true });
    fs.copyFileSync(path.join(real, 'Commander_3.tsproj'), path.join(copy, 'Commander_3.tsproj'));
    for (const f of fs.readdirSync(path.join(real, '_Config', 'IO')).filter((x) => /\.xti$/i.test(x))) fs.copyFileSync(path.join(real, '_Config', 'IO', f), path.join(copy, '_Config', 'IO', f));
    const t = readIoTree(path.join(copy, 'Commander_3.tsproj')) as N[];
    const ecat = t.find((d) => /EtherCAT/.test(d.name));
    const count = (n: N): number => 1 + n.children.reduce((s, c) => s + count(c), 0);
    expect(!!ecat && t.length === 2 && count(ecat) > 40 && ecat.children[0].name === 'Main (EK1200)', `Commander_3 (a copy): ${t.map((d) => `${d.name}${d.disabled ? ' [off]' : ''}`).join(', ')}; ${ecat ? count(ecat) - 1 : 0} boxes`);
    const before = fs.readFileSync(ecat!.file, 'utf8');
    expect(setDisabled(ecat!.file, 'device', ecat!.id, !ecat!.disabled).ok && setDisabled(ecat!.file, 'device', ecat!.id, ecat!.disabled).ok && fs.readFileSync(ecat!.file, 'utf8') === before, 'toggled twice on the copy: byte for byte as it was');
  } else console.log('-    (no machines folder here: the real project part skipped)');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
