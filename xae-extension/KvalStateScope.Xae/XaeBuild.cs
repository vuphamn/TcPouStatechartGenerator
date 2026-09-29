using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;

namespace KvalStateScope.Xae
{
    /// <summary>
    /// Build (the app's Live tab, XAE edition): XAE's own build of the open solution, its Error List sent back to the
    /// app (errors and warnings apart: the list's filters, put back as they were). The app says where each is.
    ///   app -> host: buildProject { requestId }
    ///   host -> app: plcBuildProgress { requestId, text }, xaeBuildResult { requestId, ok, errors, warnings, items, fatal }
    /// </summary>
    internal sealed partial class StateScopeControl
    {
        private EnvDTE.BuildEvents _buildEvents;
        private int _buildRequest = -1;

        private void HandleBuildProject(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r != null ? Convert.ToInt32(r) : 0;
            if (!(Package.GetGlobalService(typeof(EnvDTE.DTE)) is EnvDTE80.DTE2 dte) || dte.Solution == null || !dte.Solution.IsOpen)
            {
                Post(new { type = "xaeBuildResult", requestId, ok = false, fatal = "No solution is open in XAE" });
                return;
            }
            if (_buildRequest >= 0 || dte.Solution.SolutionBuild.BuildState == EnvDTE.vsBuildState.vsBuildStateInProgress)
            {
                Post(new { type = "xaeBuildResult", requestId, ok = false, fatal = "A build is already running in XAE" });
                return;
            }
            if (_buildEvents == null)
            {
                // (kept: its events stop when the object is collected)
                _buildEvents = dte.Events.BuildEvents;
                _buildEvents.OnBuildDone += OnXaeBuildDone;
            }
            _buildRequest = requestId;
            Log.Write("build: XAE builds the solution");
            Post(new { type = "plcBuildProgress", requestId, text = "Building in XAE" });
            // (not waited for here: XAE stays responsive; OnBuildDone reports)
            dte.Solution.SolutionBuild.Build(false);
        }

        private void OnXaeBuildDone(EnvDTE.vsBuildScope scope, EnvDTE.vsBuildAction action)
        {
            if (_buildRequest < 0) return;
            var requestId = _buildRequest;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                try
                {
                    var dte = Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE80.DTE2;
                    var failed = dte?.Solution.SolutionBuild.LastBuildInfo ?? 1;
                    var list = dte?.ToolWindows.ErrorList;
                    var items = new List<object>();
                    int errors = 0, warnings = 0;
                    if (list != null)
                    {
                        var showErrors = list.ShowErrors;
                        var showWarnings = list.ShowWarnings;
                        var showMessages = list.ShowMessages;
                        try
                        {
                            foreach (var level in new[] { "error", "warning" })
                            {
                                list.ShowErrors = level == "error";
                                list.ShowWarnings = level == "warning";
                                list.ShowMessages = false;
                                foreach (var e in await SettledErrorItemsAsync(list))
                                {
                                    if (level == "error") errors++; else warnings++;
                                    if (items.Count < 1000) items.Add(new { level, text = e.Text, file = e.File, line = e.Line, column = e.Column, project = e.Project });
                                }
                            }
                        }
                        finally
                        {
                            list.ShowErrors = showErrors;
                            list.ShowWarnings = showWarnings;
                            list.ShowMessages = showMessages;
                        }
                    }
                    Log.Write($"build: done, {errors} error(s), {warnings} warning(s), {failed} project(s) failed");
                    Post(new { type = "xaeBuildResult", requestId, ok = failed == 0 && errors == 0, errors, warnings, failedProjects = failed, items });
                }
                catch (Exception ex)
                {
                    Post(new { type = "xaeBuildResult", requestId, ok = false, fatal = "Could not read XAE's Error List: " + ex.Message });
                }
                finally
                {
                    _buildRequest = -1;
                }
            });
        }

        private struct ErrorEntry
        {
            public string Text, File, Project;
            public int Line, Column;
        }

        /// <summary>The Error List's items once they have settled (it fills after the build ends, and is refilled)</summary>
        private static async Task<List<ErrorEntry>> SettledErrorItemsAsync(EnvDTE80.ErrorList list)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            var best = new List<ErrorEntry>();
            int last = -1, steady = 0;
            for (var k = 0; k < 60 && steady < 4; k++)
            {
                var items = list.ErrorItems;
                var count = items.Count;
                var now = new List<ErrorEntry>();
                for (var i = 1; i <= count; i++)
                {
                    try
                    {
                        var e = items.Item(i);
                        if (!string.IsNullOrEmpty(e.Description)) now.Add(new ErrorEntry { Text = e.Description, File = e.FileName ?? "", Line = e.Line, Column = e.Column, Project = e.Project ?? "" });
                    }
                    catch (ArgumentException) { }
                    catch (System.Runtime.InteropServices.COMException) { }
                }
                if (now.Count >= best.Count) best = now;
                steady = count == last && now.Count == count ? steady + 1 : 0;
                last = count;
                await Task.Delay(250);
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            }
            return best;
        }
    }
}
