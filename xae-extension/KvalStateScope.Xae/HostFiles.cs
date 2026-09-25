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

        /// <summary>
        /// Writes edited files back into the project. Refuses when XAE holds unsaved changes for a file, or when the
        /// file changed on disk since StateScope loaded it. A copy of each original is kept under
        /// %LocalAppData%\KvalStateScope\Backups. Returns null on success, else the reason.
        /// </summary>
        public static string Save(IServiceProvider services, IList<(string path, string content, string loadedHash)> files)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (files.Count == 0) return "Nothing to save";
            var rdt = services.GetService(typeof(SVsRunningDocumentTable)) as IVsRunningDocumentTable;

            // Check everything before writing anything
            foreach (var (path, _, loadedHash) in files)
            {
                if (!File.Exists(path)) return $"{Path.GetFileName(path)} no longer exists";
                if (IsDirtyInIde(rdt, path))
                    return $"{Path.GetFileName(path)} has unsaved changes in XAE. Save or close it there first.";
                if (loadedHash != null && Hash(path) != loadedHash)
                    return $"{Path.GetFileName(path)} was changed outside Kval StateScope since it was loaded. Reopen it in StateScope first.";
            }

            var backupDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "KvalStateScope", "Backups", DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            Directory.CreateDirectory(backupDir);
            foreach (var (path, content, _) in files)
            {
                File.Copy(path, Path.Combine(backupDir, Path.GetFileName(path)), overwrite: true);
                var hadBom = HasUtf8Bom(path);
                File.WriteAllText(path, content, new UTF8Encoding(hadBom));
            }
            return null;
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
