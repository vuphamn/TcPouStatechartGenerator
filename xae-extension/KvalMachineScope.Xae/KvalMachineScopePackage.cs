using System;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Task = System.Threading.Tasks.Task;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// Kval MachineScope inside TwinCAT XAE: a command on .TcPOU items opens the MachineScope web app (WebView2) in a
    /// document tab.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [Guid(PackageGuids.PackageString)]
    // The version makes the IDE re-merge the menus: raise it whenever KvalMachineScopePackage.vsct changes
    // (TcXaeShell otherwise keeps its cached menus, as it has no /updateconfiguration)
    [ProvideMenuResource("Menus.ctmenu", 3)]
    // The context-menu command hides itself unless a .TcPOU is selected, which needs the package loaded: load it
    // (in the background) once a solution is open
    [ProvideAutoLoad(VSConstants.UICONTEXT.SolutionExists_string, PackageAutoLoadFlags.BackgroundLoad)]
    // One tab per POU: each has its own diagram, live session and file watchers
    [ProvideToolWindow(typeof(MachineScopeToolWindow), Style = VsDockStyle.MDI, MultiInstances = true)]
    public sealed class KvalMachineScopePackage : AsyncPackage
    {
        /// <summary>The loaded package (the tabs ask it for another tab: Live's Open instance)</summary>
        internal static KvalMachineScopePackage Instance { get; private set; }

        protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
            Instance = this;
            await OpenInMachineScopeCommand.InitializeAsync(this);
            // (updated since the last time: said once, with What's new)
            try
            {
                var version = typeof(KvalMachineScopePackage).Assembly.GetName().Version?.ToString(3);
                if (UpdateNotice.Check(version) != null) await ShowUpdatedBarAsync(version);
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException))
            {
                Log.Write("update notice: " + ex.Message);
            }
        }

        /// <summary>The main window's notification bar: updated to the version, What's new (MachineScope's page)</summary>
        private async Task ShowUpdatedBarAsync(string version)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
            if (!(await GetServiceAsync(typeof(SVsShell)) is IVsShell shell)) return;
            if (shell.GetProperty((int)__VSSPROPID7.VSSPROPID_MainWindowInfoBarHost, out var hostObj) != VSConstants.S_OK || !(hostObj is IVsInfoBarHost host)) return;
            if (!(await GetServiceAsync(typeof(SVsInfoBarUIFactory)) is IVsInfoBarUIFactory factory)) return;
            var model = new InfoBarModel(
                new[] { new InfoBarTextSpan($"Kval MachineScope was updated to {version}. ") },
                new[] { new InfoBarHyperlink("What's new") },
                Microsoft.VisualStudio.Imaging.KnownMonikers.StatusInformation,
                true);
            var bar = factory.CreateInfoBar(model);
            bar.Advise(new UpdatedBarEvents(this), out _);
            host.AddInfoBar(bar);
        }

        /// <summary>What's new clicked: a MachineScope tab shown, its What's new page opened; the bar closed</summary>
        private sealed class UpdatedBarEvents : IVsInfoBarUIEvents
        {
            private readonly KvalMachineScopePackage _package;
            public UpdatedBarEvents(KvalMachineScopePackage package) { _package = package; }
            public void OnClosed(IVsInfoBarUIElement infoBarUIElement) { }
            public void OnActionItemClicked(IVsInfoBarUIElement infoBarUIElement, IVsInfoBarActionItem actionItem)
            {
                ThreadHelper.ThrowIfNotOnUIThread();
                infoBarUIElement.Close();
                _package.JoinableTaskFactory.RunAsync(async () =>
                {
                    MachineScopeControl.WhatsNewPending = true;
                    await _package.ShowMachineScopeAsync(null);
                    await _package.JoinableTaskFactory.SwitchToMainThreadAsync();
                    for (var id = 0; id < MaxTabs; id++)
                        if (_package.FindToolWindow(typeof(MachineScopeToolWindow), id, false) is MachineScopeToolWindow tab && tab.Control != null && tab.Control.ShowWhatsNew()) break;
                });
            }
        }

        /// <summary>Most MachineScope tabs looked for (and created)</summary>
        private const int MaxTabs = 64;

        /// <summary>
        /// Shows the .TcPOU's MachineScope tab: the one that already shows it, else an empty tab, else a new one
        /// (null: show a tab, the first one if there is any). With an instance (a POU can be declared several times),
        /// the tab that follows that PLC instance of it, else a new tab that goes live on it.
        /// </summary>
        public async Task ShowMachineScopeAsync(string pouPath, string instance = null, System.Collections.Generic.Dictionary<string, string> connection = null, bool newTab = false)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
            // (the context menu's command runs while the menu is still closing: TcXaeShell 2017 left a tool window
            // shown then hidden, so the first right-click did nothing and the second showed it. Yielded first: the
            // window is made once the menu is gone)
            await Task.Yield();
            await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
            int? showing = null, empty = null, any = null, free = null;
            for (var id = 0; id < MaxTabs; id++)
            {
                if (!(FindToolWindow(typeof(MachineScopeToolWindow), id, false) is MachineScopeToolWindow tab) || tab.Control == null)
                {
                    if (free == null) free = id;
                    continue;
                }
                if (any == null) any = id;
                var shown = tab.Control.PouPath;
                if (shown == null)
                {
                    if (empty == null) empty = id;
                }
                else if (!newTab && !string.IsNullOrEmpty(pouPath) && string.Equals(shown, pouPath, StringComparison.OrdinalIgnoreCase)
                    && (string.IsNullOrEmpty(instance) || string.Equals(tab.Control.Instance, instance, StringComparison.OrdinalIgnoreCase)))
                {
                    showing = id;
                    break;
                }
            }
            var target = showing ?? empty ?? (string.IsNullOrEmpty(pouPath) ? any : null) ?? free
                ?? throw new NotSupportedException($"At most {MaxTabs} Kval MachineScope tabs can be open");
            var window = await ShowToolWindowAsync(typeof(MachineScopeToolWindow), target, true, DisposalToken) as MachineScopeToolWindow;
            if (window?.Control == null) throw new NotSupportedException("Cannot create the Kval MachineScope window");
            // (shown, made sure: a frame that is not visible after Show is shown again a moment later, up to three times)
            if (window.Frame is IVsWindowFrame frame)
            {
                for (var attempt = 1; attempt <= 3 && frame.IsVisible() != VSConstants.S_OK; attempt++)
                {
                    Log.Write($"window frame not visible after Show: shown again ({attempt})");
                    await Task.Delay(250 * attempt, DisposalToken);
                    await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
                    frame.Show();
                }
            }
            // Already shown in that tab: just bring it forward
            if (!string.IsNullOrEmpty(pouPath) && showing == null) window.Control.LoadPou(pouPath, instance, connection);
        }
    }
}
