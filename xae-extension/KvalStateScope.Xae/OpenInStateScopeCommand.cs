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

            // Context menus owned by other windows (TwinCAT's PLC tree) only ask a priority command target
            PriorityCommandTarget.Register(package, path => Run(package, path, askIfNone: false));
            AddToTwinCATPouMenu(package);
        }

        /// <summary>
        /// TwinCAT's PLC tree shows POUs with its "PlcFile" menu. Its numeric id cannot be read from outside Beckhoff's
        /// package, so the command is added to that menu by name (once; the IDE keeps the placement in its settings).
        /// Does nothing where TwinCAT is not installed.
        /// </summary>
        private static void AddToTwinCATPouMenu(IServiceProvider services)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                if (!(services.GetService(typeof(EnvDTE.DTE)) is EnvDTE80.DTE2 dte)) return;
                dynamic bars = dte.CommandBars;
                dynamic menu;
                try
                {
                    menu = bars["PlcFile"];
                }
                catch (ArgumentException)
                {
                    Log.Write("TwinCAT POU menu (PlcFile) not found: no TwinCAT PLC integration in this IDE");
                    return;
                }
                dynamic controls = menu.Controls;
                for (var i = 1; i <= (int)controls.Count; i++)
                {
                    if (((string)controls[i].Caption ?? "").Contains("Kval StateScope")) return;
                }
                var command = dte.Commands.Item(PackageGuids.CommandSet.ToString("B"), CommandIds.OpenSelected);
                command.AddControl(menu, 1);
                Log.Write("added Open in Kval StateScope to TwinCAT's POU menu (PlcFile)");
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException))
            {
                Log.Write("could not add the command to TwinCAT's POU menu: " + ex.Message);
            }
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
