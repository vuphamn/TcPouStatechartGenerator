using System;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Task = System.Threading.Tasks.Task;

namespace KvalStateScope.Xae
{
    /// <summary>
    /// Kval StateScope inside TwinCAT XAE: a command on .TcPOU items opens the StateScope web app (WebView2) in a
    /// document tab.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [Guid(PackageGuids.PackageString)]
    // The version makes the IDE re-merge the menus: raise it whenever KvalStateScopePackage.vsct changes
    // (TcXaeShell otherwise keeps its cached menus, as it has no /updateconfiguration)
    [ProvideMenuResource("Menus.ctmenu", 3)]
    // The context-menu command hides itself unless a .TcPOU is selected, which needs the package loaded: load it
    // (in the background) once a solution is open
    [ProvideAutoLoad(VSConstants.UICONTEXT.SolutionExists_string, PackageAutoLoadFlags.BackgroundLoad)]
    // One tab per POU: each has its own diagram, live session and file watchers
    [ProvideToolWindow(typeof(StateScopeToolWindow), Style = VsDockStyle.MDI, MultiInstances = true)]
    public sealed class KvalStateScopePackage : AsyncPackage
    {
        /// <summary>The loaded package (the tabs ask it for another tab: Live's Open instance)</summary>
        internal static KvalStateScopePackage Instance { get; private set; }

        protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
            Instance = this;
            await OpenInStateScopeCommand.InitializeAsync(this);
        }

        /// <summary>Most StateScope tabs looked for (and created)</summary>
        private const int MaxTabs = 64;

        /// <summary>
        /// Shows the .TcPOU's StateScope tab: the one that already shows it, else an empty tab, else a new one
        /// (null: show a tab, the first one if there is any). With an instance (a POU can be declared several times),
        /// the tab that follows that PLC instance of it, else a new tab that goes live on it.
        /// </summary>
        public async Task ShowStateScopeAsync(string pouPath, string instance = null, System.Collections.Generic.Dictionary<string, string> connection = null)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
            int? showing = null, empty = null, any = null, free = null;
            for (var id = 0; id < MaxTabs; id++)
            {
                if (!(FindToolWindow(typeof(StateScopeToolWindow), id, false) is StateScopeToolWindow tab) || tab.Control == null)
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
                else if (!string.IsNullOrEmpty(pouPath) && string.Equals(shown, pouPath, StringComparison.OrdinalIgnoreCase)
                    && (string.IsNullOrEmpty(instance) || string.Equals(tab.Control.Instance, instance, StringComparison.OrdinalIgnoreCase)))
                {
                    showing = id;
                    break;
                }
            }
            var target = showing ?? empty ?? (string.IsNullOrEmpty(pouPath) ? any : null) ?? free
                ?? throw new NotSupportedException($"At most {MaxTabs} Kval StateScope tabs can be open");
            var window = await ShowToolWindowAsync(typeof(StateScopeToolWindow), target, true, DisposalToken) as StateScopeToolWindow;
            if (window?.Control == null) throw new NotSupportedException("Cannot create the Kval StateScope window");
            // Already shown in that tab: just bring it forward
            if (!string.IsNullOrEmpty(pouPath) && showing == null) window.Control.LoadPou(pouPath, instance, connection);
        }
    }
}
