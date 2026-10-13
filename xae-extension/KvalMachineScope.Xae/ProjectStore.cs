using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// Small per-POU-type settings beside the PLC project (as shared/projectStore.cjs: the same files for every edition):
    /// one file per kind, { note, pous: { &lt;POU type&gt;: &lt;value&gt; } }. Kinds: alerts (MachineScope.alerts.json).
    /// </summary>
    public static class ProjectStore
    {
        private static readonly Dictionary<string, (string file, string note)> Kinds = new Dictionary<string, (string, string)>
        {
            ["alerts"] = ("MachineScope.alerts.json", "Alert profiles of Kval MachineScope (the Live tab's Watched): each POU type's named sets of watch expressions, which alert and after how long. Commit it with the project to share them."),
        };
        private const int MaxBytes = 200000;
        private static readonly Regex TypeRx = new Regex(@"^\w+$");

        private static Dictionary<string, object> ReadAll(string file)
        {
            try
            {
                if (!File.Exists(file)) return new Dictionary<string, object>();
                var root = new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.DeserializeObject(File.ReadAllText(file)) as Dictionary<string, object>;
                return root != null && root.TryGetValue("pous", out var p) && p is Dictionary<string, object> pous ? pous : new Dictionary<string, object>();
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is InvalidOperationException)
            {
                return new Dictionary<string, object>();
            }
        }

        public static object Read(string dir, string kind, string pouType, out string error)
        {
            error = null;
            if (kind == null || !Kinds.ContainsKey(kind)) { error = "Not a kind of settings"; return null; }
            if (dir == null || pouType == null || !TypeRx.IsMatch(pouType)) return null;
            return ReadAll(Path.Combine(dir, Kinds[kind].file)).TryGetValue(pouType, out var v) ? v : null;
        }

        /// <summary>The value saved (null: removed); false with the error otherwise</summary>
        public static bool Save(string dir, string kind, string pouType, object value, out string error)
        {
            error = null;
            if (kind == null || !Kinds.ContainsKey(kind)) { error = "Not a kind of settings"; return false; }
            if (dir == null) { error = "No PLC project (.plcproj) above the POU"; return false; }
            if (pouType == null || !TypeRx.IsMatch(pouType)) { error = "Not a POU type"; return false; }
            var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            if (value != null && (!(value is Dictionary<string, object>) || json.Serialize(value).Length > MaxBytes)) { error = "Not settings (an object, 200 KB at most)"; return false; }
            var file = Path.Combine(dir, Kinds[kind].file);
            var pous = ReadAll(file);
            if (value == null) pous.Remove(pouType);
            else pous[pouType] = value;
            try { File.WriteAllText(file, json.Serialize(new Dictionary<string, object> { ["note"] = Kinds[kind].note, ["pous"] = pous }) + "\n"); }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { error = "Not written: " + ex.Message; return false; }
            return true;
        }
    }
}
