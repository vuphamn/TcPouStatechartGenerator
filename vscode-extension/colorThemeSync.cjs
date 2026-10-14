// VS Code's color theme set from MachineScope's (a theme chosen in a statechart's Theme & Preset): VS Code's own editors
// (a .TcDUT's, a .TcGVL's: twincat-st documents) take VS Code's theme, not the webviews', so they match only when VS
// Code's theme is the same. MachineScope's IDE themes map to VS Code's (its built-in ones, or an installed theme
// extension's, found by name); asked first (kvalMachineScope.syncColorTheme: ask, always, never).

/** MachineScope theme → the names a VS Code theme may have (its id or label), the first found used */
const CANDIDATES = {
  'vscode-dark': ['Default Dark+', 'Default Dark Modern'],
  'vscode-light': ['Default Light+', 'Default Light Modern'],
  'vs-dark': ['Visual Studio Dark', 'Visual Studio 2019 Dark', 'Visual Studio 2022 Dark'],
  'vs-light': ['Visual Studio Light', 'Visual Studio 2019 Light', 'Visual Studio 2022 Light'],
  monokai: ['Monokai'],
  'solarized-dark': ['Solarized Dark'],
  'solarized-light': ['Solarized Light'],
  'one-dark': ['One Dark Pro', 'Atom One Dark', 'One Dark'],
  dracula: ['Dracula', 'Dracula Theme', 'Dracula Official'],
  'github-dark': ['GitHub Dark Default', 'GitHub Dark'],
  'github-light': ['GitHub Light Default', 'GitHub Light'],
  nord: ['Nord'],
  'jetbrains-darcula': ['Darcula', 'JetBrains Darcula', 'Darcula Theme from IntelliJ', 'IntelliJ Darcula'],
  'jetbrains-dark': ['JetBrains New Dark', 'New UI Dark', 'JetBrains Dark', 'Islands Dark'],
  'jetbrains-light': ['IntelliJ Light', 'JetBrains IntelliJ Light', 'IntelliJ Light Theme', 'JetBrains Light'],
};

/** A MachineScope theme's name, for the question (its IDE theme's) */
const NAMES = { 'vscode-dark': 'VS Code Dark+', 'vscode-light': 'VS Code Light+', 'vs-dark': 'Visual Studio Dark', 'vs-light': 'Visual Studio Light', monokai: 'Monokai', 'solarized-dark': 'Solarized Dark', 'solarized-light': 'Solarized Light', 'one-dark': 'One Dark Pro', dracula: 'Dracula', 'github-dark': 'GitHub Dark', 'github-light': 'GitHub Light', nord: 'Nord', 'jetbrains-darcula': 'Darcula', 'jetbrains-dark': 'JetBrains Dark', 'jetbrains-light': 'IntelliJ Light' };

/**
 * The VS Code theme for a MachineScope theme: { setting (workbench.colorTheme's value), label } among the installed
 * ones ([{ id?, label }]), or { missing: the names looked for } (a theme extension to install), or null (no VS Code
 * equivalent: MachineScope's own themes, dark, default …)
 */
function vsCodeThemeFor(theme, installed) {
  const names = CANDIDATES[theme];
  if (!names) return null;
  for (const name of names) {
    const n = name.toLowerCase();
    const hit = installed.find((t) => (t.id ?? '').toLowerCase() === n || (t.label ?? '').toLowerCase() === n);
    if (hit) return { setting: hit.id ?? hit.label, label: hit.label ?? hit.id };
  }
  return { missing: names };
}

/** The color themes VS Code has (built-in and installed extensions'): [{ id?, label }] */
function installedThemes(vscode) {
  const out = [];
  for (const ext of vscode.extensions.all) {
    for (const t of ext.packageJSON?.contributes?.themes ?? []) if (t && (t.id || t.label)) out.push({ id: t.id, label: t.label });
  }
  return out;
}

/** MachineScope's theme chosen: VS Code's set to match, as kvalMachineScope.syncColorTheme says (asked first by default) */
async function syncColorTheme(vscode, theme) {
  const config = vscode.workspace.getConfiguration('kvalMachineScope');
  const mode = config.get('syncColorTheme', 'ask');
  if (mode === 'never') return;
  const found = vsCodeThemeFor(theme, installedThemes(vscode));
  if (!found) return;
  const name = NAMES[theme] ?? theme;
  if (found.missing) {
    if (mode !== 'ask') return;
    const pick = await vscode.window.showInformationMessage(`MachineScope's theme is ${name}; VS Code has no ${name} theme, so its own editors (a .TcDUT's, a .TcGVL's) keep theirs. Install one to match?`, 'Find it', 'Never ask');
    if (pick === 'Find it') await vscode.commands.executeCommand('workbench.extensions.search', `@category:themes ${found.missing[0]}`);
    else if (pick === 'Never ask') await config.update('syncColorTheme', 'never', vscode.ConfigurationTarget.Global);
    return;
  }
  const workbench = vscode.workspace.getConfiguration('workbench');
  if (workbench.get('colorTheme') === found.setting) return;
  if (mode === 'ask') {
    const pick = await vscode.window.showInformationMessage(`Also set VS Code's color theme to ${found.label}? VS Code's own editors (a .TcDUT's, a .TcGVL's) take VS Code's theme, not MachineScope's: this changes it for all of VS Code.`, 'Yes', 'Always', 'Not now', 'Never');
    if (pick === 'Never') return config.update('syncColorTheme', 'never', vscode.ConfigurationTarget.Global);
    if (pick !== 'Yes' && pick !== 'Always') return;
    if (pick === 'Always') await config.update('syncColorTheme', 'always', vscode.ConfigurationTarget.Global);
  }
  await workbench.update('colorTheme', found.setting, vscode.ConfigurationTarget.Global);
}

module.exports = { syncColorTheme, vsCodeThemeFor, installedThemes, CANDIDATES };
