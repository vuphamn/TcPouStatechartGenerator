using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// Download and start (after Activate Configuration, as XAE's Login with a download): each PLC project of a TwinCAT
    /// project logged in to with a download, asking nothing (ITcPlcOnline, PLC_LOGIN_FLAGS FORCEDOWNLOAD | SILENT),
    /// started, its boot project made, logged off. TwinCAT's automation interfaces (TCatSysManagerLib) are found among the
    /// loaded assemblies: XAE has them; the real-PLC check (tests/plc/xae-download.ps1) loads them itself and runs this
    /// against a hidden XAE.
    /// </summary>
    public static class PlcDownload
    {
        /// <summary>The PLC projects a .tsproj holds (its &lt;Plc&gt;&lt;Project Name="…"&gt;)</summary>
        public static List<string> PlcProjectNames(string tsproj)
        {
            try
            {
                return PlcProjectNamesIn(File.ReadAllText(tsproj));
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { return new List<string>(); }
        }

        /// <summary>The PLC projects of a .tsproj's text</summary>
        public static List<string> PlcProjectNamesIn(string xml)
        {
            var plc = Regex.Match(xml ?? "", @"<Plc>([\s\S]*?)</Plc>");
            return Regex.Matches(plc.Success ? plc.Groups[1].Value : "", @"<Project\b[^>]*\bName=""([^""]+)""")
                .Cast<Match>().Select(m => m.Groups[1].Value).Distinct().ToList();
        }

        /// <summary>
        /// Downloads and starts each PLC project (sysManager: the TwinCAT project's ITcSysManager, its EnvDTE project's
        /// Object) → the ones done; throws when a login does not come (nothing downloaded then)
        /// </summary>
        public static List<string> Run(object sysManager, IEnumerable<string> plcs, Action<string> log)
        {
            var online = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType("TCatSysManagerLib.ITcPlcOnline", false)).FirstOrDefault(t => t != null)
                ?? throw new InvalidOperationException("TwinCAT's automation assembly (TCatSysManagerLib) is not loaded");
            var flagsType = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType("TCatSysManagerLib.PLC_LOGIN_FLAGS", false)).FirstOrDefault(t => t != null);
            dynamic sm = sysManager;
            var done = new List<string>();
            foreach (var plc in plcs)
            {
                object item = sm.LookupTreeItem($"TIPC^{plc}^{plc} Project");
                // (FORCEDOWNLOAD 4 | SILENT 256: asking nothing; the application stops, takes the code, waits)
                var flags = flagsType != null ? Enum.ToObject(flagsType, 4 + 256) : (object)(4 + 256);
                online.GetMethod("Login").Invoke(item, new[] { flags });
                var loggedIn = false;
                for (var w = 0; w < 60 && !loggedIn; w++)
                {
                    loggedIn = (bool)online.GetProperty("IsLoggedIn").GetValue(item);
                    if (!loggedIn) System.Threading.Thread.Sleep(500);
                }
                if (!loggedIn) throw new InvalidOperationException($"XAE did not log in to {plc}'s PLC: nothing was downloaded");
                try { online.GetMethod("Start").Invoke(item, null); } catch (System.Reflection.TargetInvocationException) { }
                try { ((dynamic)sm.LookupTreeItem("TIPC^" + plc)).GenerateBootProject(true); } catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException || ex is Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { log?.Invoke($"download: boot project of {plc}: {ex.Message}"); }
                try { online.GetMethod("Logoff").Invoke(item, null); } catch (System.Reflection.TargetInvocationException) { }
                log?.Invoke($"download: {plc} downloaded and started");
                done.Add(plc);
            }
            return done;
        }
    }
}
