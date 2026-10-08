using System;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
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
            // Already shown in that tab: just bring it forward
            if (!string.IsNullOrEmpty(pouPath) && showing == null) window.Control.LoadPou(pouPath, instance, connection);
        }
    }
}
