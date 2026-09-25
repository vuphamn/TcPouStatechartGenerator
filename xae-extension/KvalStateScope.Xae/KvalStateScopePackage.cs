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
    [ProvideToolWindow(typeof(StateScopeToolWindow), Style = VsDockStyle.MDI, MultiInstances = false)]
    public sealed class KvalStateScopePackage : AsyncPackage
    {
        protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
            await OpenInStateScopeCommand.InitializeAsync(this);
        }

        /// <summary>Shows the StateScope tab and loads the .TcPOU (null: just show it)</summary>
        public async Task ShowStateScopeAsync(string pouPath)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
            var window = await ShowToolWindowAsync(typeof(StateScopeToolWindow), 0, true, DisposalToken) as StateScopeToolWindow;
            if (window?.Control == null) throw new NotSupportedException("Cannot create the Kval StateScope window");
            if (!string.IsNullOrEmpty(pouPath)) window.Control.LoadPou(pouPath);
        }
    }
}
