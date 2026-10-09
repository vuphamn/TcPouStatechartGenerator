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
// (the Visual Studio 2017 SDK also has a Shell.Task)
using Task = System.Threading.Tasks.Task;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// Hosts the Kval MachineScope web app in WebView2 and answers its requests (messages as JSON objects):
    ///   app -> host: ready, browsePou, findDut, chooseDutFiles, save, navigate, liveStart, liveStop, liveWatch, discoverPlcs
    ///   host -> app: loadPou, dutCandidates, saveResult, sourceChanged, liveStatus, liveValues, liveWatchResult, liveVars, plcList
    /// </summary>
    internal sealed partial class MachineScopeControl : UserControl, ISaveAllTab
    {
        private const string AppHost = "machinescope.example";

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

        public MachineScopeControl(ToolWindowPane pane)
        {
            _pane = pane;
            Background = new SolidColorBrush(Color.FromRgb(0x02, 0x06, 0x17));
            _status.Text = "Starting Kval MachineScope...";
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
        // Shared by every MachineScope tab of this IDE: one browser process and one profile for all of them
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
                    _status.Text = "Starting Kval MachineScope... (waiting for a previous session to close)";
                    NewWebView();
                    await Task.Delay(1500);
                }
            }
        }

        private static string ExtensionDir => Path.GetDirectoryName(typeof(MachineScopeControl).Assembly.Location);

        private async Task InitializeAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            try
            {
                if (_web.CoreWebView2 != null) return;
                var appDir = Path.Combine(ExtensionDir, "MachineScopeApp");
                if (!File.Exists(Path.Combine(appDir, "index.html")))
                    throw new FileNotFoundException("The MachineScope app files are missing from the extension", Path.Combine(appDir, "index.html"));
                // The IDE's install folder is read-only: keep the browser profile per user
                var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KvalMachineScope", "WebView2");
                Log.Write($"creating WebView2 environment (runtime {CoreWebView2Environment.GetAvailableBrowserVersionString()}, profile {userData})");
                await StartWebViewAsync(userData);
                Log.Write("WebView2 ready");

                var core = _web.CoreWebView2;
                core.SetVirtualHostNameToFolderMapping(AppHost, appDir, CoreWebView2HostResourceAccessKind.Allow);
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDevToolsEnabled = true; // prototype: F12 for diagnostics
                core.WebMessageReceived += OnWebMessage;
                // Save All from another MachineScope tab reaches this one (and its answer goes back)
                SaveAllRelay.Register(this);
                core.NewWindowRequested += (s, e) =>
                {
                    // A tab moved to a window of its own (the app's window.html): WebView2's popup window, the page fills it
                    if (string.IsNullOrEmpty(e.Uri) || e.Uri == "about:blank") return;
                    if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && string.Equals(uri.Host, AppHost, StringComparison.OrdinalIgnoreCase)) return;
                    // Links such as mermaid.live open in the default browser
                    e.Handled = true;
                    if (uri != null && (uri.Scheme == "https" || uri.Scheme == "http"))
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                };
                _status.Visibility = System.Windows.Visibility.Collapsed;
                _web.Source = new Uri($"https://{AppHost}/index.html");
                Log.Write("navigating to the app");
            }
            catch (Exception ex) when (ex is WebView2RuntimeNotFoundException)
            {
                Log.Write("WebView2 runtime not found: " + ex.Message);
                _status.Text = "Kval MachineScope needs the Microsoft Edge WebView2 Runtime. Install it from https://developer.microsoft.com/microsoft-edge/webview2/ and reopen this window.";
            }
            catch (Exception ex)
            {
                Log.Write("start failed: " + ex);
                _status.Text = $"Kval MachineScope could not start: {ex.GetType().Name}: {ex.Message}. Close and reopen this tab to try again.";
                NewWebView();
                _initialization = null;
            }
        }

        // (the IDE: TabMemory keeps each IDE's tabs apart)
        private static readonly string Ide = System.Diagnostics.Process.GetCurrentProcess().ProcessName;

        /// <summary>This tab's number among the MachineScope tabs (the IDE restores it by that number); -1 when unknown</summary>
        private int TabNumber
        {
            get
            {
                ThreadHelper.ThrowIfNotOnUIThread();
                try
                {
                    if (_pane.Frame is IVsWindowFrame frame && ErrorHandler.Succeeded(frame.GetProperty((int)__VSFPROPID.VSFPROPID_MultiInstanceToolNum, out var n)) && n is int number) return number;
                }
                catch (System.Runtime.InteropServices.COMException) { }
                return -1;
            }
        }

        /// <summary>The .TcPOU this tab shows (or will show once the app is ready); null when none</summary>
        internal string PouPath => _pouPath ?? _pendingPou;

        /// <summary>The PLC instance of the POU this tab follows (or was opened for); null when none yet</summary>
        internal string Instance => _pendingPou != null ? _pendingInstance : _instance;

        /// <summary>"MachineScope: SM_X", with the followed instance: "MachineScope: SM_X (MAIN.fbLine1.smX)"</summary>
        private void UpdateCaption()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (_pouPath == null) return;
            _pane.Caption = "MachineScope: " + Path.GetFileNameWithoutExtension(_pouPath) + (string.IsNullOrEmpty(_instance) ? "" : $" ({_instance})");
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
                // (the IDE restores this tab when it opens again: it shows this POU then)
                TabMemory.Remember(Ide, TabNumber, pouPath);
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

        // (SaveAllRelay: every tool window is on the UI thread)
        void ISaveAllTab.PostToApp(object message)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (_appReady) Post(message);
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
                        else if (_pouPath == null)
                        {
                            // A tab the IDE restored (it was open when the IDE closed): the POU it showed then
                            var last = TabMemory.Recall(Ide, TabNumber);
                            if (last != null)
                            {
                                Log.Write($"restored tab {TabNumber}: {last}");
                                LoadPou(last);
                            }
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
                    case "discoverPlcs":
                        HandleDiscoverPlcs(msg);
                        break;
                    case "addRoute":
                        HandleAddRoute(msg);
                        break;
                    case "probePlcs":
                        HandleProbePlcs(msg);
                        break;
                    case "hostInfo":
                        Post(new { type = "hostInfo", edition = "xae", version = typeof(MachineScopeControl).Assembly.GetName().Version.ToString(3) });
                        break;
                    case "gitShow":
                        HandleGitShow(msg);
                        break;
                    case "layoutRead":
                    case "layoutWrite":
                        HandleLayoutFile(msg, type == "layoutWrite");
                        break;
                    case "openPou":
                        HandleOpenPou(msg);
                        break;
                    case "openInXae":
                        HandleOpenInXae(msg);
                        break;
                    case "openInstance":
                        HandleOpenInstance(msg);
                        break;
                    case "projectPous":
                        HandleProjectPous();
                        break;
                    case "findPou":
                        HandleFindPou(msg);
                        break;
                    case "activateProject":
                        HandleActivateProject(msg);
                        break;
                    case "projectVersions":
                        HandleProjectVersions(msg);
                        break;
                    case "revertProjectFiles":
                        HandleRevertProjectFiles(msg);
                        break;
                    case "projectBuilds":
                        HandleProjectBuilds(msg);
                        break;
                    case "openXaeFor":
                        HandleOpenXaeFor(msg);
                        break;
                    case "coverageFile":
                        HandleCoverageFile(msg);
                        break;
                    case "coverageFileSave":
                        HandleCoverageFileSave(msg);
                        break;
                    case "plcLicense":
                        HandlePlcLicense(msg);
                        break;
                    case "projectSymbols":
                        HandleProjectSymbols();
                        break;
                    case "projectUses":
                        HandleProjectUses(msg);
                        break;
                    case "saveOther":
                        HandleSaveOther(msg);
                        break;
                    case "saveDocument":
                        HandleSaveDocument(msg);
                        break;
                    case "buildProject":
                        HandleBuildProject(msg);
                        break;
                    // Save All: to the other MachineScope tabs; their answers back (the app matches them by id)
                    case "saveAllRelay":
                    case "saveAllDoneRelay":
                        {
                            var id = msg.TryGetValue("id", out var i) ? i as string : null;
                            var name = msg.TryGetValue("name", out var n) ? n as string : null;
                            var count = msg.TryGetValue("count", out var c) && c is int k ? k : 0;
                            SaveAllRelay.Relay(this, type == "saveAllRelay" ? "saveAll" : "saveAllDone", id, name, count);
                        }
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
                Post(new { type = "saveResult", ok = true, files = confirmed, message = $"Saved {names} {where}. A backup is in %LocalAppData%\\KvalMachineScope\\Backups." });
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
                var other = typeName != null ? FindInProject(typeName, ".TcDUT", ".TcIO") : null;
                Post(new { type = "error", message = other != null
                    ? $"{typeName} is a {(other.EndsWith(".TcDUT", StringComparison.OrdinalIgnoreCase) ? "DUT" : "interface")}, not a POU: open it in the TwinCAT editor"
                    : $"{(typeName ?? Path.GetFileName(path ?? ""))}.TcPOU was not found in {Path.GetFileName(plcproj)}" });
                return;
            }
            Log.Write($"open: {Path.GetFileName(target)} ({(typeName != null ? "referenced by " + Path.GetFileName(_pouPath) : "back")})");
            LoadPou(target);
        }

        /// <summary>
        /// A POU of the loaded POU's PLC project by type name, read only (a base the loaded POU EXTENDS, whose doState()
        /// and state methods it inherits): findPouResult { requestId, typeName, source { name, path, content,
        /// dutCandidates (its folder's) } } or { error }
        /// </summary>
        private void HandleFindPou(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var typeName = msg.TryGetValue("typeName", out var t) ? t as string : null;
            if (string.IsNullOrEmpty(typeName) || !System.Text.RegularExpressions.Regex.IsMatch(typeName, @"^[A-Za-z_]\w*$"))
            {
                Post(new { type = "findPouResult", requestId, typeName, error = "No POU name" });
                return;
            }
            try
            {
                var target = FindPouInProject(typeName);
                if (target == null)
                {
                    Post(new { type = "findPouResult", requestId, typeName, error = $"{typeName}.TcPOU was not found in the PLC project" });
                    return;
                }
                var content = HostFiles.CurrentContent(_pane, target);
                var duts = HostFiles.FindDutFiles(Path.GetDirectoryName(target));
                // (it and its enum can be edited and saved, as the POU's own folder's: known, and watched)
                _lastSeen[target] = HostFiles.ContentKey(content);
                Watch(Path.GetDirectoryName(target));
                foreach (var d in duts)
                {
                    _lastSeen[d.path] = HostFiles.ContentKey(d.content);
                    Watch(Path.GetDirectoryName(d.path));
                }
                Log.Write($"base POU: {target} ({duts.Count} .TcDUT candidate(s))");
                Post(new { type = "findPouResult", requestId, typeName, source = new { name = Path.GetFileName(target), path = target, content, dutCandidates = duts } });
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                Post(new { type = "findPouResult", requestId, typeName, error = $"{typeName}.TcPOU could not be read: {ex.Message}" });
            }
        }

        /// <summary>The .TcPOU of a POU type in the loaded POU's PLC project, or null</summary>
        private string FindPouInProject(string typeName) => FindInProject(typeName, ".TcPOU");

        /// <summary>The file of a type in the loaded POU's PLC project (the first extension found first), or null</summary>
        private string FindInProject(string typeName, params string[] extensions)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var plcproj = _pouPath != null ? LiveTargets.PlcProjectFile(_pouPath) : null;
            return plcproj == null ? null : ProjectScan.FindType(Path.GetDirectoryName(plcproj), typeName, extensions);
        }

        /// <summary>
        /// The code editors' Go to Definition on a type: that POU (or DUT, interface) of the loaded POU's PLC project
        /// opened in TwinCAT's editor, as a double-click in the project tree would
        /// </summary>
        private void HandleOpenInXae(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var typeName = msg.TryGetValue("typeName", out var t) ? t as string : null;
            // Go to Definition on a member: a method's editor, or the declaration's line (with its text)
            var method = msg.TryGetValue("method", out var mt) ? mt as string : null;
            var line = msg.TryGetValue("line", out var ln) && ln is int li ? li : 1;
            var text = msg.TryGetValue("text", out var tx) ? tx as string : null;
            if (method != null && !System.Text.RegularExpressions.Regex.IsMatch(method, @"^[A-Za-z_]\w*$")) method = null;
            var path = FindInProject(typeName, ".TcPOU", ".TcDUT", ".TcIO", ".TcGVL");
            if (path == null)
            {
                Post(new { type = "error", message = $"{typeName} was not found in the PLC project (a library type?)" });
                return;
            }
            Log.Write($"open in XAE: {Path.GetFileName(path)}{(method != null ? " " + method : line > 1 ? " line " + line : "")}");
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                string error;
                try
                {
                    error = await CodeNavigation.GoToAsync(_pane, path, method, method != null ? 1 : line, method != null ? null : text);
                }
                catch (Exception ex) when (!(ex is OutOfMemoryException))
                {
                    error = ex.Message;
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                // (GoToAsync's "Opened X; go to line 1": the editor opened, the caret was not placed)
                if (error != null && !error.StartsWith("Opened ", StringComparison.Ordinal)) Post(new { type = "error", message = error });
                Log.Write(error == null ? "open in XAE: done" : "open in XAE: " + error);
            });
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
            // (Compare: another PLC, the same instance: a tab of its own, not the one already following it)
            var newTab = msg.TryGetValue("newTab", out var nt) && nt is bool ntb && ntb;
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
            var package = KvalMachineScopePackage.Instance;
            if (package == null) return;
            Log.Write($"open instance: {instance} of {Path.GetFileName(path)}");
            _ = package.JoinableTaskFactory.RunAsync(async () =>
            {
                try
                {
                    await package.ShowMachineScopeAsync(path, instance, connection, newTab);
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

        /// <summary>
        /// Completion and the checks: the PLC project's .TcPOU / .TcGVL / .TcDUT / .TcIO files without their
        /// implementations (the declarations are what the app reads)
        /// </summary>
        private void HandleProjectSymbols()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var plcproj = _pouPath != null ? LiveTargets.PlcProjectFile(_pouPath) : null;
            if (plcproj == null)
            {
                Post(new { type = "projectSymbols", error = "The POU is not in a PLC project folder" });
                return;
            }
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                var files = ProjectScan.SymbolFiles(Path.GetDirectoryName(plcproj));
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Log.Write($"symbols: {files.Count} file(s) of {Path.GetFileName(plcproj)}");
                Post(new { type = "projectSymbols", project = Path.GetFileNameWithoutExtension(plcproj), files });
            });
        }

        /// <summary>
        /// A rename's other files: the PLC project's .TcPOU files (not this tab's) whose code has the name, in full
        /// </summary>
        private void HandleProjectUses(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var needle = msg.TryGetValue("name", out var n) ? n as string : null;
            var plcproj = _pouPath != null ? LiveTargets.PlcProjectFile(_pouPath) : null;
            if (plcproj == null || needle == null || !System.Text.RegularExpressions.Regex.IsMatch(needle, @"^[A-Za-z_]\w*$"))
            {
                Post(new { type = "projectUses", requestId, error = "The POU is not in a PLC project folder" });
                return;
            }
            var self = _pouPath;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                var files = ProjectScan.UsesOf(Path.GetDirectoryName(plcproj), needle, self);
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Log.Write($"uses of {needle}: {files.Count} other POU file(s)");
                Post(new { type = "projectUses", requestId, files });
            });
        }

        /// <summary>
        /// A rename's other files written (the PLC project's .TcPOU files, as a Save writes them: into XAE, with a
        /// backup; refused when a file changed since it was read)
        /// </summary>
        private void HandleSaveOther(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var plcproj = _pouPath != null ? LiveTargets.PlcProjectFile(_pouPath) : null;
            var root = plcproj != null ? Path.GetDirectoryName(plcproj) + Path.DirectorySeparatorChar : null;
            var files = new List<HostFiles.SaveRequest>();
            if (root != null && msg.TryGetValue("files", out var raw) && raw is System.Collections.IEnumerable list && !(raw is string))
            {
                foreach (var item in list.OfType<Dictionary<string, object>>())
                {
                    var path = item.TryGetValue("path", out var p) ? p as string : null;
                    var content = item.TryGetValue("content", out var c) ? c as string : null;
                    var baseline = item.TryGetValue("baseline", out var b) ? b as string : null;
                    if (path == null || content == null || baseline == null) continue;
                    var full = ProjectScan.ProjectPou(root, path);
                    if (full == null) continue;
                    files.Add(new HostFiles.SaveRequest { Path = full, Content = content, LoadedKey = HostFiles.ContentKey(baseline), Force = false });
                }
            }
            if (files.Count == 0)
            {
                Post(new { type = "saveOtherResult", requestId, ok = false, message = "No file of the PLC project to write" });
                return;
            }
            Log.Write($"save (rename): {string.Join(", ", files.Select(f => Path.GetFileName(f.Path)))}");
            var error = HostFiles.Save(_pane, files, out _);
            Log.Write(error == null ? "saved" : "save refused: " + error);
            Post(new { type = "saveOtherResult", requestId, ok = error == null, message = error ?? $"Wrote {files.Count} other POU(s): {string.Join(", ", files.Select(f => Path.GetFileName(f.Path)))}" });
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
            // A document (HTML, opened after saving), a live recording (JSON) or a table (CSV)
            var recording = (name ?? "").EndsWith(".json", StringComparison.OrdinalIgnoreCase);
            var csv = (name ?? "").EndsWith(".csv", StringComparison.OrdinalIgnoreCase);
            var plcproj = _pouPath != null ? LiveTargets.PlcProjectFile(_pouPath) : null;
            // (personal: a live recording, offered in the user's own folder, not the project's: not for git)
            var personal = msg.TryGetValue("personal", out var pe) && pe is bool pb && pb;
            string personalDir = null;
            if (personal)
            {
                try
                {
                    personalDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Kval MachineScope", "Recordings");
                    Directory.CreateDirectory(personalDir);
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { personalDir = null; }
            }
            var dialog = new Microsoft.Win32.SaveFileDialog
            {
                Title = recording ? "Save the live recording" : csv ? "Save the table" : "Save the documentation",
                FileName = string.IsNullOrEmpty(name) ? "documentation.html" : Path.GetFileName(name),
                Filter = recording ? "Live recording (*.json)|*.json" : csv ? "CSV (Excel) (*.csv)|*.csv" : "HTML document (*.html)|*.html",
                InitialDirectory = personalDir ?? (plcproj != null ? Path.GetDirectoryName(Path.GetDirectoryName(plcproj)) : null),
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
                if (!recording && !csv)
                {
                    try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(dialog.FileName) { UseShellExecute = true }); }
                    catch (System.ComponentModel.Win32Exception) { }
                }
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
        /// <summary>
        /// A POU's layout file beside it (&lt;POU&gt;.machinescope.json: the states' places, the transitions' routes, the
        /// notes; for git): read (layoutResult { requestId, text }, null: none yet) or written (text; { written }), only
        /// for a POU this tab loaded; written only when it changed, through a temp file
        /// </summary>
        private void HandleLayoutFile(Dictionary<string, object> msg, bool write)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var pou = msg.TryGetValue("path", out var p) ? p as string : null;
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var text = msg.TryGetValue("text", out var t) ? t as string : null;
            if (pou == null || !pou.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase) || !(string.Equals(pou, _pouPath, StringComparison.OrdinalIgnoreCase) || _lastSeen.ContainsKey(pou)))
            {
                Post(new { type = "layoutResult", requestId, error = "Not a POU loaded in MachineScope" });
                return;
            }
            var file = pou.Substring(0, pou.Length - ".TcPOU".Length) + ".machinescope.json";
            try
            {
                if (!write)
                {
                    Post(new { type = "layoutResult", requestId, text = File.Exists(file) ? File.ReadAllText(file) : null });
                    return;
                }
                if (text == null)
                {
                    var had = File.Exists(file);
                    if (had) File.Delete(file);
                    Post(new { type = "layoutResult", requestId, written = had });
                    return;
                }
                if (File.Exists(file) && File.ReadAllText(file) == text)
                {
                    Post(new { type = "layoutResult", requestId, written = false });
                    return;
                }
                var tmp = file + ".tmp";
                File.WriteAllText(tmp, text, new System.Text.UTF8Encoding(false));
                if (File.Exists(file)) File.Delete(file);
                File.Move(tmp, file);
                Post(new { type = "layoutResult", requestId, written = true });
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                Post(new { type = "layoutResult", requestId, error = ex.Message });
            }
        }

        private void HandleGitShow(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var path = msg.TryGetValue("path", out var p) ? p as string : null;
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            if (path == null || !_lastSeen.ContainsKey(path))
            {
                Post(new { type = "gitShowResult", requestId, error = "Not a file loaded in MachineScope" });
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

        /// <summary>The PLC switcher: which remembered PLCs answer (a TCP connect to their ADS router port, nothing sent)</summary>
        private void HandleProbePlcs(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var targets = (msg.TryGetValue("targets", out var t) && t is System.Collections.ArrayList list ? list.OfType<Dictionary<string, object>>() : Enumerable.Empty<Dictionary<string, object>>())
                .Take(50)
                .Select(x => new { key = x.TryGetValue("key", out var k) ? k as string ?? "" : "", ip = x.TryGetValue("ip", out var i) ? i as string ?? "" : "" })
                .ToList();
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                var reachable = new Dictionary<string, bool>();
                var tasks = targets.Select(async x =>
                {
                    var parts = x.ip.Split(':');
                    var port = parts.Length > 1 && int.TryParse(parts[1], out var p) ? p : 48898;
                    var ok = false;
                    if (System.Text.RegularExpressions.Regex.IsMatch(parts[0], @"^[A-Za-z0-9.-]{1,253}$"))
                    {
                        using (var c = new System.Net.Sockets.TcpClient())
                        {
                            try
                            {
                                var connect = c.ConnectAsync(parts[0], port);
                                ok = await Task.WhenAny(connect, Task.Delay(1500)).ConfigureAwait(false) == connect && c.Connected;
                            }
                            catch (System.Net.Sockets.SocketException) { ok = false; }
                        }
                    }
                    lock (reachable) reachable[x.key] = ok;
                });
                await Task.WhenAll(tasks);
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Post(new { type = "probeResult", requestId, reachable });
            });
        }

        /// <summary>Add Route from the Live tab's Browse, both ways through XAE (the password is not kept or logged)</summary>
        private void HandleAddRoute(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            string Text(string key) => msg.TryGetValue(key, out var v) ? (v as string ?? "").Trim() : "";
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var netId = Text("netId");
            var ip = Text("ip").Split(':')[0];
            var name = Text("name");
            if (!System.Text.RegularExpressions.Regex.IsMatch(netId, @"^\d{1,3}(\.\d{1,3}){5}$") || !System.Text.RegularExpressions.Regex.IsMatch(ip, @"^[A-Za-z0-9.-]{1,253}$"))
            {
                Post(new { type = "addRouteResult", requestId, ok = false, message = "The PLC's AMS NetId and IP address are needed" });
                return;
            }
            if (_pouPath == null)
            {
                Post(new { type = "addRouteResult", requestId, ok = false, message = "Open a POU of the TwinCAT project first" });
                return;
            }
            if (name.Length == 0 || name.Length > 60 || !System.Text.RegularExpressions.Regex.IsMatch(name, @"^[\w .-]+$")) name = ip;
            var error = TwinCATProject.AddRoute(_pane, _pouPath, name, netId, ip, Text("user"), msg.TryGetValue("password", out var pw) ? pw as string ?? "" : "");
            Log.Write($"route: add {name} ({netId}, {ip}): {error ?? "done"}");
            Post(new { type = "addRouteResult", requestId, ok = error == null, message = error == null ? $"Route added to {name} ({netId}), both ways" : $"Not added: {error}" });
        }

        /// <summary>The Live tab's Browse: the project's target, the router's routes and the devices on the network</summary>
        private void HandleDiscoverPlcs(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var addresses = (msg.TryGetValue("addresses", out var a) && a is System.Collections.ArrayList list ? list.OfType<string>() : Enumerable.Empty<string>())
                .Select(x => x.Trim()).Where(x => x.Length > 0 && x.Length < 254 && System.Text.RegularExpressions.Regex.IsMatch(x, @"^[A-Za-z0-9.-]+$")).Take(64).ToList();
            var projectTarget = _pouPath != null ? TwinCATProject.TargetNetId(_pane, _pouPath) : null;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                var errors = new List<string>();
                List<PlcSearch.Found> devices;
                try { devices = PlcSearch.Browse(addresses, errors); }
                catch (Exception ex) when (ex is System.Net.Sockets.SocketException || ex is IOException || ex is InvalidOperationException)
                {
                    devices = new List<PlcSearch.Found>();
                    errors.Add(ex.Message);
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Log.Write($"plc search: {devices.Count} device(s)");
                Post(new { type = "plcList", requestId, devices, errors, projectTarget });
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
                string chosen = null, plcState = null, type = null, error = null, instanceType = null;
                int? twinCatBuild = null, symbolVersion = null;
                Dictionary<string, string> stateNames = null;
                object activeProject = null;
                string plcBuildId = null;
                var found = new List<string>();
                try
                {
                    plcState = monitor.Connect(targetNetId, amsPort);
                    // (the PLC's TwinCAT build: the app says when this XAE is of another one)
                    twinCatBuild = monitor.ReadTwinCatBuild();
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
                    // (the instance's own type: the app says when it is not the loaded POU's; the symbol version: a
                    // new program downloaded later is noticed)
                    instanceType = monitor.Probe(chosen)?.Type;
                    symbolVersion = monitor.ReadSymbolVersion();
                    // (the state variable's enum as the PLC has it: the app compares it with the loaded .TcDUT; the
                    // project the PLC's configuration was activated from: the Live tab shows it)
                    try { stateNames = monitor.EnumNames(info.Type); } catch (AdsException) { }
                    activeProject = ActiveProjectOf(monitor);
                    // (the build the PLC runs: Boot\Plc\Port_<port>.cid, the GUID its .compileinfo is named by)
                    var cid = monitor.ReadBootFile($"Plc/Port_{amsPort}.cid");
                    if (cid != null && cid.Length >= 16) plcBuildId = new Guid(cid.Take(16).ToArray()).ToString().ToUpperInvariant();
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
                _liveSymbolVersion = symbolVersion;
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
                    instanceType,
                    stateNames,
                    activeProject,
                    compileInfo = CompareBuilds(plcBuildId, RecordProjectBuilds(_pouPath)),
                    loadedProject = LoadedProjectOf(_pouPath)?.name,
                    twinCatBuild,
                    xaeBuild = ActiveXaeBuild(out var xaeVersion),
                    xaeVersion,
                });
            });
        }

        /// <summary>
        /// This XAE's TwinCAT build: the Visual Studio 2017 build of the extension is in 4024's TcXaeShell; the other in a
        /// Visual Studio 2022 shell, 4024's 64-bit one or 4026's: this computer's TwinCAT's build (TwinCAT3\System's Build)
        /// </summary>
#if VS2017
        private static int XaeBuild => 4024;
#else
        private static int XaeBuild
        {
            get
            {
                try
                {
                    using (var key = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine, Microsoft.Win32.RegistryView.Registry32).OpenSubKey(@"SOFTWARE\Beckhoff\TwinCAT3\System"))
                    {
                        var build = key?.GetValue("Build") as int?;
                        if (build.HasValue && build.Value > 4000) return build.Value >= 4026 ? 4026 : 4024;
                    }
                }
                catch (System.Security.SecurityException) { }
                catch (System.IO.IOException) { }
                return 4026;
            }
        }
#endif

        /// <summary>
        /// The engineering build this XAE has loaded: its Remote Manager's version ("3.1.4024.59": 4024, version
        /// "4024.59"); without one (no Remote Manager, an older TwinCAT), the build guessed above
        /// </summary>
        private static int ActiveXaeBuild(out string version)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            version = null;
            try
            {
                if (Package.GetGlobalService(typeof(EnvDTE.DTE)) is EnvDTE.DTE dte)
                {
                    dynamic manager = dte.GetObject("TcRemoteManager");
                    string text = manager?.Version;
                    var m = System.Text.RegularExpressions.Regex.Match(text ?? "", @"^3\.1\.(\d{4})(?:\.(\d+))?");
                    if (m.Success)
                    {
                        version = m.Groups[2].Success ? $"{m.Groups[1].Value}.{m.Groups[2].Value}" : m.Groups[1].Value;
                        return int.Parse(m.Groups[1].Value);
                    }
                }
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException))
            {
                // (no Remote Manager here)
            }
            return XaeBuild;
        }

        /// <summary>
        /// The TwinCAT project the PLC's configuration was activated from (Boot\CurrentProjectInfo.json: its name, when,
        /// its PLC projects), or null (not there: TwinCAT 4024 may keep none)
        /// </summary>
        private static object ActiveProjectOf(LiveMonitor monitor)
        {
            try
            {
                var bytes = monitor.ReadBootFile("CurrentProjectInfo.json");
                if (bytes == null) return null;
                var text = System.Text.Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF');
                var info = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(text);
                var project = info != null && info.TryGetValue("project", out var p) ? p as Dictionary<string, object> : null;
                var name = project != null && project.TryGetValue("name", out var n) ? n as string : null;
                if (string.IsNullOrEmpty(name)) return null;
                var created = project.TryGetValue("created", out var c) ? c as string : null;
                var plcs = new List<string>();
                if (info.TryGetValue("sub_projects", out var subs) && subs is System.Collections.ArrayList list)
                    foreach (var s in list.OfType<Dictionary<string, object>>())
                        if (s.TryGetValue("name", out var sn) && sn is string plc) plcs.Add(plc);
                return new { name, created, plcProjects = plcs };
            }
            catch (Exception ex) when (ex is AdsException || ex is ArgumentException || ex is InvalidOperationException) { return null; }
        }

        /// <summary>The nearest folder above the file that holds a file of that extension, or null</summary>
        private static string FolderWith(string file, string extension)
        {
            try
            {
                for (var dir = Path.GetDirectoryName(file); !string.IsNullOrEmpty(dir); dir = Path.GetDirectoryName(dir))
                    if (Directory.EnumerateFiles(dir, "*" + extension).Any()) return dir;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException) { }
            return null;
        }

        /// <summary>The builds of the POU's PLC project here (its _CompileInfo: GUID-named .compileinfo files), newest first</summary>
        private static List<KeyValuePair<string, DateTime>> ProjectBuilds(string pouPath)
        {
            var list = new List<KeyValuePair<string, DateTime>>();
            var dir = string.IsNullOrEmpty(pouPath) ? null : FolderWith(pouPath, ".plcproj");
            if (dir == null) return list;
            try
            {
                foreach (var f in Directory.EnumerateFiles(Path.Combine(dir, "_CompileInfo"), "*.compileinfo"))
                {
                    var name = Path.GetFileNameWithoutExtension(f);
                    if (Guid.TryParse(name, out _)) list.Add(new KeyValuePair<string, DateTime>(name.ToUpperInvariant(), File.GetLastWriteTimeUtc(f)));
                }
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { }
            return list.OrderByDescending(b => b.Value).ToList();
        }

        /// <summary>
        /// The builds of the loaded POU's PLC project here (its _CompileInfo), newest first: projectBuildsResult
        /// { requestId, builds: [{ id, at }] }. The app asks when the POU opens, when it gets the focus back and every
        /// minute, and remembers each one (XAE keeps only the latest build's compile info: an older build is known so)
        /// </summary>
        private void HandleProjectBuilds(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var pou = _pouPath;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                var builds = RecordProjectBuilds(pou).Select(b => new { id = b.Key, at = b.Value.ToString("o") }).ToList();
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Post(new { type = "projectBuildsResult", requestId, builds });
            });
        }

        /// <summary>
        /// The connected PLC's TwinCAT trial license (read only, through its system service: 4026 keeps it beside the
        /// boot folder, 4024 under Target): plcLicenseResult { requestId, trial: { expires, issued } (ISO, UTC) or null }.
        /// A full license has no trial file: null
        /// </summary>
        private void HandlePlcLicense(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var monitor = _live;
            if (monitor == null)
            {
                Post(new { type = "plcLicenseResult", requestId, trial = (object)null, error = "Not connected" });
                return;
            }
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                object trial = null;
                foreach (var f in new[] { "../License/TrialLicense.tclrs", "../Target/License/TrialLicense.tclrs" })
                {
                    byte[] bytes;
                    try { bytes = monitor.ReadBootFile(f); } catch (Exception ex) when (ex is InvalidOperationException || ex is ObjectDisposedException) { bytes = null; }
                    if (bytes == null) continue;
                    var xml = System.Text.Encoding.UTF8.GetString(bytes);
                    var expire = System.Text.RegularExpressions.Regex.Match(xml, "<ExpireTime>([^<]+)</ExpireTime>");
                    if (!expire.Success) continue;
                    // (UTC in the file, without a zone)
                    string Utc(string t) => DateTime.TryParse(t, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal, out var d) ? d.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") : null;
                    var issue = System.Text.RegularExpressions.Regex.Match(xml, "<IssueTime>([^<]+)</IssueTime>");
                    trial = new { expires = Utc(expire.Groups[1].Value), issued = issue.Success ? Utc(issue.Groups[1].Value) : null };
                    break;
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Post(new { type = "plcLicenseResult", requestId, trial });
            });
        }

        // The builds of the PLC project seen (XAE keeps only the latest's compile info): kept beside the .plcproj, to
        // commit with the project (as shared/tcCompileInfo.cjs: the same file for every edition)
        private const string BuildHistoryFile = "MachineScope.builds.json";

        /// <summary>
        /// The project's builds: its _CompileInfo now and its history file together, newest first; a build new to the
        /// history written into it (the file made when there is none; a read-only folder: not written)
        /// </summary>
        private static List<KeyValuePair<string, DateTime>> RecordProjectBuilds(string pouPath)
        {
            var now = ProjectBuilds(pouPath);
            var dir = string.IsNullOrEmpty(pouPath) ? null : FolderWith(pouPath, ".plcproj");
            if (dir == null) return now;
            var file = Path.Combine(dir, BuildHistoryFile);
            var known = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
            try
            {
                if (File.Exists(file) && new JavaScriptSerializer().DeserializeObject(File.ReadAllText(file)) is Dictionary<string, object> root && root.TryGetValue("builds", out var b) && b is System.Collections.IEnumerable list && !(b is string))
                {
                    foreach (var o in list.Cast<object>().OfType<Dictionary<string, object>>())
                    {
                        if (o.TryGetValue("id", out var id) && id is string s && Guid.TryParse(s, out _) && o.TryGetValue("at", out var at) && at is string a
                            && DateTime.TryParse(a, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var when))
                            known[s.ToUpperInvariant()] = when;
                    }
                }
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is InvalidOperationException) { }
            var fresh = now.Where(x => !known.ContainsKey(x.Key)).ToList();
            foreach (var x in fresh) known[x.Key] = x.Value;
            var all = known.Select(k => new KeyValuePair<string, DateTime>(k.Key, k.Value)).OrderByDescending(k => k.Value).Take(200).ToList();
            if (fresh.Count > 0)
            {
                try
                {
                    var body = string.Join(",\n", all.Select(k => $"    {{\n      \"id\": \"{k.Key}\",\n      \"at\": \"{k.Value.ToUniversalTime():yyyy-MM-ddTHH:mm:ss.fffZ}\"\n    }}"));
                    File.WriteAllText(file, "{\n  \"note\": \"The builds of this PLC project seen by Kval MachineScope (XAE keeps only the latest one's compile info): a PLC running one of them runs an older build of this project. Commit it with the project.\",\n  \"builds\": [\n" + body + "\n  ]\n}\n");
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { }
            }
            return all;
        }

        /// <summary>The PLC's build against the project's: newest, older (of this copy) or other (not built here)</summary>
        private static object CompareBuilds(string plcId, List<KeyValuePair<string, DateTime>> builds)
        {
            if (string.IsNullOrEmpty(plcId)) return null;
            var newest = builds.Count > 0 ? (object)new { id = builds[0].Key, at = builds[0].Value.ToString("o") } : null;
            var match = builds.FindIndex(b => b.Key == plcId);
            return new { plc = plcId, newest, state = match < 0 ? "other" : match == 0 ? "newest" : "older", builtAt = match < 0 ? null : builds[match].Value.ToString("o") };
        }

        /// <summary>The TwinCAT project (.tsproj) the POU belongs to: its name and file, or null</summary>
        private static (string name, string path)? LoadedProjectOf(string pouPath)
        {
            var dir = string.IsNullOrEmpty(pouPath) ? null : FolderWith(pouPath, ".tsproj");
            if (dir == null) return null;
            try
            {
                var ts = Directory.EnumerateFiles(dir, "*.tsproj").FirstOrDefault();
                return ts == null ? ((string, string)?)null : (Path.GetFileNameWithoutExtension(ts), ts);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { return null; }
        }

        /// <summary>
        /// The Live tab's Activate (asked there first): the TwinCAT project of the loaded POU activated on its target, as
        /// XAE's Activate Configuration (TwinCAT restarted in Run mode). activateResult { requestId, ok, message }
        /// </summary>
        private void HandleActivateProject(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var project = LoadedProjectOf(_pouPath);
            if (project == null)
            {
                Post(new { type = "activateResult", requestId, ok = false, message = "The POU is not in a TwinCAT project folder" });
                return;
            }
            try
            {
                if (!(Package.GetGlobalService(typeof(EnvDTE.DTE)) is EnvDTE.DTE dte)) throw new InvalidOperationException("XAE's automation is not available");
                EnvDTE.Project found = null;
                foreach (EnvDTE.Project p in dte.Solution.Projects)
                {
                    string file = null;
                    try { file = p.FullName; } catch (System.Runtime.InteropServices.COMException) { }
                    if (string.Equals(file, project.Value.path, StringComparison.OrdinalIgnoreCase)) { found = p; break; }
                }
                if (found == null) throw new InvalidOperationException($"{project.Value.name}.tsproj is not open in XAE: open its solution, then activate");
                dynamic sysManager = found.Object;
                Log.Write($"activate: {project.Value.path}");
                sysManager.ActivateConfiguration();
                sysManager.StartRestartTwinCAT();
                Post(new { type = "activateResult", requestId, ok = true, message = $"{project.Value.name} activated: TwinCAT restarts in Run mode" });
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException))
            {
                Log.Write("activate: " + ex.Message);
                Post(new { type = "activateResult", requestId, ok = false, message = $"{project.Value.name} was not activated: {ex.Message}" });
            }
        }

        /// <summary>
        /// The loaded POU's project files' TwinCAT version here and in git (HEAD): the .tsproj (TcVersion), the .plcproj
        /// (ProgramVersion), the .TcPOU (ProductVersion). projectVersionsResult { requestId, files, converted }
        /// </summary>
        private void HandleProjectVersions(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var pou = _pouPath;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                var files = new List<object>();
                var converted = false;
                if (!string.IsNullOrEmpty(pou))
                {
                    var targets = new List<(string kind, string file, string pattern)>();
                    var tsDir = FolderWith(pou, ".tsproj");
                    var plcDir = FolderWith(pou, ".plcproj");
                    var ts = tsDir == null ? null : Directory.EnumerateFiles(tsDir, "*.tsproj").FirstOrDefault();
                    var plc = plcDir == null ? null : Directory.EnumerateFiles(plcDir, "*.plcproj").FirstOrDefault();
                    if (ts != null) targets.Add(("tsproj", ts, "<TcSmProject\\b[^>]*\\bTcVersion=\"([^\"]+)\""));
                    if (plc != null) targets.Add(("plcproj", plc, "<ProgramVersion>([^<]+)<"));
                    targets.Add(("pou", pou, "<TcPlcObject\\b[^>]*\\bProductVersion=\"([^\"]+)\""));
                    foreach (var t in targets)
                    {
                        string working = null, head = null;
                        try { working = System.Text.RegularExpressions.Regex.Match(File.ReadAllText(t.file), t.pattern).Groups[1].Value; } catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { }
                        var committed = GitHeadText(t.file);
                        if (committed != null) head = System.Text.RegularExpressions.Regex.Match(committed, t.pattern).Groups[1].Value;
                        if (string.IsNullOrEmpty(working)) working = null;
                        if (string.IsNullOrEmpty(head)) head = null;
                        object changed = null;
                        if (working != null && head != null && working != head)
                        {
                            converted = true;
                            // (the lines changed in it since HEAD: what a revert would lose besides the version)
                            var numstat = RunGit(t.file, $"diff --numstat HEAD -- \"{Path.GetFileName(t.file)}\"");
                            if (numstat != null)
                            {
                                var m = System.Text.RegularExpressions.Regex.Match(numstat, @"^(\d+)\t(\d+)\t");
                                changed = m.Success ? new { added = int.Parse(m.Groups[1].Value), removed = int.Parse(m.Groups[2].Value) } : new { added = 0, removed = 0 };
                            }
                        }
                        files.Add(new { kind = t.kind, path = t.file, working, head, changed });
                    }
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Post(new { type = "projectVersionsResult", requestId, files, converted });
            });
        }

        /// <summary>
        /// The loaded POU's project's .tsproj / .plcproj back to git's HEAD (git checkout HEAD -- file; the app asked first,
        /// saying what else changed in them). Only those two files of this POU's project. revertProjectFilesResult
        /// { requestId, reverted, errors }; XAE then asks to reload the project (changed outside)
        /// </summary>
        private void HandleRevertProjectFiles(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var paths = msg.TryGetValue("paths", out var p) && p is System.Collections.IEnumerable list && !(p is string) ? list.Cast<object>().Select(o => o as string).Where(s => !string.IsNullOrEmpty(s)).ToList() : new List<string>();
            var pou = _pouPath;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                var reverted = new List<string>();
                var errors = new List<object>();
                var allowed = new List<string>();
                if (!string.IsNullOrEmpty(pou))
                {
                    foreach (var ext in new[] { ".tsproj", ".plcproj" })
                    {
                        var dir = FolderWith(pou, ext);
                        var f = dir == null ? null : Directory.EnumerateFiles(dir, "*" + ext).FirstOrDefault();
                        if (f != null) allowed.Add(Path.GetFullPath(f));
                    }
                }
                foreach (var path in paths)
                {
                    string full;
                    try { full = Path.GetFullPath(path); } catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException) { full = null; }
                    if (full == null || !allowed.Any(a => string.Equals(a, full, StringComparison.OrdinalIgnoreCase)))
                    {
                        errors.Add(new { path, error = "Not this POU's project file" });
                        continue;
                    }
                    if (RunGit(full, $"checkout HEAD -- \"{Path.GetFileName(full)}\"") != null) reverted.Add(full);
                    else errors.Add(new { path = full, error = "git checkout failed" });
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Post(new { type = "revertProjectFilesResult", requestId, reverted, errors });
            });
        }

        /// <summary>
        /// The POU's project opened in the XAE of its committed TwinCAT version (version: "3.1.4024.59"): 4024's shell
        /// (32-bit, TcXaeShell.DTE.15.0) or 4026's (TcXaeShell.DTE.17.0), started with the solution (the .sln above the
        /// .tsproj, else the .tsproj); this XAE when it is already of that family (said, nothing started). Whether its
        /// Remote Manager has that build (Components\Base\Build_4024.59). openXaeForResult { requestId, ok, message }
        /// </summary>
        private void HandleOpenXaeFor(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var version = msg.TryGetValue("version", out var v) ? v as string : null;
            var m = System.Text.RegularExpressions.Regex.Match(version ?? "", @"^(?:3\.1\.)?(\d{4})\.(\d+)");
            var build = m.Success ? int.Parse(m.Groups[1].Value) : 0;
            var rm = m.Success ? $"{m.Groups[1].Value}.{m.Groups[2].Value}" : null;
            var tsDir = string.IsNullOrEmpty(_pouPath) ? null : FolderWith(_pouPath, ".tsproj");
            var ts = tsDir == null ? null : Directory.EnumerateFiles(tsDir, "*.tsproj").FirstOrDefault();
            if (ts == null || build == 0)
            {
                Post(new { type = "openXaeForResult", requestId, ok = false, message = ts == null ? "The POU is not in a TwinCAT project (no .tsproj above it)" : "The committed TwinCAT version is not known" });
                return;
            }
            var slnDir = FolderWith(ts, ".sln");
            var file = (slnDir == null ? null : Directory.EnumerateFiles(slnDir, "*.sln").FirstOrDefault()) ?? ts;
            var rmBuilds = new List<string>();
            try { rmBuilds = Directory.EnumerateDirectories(@"C:\Program Files (x86)\Beckhoff\TwinCAT\3.1\Components\Base", "Build_*").Select(d => Path.GetFileName(d).Substring(6)).ToList(); } catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { }
            var rmNote = rm != null && !rmBuilds.Contains(rm) ? $" Its Remote Manager has no {rm} here ({(rmBuilds.Count > 0 ? string.Join(", ", rmBuilds) : "none")}): pick it in XAE's version selector after installing it, or XAE converts the project." : rm != null ? $" Choose {rm} in its Remote Manager (the version selector) before saving." : "";
            var family = build >= 4026 ? 4026 : 4024;
            if ((XaeBuild >= 4026 ? 4026 : 4024) == family)
            {
                Post(new { type = "openXaeForResult", requestId, ok = true, message = $"This XAE is TwinCAT {family}'s already: the project is open here.{rmNote}" });
                return;
            }
            string exe = null;
            foreach (var progId in family >= 4026 ? new[] { "TcXaeShell.DTE.17.0" } : new[] { "TcXaeShell.DTE.15.0", "TcXaeShell.DTE.17.0" })
            {
                exe = XaeExecutable(progId);
                if (exe != null) break;
            }
            if (exe == null)
            {
                Post(new { type = "openXaeForResult", requestId, ok = false, message = $"No TwinCAT {family} XAE on this computer" });
                return;
            }
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(exe, $"\"{file}\"") { UseShellExecute = false });
                Post(new { type = "openXaeForResult", requestId, ok = true, message = $"TwinCAT {family}'s XAE is starting with {Path.GetFileName(file)} (close the project here first: two XAEs on one project overwrite each other's saves).{rmNote}" });
            }
            catch (Exception ex) when (ex is System.ComponentModel.Win32Exception || ex is InvalidOperationException || ex is IOException)
            {
                Post(new { type = "openXaeForResult", requestId, ok = false, message = $"Could not start TwinCAT {family}'s XAE: {ex.Message}" });
            }
        }

        /// <summary>An XAE's TcXaeShell.exe from its registered automation server (HKCR\ProgId\CLSID → LocalServer32), or null</summary>
        private static string XaeExecutable(string progId)
        {
            try
            {
                using (var p = Microsoft.Win32.Registry.ClassesRoot.OpenSubKey(progId + @"\CLSID"))
                {
                    var clsid = p?.GetValue(null) as string;
                    if (string.IsNullOrEmpty(clsid)) return null;
                    using (var s = Microsoft.Win32.Registry.ClassesRoot.OpenSubKey($@"CLSID\{clsid}\LocalServer32"))
                    {
                        var server = (s?.GetValue(null) as string)?.Trim();
                        if (string.IsNullOrEmpty(server)) return null;
                        var exe = server.StartsWith("\"") ? server.Substring(1, server.IndexOf('"', 1) - 1) : server.Substring(0, server.IndexOf(".exe", StringComparison.OrdinalIgnoreCase) + 4);
                        return File.Exists(exe) ? exe : null;
                    }
                }
            }
            catch (Exception ex) when (ex is System.Security.SecurityException || ex is UnauthorizedAccessException || ex is IOException || ex is ArgumentException) { return null; }
        }

        // The transitions each state machine's PLC took, kept beside the PLC project (as shared/coverageFile.cjs: the same
        // file for every edition): per POU type, each transition's count and last time; merged by the highest
        private const string CoverageFile = "MachineScope.coverage.json";

        private static SortedDictionary<string, SortedDictionary<string, KeyValuePair<long, double>>> ReadCoverageFile(string pouPath)
        {
            var pous = new SortedDictionary<string, SortedDictionary<string, KeyValuePair<long, double>>>(StringComparer.Ordinal);
            var dir = string.IsNullOrEmpty(pouPath) ? null : FolderWith(pouPath, ".plcproj");
            var file = dir == null ? null : Path.Combine(dir, CoverageFile);
            if (file == null || !File.Exists(file)) return pous;
            try
            {
                if (new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.DeserializeObject(File.ReadAllText(file)) is Dictionary<string, object> root && root.TryGetValue("pous", out var p) && p is Dictionary<string, object> types)
                {
                    foreach (var t in types)
                    {
                        if (!System.Text.RegularExpressions.Regex.IsMatch(t.Key, @"^\w+$") || !(t.Value is Dictionary<string, object> counts)) continue;
                        var list = new SortedDictionary<string, KeyValuePair<long, double>>(StringComparer.Ordinal);
                        foreach (var c in counts) if (TryCount(c.Key, c.Value, out var v)) list[c.Key] = v;
                        pous[t.Key] = list;
                    }
                }
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is InvalidOperationException) { }
            return pous;
        }

        /// <summary>A transition's count from JSON ({ n, last }): only "FROM->TO" with n &gt; 0</summary>
        private static bool TryCount(string key, object value, out KeyValuePair<long, double> count)
        {
            count = default;
            if (!System.Text.RegularExpressions.Regex.IsMatch(key ?? "", "^[^>]+->[^>]+$") || !(value is Dictionary<string, object> o)) return false;
            if (!o.TryGetValue("n", out var n) || !double.TryParse(Convert.ToString(n, System.Globalization.CultureInfo.InvariantCulture), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var nv) || nv <= 0) return false;
            double last = 0;
            if (o.TryGetValue("last", out var l)) double.TryParse(Convert.ToString(l, System.Globalization.CultureInfo.InvariantCulture), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out last);
            count = new KeyValuePair<long, double>((long)Math.Floor(nv), last);
            return true;
        }

        private static string CoverageText(SortedDictionary<string, SortedDictionary<string, KeyValuePair<long, double>>> pous)
        {
            var json = new JavaScriptSerializer();
            var types = pous.Select(t => $"    {json.Serialize(t.Key)}: {{\n" + string.Join(",\n", t.Value.Select(c => $"      {json.Serialize(c.Key)}: {{ \"n\": {c.Value.Key}, \"last\": {c.Value.Value.ToString("R", System.Globalization.CultureInfo.InvariantCulture)} }}")) + "\n    }");
            return "{\n  \"note\": \"The transitions each state machine's PLC took, seen live with Kval MachineScope (count, last time in ms): the coverage counts what anyone saw. Commit it with the project.\",\n  \"pous\": {\n" + string.Join(",\n", types) + "\n  }\n}\n";
        }

        private static object CountsOf(SortedDictionary<string, KeyValuePair<long, double>> counts) => counts.ToDictionary(c => c.Key, c => (object)new { n = c.Value.Key, last = c.Value.Value });

        /// <summary>coverageFile → coverageFileResult { requestId, pous: { type: { 'FROM->TO': { n, last } } } }</summary>
        private void HandleCoverageFile(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var pou = _pouPath;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                var pous = ReadCoverageFile(pou).ToDictionary(t => t.Key, t => CountsOf(t.Value));
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Post(new { type = "coverageFileResult", requestId, pous });
            });
        }

        /// <summary>
        /// coverageFileSave { pouType, counts }: merged into the file (the highest count, the latest time; written only
        /// when that adds something) → coverageFileSaveResult { requestId, counts, error? }
        /// </summary>
        private void HandleCoverageFileSave(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var requestId = msg.TryGetValue("requestId", out var r) && r is int ri ? ri : 0;
            var type = msg.TryGetValue("pouType", out var t) ? t as string : null;
            var given = msg.TryGetValue("counts", out var c) ? c as Dictionary<string, object> : null;
            var pou = _pouPath;
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await TaskScheduler.Default;
                object counts = null;
                string error = null;
                var dir = string.IsNullOrEmpty(pou) ? null : FolderWith(pou, ".plcproj");
                if (dir == null || type == null || !System.Text.RegularExpressions.Regex.IsMatch(type, @"^\w+$")) error = "No PLC project (.plcproj) above the POU, or no POU type";
                else
                {
                    var pous = ReadCoverageFile(pou);
                    var before = CoverageText(new SortedDictionary<string, SortedDictionary<string, KeyValuePair<long, double>>> { [type] = pous.TryGetValue(type, out var b) ? b : new SortedDictionary<string, KeyValuePair<long, double>>(StringComparer.Ordinal) });
                    if (!pous.TryGetValue(type, out var mine)) pous[type] = mine = new SortedDictionary<string, KeyValuePair<long, double>>(StringComparer.Ordinal);
                    foreach (var g in given ?? new Dictionary<string, object>())
                    {
                        if (!TryCount(g.Key, g.Value, out var v)) continue;
                        mine[g.Key] = mine.TryGetValue(g.Key, out var w) ? new KeyValuePair<long, double>(Math.Max(w.Key, v.Key), Math.Max(w.Value, v.Value)) : v;
                    }
                    var after = CoverageText(new SortedDictionary<string, SortedDictionary<string, KeyValuePair<long, double>>> { [type] = mine });
                    if (after != before)
                    {
                        try { File.WriteAllText(Path.Combine(dir, CoverageFile), CoverageText(pous)); }
                        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { error = "Not written: " + ex.Message; }
                    }
                    counts = CountsOf(mine);
                }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Post(new { type = "coverageFileSaveResult", requestId, counts, error });
            });
        }

        /// <summary>A file's committed (git HEAD) text, or null (not in git, not committed)</summary>
        private static string GitHeadText(string file) => RunGit(file, $"show \"HEAD:./{Path.GetFileName(file)}\"");

        /// <summary>git in the file's folder: its output, or null (failed, not in git, no git)</summary>
        private static string RunGit(string file, string args)
        {
            try
            {
                var psi = new System.Diagnostics.ProcessStartInfo("git", $"-C \"{Path.GetDirectoryName(file)}\" {args}")
                {
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    StandardOutputEncoding = System.Text.Encoding.UTF8,
                };
                using (var proc = System.Diagnostics.Process.Start(psi))
                {
                    var text = proc.StandardOutput.ReadToEndAsync();
                    if (!proc.WaitForExit(15000)) { try { proc.Kill(); } catch (InvalidOperationException) { } return null; }
                    return proc.ExitCode == 0 ? text.Result : null;
                }
            }
            catch (Exception ex) when (ex is System.ComponentModel.Win32Exception || ex is InvalidOperationException || ex is IOException) { return null; }
        }

        // The PLC's symbol version when live connected (a change: another program was downloaded or activated)
        private int? _liveSymbolVersion;

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
                int? symbolVersion = null;
                await TaskScheduler.Default;
                try
                {
                    state = monitor.ReadState();
                    symbolVersion = monitor.ReadSymbolVersion();
                }
                catch (AdsException ex) { error = ex.Message; }
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                _liveStateCheck = false;
                if (session != _liveSession) return;
                if (error != null) Post(new { type = "liveStatus", state = "lost", message = "Connection lost: " + error });
                else if (symbolVersion.HasValue && _liveSymbolVersion.HasValue && symbolVersion != _liveSymbolVersion)
                {
                    // Another program (a download, an activation): the app connects again (the instance, its type, the
                    // symbols read anew; the old handles are gone)
                    _liveSymbolVersion = symbolVersion;
                    Log.Write($"live: the PLC's program changed (symbol version {symbolVersion})");
                    Post(new { type = "liveStatus", state = "programChanged", plcState = state, message = "The PLC's program changed (a download or an activation)" });
                }
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
            SaveAllRelay.Unregister(this);
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

    /// <summary>Diagnostics for the prototype: %LocalAppData%KvalMachineScopelog.txt (kept small)</summary>
    internal static class Log
    {
        private static readonly string File = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KvalMachineScope", "log.txt");

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
