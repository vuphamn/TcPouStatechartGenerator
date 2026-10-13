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

        public sealed class Type
        {
            public List<string> allowed { get; set; } = new List<string>();
            public List<Entry> log { get; set; } = new List<Entry>();
        }

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

        /// <summary>The list (allowed: null keeps it) and / or a state set (entry: logged with the user, now) saved</summary>
        public static Type Save(string dir, string pouType, List<string> allowed, Entry entry, string user, out string error)
        {
            error = null;
            if (dir == null) { error = "No PLC project (.plcproj) above the POU"; return null; }
            if (pouType == null || !TypeRx.IsMatch(pouType)) { error = "Not a POU type"; return null; }
            var file = Path.Combine(dir, FileName);
            var pous = ReadAll(file);
            if (!pous.TryGetValue(pouType, out var mine)) pous[pouType] = mine = new Type();
            if (allowed != null) mine.allowed = allowed.Where(x => x != null && StateRx.IsMatch(x)).Distinct().Take(500).ToList();
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
                File.WriteAllText(file, json.Serialize(new Dictionary<string, object> { ["note"] = "Commissioning of Kval MachineScope: each POU type's states the PLC may be set to from a state's menu (live), and who set which state when. Commit it with the project to share it.", ["pous"] = pous }) + "\n");
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { error = "Not written: " + ex.Message; return null; }
            return mine;
        }
    }
}
