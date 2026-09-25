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
        private readonly WebView2 _web = new WebView2();
        private readonly TextBlock _status = new TextBlock { Margin = new System.Windows.Thickness(12), Foreground = Brushes.Gainsboro, TextWrapping = System.Windows.TextWrapping.Wrap };
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        private bool _appReady;
        private string _pendingPou;
        private string _pouPath;
        // Content hash of each file when it was sent to the app (detects changes made elsewhere before saving)
        private readonly Dictionary<string, string> _loadedHashes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public StateScopeControl(ToolWindowPane pane)
        {
            _pane = pane;
            Background = new SolidColorBrush(Color.FromRgb(0x02, 0x06, 0x17));
            _status.Text = "Starting Kval StateScope...";
            // WebView2 only initializes once it is in the visual tree (it needs a window handle), so it is part of
            // the layout from the start. It is a native window WPF cannot draw over: the status line gets its own row.
            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = System.Windows.GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = new System.Windows.GridLength(1, System.Windows.GridUnitType.Star) });
            Grid.SetRow(_status, 0);
            Grid.SetRow(_web, 1);
            _web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(0x02, 0x06, 0x17);
            grid.Children.Add(_status);
            grid.Children.Add(_web);
            Content = grid;
            Loaded += OnLoaded;
        }

        private void OnLoaded(object sender, System.Windows.RoutedEventArgs e)
        {
            Log.Write("window loaded");
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(InitializeAsync);
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
                var env = await CoreWebView2Environment.CreateAsync(null, userData);
                await _web.EnsureCoreWebView2Async(env);
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
                _status.Text = $"Kval StateScope could not start: {ex.GetType().Name}: {ex.Message}";
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
                _pouPath = pouPath;
                _loadedHashes.Clear();
                _loadedHashes[pouPath] = HostFiles.Hash(pouPath);
                foreach (var d in duts) _loadedHashes[d.path] = HostFiles.Hash(d.path);
                Post(new
                {
                    type = "loadPou",
                    source = new { name = Path.GetFileName(pouPath), path = pouPath, content = HostFiles.ReadText(pouPath), dutCandidates = duts },
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
                }
            }
            catch (Exception ex)
            {
                Post(new { type = "error", message = ex.Message });
            }
        }

        private void SendDutCandidates(List<DutFile> duts, bool forceFirst)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            foreach (var d in duts) _loadedHashes[d.path] = HostFiles.Hash(d.path);
            Post(new { type = "dutCandidates", candidates = duts, forceFirst });
        }

        private void HandleSave(Dictionary<string, object> msg)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var files = new List<(string path, string content, string loadedHash)>();
            // JavaScriptSerializer turns JSON arrays into ArrayList
            if (msg.TryGetValue("files", out var raw) && raw is System.Collections.IEnumerable list && !(raw is string))
            {
                foreach (var item in list.OfType<Dictionary<string, object>>())
                {
                    var path = item.TryGetValue("path", out var p) ? p as string : null;
                    var content = item.TryGetValue("content", out var c) ? c as string : null;
                    // Only files this window loaded can be written
                    if (path == null || content == null || !_loadedHashes.ContainsKey(path)) continue;
                    files.Add((path, content, _loadedHashes[path]));
                }
            }
            Log.Write($"save requested: {files.Count} file(s) {string.Join(", ", files.Select(f => Path.GetFileName(f.path)))}");
            var error = HostFiles.Save(_pane, files);
            Log.Write(error == null ? "saved" : "save refused: " + error);
            if (error == null)
            {
                foreach (var f in files) _loadedHashes[f.path] = HostFiles.Hash(f.path);
                Post(new { type = "saveResult", ok = true, message = $"Saved {string.Join(", ", files.Select(f => Path.GetFileName(f.path)))}. A backup is in %LocalAppData%\\KvalStateScope\\Backups." });
            }
            else
            {
                Post(new { type = "saveResult", ok = false, message = error });
            }
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
