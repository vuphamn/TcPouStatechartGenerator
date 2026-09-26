using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio.TextManager.Interop;
using Microsoft.VisualStudio.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace KvalStateScope.Xae
{
    /// <summary>
    /// Hosts the Kval StateScope web app in WebView2 and answers its requests (messages as JSON objects):
    ///   app -> host: ready, browsePou, findDut, chooseDutFiles, save, navigate, liveStart, liveStop, liveWatch
    ///   host -> app: loadPou, dutCandidates, saveResult, sourceChanged, liveStatus, liveValues, liveWatchResult, liveVars
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
        private string _pendingInstance;
        private Dictionary<string, string> _pendingConnection;
        private string _pouPath;
        // The PLC instance this tab follows: the one it was opened for (Open instance), then the one live found
        private string _instance;
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
        // Shared by every StateScope tab of this IDE: one browser process and one profile for all of them
        private static CoreWebView2Environment _environment;

        private async Task StartWebViewAsync(string userData)
        {
            const int ProfileBusy = unchecked((int)0x8007139F);
            if (_environment != null)
            {
                try
                {
                    await _web.EnsureCoreWebView2Async(_environment);
                    return;
                }
                catch (System.Runtime.InteropServices.COMException ex)
                {
                    Log.Write("shared browser environment not usable, creating another: " + ex.Message);
                    _environment = null;
                    NewWebView();
                }
            }
            RemoveStaleSessionProfiles(userData);
            for (var attempt = 1; ; attempt++)
            {
                var profile = attempt <= 6 ? userData : $"{userData}-{System.Diagnostics.Process.GetCurrentProcess().Id}";
                try
                {
                    var env = await CoreWebView2Environment.CreateAsync(null, profile);
                    await _web.EnsureCoreWebView2Async(env);
                    _environment = env;
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

        /// <summary>The .TcPOU this tab shows (or will show once the app is ready); null when none</summary>
        internal string PouPath => _pouPath ?? _pendingPou;

        /// <summary>The PLC instance of the POU this tab follows (or was opened for); null when none yet</summary>
        internal string Instance => _pendingPou != null ? _pendingInstance : _instance;

        /// <summary>"StateScope: SM_X", with the followed instance: "StateScope: SM_X (MAIN.fbLine1.smX)"</summary>
        private void UpdateCaption()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (_pouPath == null) return;
            _pane.Caption = "StateScope: " + Path.GetFileNameWithoutExtension(_pouPath) + (string.IsNullOrEmpty(_instance) ? "" : $" ({_instance})");
        }

        /// <summary>
        /// Loads a .TcPOU (and the .TcDUT candidates of its folder tree) into the app. instance: the tab follows that
        /// PLC instance of it and goes live on it (Live's Open instance)
        /// </summary>
        public void LoadPou(string pouPath, string instance = null, Dictionary<string, string> connection = null)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!_appReady)
            {
                _pendingPou = pouPath;
                _pendingInstance = instance;
                _pendingConnection = connection;
                return;
            }
            try
            {
                var folder = Path.GetDirectoryName(pouPath);
                var duts = HostFiles.FindDutFiles(folder);
                // XAE's copy when the POU belongs to an open TwinCAT project (same as the file unless changed in XAE)
                var content = HostFiles.CurrentContent(_pane, pouPath);
                if (!string.Equals(_pouPath, pouPath, StringComparison.OrdinalIgnoreCase)) StopLive(true);
                _pouPath = pouPath;
                _instance = string.IsNullOrWhiteSpace(instance) ? null : instance.Trim();
                _lastSeen.Clear();
                _lastSeen[pouPath] = HostFiles.ContentKey(content);
                foreach (var d in duts) _lastSeen[d.path] = HostFiles.ContentKey(d.content);
                ResetWatchers();
                Watch(folder);
                Post(new
                {
                    type = "loadPou",
                    source = new { name = Path.GetFileName(pouPath), path = pouPath, content, dutCandidates = duts },
                    instance = _instance,
                    // The opener's PLC connection (Open instance / Watch: the same PLC)
                    connection,
                    live = _instance != null,
                });
                UpdateCaption();
                Log.Write($"loaded {pouPath} with {duts.Count} .TcDUT candidate(s){(_instance != null ? ", following " + _instance : "")}");
                _lastCaret = null;
                StartCaretWatch();
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
                            var pi = _pendingInstance;
                            var pc = _pendingConnection;
                            _pendingConnection = null;
                            _pendingPou = null;
                            _pendingInstance = null;
                            LoadPou(p, pi, pc);
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
                    case "liveStart":
                        HandleLiveStart(msg);
                        break;
                    case "liveStop":
                        StopLive(true);
                        break;
                    case "liveWatch":
                        HandleLiveWatch(msg);
                        break;
                    case "liveBrowse":
                        HandleLiveBrowse(msg);
                        break;
                    case "gitShow":
                        HandleGitShow(msg);
                        break;
                    case "openPou":
                        HandleOpenPou(msg);
                        break;
                    case "openInstance":
                        HandleOpenInstance(msg);
                        break;
                    case "projectPous":
                        HandleProjectPous();
                        break;
                    case "saveDocument":
                        HandleSaveDocument(msg);
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

        /// <summary>
        /// Opens another POU of the loaded POU's PLC project in this tab: a state machine the diagram references
        /// (typeName, e.g. "SM_KAxis") or a previous one (path, the app's Back)
        /// </summary>
        private void HandleOpenPou(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var typeName = msg.TryGetValue("typeName", out var t) ? t as string : null;
            var path = msg.TryGetValue("path", out var p) ? p as string : null;
            var plcproj = _pouPath != null ? LiveTargets.PlcProjectFile(_pouPath) : null;
            if (plcproj == null)
            {
                Post(new { type = "error", message = "The POU is not in a PLC project folder" });
                return;
            }
            var root = Path.GetDirectoryName(plcproj);
            string target = null;
            if (!string.IsNullOrEmpty(path))
            {
                var full = Path.GetFullPath(path);
                if (full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && full.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase) && File.Exists(full)) target = full;
            }
            else if (!string.IsNullOrEmpty(typeName) && System.Text.RegularExpressions.Regex.IsMatch(typeName, @"^[A-Za-z_]\w*$"))
            {
                try
                {
                    target = Directory.EnumerateFiles(root, typeName + ".TcPOU", SearchOption.AllDirectories).FirstOrDefault();
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { }
            }
            if (target == null)
            {
                Post(new { type = "error", message = $"{(typeName ?? Path.GetFileName(path ?? ""))}.TcPOU was not found in {Path.GetFileName(plcproj)}" });
                return;
            }
            Log.Write($"open: {Path.GetFileName(target)} ({(typeName != null ? "referenced by " + Path.GetFileName(_pouPath) : "back")})");
            LoadPou(target);
        }

        /// <summary>The .TcPOU of a POU type in the loaded POU's PLC project, or null</summary>
        private string FindPouInProject(string typeName)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var plcproj = _pouPath != null ? LiveTargets.PlcProjectFile(_pouPath) : null;
            if (plcproj == null || !System.Text.RegularExpressions.Regex.IsMatch(typeName ?? "", @"^[A-Za-z_]\w*$")) return null;
            try
            {
                return Directory.EnumerateFiles(Path.GetDirectoryName(plcproj), typeName + ".TcPOU", SearchOption.AllDirectories).FirstOrDefault();
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { return null; }
        }

        /// <summary>
        /// Live's Open instance: another tab on this tab's POU that follows another PLC instance of it (the tab that
        /// already follows it comes forward)
        /// </summary>
        private void HandleOpenInstance(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var path = msg.TryGetValue("path", out var p) ? p as string : null;
            var typeName = msg.TryGetValue("typeName", out var t) ? t as string : null;
            var instance = msg.TryGetValue("instance", out var i) ? (i as string)?.Trim() : null;
            // The opener's PLC connection: short strings only (the app keeps the keys it knows)
            var connection = msg.TryGetValue("connection", out var c) && c is Dictionary<string, object> cd
                ? cd.Where(kv => kv.Key.Length <= 20 && kv.Value is string sv && sv.Length <= 200).Take(16).ToDictionary(kv => kv.Key, kv => (string)kv.Value)
                : null;
            if (string.IsNullOrEmpty(instance) || !System.Text.RegularExpressions.Regex.IsMatch(instance, @"^[A-Za-z_][\w.\[\], ]*$")) return;
            // Symbol browser's Watch: another state machine type, found in this POU's PLC project
            if (!string.IsNullOrEmpty(typeName))
            {
                path = FindPouInProject(typeName);
                if (path == null)
                {
                    Post(new { type = "error", message = $"{typeName}.TcPOU was not found in the PLC project" });
                    return;
                }
            }
            // Else only this tab's POU, and an instance path (MAIN.fbLine.smX, GVL.aX[2])
            else if (path == null || !string.Equals(path, _pouPath, StringComparison.OrdinalIgnoreCase)) return;
            var package = KvalStateScopePackage.Instance;
            if (package == null) return;
            Log.Write($"open instance: {instance} of {Path.GetFileName(path)}");
            _ = package.JoinableTaskFactory.RunAsync(async () =>
            {
                try
                {
                    await package.ShowStateScopeAsync(path, instance, connection);
                }
                catch (Exception ex)
                {
                    await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                    Post(new { type = "error", message = ex.Message });
                }
            });
        }

        /// <summary>Project documentation: the state machine POUs (with a doState method) and all enums of the PLC project</summary>
        private void HandleProjectPous()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var plcproj = _pouPath != null ? LiveTargets.PlcProjectFile(_pouPath) : null;
            if (plcproj == null)
            {
                Post(new { type = "projectPous", error = "The POU is not in a PLC project folder" });
                return;
            }
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                var root = Path.GetDirectoryName(plcproj);
                var pous = new List<object>();
                var duts = new List<object>();
                var skip = new[] { "_Boot", "_CompileInfo", "_Libraries", "_Deployment" };
                foreach (var file in Directory.EnumerateFiles(root, "*.*", SearchOption.AllDirectories))
                {
                    var rel = file.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar);
                    if (skip.Any(s => rel.StartsWith(s + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))) continue;
                    var isPou = file.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase);
                    if (!isPou && !file.EndsWith(".TcDUT", StringComparison.OrdinalIgnoreCase)) continue;
                    string content;
                    try { content = File.ReadAllText(file).TrimStart('﻿'); }
                    catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { continue; }
                    if (isPou)
                    {
                        if (content.IndexOf("Name=\"doState\"", StringComparison.OrdinalIgnoreCase) >= 0) pous.Add(new { name = Path.GetFileName(file), path = file, content });
                    }
                    else duts.Add(new { name = Path.GetFileName(file), relativePath = rel.Replace('\\', '/'), path = file, content });
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Log.Write($"docs: {pous.Count} state machine POU(s), {duts.Count} enum file(s) in {Path.GetFileName(plcproj)}");
                Post(new { type = "projectPous", project = Path.GetFileNameWithoutExtension(plcproj), pous, duts });
            });
        }

        /// <summary>Saves a document (the project documentation) where the user chooses, then opens it</summary>
        private void HandleSaveDocument(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var name = msg.TryGetValue("name", out var n) ? n as string : null;
            var content = msg.TryGetValue("content", out var c) ? c as string : null;
            if (content == null)
            {
                Post(new { type = "saveDocumentResult", error = "Nothing to save" });
                return;
            }
            var plcproj = _pouPath != null ? LiveTargets.PlcProjectFile(_pouPath) : null;
            var dialog = new Microsoft.Win32.SaveFileDialog
            {
                Title = "Save the documentation",
                FileName = string.IsNullOrEmpty(name) ? "documentation.html" : Path.GetFileName(name),
                Filter = "HTML document (*.html)|*.html",
                InitialDirectory = plcproj != null ? Path.GetDirectoryName(Path.GetDirectoryName(plcproj)) : null,
            };
            if (dialog.ShowDialog() != true)
            {
                Post(new { type = "saveDocumentResult", canceled = true });
                return;
            }
            try
            {
                File.WriteAllText(dialog.FileName, content, new System.Text.UTF8Encoding(false));
                Log.Write("docs: saved " + dialog.FileName);
                try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(dialog.FileName) { UseShellExecute = true }); }
                catch (System.ComponentModel.Win32Exception) { }
                Post(new { type = "saveDocumentResult", path = dialog.FileName });
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                Post(new { type = "saveDocumentResult", error = ex.Message });
            }
        }

        // ---- Two-way selection: where the caret is in TwinCAT's editor of the loaded POU ----

        private System.Windows.Threading.DispatcherTimer _caretTimer;
        private string _lastCaret;

        private void StartCaretWatch()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (_caretTimer != null) return;
            _caretTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(350) };
            _caretTimer.Tick += (s, e) => CheckCaret();
            _caretTimer.Start();
        }

        private void CheckCaret()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!_appReady || _pouPath == null) return;
            if (!(Package.GetGlobalService(typeof(SVsShellMonitorSelection)) is IVsMonitorSelection monitor)) return;
            if (ErrorHandler.Failed(monitor.GetCurrentElementValue((uint)VSConstants.VSSELELEMID.SEID_DocumentFrame, out var frameObj)) || !(frameObj is IVsWindowFrame frame)) return;
            if (ErrorHandler.Failed(frame.GetProperty((int)__VSFPROPID.VSFPROPID_Caption, out var captionObj)) || !(captionObj is string caption)) return;
            // TwinCAT's method editor: "SM_X.doState" (maybe with a suffix such as " [Online]")
            var prefix = Path.GetFileNameWithoutExtension(_pouPath) + ".";
            if (!caption.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return;
            var method = caption.Substring(prefix.Length).Split(' ')[0];
            if (ErrorHandler.Failed(frame.GetProperty((int)__VSFPROPID.VSFPROPID_DocView, out var docView)) || !(docView is IVsTextView view)) return;
            if (ErrorHandler.Failed(view.GetCaretPos(out var line, out _))) return;
            var lineCount = 0;
            if (ErrorHandler.Succeeded(view.GetBuffer(out var buffer)) && buffer != null) buffer.GetLineCount(out lineCount);
            var key = $"{method}:{line}:{lineCount}";
            if (key == _lastCaret) return;
            _lastCaret = key;
            Post(new { type = "editorCaret", method, line = line + 1, lineCount });
        }

        /// <summary>Compare: the committed (git HEAD) version of a loaded file, from its folder's repository</summary>
        private void HandleGitShow(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var path = msg.TryGetValue("path", out var p) ? p as string : null;
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            if (path == null || !_lastSeen.ContainsKey(path))
            {
                Post(new { type = "gitShowResult", requestId, error = "Not a file loaded in StateScope" });
                return;
            }
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                string content = null, error = null;
                try
                {
                    var psi = new System.Diagnostics.ProcessStartInfo("git", $"-C \"{Path.GetDirectoryName(path)}\" show \"HEAD:./{Path.GetFileName(path)}\"")
                    {
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        CreateNoWindow = true,
                        StandardOutputEncoding = System.Text.Encoding.UTF8,
                        StandardErrorEncoding = System.Text.Encoding.UTF8,
                    };
                    using (var proc = System.Diagnostics.Process.Start(psi))
                    {
                        var output = proc.StandardOutput.ReadToEndAsync();
                        var errors = proc.StandardError.ReadToEndAsync();
                        if (!proc.WaitForExit(15000))
                        {
                            try { proc.Kill(); } catch (InvalidOperationException) { }
                            error = "git did not answer";
                        }
                        else if (proc.ExitCode != 0)
                        {
                            var text = await errors;
                            error = text.Contains("not a git repository") ? "The file is not in a git repository"
                                : text.Contains("exists on disk, but not in") || text.Contains("does not exist in") ? "The file is not committed yet"
                                : text.Trim().Split('\n')[0].Trim();
                        }
                        else content = (await output).TrimStart('﻿');
                    }
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    error = "git is not installed (or not on the PATH)";
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Log.Write($"git: {Path.GetFileName(path)} at HEAD: {(error ?? $"{content.Length} chars")}");
                Post(new { type = "gitShowResult", requestId, content, error });
            });
        }

        // ---- Live view: the POU's state variable in the running PLC, over ADS ----

        private LiveMonitor _live;
        private System.Windows.Threading.DispatcherTimer _liveTimer;
        // Raised by every start / stop, so a connection still being made for an older request is dropped
        private int _liveSession;
        private int _liveTicks;
        private bool _liveStateCheck;
        // Guard variables: the latest set asked for, applied on a worker thread (one at a time)
        private List<KeyValuePair<string, List<string>>> _liveWatchWanted;
        private bool _liveWatchRunning;
        private static readonly System.Text.RegularExpressions.Regex SymbolPath =
            new System.Text.RegularExpressions.Regex(@"^[A-Za-z_]\w*(\[-?\d+\]|\^)*(\.[A-Za-z_]\w*(\[-?\d+\]|\^)*)*$");

        /// <summary>liveWatch: the guard variables to follow ({ id, candidates }[]), replacing the previous set</summary>
        private void HandleLiveWatch(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!msg.TryGetValue("vars", out var raw) || !(raw is System.Collections.IEnumerable list) || raw is string) return;
            var wanted = new List<KeyValuePair<string, List<string>>>();
            foreach (var item in list.OfType<Dictionary<string, object>>())
            {
                var id = item.TryGetValue("id", out var i) ? i as string : null;
                var candidates = item.TryGetValue("candidates", out var c) && c is System.Collections.IEnumerable cl && !(c is string)
                    ? cl.OfType<string>().Where(p => p.Length <= 250 && SymbolPath.IsMatch(p)).Take(4).ToList()
                    : new List<string>();
                if (string.IsNullOrEmpty(id) || id.Length > 250 || candidates.Count == 0) continue;
                wanted.Add(new KeyValuePair<string, List<string>>(id, candidates));
                if (wanted.Count >= 300) break;
            }
            _liveWatchWanted = wanted;
            ApplyLiveWatch();
        }

        /// <summary>Symbol browser: a symbol's members in the connected PLC (answered with liveBrowseResult)</summary>
        private void HandleLiveBrowse(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var path = msg.TryGetValue("path", out var p) ? (p as string)?.Trim() : null;
            var stateVar = msg.TryGetValue("stateVar", out var v) && v is string sv && System.Text.RegularExpressions.Regex.IsMatch(sv, @"^[A-Za-z_]\w*$") ? sv : "machineState";
            var monitor = _live;
            if (string.IsNullOrEmpty(path) || path.Length > 250 || !SymbolPath.IsMatch(path))
            {
                Post(new { type = "liveBrowseResult", requestId, path, error = "Not a symbol path" });
                return;
            }
            if (monitor == null)
            {
                Post(new { type = "liveBrowseResult", requestId, path, error = "Not connected" });
                return;
            }
            var session = _liveSession;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                LiveMonitor.BrowseResult result;
                try { result = monitor.Browse(path, stateVar); }
                catch (Exception ex) when (ex is AdsException || ex is ArgumentException || ex is IndexOutOfRangeException)
                {
                    result = new LiveMonitor.BrowseResult { path = path, error = ex.Message };
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                if (session != _liveSession) return;
                Post(new
                {
                    type = "liveBrowseResult", requestId, result.path, result.symbolType, result.kind, result.stateMachine, result.stateType, result.stateNames, result.truncated, result.children, result.error,
                });
            });
        }

        private void ApplyLiveWatch()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var monitor = _live;
            if (monitor == null || _liveWatchRunning || _liveWatchWanted == null) return;
            var wanted = _liveWatchWanted;
            _liveWatchWanted = null;
            _liveWatchRunning = true;
            var session = _liveSession;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                List<LiveMonitor.VarResult> results = null;
                try { results = monitor.SetVars(wanted); }
                catch (Exception ex) when (!(ex is OutOfMemoryException)) { Log.Write("live: watch: " + ex.Message); }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                _liveWatchRunning = false;
                if (session != _liveSession) return;
                if (results != null && results.Count > 0) Post(new { type = "liveWatchResult", vars = results });
                // A newer set arrived meanwhile
                ApplyLiveWatch();
            });
        }

        /// <summary>Connects (on a worker thread), finds the instance, subscribes; values are posted every 50 ms</summary>
        private void HandleLiveStart(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var path = msg.TryGetValue("path", out var p) ? p as string : null;
            if (path == null || !_lastSeen.ContainsKey(path)) return;
            var stateVar = (msg.TryGetValue("stateVar", out var v) ? v as string : null) ?? "machineState";
            var instance = msg.TryGetValue("instance", out var i) ? (i as string)?.Trim() : null;
            var netId = msg.TryGetValue("netId", out var n) ? (n as string)?.Trim() : null;
            var port = msg.TryGetValue("port", out var po) && po is int pi && pi > 0 && pi < 65536 ? (ushort)pi : (ushort)0;

            StopLive(false);
            var session = ++_liveSession;
            var pouName = Path.GetFileNameWithoutExtension(path);
            var targetNetId = string.IsNullOrEmpty(netId) ? TwinCATProject.TargetNetId(_pane, path) : netId;
            var amsPort = port != 0 ? port : LiveTargets.PlcPort(path);
            PostLive("connecting", $"Connecting to {targetNetId ?? "the local system"}, port {amsPort}...");
            Log.Write($"live: start {pouName}.{stateVar} on {targetNetId ?? "local"}:{amsPort} (instance {instance ?? "auto"})");

            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                var monitor = new LiveMonitor();
                string chosen = null, plcState = null, type = null, error = null;
                var found = new List<string>();
                try
                {
                    plcState = monitor.Connect(targetNetId, amsPort);
                    var candidates = LiveTargets.InstancePaths(path, pouName);
                    if (!string.IsNullOrEmpty(instance)) candidates.Insert(0, instance);
                    LiveMonitor.SymbolInfo info = null;
                    foreach (var c in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
                    {
                        var s = monitor.Probe(c + "." + stateVar);
                        if (s == null) continue;
                        found.Add(c);
                        if (chosen == null) { chosen = c; info = s; }
                    }
                    if (chosen == null)
                    {
                        throw new AdsException(candidates.Count == 0
                            ? $"No instance of {pouName} was found in the PLC project: enter its path (e.g. MAIN.fbX)"
                            : $"The PLC ({plcState}) has none of {string.Join(", ", candidates.Take(3))}{(candidates.Count > 3 ? ", ..." : "")}: is the current program downloaded? Or enter the instance path", 0);
                    }
                    type = info.Type;
                    monitor.Subscribe(chosen + "." + stateVar, info.Size);
                }
                catch (Exception ex) when (ex is AdsException || ex is DllNotFoundException || ex is EntryPointNotFoundException || ex is BadImageFormatException)
                {
                    error = ex.Message;
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                if (error != null || session != _liveSession)
                {
                    _ = Task.Run(() => monitor.Dispose());
                    if (error != null && session == _liveSession)
                    {
                        Log.Write("live: " + error);
                        PostLive("error", error, found);
                    }
                    return;
                }
                _live = monitor;
                _liveTicks = 0;
                ApplyLiveWatch();
                _liveTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
                _liveTimer.Tick += OnLiveTick;
                _liveTimer.Start();
                Log.Write($"live: following {chosen}.{stateVar} ({type}) on {monitor.TargetText}, PLC {plcState}");
                // The tab now follows this instance (its caption says which; Open instance finds it by it)
                _instance = chosen;
                UpdateCaption();
                Post(new
                {
                    type = "liveStatus",
                    state = "connected",
                    message = $"{chosen}.{stateVar} on {monitor.TargetText} (PLC {plcState})",
                    target = monitor.TargetText,
                    plcState,
                    instance = chosen,
                    instances = found,
                    symbolType = type,
                });
            });
        }

        private void OnLiveTick(object sender, EventArgs e)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var monitor = _live;
            if (monitor == null) return;
            var samples = monitor.Drain();
            if (samples.Count > 0) Post(new { type = "liveValues", events = samples });
            var values = monitor.DrainVars();
            if (values.Count > 0) Post(new { type = "liveVars", values });
            // Every 2 s: is the PLC still there and running?
            if (++_liveTicks % 40 != 0 || _liveStateCheck) return;
            _liveStateCheck = true;
            var session = _liveSession;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                string state = null, error = null;
                await TaskScheduler.Default;
                try { state = monitor.ReadState(); }
                catch (AdsException ex) { error = ex.Message; }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                _liveStateCheck = false;
                if (session != _liveSession) return;
                if (error != null) Post(new { type = "liveStatus", state = "lost", message = "Connection lost: " + error });
                else Post(new { type = "liveStatus", state = "plcState", plcState = state });
            });
        }

        private void PostLive(string state, string message, List<string> instances = null)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            Post(new { type = "liveStatus", state, message, instances = instances ?? new List<string>() });
        }

        private void StopLive(bool notify)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            _liveSession++;
            _liveWatchWanted = null;
            _liveWatchRunning = false;
            if (_liveTimer != null)
            {
                _liveTimer.Stop();
                _liveTimer.Tick -= OnLiveTick;
                _liveTimer = null;
            }
            var monitor = _live;
            _live = null;
            if (monitor != null)
            {
                // ADS calls block (up to the timeout): not on the UI thread
                _ = Task.Run(() => monitor.Dispose());
                Log.Write("live: stopped");
            }
            if (notify && _appReady) PostLive("stopped", "Not connected");
        }

        /// <summary>The tab is closing: stop the live view and the file watchers</summary>
        internal void Shutdown()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            StopLive(false);
            ResetWatchers();
            _caretTimer?.Stop();
            _caretTimer = null;
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
