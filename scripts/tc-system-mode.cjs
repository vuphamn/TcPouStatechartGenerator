// The local TwinCAT system's mode (ADS port 10000): `node scripts/tc-system-mode.cjs` prints it (Run, Config, ...);
// `node scripts/tc-system-mode.cjs config` switches it to Config and waits up to 20 s for it (the nightly real-PLC run
// puts it back as it found it). Exit code 0: done; 1: not reachable or not switched.
const { Client } = require('ads-client');

const target = { targetAmsNetId: '127.0.0.1.1.1', targetAdsPort: 10000, rawClient: true, autoReconnect: false };

async function mode() {
  const c = new Client(target);
  try {
    await c.connect();
    return (await c.readState()).adsStateStr;
  } finally {
    await c.disconnect().catch(() => {});
  }
}

(async () => {
  try {
    if (process.argv[2] !== 'config') {
      console.log(await mode());
      process.exit(0);
    }
    if ((await mode()) === 'Config') {
      console.log('Config');
      process.exit(0);
    }
    // (a raw client: port 10000 is TwinCAT's system service, no PLC runtime)
    const c = new Client(target);
    await c.connect();
    await c.setTcSystemToConfig();
    await c.disconnect().catch(() => {});
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const now = await mode().catch(() => null);
      if (now === 'Config') {
        console.log('Config');
        process.exit(0);
      }
    }
    console.error('TwinCAT did not switch to Config within 20 s');
    process.exit(1);
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
})();
