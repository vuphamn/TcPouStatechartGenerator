using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace KvalStateScope.Xae
{
    /// <summary>
    /// Where a function block lives in the running PLC: its instance paths ("MAIN.fbLine.smTable"), found from the
    /// declarations in the PLC project's files, and the PLC's ADS port (from the TwinCAT project's .xti / .tsproj).
    /// </summary>
    internal static class LiveTargets
    {
        public const ushort DefaultPlcPort = 851;
        private const int MaxPaths = 50;

        /// <summary>The ADS port of the PLC project that contains the file (851 when not found)</summary>
        public static ushort PlcPort(string filePath)
        {
            var plcproj = PlcProjectFile(filePath);
            if (plcproj == null) return DefaultPlcPort;
            // The TwinCAT project (.tsproj) is above the PLC project; the PLC's settings are in a .xti or in the .tsproj
            var dir = Path.GetDirectoryName(Path.GetDirectoryName(plcproj));
            for (var depth = 0; dir != null && depth < 4; depth++, dir = Path.GetDirectoryName(dir))
            {
                IEnumerable<string> files;
                try
                {
                    if (!Directory.EnumerateFiles(dir, "*.tsproj").Any()) continue;
                    files = Directory.EnumerateFiles(dir, "*.tsproj").Concat(Directory.EnumerateFiles(dir, "*.xti", SearchOption.AllDirectories));
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { break; }
                foreach (var file in files)
                {
                    string text;
                    try { text = File.ReadAllText(file); } catch (IOException) { continue; }
                    foreach (Match m in Regex.Matches(text, @"<Project\b[^>]*>"))
                    {
                        var prj = Regex.Match(m.Value, @"\bPrjFilePath=""([^""]+)""");
                        var port = Regex.Match(m.Value, @"\bAmsPort=""(\d+)""");
                        if (!prj.Success || !port.Success) continue;
                        string resolved;
                        try { resolved = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(file), prj.Groups[1].Value)); }
                        catch (Exception ex) when (ex is ArgumentException || ex is NotSupportedException || ex is PathTooLongException) { resolved = prj.Groups[1].Value; }
                        var same = string.Equals(resolved, plcproj, StringComparison.OrdinalIgnoreCase)
                                   || string.Equals(Path.GetFileName(resolved), Path.GetFileName(plcproj), StringComparison.OrdinalIgnoreCase);
                        if (same && ushort.TryParse(port.Groups[1].Value, out var p)) return p;
                    }
                }
                break;
            }
            return DefaultPlcPort;
        }

        /// <summary>Instance paths of the function block (or the program itself), from the PLC project's declarations</summary>
        public static List<string> InstancePaths(string pouPath, string pouName)
        {
            var plcproj = PlcProjectFile(pouPath);
            if (plcproj == null) return new List<string>();
            var types = new Dictionary<string, TypeInfo>(StringComparer.OrdinalIgnoreCase);
            IEnumerable<string> files;
            try
            {
                files = Directory.EnumerateFiles(Path.GetDirectoryName(plcproj), "*.*", SearchOption.AllDirectories)
                    .Where(f => f.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".TcGVL", StringComparison.OrdinalIgnoreCase));
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { return new List<string>(); }
            foreach (var file in files)
            {
                try { Read(file, types); }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { }
            }
            if (types.TryGetValue(pouName, out var self) && self.Kind == "PROGRAM") return new List<string> { self.Name };

            // Members inherited through EXTENDS
            IEnumerable<Member> MembersOf(TypeInfo t, int depth)
            {
                if (depth > 8) yield break;
                foreach (var m in t.Members) yield return m;
                if (t.Extends != null && types.TryGetValue(t.Extends, out var b))
                    foreach (var m in MembersOf(b, depth + 1)) yield return m;
            }
            // Who holds an instance of a type: (container, member)
            var holders = new Dictionary<string, List<(TypeInfo, string)>>(StringComparer.OrdinalIgnoreCase);
            foreach (var t in types.Values)
                foreach (var m in MembersOf(t, 0))
                {
                    if (!holders.TryGetValue(m.Type, out var list)) holders[m.Type] = list = new List<(TypeInfo, string)>();
                    list.Add((t, m.Name));
                }

            var paths = new List<string>();
            void Up(string type, string suffix, int depth, HashSet<string> seen)
            {
                if (paths.Count >= MaxPaths || depth > 10 || !holders.TryGetValue(type, out var list)) return;
                foreach (var (container, member) in list)
                {
                    var path = member + suffix;
                    if (container.Kind == "PROGRAM" || container.Kind == "GVL") paths.Add(container.Name + "." + path);
                    else if (seen.Add(container.Name)) { Up(container.Name, "." + path, depth + 1, seen); seen.Remove(container.Name); }
                }
            }
            Up(pouName, "", 0, new HashSet<string>(StringComparer.OrdinalIgnoreCase) { pouName });
            return paths.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        private sealed class TypeInfo
        {
            public string Name;
            public string Kind; // PROGRAM, FUNCTION_BLOCK, GVL, ...
            public string Extends;
            public List<Member> Members = new List<Member>();
        }

        private sealed class Member
        {
            public string Name;
            public string Type;
        }

        private static readonly Regex Block = new Regex(@"\b(VAR_GLOBAL|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|VAR_STAT|VAR_INST|VAR_EXTERNAL|VAR)\b(?<mods>[^\r\n]*)(?<body>.*?)\bEND_VAR\b",
            RegexOptions.Singleline | RegexOptions.IgnoreCase);

        private static void Read(string file, Dictionary<string, TypeInfo> types)
        {
            var xml = File.ReadAllText(file);
            var isGvl = file.EndsWith(".TcGVL", StringComparison.OrdinalIgnoreCase);
            var head = Regex.Match(xml, isGvl ? @"<GVL\b[^>]*\bName=""([^""]+)""" : @"<POU\b[^>]*\bName=""([^""]+)""");
            if (!head.Success) return;
            // The object's own declaration (not those of its methods, which come later in the file)
            var decl = Regex.Match(xml.Substring(head.Index), @"<Declaration>\s*<!\[CDATA\[(.*?)\]\]>", RegexOptions.Singleline);
            if (!decl.Success) return;
            var code = BlankComments(decl.Groups[1].Value);
            var type = new TypeInfo { Name = head.Groups[1].Value };
            if (isGvl) type.Kind = "GVL";
            else
            {
                var kind = Regex.Match(code, @"^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION|INTERFACE)\b", RegexOptions.Multiline | RegexOptions.IgnoreCase);
                type.Kind = kind.Success ? kind.Groups[1].Value.ToUpperInvariant() : "FUNCTION_BLOCK";
                var ext = Regex.Match(code, @"\bEXTENDS\s+([A-Za-z_][\w.]*)", RegexOptions.IgnoreCase);
                if (ext.Success) type.Extends = ext.Groups[1].Value.Split('.').Last();
            }
            if (type.Kind == "FUNCTION" || type.Kind == "INTERFACE") return;
            foreach (Match b in Block.Matches(code))
            {
                var kind = b.Groups[1].Value.ToUpperInvariant();
                var mods = b.Groups["mods"].Value;
                if (kind == "VAR_TEMP" || kind == "VAR_IN_OUT" || kind == "VAR_INST" || kind == "VAR_EXTERNAL"
                    || Regex.IsMatch(mods, @"\bCONSTANT\b", RegexOptions.IgnoreCase)) continue;
                foreach (var statement in b.Groups["body"].Value.Split(';'))
                {
                    var m = Regex.Match(statement, @"^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?:AT\s+%\S+\s*)?:\s*(.+)$", RegexOptions.Singleline);
                    if (!m.Success) continue;
                    var typeText = m.Groups[2].Value.Trim();
                    typeText = Regex.Replace(typeText, @":=.*$", "", RegexOptions.Singleline).Trim();
                    if (Regex.IsMatch(typeText, @"^(ARRAY|POINTER|REFERENCE)\b", RegexOptions.IgnoreCase)) continue;
                    var typeName = Regex.Match(typeText, @"^([A-Za-z_][\w.]*)").Groups[1].Value.Split('.').Last();
                    if (typeName.Length == 0) continue;
                    foreach (var name in m.Groups[1].Value.Split(','))
                        type.Members.Add(new Member { Name = name.Trim(), Type = typeName });
                }
            }
            types[type.Name] = type;
        }

        private static string BlankComments(string text)
        {
            var sb = new StringBuilder(text);
            for (var i = 0; i < sb.Length; i++)
            {
                if (sb[i] == '(' && i + 1 < sb.Length && sb[i + 1] == '*')
                {
                    var depth = 0;
                    var j = i;
                    for (; j < sb.Length; j++)
                    {
                        if (sb[j] == '(' && j + 1 < sb.Length && sb[j + 1] == '*') { depth++; j++; }
                        else if (sb[j] == '*' && j + 1 < sb.Length && sb[j + 1] == ')') { depth--; j++; if (depth == 0) break; }
                    }
                    for (var k = i; k <= Math.Min(j, sb.Length - 1); k++) if (sb[k] != '\n') sb[k] = ' ';
                    i = j;
                }
                else if (sb[i] == '/' && i + 1 < sb.Length && sb[i + 1] == '/')
                {
                    for (; i < sb.Length && sb[i] != '\n'; i++) sb[i] = ' ';
                }
                else if (sb[i] == '{')
                {
                    for (; i < sb.Length && sb[i] != '}' && sb[i] != '\n'; i++) sb[i] = ' ';
                    if (i < sb.Length && sb[i] == '}') sb[i] = ' ';
                }
            }
            return sb.ToString();
        }

        internal static string PlcProjectFile(string filePath)
        {
            var dir = Path.GetDirectoryName(filePath);
            for (var depth = 0; dir != null && depth < 12; depth++, dir = Path.GetDirectoryName(dir))
            {
                try
                {
                    var plcproj = Directory.GetFiles(dir, "*.plcproj").FirstOrDefault();
                    if (plcproj != null) return plcproj;
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { return null; }
            }
            return null;
        }
    }
}
