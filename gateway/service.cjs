// Run at startup (Windows): the gateway as a scheduled task that starts when the computer starts (as SYSTEM, before
// anyone signs in), is started again when it stops, and has no time limit. Installed, removed and started from the
// setup page (it needs an administrator: the gateway itself must run elevated to change it). Node.js programs are
// not Windows services themselves, and a task needs no extra service wrapper.
// KSS_SERVICE_DRYRUN=1: the commands are returned, not run (the tests).
const { execFile, spawn } = require('child_process');
const path = require('path');

const TASK = 'Kval MachineScope gateway';
const dry = () => process.env.KSS_SERVICE_DRYRUN === '1';

const run = (cmd, args) =>
  new Promise((resolve) => {
    if (dry()) return resolve({ code: 0, out: '', err: '', dry: [cmd, ...args].join(' ') });
    execFile(cmd, args, { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, out: String(stdout), err: String(stderr) }));
  });

// (a PowerShell string: single quotes doubled)
const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;

function createService({ configPath, log, audit }) {
  const script = path.join(__dirname, 'gateway.cjs');
  const node = process.execPath;
  const isWindows = process.platform === 'win32';

  async function elevated() {
    if (!isWindows) return false;
    if (dry()) return true;
    const r = await run('net', ['session']);
    return r.code === 0;
  }

  return {
    async status() {
      if (!isWindows) return { supported: false, message: 'Only on Windows (elsewhere: a systemd unit or your usual service manager)' };
      const r = await run('schtasks', ['/Query', '/TN', TASK, '/FO', 'LIST', '/V']);
      if (r.dry) return { supported: true, installed: false, elevated: true, dry: r.dry };
      const installed = r.code === 0;
      const status = /Status:\s*(.+)/i.exec(r.out)?.[1]?.trim() ?? null;
      const runs = /Task To Run:\s*(.+)/i.exec(r.out)?.[1]?.trim() ?? null;
      return { supported: true, installed, status, runs, elevated: await elevated(), task: TASK, thisGateway: `"${node}" "${script}" start --config "${configPath}"` };
    },
    /** Registers the task (at startup, as SYSTEM, restarted when it stops) */
    async install(user) {
      if (!isWindows) throw new Error('Only on Windows');
      if (!(await elevated())) throw new Error('Run the gateway as an administrator once to install it (right-click the console, Run as administrator)');
      const command = [
        `$a = New-ScheduledTaskAction -Execute ${ps(node)} -Argument ${ps(`"${script}" start --config "${configPath}"`)} -WorkingDirectory ${ps(path.dirname(configPath))}`,
        '$t = New-ScheduledTaskTrigger -AtStartup',
        "$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest",
        '$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
        `Register-ScheduledTask -TaskName ${ps(TASK)} -Action $a -Trigger $t -Principal $p -Settings $s -Force -Description ${ps('Kval MachineScope gateway (setup page: Run at startup)')} | Out-Null`,
      ].join('; ');
      const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]);
      if (r.code !== 0) throw new Error(`Could not install it: ${(r.err || r.out).trim().split('\n')[0]}`);
      log(`service: ${user} installed the startup task "${TASK}"`);
      audit?.add(user, 'service.install', { task: TASK });
      return { ok: true, dry: r.dry, message: `Installed: the gateway starts with Windows. "Switch to the service" stops this console gateway and starts the task now.` };
    },
    async remove(user) {
      if (!isWindows) throw new Error('Only on Windows');
      if (!(await elevated())) throw new Error('Run the gateway as an administrator to remove it');
      const r = await run('powershell.exe', ['-NoProfile', '-Command', `Unregister-ScheduledTask -TaskName ${ps(TASK)} -Confirm:$false`]);
      if (r.code !== 0) throw new Error(`Could not remove it: ${(r.err || r.out).trim().split('\n')[0]}`);
      log(`service: ${user} removed the startup task`);
      audit?.add(user, 'service.remove', { task: TASK });
      return { ok: true, dry: r.dry, message: 'Removed: the gateway no longer starts with Windows.' };
    },
    /** This gateway stops, and the task starts it again (the same port) a few seconds later */
    async switchToTask(user, exit) {
      if (!isWindows) throw new Error('Only on Windows');
      const cmd = `Start-Sleep -Seconds 3; Start-ScheduledTask -TaskName ${ps(TASK)}`;
      log(`service: ${user} switches to the startup task (this gateway stops)`);
      audit?.add(user, 'service.switch', { task: TASK });
      if (dry()) return { ok: true, dry: `powershell.exe -NoProfile -Command ${cmd}`, message: 'The task would start in 3 s' };
      spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      setTimeout(exit, 500);
      return { ok: true, message: 'This gateway stops now; the task starts it in a few seconds. Reload the page then.' };
    },
  };
}

module.exports = { createService, TASK };
