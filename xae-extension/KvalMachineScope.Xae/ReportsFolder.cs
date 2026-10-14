using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// Reports kept beside the PLC project (MachineScope.reports\, as shared/reportsFile.cjs: the same folder for every
    /// edition): the Live tab's test reports (HTML, and their data as JSON to compare two) and the shift reports.
    /// </summary>
    public static class ReportsFolder
    {
        public const string FolderName = "MachineScope.reports";
        private const int MaxBytes = 4 * 1024 * 1024;
        private static readonly Regex NameRx = new Regex(@"^[\w.-]{1,120}\.(html|json)$", RegexOptions.IgnoreCase);

        public sealed class Info
        {
            public string name { get; set; }
            public long size { get; set; }
            public double mtime { get; set; }
        }

        public static bool OkName(string name) => name != null && NameRx.IsMatch(name) && !name.Contains("..");

        /// <summary>Saved: the file's path, or null with error</summary>
        public static string Save(string projectDir, string name, string content, out string error)
        {
            error = null;
            if (projectDir == null) { error = "The PLC project (.plcproj) of the POU was not found"; return null; }
            if (!OkName(name)) { error = "Not a report file name (.html or .json)"; return null; }
            if (content == null || content.Length > MaxBytes) { error = "Nothing to save, or too large"; return null; }
            try
            {
                var dir = Path.Combine(projectDir, FolderName);
                Directory.CreateDirectory(dir);
                var file = Path.Combine(dir, name);
                File.WriteAllText(file, content, new System.Text.UTF8Encoding(false));
                return file;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { error = ex.Message; return null; }
        }

        /// <summary>The reports kept, newest first (at most 200)</summary>
        public static List<Info> List(string projectDir)
        {
            var dir = projectDir == null ? null : Path.Combine(projectDir, FolderName);
            if (dir == null || !Directory.Exists(dir)) return new List<Info>();
            try
            {
                var epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                return new DirectoryInfo(dir).GetFiles()
                    .Where(f => OkName(f.Name))
                    .Select(f => new Info { name = f.Name, size = f.Length, mtime = Math.Floor((f.LastWriteTimeUtc - epoch).TotalMilliseconds) })
                    .OrderByDescending(f => f.mtime).ThenByDescending(f => f.name, StringComparer.Ordinal)
                    .Take(200).ToList();
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { return new List<Info>(); }
        }

        /// <summary>One report's text, or null with error</summary>
        public static string Read(string projectDir, string name, out string error)
        {
            error = null;
            if (projectDir == null) { error = "The PLC project (.plcproj) of the POU was not found"; return null; }
            if (!OkName(name)) { error = "Not a report file name"; return null; }
            var file = Path.Combine(projectDir, FolderName, name);
            try
            {
                if (!File.Exists(file)) { error = "No such report"; return null; }
                if (new FileInfo(file).Length > MaxBytes) { error = "Too large"; return null; }
                return File.ReadAllText(file).TrimStart('﻿');
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { error = ex.Message; return null; }
        }
    }
}
