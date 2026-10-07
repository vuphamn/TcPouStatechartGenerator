using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// The .TcPOU each MachineScope tab showed last, by IDE (TcXaeShell, devenv) and tab number: the IDE restores the
    /// tabs that were open when it closed, empty; each opens its POU again. One line per tab:
    /// "&lt;ide&gt;\t&lt;tab number&gt;\t&lt;.TcPOU&gt;" in %LocalAppData%\KvalMachineScope\tabs.txt
    /// </summary>
    internal static class TabMemory
    {
        /// <summary>(tests: another file)</summary>
        internal static string FilePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KvalMachineScope", "tabs.txt");

        private static Dictionary<string, string> Read()
        {
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                if (!File.Exists(FilePath)) return map;
                foreach (var line in File.ReadAllLines(FilePath))
                {
                    var parts = line.Split('\t');
                    if (parts.Length == 3 && int.TryParse(parts[1], out _)) map[parts[0] + "\t" + parts[1]] = parts[2];
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            return map;
        }

        /// <summary>That tab of that IDE shows this .TcPOU now</summary>
        public static void Remember(string ide, int tab, string pouPath)
        {
            if (string.IsNullOrEmpty(ide) || tab < 0 || string.IsNullOrEmpty(pouPath)) return;
            var map = Read();
            var key = ide + "\t" + tab;
            if (map.TryGetValue(key, out var was) && string.Equals(was, pouPath, StringComparison.OrdinalIgnoreCase)) return;
            map[key] = pouPath;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
                File.WriteAllLines(FilePath, map.OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase).Select(kv => kv.Key + "\t" + kv.Value));
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        /// <summary>The .TcPOU that tab of that IDE showed last, when the file is still there; else null</summary>
        public static string Recall(string ide, int tab)
        {
            if (string.IsNullOrEmpty(ide) || tab < 0) return null;
            return Read().TryGetValue(ide + "\t" + tab, out var path) && File.Exists(path) ? path : null;
        }
    }
}
