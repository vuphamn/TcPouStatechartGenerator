using System;
using System.ComponentModel.Design;
using System.IO;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Task = System.Threading.Tasks.Task;

namespace KvalStateScope.Xae
{
    /// <summary>"Open in Kval StateScope" (context menus) and "Tools > Kval StateScope..."</summary>
    internal static class OpenInStateScopeCommand
    {
        public static async Task InitializeAsync(KvalStateScopePackage package)
        {
            await package.JoinableTaskFactory.SwitchToMainThreadAsync(package.DisposalToken);
            if (!(await package.GetServiceAsync(typeof(IMenuCommandService)) is OleMenuCommandService commands)) return;

            var openSelected = new OleMenuCommand(
                (s, e) => Run(package, SelectionHelper.GetSelectedPouPath(package), askIfNone: false),
                new CommandID(PackageGuids.CommandSet, CommandIds.OpenSelected));
            // Only offered when the right-clicked item / document is a .TcPOU
            openSelected.BeforeQueryStatus += (s, e) =>
            {
                ThreadHelper.ThrowIfNotOnUIThread();
                var visible = SelectionHelper.GetSelectedPouPath(package) != null;
                openSelected.Visible = visible;
                openSelected.Enabled = visible;
            };
            commands.AddCommand(openSelected);

            // Also takes a path: "KvalStateScope.Open C:\Path\SM_X.TcPOU" in the Command Window or devenv /Command
            var openFromTools = new OleMenuCommand(
                (s, e) =>
                {
                    ThreadHelper.ThrowIfNotOnUIThread();
                    var arg = ((e as OleMenuCmdEventArgs)?.InValue as string)?.Trim().Trim('"');
                    var path = SelectionHelper.IsPou(arg)
                        ? arg
                        : SelectionHelper.GetSelectedPouPath(package) ?? SelectionHelper.GetActivePouPath(package);
                    Run(package, path, askIfNone: true);
                },
                new CommandID(PackageGuids.CommandSet, CommandIds.OpenFromTools));
            openFromTools.ParametersDescription = "$";
            commands.AddCommand(openFromTools);
        }

        private static void Run(KvalStateScopePackage package, string pouPath, bool askIfNone)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (pouPath == null && askIfNone)
            {
                pouPath = HostFiles.AskForPou(SelectionHelper.GetSolutionFolder(package));
            }
            package.JoinableTaskFactory.RunAsync(async () =>
            {
                try
                {
                    await package.ShowStateScopeAsync(pouPath);
                }
                catch (Exception ex)
                {
                    await package.JoinableTaskFactory.SwitchToMainThreadAsync();
                    VsShellUtilities.ShowMessageBox(package, ex.Message, "Kval StateScope",
                        OLEMSGICON.OLEMSGICON_CRITICAL, OLEMSGBUTTON.OLEMSGBUTTON_OK, OLEMSGDEFBUTTON.OLEMSGDEFBUTTON_FIRST);
                }
            }).FileAndForget("KvalStateScope/Open");
        }
    }
}
