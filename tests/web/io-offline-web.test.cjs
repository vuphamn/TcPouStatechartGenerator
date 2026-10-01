// The I/O tab offline in the browser (no PLC): From project reads a TwinCAT project folder chosen (the picker stubbed
// with a folder in memory: its .tsproj one level down, its _Config's .xti files), parsed by the same module as on the
// desktop; the tree, the network and a box's properties (the project's details, its links)
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const IO = `<?xml version="1.0"?>
<TcSmItem><Device Id="1" AmsNetId="5.6.7.8.2.1" RemoteName="Line (EtherCAT)"><Name>__FILENAME__</Name>
  <Box Id="1"><Name>Main (EK1100)</Name><EtherCAT VendorId="#x00000002" ProductCode="#x044c2c52" RevisionNo="#x00120000" Type="EK1100 EtherCAT Coupler (2A E-Bus)" Desc="EK1100" PortABoxInfo="#x00ffffff"/>
    <Box Id="2"><Name>Inputs (EL1008)</Name><EtherCAT VendorId="#x00000002" ProductCode="#x03f03052" RevisionNo="#x00110000" Type="EL1008 8Ch. Dig. Input 24V, 3ms" Desc="EL1008" PortABoxInfo="#x01000001"><Pdo Name="Channel 1" Index="#x1a00"><Entry Name="Input" Index="#x6000" Sub="#x01"><Type>BIT</Type></Entry></Pdo></EtherCAT></Box>
  </Box>
  <Box Id="3"><Name>Feed (Inverter i550 Cabinet)</Name><EtherCAT VendorId="#x0000003b" ProductCode="#x69055000" Type="i550 Inverter FW V05.02.xx" Desc="Inverter i550 Cabinet" PortABoxInfo="#x02000002"><SuName>Lenze i550</SuName></EtherCAT></Box>
</Device></TcSmItem>`;
const PLC = `<?xml version="1.0"?>
<TcSmItem><Mappings><OwnerA Name="InputDst"><OwnerB Name="TIID^Line (EtherCAT)^Main (EK1100)^Inputs (EL1008)"><Link VarA="MAIN.bStart" TypeA="BOOL" VarB="Channel 1^Input"/></OwnerB></OwnerA></Mappings></TcSmItem>`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  // The folder the picker gives: Lines/Line.tsproj, Lines/_Config/IO/Line (EtherCAT).xti, …/PLC/Plant/Plant Instance.xti
  await p.evaluate((io, plc) => {
    const file = (name, text) => ({ kind: 'file', name, getFile: async () => new File([text], name) });
    const dir = (name, entries) => ({ kind: 'directory', name, values: async function* () { for (const e of entries) yield e; } });
    const root = dir('Machines', [file('readme.txt', 'x'), dir('Lines', [file('Line.tsproj', '<TcSmProject/>'), dir('_Config', [dir('IO', [file('Line (EtherCAT).xti', io), file('Line (EtherCAT).xti.bak', 'old')]), dir('PLC', [dir('Plant', [file('Plant Instance.xti', plc)])])])])]);
    window.showDirectoryPicker = async () => root;
  }, IO, PLC);
  await p.evaluate(() => document.getElementById('dock-tab-io')?.click());
  await h.sleep(500);
  expect(!!(await p.$('#io-tree-load-folder')), 'From project: offered in the browser (it can choose a folder)');
  await p.click('#io-tree-load-folder').catch(() => {});
  await p.waitForSelector('[data-io-device]', { timeout: 10000 }).catch(() => {});
  await p.type('#io-tree-filter', 'bStart').catch(() => {});
  await h.sleep(400);
  const tree = await p.evaluate(() => ({
    devices: [...document.querySelectorAll('[data-io-device]')].map((d) => d.getAttribute('data-io-device')),
    entry: !!document.querySelector('[data-io-entry$="Inputs (EL1008)^Channel 1^Input"]'),
    note: document.querySelector('#io-tree-panel')?.textContent.match(/Line · offline, from the project folder/)?.[0] ?? null,
    error: document.getElementById('io-tree-error')?.textContent ?? null,
  }));
  expect(tree.devices.join() === 'Line (EtherCAT)' && tree.entry && !!tree.note && !tree.error, `offline: the project's I/O (${JSON.stringify(tree)})`);
  // The network: three boxes, cabled; a box's properties from the project (no Link: no device files, no pictures)
  await p.click('#io-view-network');
  await p.waitForSelector('#io-network [data-io-node]', { timeout: 5000 }).catch(() => {});
  const nodes = await p.$$eval('#io-network [data-io-node]', (n) => n.map((x) => `${x.getAttribute('data-io-node').split('^').pop()}:${x.getAttribute('data-state')}`));
  expect(nodes.length === 3 && nodes.every((n) => n.endsWith(':unknown')), `the network offline: ${nodes.join(', ')}`);
  await p.click('#io-network [data-io-node$="Feed (Inverter i550 Cabinet)"]', { button: 'right' }).catch(() => {});
  await p.waitForSelector('#io-box-props', { timeout: 3000 }).catch(() => {});
  const props = await p.evaluate(() => {
    const el = document.getElementById('io-box-props');
    const v = (k) => { const r = el?.querySelector(`[data-io-prop="${k}"]`); return (r?.children.length > 1 ? r.lastElementChild : r)?.textContent.trim() ?? null; };
    return el ? { name: v('name'), vendor: v('vendor'), port: v('port-a'), links: [...el.querySelectorAll('[data-io-link]')].map((l) => `${l.getAttribute('data-io-link')}=${l.getAttribute('href')}`), pictures: document.getElementById('io-box-props-no-images')?.textContent ?? '', source: document.getElementById('io-box-props-source')?.textContent ?? '' } : null;
  });
  expect(props?.name === 'i550 Inverter FW V05.02.xx' && props.vendor === 'Lenze' && /Inputs, port C/.test(props.port ?? ''), `a Lenze drive's properties: ${JSON.stringify(props)}`);
  expect(props?.links.length === 1 && /^web=https:\/\/www\.google\.com\/search\?q=Lenze%20i550%20i550%20Inverter/.test(props.links[0]) && /desktop app, or through Link/.test(props.pictures) && /From the project/.test(props.source), `another vendor's link; pictures and device files: said where (${JSON.stringify(props)})`);
  await p.screenshot({ path: h.out('io-offline-web.png') });

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
