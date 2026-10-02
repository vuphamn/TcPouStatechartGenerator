// Start at sign-in (Windows): a shortcut in this user's Startup folder that starts Link minimized, without opening its
// page. Per user, no administrator needed; the same as dragging the Start menu shortcut there. Set and cleared from
// Link's page. KSS_SERVICE_DRYRUN=1: the shortcut is not written, its command is returned (the tests).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const NAME = 'Kval MachineScope Link.lnk';
const dry = () => process.env.KSS_SERVICE_DRYRUN === '1';
// (a PowerShell string: single quotes doubled)
const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** This program as started: the single executable, or node with link.cjs */
function selfCommand(extraArgs) {
  let sea = false;
  try {
    sea = require('node:sea').isSea();
  } catch {
    // an older Node.js: not a single executable
  }
  const script = process.argv[1] && !sea ? [path.resolve(process.argv[1])] : [];
  return { target: process.execPath, args: [...script, ...extraArgs] };
}

const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function createStartup({ port, log }) {
  const folder = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const file = path.join(folder, NAME);
  let dryOn = false;
  const extra = ['--no-open', ...(port !== 48960 ? ['--port', String(port)] : [])];

  const run = (command) =>
    new Promise((resolve) => {
      if (dry()) return resolve({ code: 0, dry: `powershell.exe -NoProfile -Command ${command}` });
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) =>
        resolve({ code: error ? error.code ?? 1 : 0, err: String(stderr || stdout) }));
    });

  return {
    status() {
      if (process.platform !== 'win32') return { supported: false, on: false, message: 'Only on Windows (elsewhere: your desktop\'s autostart settings)' };
      const { target, args } = selfCommand(extra);
      return { supported: true, on: dry() ? dryOn : fs.existsSync(file), shortcut: file, command: [target, ...args].map(quote).join(' ') };
    },
    async set(on) {
      if (process.platform !== 'win32') throw new Error('Only on Windows');
      const { target, args } = selfCommand(extra);
      if (!on) {
        if (dry()) {
          dryOn = false;
          return { ok: true, dry: `del ${file}`, message: 'Link no longer starts when you sign in.' };
        }
        fs.rmSync(file, { force: true });
        log('startup: removed from this user\'s Startup folder');
        return { ok: true, message: 'Link no longer starts when you sign in.' };
      }
      // WindowStyle 7: minimized
      const command = [
        `New-Item -ItemType Directory -Force -Path ${ps(folder)} | Out-Null`,
        `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${ps(file)})`,
        `$s.TargetPath = ${ps(target)}`,
        `$s.Arguments = ${ps(args.map(quote).join(' '))}`,
        `$s.WorkingDirectory = ${ps(path.dirname(target))}`,
        '$s.WindowStyle = 7',
        `$s.Description = ${ps('Kval MachineScope Link (started when you sign in: set on its page)')}`,
        '$s.Save()',
      ].join('; ');
      const r = await run(command);
      if (r.code !== 0) throw new Error(`Could not add it: ${(r.err || '').trim().split('\n')[0]}`);
      if (dry()) dryOn = true;
      else log(`startup: added to this user's Startup folder (${file})`);
      return { ok: true, dry: r.dry, message: 'Link starts (minimized) when you sign in to Windows.' };
    },
  };
}

module.exports = { createStartup, NAME };
