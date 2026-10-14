using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// Commissioning beside the PLC project (MachineScope.commissioning.json, as shared/commissioningFile.cjs: the same
    /// file for every edition): per POU type, the states the PLC may be set to from a state's menu, and who set which
    /// state when (the user named here, by Windows, not by the page).
    /// </summary>
    public static class CommissioningFile
    {
        public const string FileName = "MachineScope.commissioning.json";
        private const int MaxLog = 500;
        private static readonly Regex StateRx = new Regex(@"^[A-Za-z_][\w.]{0,120}$");
        private static readonly Regex TypeRx = new Regex(@"^\w+$");
        private static readonly Regex NameRx = new Regex(@"^[\w .()+-]{1,60}$");

        public sealed class Entry
        {
            public string t { get; set; }
            public string user { get; set; }
            public string state { get; set; }
            public string from { get; set; }
            public string plc { get; set; }
            public bool ok { get; set; }
            public string message { get; set; }
            public string reason { get; set; }
        }

        /// <summary>A saved sequence: states one after another (2 to 20), by name</summary>
        public sealed class Sequence
        {
            public string name { get; set; }
            public List<string> states { get; set; } = new List<string>();
        }

        public sealed class Type
        {
            public List<string> allowed { get; set; } = new List<string>();
            public List<Entry> log { get; set; } = new List<Entry>();
            public List<Sequence> sequences { get; set; } = new List<Sequence>();
        }

        /// <summary>Sequences checked: a name, 2 to 20 states, each name once (case-insensitive), at most 50</summary>
        public static List<Sequence> CleanSequences(IEnumerable<Sequence> list)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var output = new List<Sequence>();
            foreach (var s in list ?? Enumerable.Empty<Sequence>())
            {
                var name = s?.name?.Trim();
                if (name == null || !NameRx.IsMatch(name) || s.states == null) continue;
                var states = s.states.Where(x => x != null && StateRx.IsMatch(x)).Take(20).ToList();
                if (states.Count < 2 || !seen.Add(name)) continue;
                output.Add(new Sequence { name = name, states = states });
                if (output.Count >= 50) break;
            }
            return output;
        }

        /// <summary>Sequences from JSON (deserialized: a list of { name, states })</summary>
        public static List<Sequence> SequencesFrom(object value) =>
            value is object[] list
                ? CleanSequences(list.OfType<Dictionary<string, object>>().Select(d => new Sequence { name = d.TryGetValue("name", out var n) ? n as string : null, states = d.TryGetValue("states", out var st) && st is object[] xs ? xs.OfType<string>().ToList() : null }))
                : null;

        private static string S(Dictionary<string, object> d, string k) => d.TryGetValue(k, out var v) && v != null ? v.ToString() : "";

        private static SortedDictionary<string, Type> ReadAll(string file)
        {
            var pous = new SortedDictionary<string, Type>(StringComparer.Ordinal);
            try
            {
                if (file == null || !File.Exists(file)) return pous;
                if (!(new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.DeserializeObject(File.ReadAllText(file)) is Dictionary<string, object> root) || !root.TryGetValue("pous", out var p) || !(p is Dictionary<string, object> types)) return pous;
                foreach (var ty in types)
                {
                    if (!TypeRx.IsMatch(ty.Key) || !(ty.Value is Dictionary<string, object> v)) continue;
                    var t = new Type();
                    if (v.TryGetValue("allowed", out var a) && a is object[] list) t.allowed = list.OfType<string>().Where(x => StateRx.IsMatch(x)).Distinct().Take(500).ToList();
                    if (v.TryGetValue("log", out var l) && l is object[] entries)
                        t.log = entries.OfType<Dictionary<string, object>>().Where(e => S(e, "t") != "" && S(e, "state") != "")
                            .Select(e => new Entry { t = S(e, "t"), user = S(e, "user"), state = S(e, "state"), from = S(e, "from"), plc = S(e, "plc"), ok = !(e.TryGetValue("ok", out var o) && o is bool b && !b), message = e.TryGetValue("message", out var m) && m != null ? m.ToString() : null, reason = e.TryGetValue("reason", out var rs) && rs != null ? rs.ToString() : null })
                            .Skip(Math.Max(0, entries.Length - MaxLog)).ToList();
                    if (v.TryGetValue("sequences", out var sq)) t.sequences = SequencesFrom(sq) ?? new List<Sequence>();
                    pous[ty.Key] = t;
                }
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is InvalidOperationException) { }
            return pous;
        }

        public static Type Read(string dir, string pouType)
        {
            if (dir == null || pouType == null || !TypeRx.IsMatch(pouType)) return new Type();
            return ReadAll(Path.Combine(dir, FileName)).TryGetValue(pouType, out var t) ? t : new Type();
        }

        /// <summary>The list (allowed: null keeps it), the saved sequences (null keeps them) and / or a state set (entry: logged with the user, now) saved</summary>
        public static Type Save(string dir, string pouType, List<string> allowed, Entry entry, string user, out string error, List<Sequence> sequences = null)
        {
            error = null;
            if (dir == null) { error = "No PLC project (.plcproj) above the POU"; return null; }
            if (pouType == null || !TypeRx.IsMatch(pouType)) { error = "Not a POU type"; return null; }
            var file = Path.Combine(dir, FileName);
            var pous = ReadAll(file);
            if (!pous.TryGetValue(pouType, out var mine)) pous[pouType] = mine = new Type();
            if (allowed != null) mine.allowed = allowed.Where(x => x != null && StateRx.IsMatch(x)).Distinct().Take(500).ToList();
            if (sequences != null) mine.sequences = CleanSequences(sequences);
            if (entry != null && entry.state != null && StateRx.IsMatch(entry.state))
            {
                entry.t = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
                entry.user = string.IsNullOrEmpty(user) ? "?" : user;
                if (entry.message != null && entry.message.Length > 300) entry.message = entry.message.Substring(0, 300);
                if (entry.reason != null && entry.reason.Length > 300) entry.reason = entry.reason.Substring(0, 300);
                mine.log.Add(entry);
                if (mine.log.Count > MaxLog) mine.log = mine.log.Skip(mine.log.Count - MaxLog).ToList();
            }
            try
            {
                var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
                File.WriteAllText(file, json.Serialize(new Dictionary<string, object> { ["note"] = "Commissioning of Kval MachineScope: each POU type's states the PLC may be set to from a state's menu (live), its saved sequences of them, and who set which state when. Commit it with the project to share it.", ["pous"] = pous }) + "\n");
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { error = "Not written: " + ex.Message; return null; }
            return mine;
        }
    }
}
