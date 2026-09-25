using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace KvalStateScope.Xae
{
    /// <summary>A .TcDUT next to (or below) the .TcPOU; the web app picks the one whose enum matches doState()</summary>
    internal sealed class DutFile
    {
        public string name;
        public string relativePath;
        public string path;
        public string content;
    }

    /// <summary>File access for the web app: dialogs, the .TcDUT search and saving back into the project</summary>
    internal static class HostFiles
    {
        private const int MaxDepth = 8;
        private const int MaxDutFiles = 500;
        // Build output, VCS and library folders never hold the POU's own enum
        private static readonly HashSet<string> SkipDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "node_modules", "_Boot", "_CompileInfo", "_Libraries", "_Deployment", "bin", "obj",
        };

        /// <summary>Reads a text file the way TwinCAT writes it (UTF-8, usually with BOM); the BOM is not part of the text</summary>
        public static string ReadText(string path)
        {
            using (var reader = new StreamReader(path, new UTF8Encoding(false), detectEncodingFromByteOrderMarks: true))
                return reader.ReadToEnd();
        }

        public static string Hash(string path)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(path))
                return Convert.ToBase64String(sha.ComputeHash(stream));
        }

        public static List<DutFile> FindDutFiles(string rootDir)
        {
            var found = new List<DutFile>();
            void Walk(string dir, int depth)
            {
                if (depth > MaxDepth || found.Count >= MaxDutFiles) return;
                string[] files, dirs;
                try
                {
                    files = Directory.GetFiles(dir, "*.TcDUT");
                    dirs = Directory.GetDirectories(dir);
                }
                catch (IOException) { return; }
                catch (UnauthorizedAccessException) { return; }
                // Files first, so the POU's own folder wins when the limit is reached
                foreach (var file in files.OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
                {
                    if (found.Count >= MaxDutFiles) return;
                    try
                    {
                        found.Add(new DutFile
                        {
                            name = Path.GetFileName(file),
                            relativePath = RelativePath(rootDir, file),
                            path = file,
                            content = ReadText(file),
                        });
                    }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
                foreach (var sub in dirs.OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
                {
                    var name = Path.GetFileName(sub);
                    if (name.StartsWith(".") || SkipDirs.Contains(name)) continue;
                    Walk(sub, depth + 1);
                }
            }
            Walk(rootDir, 0);
            return found;
        }

        private static string RelativePath(string root, string file)
        {
            var rootUri = new Uri(root.EndsWith("\\") ? root : root + "\\");
            return Uri.UnescapeDataString(rootUri.MakeRelativeUri(new Uri(file)).ToString());
        }

        public static string AskForPou(string startFolder)
        {
            var dialog = new Microsoft.Win32.OpenFileDialog
            {
                Title = "Open a TwinCAT function block in Kval StateScope",
                Filter = "TwinCAT POU (*.TcPOU)|*.TcPOU|All files (*.*)|*.*",
                InitialDirectory = startFolder != null && Directory.Exists(startFolder) ? startFolder : null,
            };
            return dialog.ShowDialog() == true ? dialog.FileName : null;
        }

        public static string AskForFolder(string startFolder)
        {
            using (var dialog = new System.Windows.Forms.FolderBrowserDialog
            {
                Description = "Folder to search (with its subfolders) for the .TcDUT state enum",
                SelectedPath = startFolder ?? "",
                ShowNewFolderButton = false,
            })
            {
                return dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK ? dialog.SelectedPath : null;
            }
        }

        public static List<DutFile> AskForDutFiles(string startFolder)
        {
            var dialog = new Microsoft.Win32.OpenFileDialog
            {
                Title = "Choose the .TcDUT file(s) with the state enum",
                Filter = "TwinCAT DUT (*.TcDUT)|*.TcDUT|All files (*.*)|*.*",
                Multiselect = true,
                InitialDirectory = startFolder != null && Directory.Exists(startFolder) ? startFolder : null,
            };
            if (dialog.ShowDialog() != true) return null;
            return dialog.FileNames.Select(f => new DutFile { name = Path.GetFileName(f), relativePath = Path.GetFileName(f), path = f, content = ReadText(f) }).ToList();
        }

        /// <summary>A file to write back: its new text, the content key when StateScope loaded it, and whether a change made
        /// in XAE since then may be overwritten (the user chose to keep their edits)</summary>
        internal sealed class SaveRequest
        {
            public string Path;
            public string Content;
            public string LoadedKey;
            public bool Force;
        }

        /// <summary>
        /// Writes edited files back. A file of an open TwinCAT project goes through the Automation Interface
        /// (DocumentXml), so XAE's project is updated and TwinCAT writes the file; other files are written directly.
        /// Refused when XAE holds unsaved changes for a file, or when it changed in XAE / on disk since StateScope loaded it
        /// (unless Force). A copy of each original is kept under %LocalAppData%\KvalStateScope\Backups.
        /// Returns null on success, else the reason; <paramref name="viaXae"/> lists the files written through XAE.
        /// </summary>
        public static string Save(IServiceProvider services, IList<SaveRequest> files, out List<string> viaXae)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            viaXae = new List<string>();
            if (files.Count == 0) return "Nothing to save";
            var rdt = services.GetService(typeof(SVsRunningDocumentTable)) as IVsRunningDocumentTable;

            // Check everything before writing anything
            var items = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (var f in files)
            {
                var name = System.IO.Path.GetFileName(f.Path);
                if (!File.Exists(f.Path)) return $"{name} no longer exists";
                if (IsDirtyInIde(rdt, f.Path))
                    return $"{name} has unsaved changes in XAE. Save or close it there first.";
                var item = TwinCATProject.FindTreeItem(services, f.Path);
                items[f.Path] = item;
                var current = item != null ? TwinCATProject.ReadXml(item) : ReadText(f.Path);
                if (!f.Force && f.LoadedKey != null && ContentKey(current) != f.LoadedKey)
                    return $"{name} was changed in XAE since it was loaded into Kval StateScope. Reload it first, or keep your edits to overwrite it.";
            }

            var backupDir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "KvalStateScope", "Backups", DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            Directory.CreateDirectory(backupDir);
            foreach (var f in files)
            {
                File.Copy(f.Path, System.IO.Path.Combine(backupDir, System.IO.Path.GetFileName(f.Path)), overwrite: true);
                var item = items[f.Path];
                if (item != null)
                {
                    var wasOpen = IsOpenInIde(rdt, f.Path);
                    var mode = TwinCATProject.WriteChanges(item, f.Content, out var partsWritten);
                    viaXae.Add(f.Path);
                    Log.Write(mode == "parts"
                        ? $"written through the Automation Interface ({partsWritten} part(s), ids kept): {TwinCATProject.TreePath(item)}"
                        : $"written through the Automation Interface (whole object): {TwinCATProject.TreePath(item)}");
                    // Replacing the whole object closes an open editor of it: open it again afterwards
                    if (mode == "document" && wasOpen) ReopenInIde(services, f.Path);
                }
                else
                {
                    var hadBom = HasUtf8Bom(f.Path);
                    File.WriteAllText(f.Path, f.Content, new UTF8Encoding(hadBom));
                    Log.Write($"written to disk (not part of an open TwinCAT project): {f.Path}");
                }
            }
            return null;
        }

        /// <summary>The text of a file as XAE has it (its project object), or from disk when it is not in an open project</summary>
        public static string CurrentContent(IServiceProvider services, string path)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var item = TwinCATProject.FindTreeItem(services, path);
            return item != null ? TwinCATProject.ReadXml(item) : ReadText(path);
        }

        /// <summary>Compares texts by content: XAE's copy and the file can differ in BOM and line endings only</summary>
        public static string ContentKey(string text)
        {
            var normalized = (text ?? "").TrimStart('﻿').Replace("\r\n", "\n").TrimEnd();
            using (var sha = SHA256.Create())
                return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(normalized)));
        }

        private static bool IsOpenInIde(IVsRunningDocumentTable rdt, string path)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (rdt == null) return false;
            IntPtr docData = IntPtr.Zero;
            try
            {
                return ErrorHandler.Succeeded(rdt.FindAndLockDocument((uint)_VSRDTFLAGS.RDT_NoLock, path, out _, out _, out docData, out _)) && docData != IntPtr.Zero;
            }
            finally
            {
                if (docData != IntPtr.Zero) System.Runtime.InteropServices.Marshal.Release(docData);
            }
        }

        private static void ReopenInIde(IServiceProvider services, string path)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                (services.GetService(typeof(EnvDTE.DTE)) as EnvDTE80.DTE2)?.ItemOperations.OpenFile(path);
            }
            catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException || ex is ArgumentException)
            {
                Log.Write($"could not reopen {path}: {ex.Message}");
            }
        }

        private static bool HasUtf8Bom(string path)
        {
            var bytes = new byte[3];
            using (var stream = File.OpenRead(path))
            {
                var read = stream.Read(bytes, 0, 3);
                return read == 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
            }
        }

        private static bool IsDirtyInIde(IVsRunningDocumentTable rdt, string path)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (rdt == null) return false;
            IntPtr docData = IntPtr.Zero;
            try
            {
                if (ErrorHandler.Failed(rdt.FindAndLockDocument((uint)_VSRDTFLAGS.RDT_NoLock, path, out _, out _, out docData, out _)) || docData == IntPtr.Zero)
                    return false;
                var data = System.Runtime.InteropServices.Marshal.GetObjectForIUnknown(docData);
                return data is IVsPersistDocData persist && ErrorHandler.Succeeded(persist.IsDocDataDirty(out int dirty)) && dirty != 0;
            }
            finally
            {
                if (docData != IntPtr.Zero) System.Runtime.InteropServices.Marshal.Release(docData);
            }
        }
    }
}
