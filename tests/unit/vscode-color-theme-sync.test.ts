// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// VS Code's color theme set from MachineScope's (vscode-extension/colorThemeSync.cjs): the matching VS Code theme found
// among the built-in and installed ones; asked first (Yes, Always, Not now, Never), or always, or never; a theme not
// installed: Find it
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { syncColorTheme, vsCodeThemeFor } = require('../../vscode-extension/colorThemeSync.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const builtIn = [{ id: 'Default Dark+', label: 'Dark+' }, { id: 'Default Light+', label: 'Light+' }, { label: 'Visual Studio Dark' }, { label: 'Monokai' }, { label: 'Solarized Light' }];
expect(vsCodeThemeFor('vscode-dark', builtIn)?.setting === 'Default Dark+' && vsCodeThemeFor('vs-dark', builtIn)?.setting === 'Visual Studio Dark' && vsCodeThemeFor('solarized-light', builtIn)?.setting === 'Solarized Light', 'the built-in ones: by id or label');
expect(vsCodeThemeFor('dark', builtIn) === null && vsCodeThemeFor('forest', builtIn) === null, "MachineScope's own themes: no VS Code equivalent");
expect(vsCodeThemeFor('dracula', builtIn)?.missing?.[0] === 'Dracula' && vsCodeThemeFor('dracula', [...builtIn, { id: 'Dracula Theme', label: 'Dracula' }])?.setting === 'Dracula Theme', 'an extension theme: found when installed (its id set), else missing');

/** A stand-in vscode: its settings, the answer given to the question, the commands run */
function fakeVscode(o: { mode?: string; colorTheme?: string; answer?: string; themes?: { id?: string; label?: string }[] }) {
  const settings: Record<string, unknown> = { 'kvalMachineScope.syncColorTheme': o.mode ?? 'ask', 'workbench.colorTheme': o.colorTheme ?? 'Default Light+' };
  const asked: string[] = [];
  const commands: unknown[][] = [];
  const vscode = {
    ConfigurationTarget: { Global: 1 },
    extensions: { all: [{ packageJSON: { contributes: { themes: o.themes ?? builtIn } } }, { packageJSON: {} }] },
    workspace: {
      getConfiguration: (section: string) => ({
        get: (k: string, d: unknown) => settings[`${section}.${k}`] ?? d,
        update: async (k: string, v: unknown) => {
          settings[`${section}.${k}`] = v;
        },
      }),
    },
    window: {
      showInformationMessage: async (text: string) => {
        asked.push(text);
        return o.answer;
      },
    },
    commands: { executeCommand: async (...a: unknown[]) => void commands.push(a) },
  };
  return { vscode, settings, asked, commands };
}

(async () => {
  let f = fakeVscode({ answer: 'Yes' });
  await syncColorTheme(f.vscode, 'vscode-dark');
  expect(f.asked.length === 1 && /Also set VS Code's color theme to Dark\+\?/.test(f.asked[0]) && f.settings['workbench.colorTheme'] === 'Default Dark+' && f.settings['kvalMachineScope.syncColorTheme'] === 'ask', 'asked: Yes sets it (asked again next time)');
  f = fakeVscode({ answer: 'Not now' });
  await syncColorTheme(f.vscode, 'vscode-dark');
  expect(f.settings['workbench.colorTheme'] === 'Default Light+', 'Not now: left as it is');
  f = fakeVscode({ answer: 'Always' });
  await syncColorTheme(f.vscode, 'monokai');
  expect(f.settings['workbench.colorTheme'] === 'Monokai' && f.settings['kvalMachineScope.syncColorTheme'] === 'always', 'Always: set, and not asked again');
  f = fakeVscode({ mode: 'always' });
  await syncColorTheme(f.vscode, 'vs-dark');
  expect(f.asked.length === 0 && f.settings['workbench.colorTheme'] === 'Visual Studio Dark', 'always: set without asking');
  f = fakeVscode({ answer: 'Never' });
  await syncColorTheme(f.vscode, 'vscode-dark');
  expect(f.settings['kvalMachineScope.syncColorTheme'] === 'never' && f.settings['workbench.colorTheme'] === 'Default Light+', 'Never: not set, never asked again');
  f = fakeVscode({ mode: 'never', answer: 'Yes' });
  await syncColorTheme(f.vscode, 'vscode-dark');
  expect(f.asked.length === 0 && f.settings['workbench.colorTheme'] === 'Default Light+', 'never: nothing');
  f = fakeVscode({ colorTheme: 'Default Dark+', answer: 'Yes' });
  await syncColorTheme(f.vscode, 'vscode-dark');
  expect(f.asked.length === 0, 'already that theme: not asked');
  f = fakeVscode({ answer: 'Yes' });
  await syncColorTheme(f.vscode, 'forest');
  expect(f.asked.length === 0, "MachineScope's own theme: not asked");
  f = fakeVscode({ answer: 'Find it' });
  await syncColorTheme(f.vscode, 'nord');
  expect(/VS Code has no Nord theme/.test(f.asked[0] ?? '') && f.commands[0]?.[0] === 'workbench.extensions.search' && f.commands[0]?.[1] === '@category:themes Nord' && f.settings['workbench.colorTheme'] === 'Default Light+', 'not installed: Find it searches the themes');
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
