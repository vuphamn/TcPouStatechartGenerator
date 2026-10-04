// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The connection check's last word on the PLC itself, once it answers: Run, nothing to add; Stop, a hint (its values
// frozen); Invalid (its runtime there, no program loaded: a PLC that is not started, or whose license ran out) or
// another state, a failing step: no more "All good: go live" for a PLC with nothing to go live on. This computer's
// TwinCAT not running (its router closed): a step, with why from Windows' log in words (an incomplete install, a
// license that could not be read); running, or no TwinCAT here: none
/* eslint-disable @typescript-eslint/no-require-imports */
const { plcStateStep, explainTwinCatError, localTwinCatStep } = require('../../shared/tcCheck.cjs');
const { localTwinCatNetId } = require('../../shared/liveSession.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

expect(plcStateStep('Run', 851) === null, 'Run: nothing to add');
const stop = plcStateStep('Stop', 851);
expect(stop?.id === 'plc' && stop.ok === null && /stopped/.test(stop.title) && /frozen/.test(stop.detail), `Stop: a hint (${stop?.title})`);
const invalid = plcStateStep('Invalid', 851);
expect(invalid?.ok === false && /runs no program \(state: Invalid\)/.test(invalid.title) && /Login/.test(invalid.detail) && /license/.test(invalid.detail), `Invalid: failing (${invalid?.title})`);
const other = plcStateStep('Init', 852);
expect(other?.ok === false && /port 852/.test(other.title), `another state: failing, its port said (${other?.title})`);
expect(plcStateStep('', 851)?.ok === false && /unknown/.test(plcStateStep('', 851)!.title), 'no state: failing, said unknown');

// Why TwinCAT here did not start, in words
const xml = explainTwinCatError('Error creating XML DOM for init commands! Error message >> Error while parsing XML-File C:\\Program Files (x86)\\Beckhoff\\TwinCAT\\3.1\\Target\\DefaultConfig.xml at Offset 0:\nFile was not found <<');
expect(/incomplete/.test(xml) && /Repair/.test(xml) && /DefaultConfig/.test(xml), `DefaultConfig.xml missing: an incomplete install, repair it (${xml.slice(0, 70)}…)`);
const lic = explainTwinCatError('Init42\\CacheLicenseResponses: caching license response file(s) from Beckhoff License Terminal (EL6070-0033) >> AdsWarning: 1861 (0x745, ADS ERROR: timeout elapsed)');
expect(/license/.test(lic) && /Config mode/.test(lic), `a license not read: plug it in, or Config mode (${lic.slice(0, 70)}…)`);
expect(/Windows' log says: "Something else"/.test(explainTwinCatError('Something else\nmore')), 'anything else: its first line');
expect(explainTwinCatError('') === '', 'nothing logged: nothing said');

void (async () => {
  if (localTwinCatNetId()) {
    const down = await localTwinCatStep({ check: async () => false, errors: async () => 'File DefaultConfig.xml was not found' });
    expect(down?.id === 'localTwinCat' && down.ok === null && /not running/.test(down.title) && /incomplete/.test(down.detail) && /connects straight/.test(down.detail), `its router closed: said, with why (${down?.title})`);
    expect((await localTwinCatStep({ check: async () => true, errors: async () => 'x' })) === null, 'its router answers: nothing to say');
  } else console.log('(no TwinCAT on this computer: the local step not tried)');
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
