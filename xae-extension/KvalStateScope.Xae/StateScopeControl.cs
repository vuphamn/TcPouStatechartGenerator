using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.VisualStudio.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace KvalStateScope.Xae
{
    /// <summary>
    /// Hosts the Kval StateScope web app in WebView2 and answers its requests (messages as JSON objects):
    ///   app -> host: ready, browsePou, findDut, chooseDutFiles, save
    ///   host -> app: loadPou, dutCandidates, saveResult
    /// </summary>
    internal sealed class StateScopeControl : UserControl
    {
        private const string AppHost = "statescope.example";

        private readonly ToolWindowPane _pane;
        private readonly Grid _grid = new Grid();
        // Replaced by a fresh control when a start attempt fails (a failed WebView2 control cannot be initialized again)
        private WebView2 _web;
        private Task _initialization;
        private readonly TextBlock _status = new TextBlock { Margin = new System.Windows.Thickness(12), Foreground = Brushes.Gainsboro, TextWrapping = System.Windows.TextWrapping.Wrap };
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        private bool _appReady;
        private string _pendingPou;
        private string _pouPath;
        // Files sent to the app (only these can be saved), with the content key last seen for each (change detection)
        private readonly Dictionary<string, string> _lastSeen = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        // Folders watched for changes made in XAE or on disk (TwinCAT save, git pull, ...)
        private readonly Dictionary<string, FileSystemWatcher> _watchers = new Dictionary<string, FileSystemWatcher>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _pendingChecks = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public StateScopeControl(ToolWindowPane pane)
        {
            _pane = pane;
            Background = new SolidColorBrush(Color.FromRgb(0x02, 0x06, 0x17));
            _status.Text = "Starting Kval StateScope...";
            // WebView2 only initializes once it is in the visual tree (it needs a window handle), so it is part of
            // the layout from the start. It is a native window WPF cannot draw over: the status line gets its own row.
            _grid.RowDefinitions.Add(new RowDefinition { Height = System.Windows.GridLength.Auto });
            _grid.RowDefinitions.Add(new RowDefinition { Height = new System.Windows.GridLength(1, System.Windows.GridUnitType.Star) });
            Grid.SetRow(_status, 0);
            _grid.Children.Add(_status);
            NewWebView();
            Content = _grid;
            Loaded += OnLoaded;
        }

        private void NewWebView()
        {
            if (_web != null)
            {
                _grid.Children.Remove(_web);
                _web.Dispose();
            }
            _web = new WebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(0x02, 0x06, 0x17) };
            Grid.SetRow(_web, 1);
            _grid.Children.Add(_web);
        }

        /// <summary>Session-only profiles ("WebView2-&lt;pid&gt;") of IDE processes that are gone</summary>
        private static void RemoveStaleSessionProfiles(string userData)
        {
            try
            {
                var parent = Path.GetDirectoryName(userData);
                var prefix = Path.GetFileName(userData) + "-";
                foreach (var dir in Directory.GetDirectories(parent, prefix + "*"))
                {
                    if (!int.TryParse(Path.GetFileName(dir).Substring(prefix.Length), out var pid)) continue;
                    var alive = false;
                    try { alive = !System.Diagnostics.Process.GetProcessById(pid).HasExited; } catch (ArgumentException) { }
                    if (alive) continue;
                    try { Directory.Delete(dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        private void OnLoaded(object sender, System.Windows.RoutedEventArgs e)
        {
            // Loaded fires again whenever the tab is shown: start (at most) once
            if (_initialization != null) return;
            Log.Write("window loaded");
            _initialization = ThreadHelper.JoinableTaskFactory.RunAsync(InitializeAsync).Task;
        }

        /// <summary>
        /// Creates the WebView2. "Not in the correct state" (0x8007139F) means the browser profile is still held by a
        /// WebView2 that is shutting down (e.g. an IDE that just closed): wait and retry with a fresh control, and in the
        /// end fall back to a profile of this session only.
        /// </summary>
        private async Task StartWebViewAsync(string userData)
        {
            const int ProfileBusy = unchecked((int)0x8007139F);
            RemoveStaleSessionProfiles(userData);
            for (var attempt = 1; ; attempt++)
            {
                var profile = attempt <= 6 ? userData : $"{userData}-{System.Diagnostics.Process.GetCurrentProcess().Id}";
                try
                {
                    var env = await CoreWebView2Environment.CreateAsync(null, profile);
                    await _web.EnsureCoreWebView2Async(env);
                    if (profile != userData) Log.Write("using a session-only browser profile: " + profile);
                    return;
                }
                catch (System.Runtime.InteropServices.COMException ex) when (ex.HResult == ProfileBusy && attempt <= 6)
                {
                    Log.Write($"browser profile busy (attempt {attempt}), retrying");
                    _status.Text = "Starting Kval StateScope... (waiting for a previous session to close)";
                    NewWebView();
                    await Task.Delay(1500);
                }
            }
        }

        private static string ExtensionDir => Path.GetDirectoryName(typeof(StateScopeControl).Assembly.Location);

        private async Task InitializeAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            try
            {
                if (_web.CoreWebView2 != null) return;
                var appDir = Path.Combine(ExtensionDir, "StateScopeApp");
                if (!File.Exists(Path.Combine(appDir, "index.html")))
                    throw new FileNotFoundException("The StateScope app files are missing from the extension", Path.Combine(appDir, "index.html"));
                // The IDE's install folder is read-only: keep the browser profile per user
                var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KvalStateScope", "WebView2");
                Log.Write($"creating WebView2 environment (runtime {CoreWebView2Environment.GetAvailableBrowserVersionString()}, profile {userData})");
                await StartWebViewAsync(userData);
                Log.Write("WebView2 ready");

                var core = _web.CoreWebView2;
                core.SetVirtualHostNameToFolderMapping(AppHost, appDir, CoreWebView2HostResourceAccessKind.Allow);
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDevToolsEnabled = true; // prototype: F12 for diagnostics
                core.WebMessageReceived += OnWebMessage;
                core.NewWindowRequested += (s, e) =>
                {
                    // Links such as mermaid.live open in the default browser
                    e.Handled = true;
                    if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && (uri.Scheme == "https" || uri.Scheme == "http"))
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                };
                _status.Visibility = System.Windows.Visibility.Collapsed;
                _web.Source = new Uri($"https://{AppHost}/index.html");
                Log.Write("navigating to the app");
            }
            catch (Exception ex) when (ex is WebView2RuntimeNotFoundException)
            {
                Log.Write("WebView2 runtime not found: " + ex.Message);
                _status.Text = "Kval StateScope needs the Microsoft Edge WebView2 Runtime. Install it from https://developer.microsoft.com/microsoft-edge/webview2/ and reopen this window.";
            }
            catch (Exception ex)
            {
                Log.Write("start failed: " + ex);
                _status.Text = $"Kval StateScope could not start: {ex.GetType().Name}: {ex.Message}. Close and reopen this tab to try again.";
                NewWebView();
                _initialization = null;
            }
        }

        /// <summary>Loads a .TcPOU (and the .TcDUT candidates of its folder tree) into the app</summary>
        public void LoadPou(string pouPath)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!_appReady)
            {
                _pendingPou = pouPath;
                return;
            }
            try
            {
                var folder = Path.GetDirectoryName(pouPath);
                var duts = HostFiles.FindDutFiles(folder);
                // XAE's copy when the POU belongs to an open TwinCAT project (same as the file unless changed in XAE)
                var content = HostFiles.CurrentContent(_pane, pouPath);
                _pouPath = pouPath;
                _lastSeen.Clear();
                _lastSeen[pouPath] = HostFiles.ContentKey(content);
                foreach (var d in duts) _lastSeen[d.path] = HostFiles.ContentKey(d.content);
                ResetWatchers();
                Watch(folder);
                Post(new
                {
                    type = "loadPou",
                    source = new { name = Path.GetFileName(pouPath), path = pouPath, content, dutCandidates = duts },
                });
                _pane.Caption = "StateScope: " + Path.GetFileNameWithoutExtension(pouPath);
                Log.Write($"loaded {pouPath} with {duts.Count} .TcDUT candidate(s)");
            }
            catch (Exception ex)
            {
                Post(new { type = "error", message = $"Could not open {Path.GetFileName(pouPath)}: {ex.Message}" });
            }
        }

        private void Post(object message)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            _web.CoreWebView2?.PostWebMessageAsJson(_json.Serialize(message));
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            // Only the bundled app may talk to the host
            if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || !string.Equals(source.Host, AppHost, StringComparison.OrdinalIgnoreCase)) return;
            Dictionary<string, object> msg;
            try
            {
                msg = _json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
            }
            catch (ArgumentException) { return; }
            var type = msg.TryGetValue("type", out var t) ? t as string : null;
            var pouFolder = _pouPath != null ? Path.GetDirectoryName(_pouPath) : null;
            try
            {
                switch (type)
                {
                    case "ready":
                        Log.Write("app ready");
                        _appReady = true;
                        if (_pendingPou != null)
                        {
                            var p = _pendingPou;
                            _pendingPou = null;
                            LoadPou(p);
                        }
                        break;
                    case "browsePou":
                        var picked = HostFiles.AskForPou(pouFolder);
                        if (picked != null) LoadPou(picked);
                        break;
                    case "findDut":
                        var folder = HostFiles.AskForFolder(pouFolder);
                        if (folder != null) SendDutCandidates(HostFiles.FindDutFiles(folder), forceFirst: false);
                        break;
                    case "chooseDutFiles":
                        var chosen = HostFiles.AskForDutFiles(pouFolder);
                        if (chosen != null) SendDutCandidates(chosen, forceFirst: true);
                        break;
                    case "save":
                        HandleSave(msg);
                        break;
                    case "navigate":
                        HandleNavigate(msg);
                        break;
                }
            }
            catch (Exception ex)
            {
                Post(new { type = "error", message = ex.Message });
            }
        }

        /// <summary>Opens TwinCAT's editor of a method of the loaded POU at a line</summary>
        private void HandleNavigate(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var path = msg.TryGetValue("path", out var p) ? p as string : null;
            var method = msg.TryGetValue("method", out var m) ? m as string : null;
            var line = msg.TryGetValue("line", out var l) && l is int li ? li : 1;
            var text = msg.TryGetValue("text", out var t) ? t as string : null;
            if (path == null || !_lastSeen.ContainsKey(path)) return;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                string error;
                try
                {
                    error = await CodeNavigation.GoToAsync(_pane, path, method, line, text);
                }
                catch (Exception ex) when (!(ex is OutOfMemoryException))
                {
                    error = ex.Message;
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Log.Write(error == null ? "navigate: done" : "navigate failed: " + error);
                if (error != null) Post(new { type = "error", message = error });
            });
        }

        private void SendDutCandidates(List<DutFile> duts, bool forceFirst)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            foreach (var d in duts)
            {
                _lastSeen[d.path] = HostFiles.ContentKey(d.content);
                Watch(Path.GetDirectoryName(d.path));
            }
            Post(new { type = "dutCandidates", candidates = duts, forceFirst });
        }

        private void HandleSave(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var files = new List<HostFiles.SaveRequest>();
            // JavaScriptSerializer turns JSON arrays into ArrayList
            if (msg.TryGetValue("files", out var raw) && raw is System.Collections.IEnumerable list && !(raw is string))
            {
                foreach (var item in list.OfType<Dictionary<string, object>>())
                {
                    var path = item.TryGetValue("path", out var p) ? p as string : null;
                    var content = item.TryGetValue("content", out var c) ? c as string : null;
                    // The version the app last loaded / saved: a change in XAE since then is a conflict
                    var baseline = item.TryGetValue("baseline", out var b) ? b as string : null;
                    var force = item.TryGetValue("force", out var fo) && fo is bool fb && fb;
                    // Only files this window loaded can be written
                    if (path == null || content == null || !_lastSeen.ContainsKey(path)) continue;
                    files.Add(new HostFiles.SaveRequest { Path = path, Content = content, LoadedKey = baseline != null ? HostFiles.ContentKey(baseline) : null, Force = force });
                }
            }
            Log.Write($"save requested: {files.Count} file(s) {string.Join(", ", files.Select(f => Path.GetFileName(f.Path)))}");
            var error = HostFiles.Save(_pane, files, out var viaXae);
            Log.Write(error == null ? "saved" : "save refused: " + error);
            if (error == null)
            {
                // What XAE holds now (it can differ slightly from what was sent) is the new saved version; recording it
                // keeps our own write from coming back as a change made in XAE
                var confirmed = files.Select(f => new { path = f.Path, content = HostFiles.CurrentContent(_pane, f.Path) }).ToList();
                foreach (var c in confirmed) _lastSeen[c.path] = HostFiles.ContentKey(c.content);
                var names = string.Join(", ", files.Select(f => Path.GetFileName(f.Path)));
                var where = viaXae.Count == files.Count
                    ? "into the TwinCAT project (XAE updated it and wrote the file)"
                    : viaXae.Count == 0 ? "to disk (not part of an open TwinCAT project)" : "into the TwinCAT project / to disk";
                Post(new { type = "saveResult", ok = true, files = confirmed, message = $"Saved {names} {where}. A backup is in %LocalAppData%\\KvalStateScope\\Backups." });
            }
            else
            {
                Post(new { type = "saveResult", ok = false, message = error });
            }
        }

        // ---------------------------------------------------------------------------------------------------------
        // Changes made in XAE / on disk: a loaded file that changes is sent to the app, which refreshes the diagram
        // (or asks, when it has unsaved edits of that file)
        // ---------------------------------------------------------------------------------------------------------
        private void Watch(string folder)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder) || _watchers.ContainsKey(folder)) return;
            // A folder already watched with its subfolders covers this one
            var sep = Path.DirectorySeparatorChar;
            if (_watchers.Keys.Any(w => (folder + sep).StartsWith(w.TrimEnd(sep) + sep, StringComparison.OrdinalIgnoreCase))) return;
            try
            {
                var watcher = new FileSystemWatcher(folder)
                {
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size,
                };
                watcher.Changed += OnFileEvent;
                watcher.Created += OnFileEvent;
                watcher.Renamed += OnFileEvent;
                watcher.EnableRaisingEvents = true;
                _watchers[folder] = watcher;
            }
            catch (Exception ex) when (ex is ArgumentException || ex is IOException)
            {
                Log.Write($"cannot watch {folder}: {ex.Message}");
            }
        }

        private void ResetWatchers()
        {
            foreach (var w in _watchers.Values) w.Dispose();
            _watchers.Clear();
        }

        // Watcher thread: collect the path, then check it on the UI thread once the writes have settled
        private void OnFileEvent(object sender, FileSystemEventArgs e)
        {
            var path = e.FullPath;
            lock (_pendingChecks)
            {
                if (!_pendingChecks.Add(path)) return;
            }
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await Task.Delay(600);
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                lock (_pendingChecks) _pendingChecks.Remove(path);
                CheckForChange(path);
            });
        }

        private void CheckForChange(string path)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!_lastSeen.TryGetValue(path, out var lastKey) || !File.Exists(path)) return;
            string content;
            try
            {
                content = HostFiles.CurrentContent(_pane, path);
            }
            catch (IOException)
            {
                // Still being written: the next event checks again
                return;
            }
            var key = HostFiles.ContentKey(content);
            if (key == lastKey) return;
            _lastSeen[path] = key;
            Log.Write($"changed in XAE / on disk: {path}");
            Post(new { type = "sourceChanged", path, name = Path.GetFileName(path), content });
        }
    }

    /// <summary>Diagnostics for the prototype: %LocalAppData%KvalStateScopelog.txt (kept small)</summary>
    internal static class Log
    {
        private static readonly string File = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KvalStateScope", "log.txt");

        public static void Write(string message)
        {
            try
            {
                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(File));
                if (System.IO.File.Exists(File) && new FileInfo(File).Length > 512 * 1024) System.IO.File.Delete(File);
                System.IO.File.AppendAllText(File, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}  {message}{Environment.NewLine}");
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}
