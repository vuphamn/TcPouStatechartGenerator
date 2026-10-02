// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Which XAE builds and writes for a PLC (shared/tcBuild.cjs): the PLC's TwinCAT build read from its system service
// (device info, port 10000), then the XAE of that build when it is installed (4024.x: 4024's TcXaeShell, 4026.x:
// 4026's), else the one there is, with a note why; KSS_XAE_PROGID: that one always
/* eslint-disable @typescript-eslint/no-require-imports */
const { xaeForTarget, targetBuildOf } = require('../../shared/tcBuild.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  process.env.KSS_BUILD_DRYRUN = '1';
  const X26 = 'TcXaeShell.DTE.17.0';
  const X24 = 'TcXaeShell.DTE.15.0';
  const pick = (installed: string, build: number | null) => {
    process.env.KSS_XAE_INSTALLED = installed;
    return xaeForTarget(build);
  };

  // Both XAEs here: each PLC on its own build's
  let r = pick(`${X26},${X24}`, 4024);
  expect(r.progId === X24 && !r.note, `a 4024.59 PLC, both XAEs here: 4024's (${r.progId})`);
  r = pick(`${X26},${X24}`, 4026);
  expect(r.progId === X26 && !r.note, `a 4026 PLC, both XAEs here: 4026's (${r.progId})`);
  r = pick(`${X26},${X24}`, 4022);
  expect(r.progId === X24 && !r.note, `a 4022 PLC: the older XAE, 4024's (${r.progId})`);
  // Only one: it, said why
  r = pick(X26, 4024);
  expect(r.progId === X26 && /3\.1\.4024/.test(r.note ?? '') && /newer format/.test(r.note ?? '') && /4024's XAE/.test(r.note ?? ''), `a 4024 PLC, only 4026's XAE: it, with a note (${r.note})`);
  r = pick(X24, 4026);
  expect(r.progId === X24 && /older than the PLC's runtime/.test(r.note ?? ''), `a 4026 PLC, only 4024's XAE: it, with a note (${r.note})`);
  // The PLC's build not known: the first one there, nothing said
  r = pick(`${X24}`, null);
  expect(r.progId === X24 && !r.note, `the build not known: the XAE there (${r.progId})`);
  // KSS_XAE_PROGID: that one
  process.env.KSS_XAE_PROGID = X26;
  r = pick(`${X26},${X24}`, 4024);
  expect(r.progId === X26 && !r.note, `KSS_XAE_PROGID: that one (${r.progId})`);
  delete process.env.KSS_XAE_PROGID;

  // TwinCAT 4024 here with its 64-bit TcXaeShell (a Visual Studio 2022 shell, the same ProgID as 4026's): a 4024 one
  process.env.KSS_LOCAL_TC_BUILD = '4024';
  r = pick(X26, 4024);
  expect(r.progId === X26 && r.xaeBuild === 4024 && !r.note, `4024's 64-bit TcXaeShell, a 4024 PLC: it, nothing said (${JSON.stringify(r)})`);
  r = pick(`${X26},${X24}`, 4024);
  expect(r.progId === X26 && !r.note, `4024's 64-bit and 32-bit shells, a 4024 PLC: the 64-bit one (${r.progId})`);
  r = pick(X26, 4026);
  expect(r.progId === X26 && /older than the PLC's runtime/.test(r.note ?? ''), `4024's 64-bit shell, a 4026 PLC: it, with a note (${r.note})`);
  delete process.env.KSS_LOCAL_TC_BUILD;

  // The PLC's build: its system service's device info
  let asked: { amsNetId?: string; adsPort?: number } | null = null;
  const plc = (major: number, minor: number, build: number) => ({ readDeviceInfo: async (t: { amsNetId?: string; adsPort?: number }) => { asked = t; return { majorVersion: major, minorVersion: minor, versionBuild: build, deviceName: 'TwinCAT System' }; } });
  expect((await targetBuildOf(plc(3, 1, 4024), '5.1.2.3.1.1')) === 4024 && asked?.adsPort === 10000 && asked?.amsNetId === '5.1.2.3.1.1', `read from port 10000 of the PLC: 4024 (${JSON.stringify(asked)})`);
  expect((await targetBuildOf(plc(2, 11, 2300), '')) === null, 'TwinCAT 2: not a build of 3.1');
  expect((await targetBuildOf({ readDeviceInfo: async () => { throw new Error('timeout'); } }, '')) === null, 'no answer: not known');
  expect((await targetBuildOf({}, '')) === null && (await targetBuildOf(null, '')) === null, 'no client: not known');

  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
