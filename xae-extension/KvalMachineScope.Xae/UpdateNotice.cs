using System;
using System.IO;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// What's new after an update (no Visual Studio needed: tested on its own): the extension's version last loaded in
    /// this TcXaeShell, kept in a file; a newer one loaded → the one before (the package shows a notification bar with
    /// What's new); a first install, or the same version → nothing.
    /// </summary>
    internal static class UpdateNotice
    {
        internal static string FilePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KvalMachineScope", "xae-version.txt");

        /// <summary>The version loaded now → the one before when it changed (shown then), else null; the file updated</summary>
        internal static string Check(string current)
        {
            if (string.IsNullOrWhiteSpace(current)) return null;
            string before = null;
            try
            {
                if (File.Exists(FilePath)) before = File.ReadAllText(FilePath).Trim();
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { return null; }
            if (string.Equals(before, current, StringComparison.OrdinalIgnoreCase)) return null;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
                File.WriteAllText(FilePath, current);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { return null; }
            // (a first install: nothing to tell)
            return string.IsNullOrEmpty(before) ? null : before;
        }
    }
}
