using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace KvalStateScope.Xae
{
    /// <summary>
    /// The PLC project's files as the app asks for them (no Visual Studio needed: tested on its own): the type files
    /// without their implementations (completion, the checks), the POUs that use a name (a rename), a type's file,
    /// and whether a path is a POU of the project (what may be written).
    /// </summary>
    internal static class ProjectScan
    {
        /// <summary>Generated / library folders of a PLC project: never read</summary>
        private static readonly string[] Skip = { "_Boot", "_CompileInfo", "_Libraries", "_Deployment" };

        private static readonly Regex Implementation = new Regex(@"<Implementation>[\s\S]*?</Implementation>|<LineIds\b[\s\S]*?</LineIds>", RegexOptions.IgnoreCase);
        private static readonly Regex Identifier = new Regex(@"^[A-Za-z_]\w*$");

        public sealed class ProjectFile
        {
            public string name;
            public string path;
            public string content;
        }

        private static bool Skipped(string root, string file)
        {
            var rel = file.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar);
            return Skip.Any(s => rel.StartsWith(s + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase));
        }

        private static string Read(string file) => File.ReadAllText(file).TrimStart('﻿');

        /// <summary>A file's text without its implementations and line ids (the declarations are what is read)</summary>
        public static string StripImplementations(string content) => Implementation.Replace(content ?? "", "");

        /// <summary>The project's .TcPOU / .TcGVL / .TcDUT / .TcIO files, declarations only, up to maxChars in all</summary>
        public static List<ProjectFile> SymbolFiles(string root, long maxChars = 30000000)
        {
            var files = new List<ProjectFile>();
            long total = 0;
            foreach (var file in Directory.EnumerateFiles(root, "*.*", SearchOption.AllDirectories))
            {
                if (Skipped(root, file)) continue;
                var ext = Path.GetExtension(file).ToLowerInvariant();
                if (ext != ".tcpou" && ext != ".tcgvl" && ext != ".tcdut" && ext != ".tcio") continue;
                string content;
                try { content = StripImplementations(Read(file)); }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { continue; }
                total += content.Length;
                if (total > maxChars) break;
                files.Add(new ProjectFile { name = Path.GetFileName(file), path = file, content = content });
            }
            return files;
        }

        /// <summary>The project's .TcPOU files (not `except`) whose text has the name as a word, in full</summary>
        public static List<ProjectFile> UsesOf(string root, string name, string except, int max = 200)
        {
            var files = new List<ProjectFile>();
            if (name == null || !Identifier.IsMatch(name)) return files;
            var word = new Regex(@"\b" + name + @"\b", RegexOptions.IgnoreCase);
            foreach (var file in Directory.EnumerateFiles(root, "*.TcPOU", SearchOption.AllDirectories))
            {
                if (Skipped(root, file) || string.Equals(file, except, StringComparison.OrdinalIgnoreCase)) continue;
                string content;
                try { content = Read(file); }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { continue; }
                if (word.IsMatch(content)) files.Add(new ProjectFile { name = Path.GetFileName(file), path = file, content = content });
                if (files.Count >= max) break;
            }
            return files;
        }

        /// <summary>The file of a type (the first extension found first), or null</summary>
        public static string FindType(string root, string typeName, params string[] extensions)
        {
            if (root == null || typeName == null || !Identifier.IsMatch(typeName)) return null;
            try
            {
                foreach (var extension in extensions)
                {
                    var hit = Directory.EnumerateFiles(root, typeName + extension, SearchOption.AllDirectories).FirstOrDefault(f => !Skipped(root, f));
                    if (hit != null) return hit;
                }
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { }
            return null;
        }

        /// <summary>A path that is an existing .TcPOU inside the project folder (what a rename may write), or null</summary>
        public static string ProjectPou(string root, string path)
        {
            if (root == null || string.IsNullOrEmpty(path)) return null;
            string full;
            try { full = Path.GetFullPath(path); }
            catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException) { return null; }
            var prefix = root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !full.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) return null;
            return full;
        }
    }
}
