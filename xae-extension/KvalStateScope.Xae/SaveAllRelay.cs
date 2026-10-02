using System;
using System.Collections.Generic;

namespace KvalStateScope.Xae
{
    /// <summary>A MachineScope tab that the relay can send an app message to</summary>
    internal interface ISaveAllTab
    {
        void PostToApp(object message);
    }

    /// <summary>
    /// Save All across the MachineScope tabs of this XAE: a tab's "saveAll" goes to the others, their "saveAllDone"
    /// replies back. The app does this itself through a BroadcastChannel when the tabs share one WebView2 profile; a
    /// tab with a profile of its own (the shared one was in use) only hears it through here. The app ignores a
    /// request it has already answered (the same id), so a tab reached both ways saves once.
    /// </summary>
    internal static class SaveAllRelay
    {
        private static readonly List<WeakReference<ISaveAllTab>> Tabs = new List<WeakReference<ISaveAllTab>>();

        public static void Register(ISaveAllTab tab)
        {
            lock (Tabs)
            {
                Tabs.RemoveAll(w => !w.TryGetTarget(out var t) || ReferenceEquals(t, tab));
                Tabs.Add(new WeakReference<ISaveAllTab>(tab));
            }
        }

        public static void Unregister(ISaveAllTab tab)
        {
            lock (Tabs) Tabs.RemoveAll(w => !w.TryGetTarget(out var t) || ReferenceEquals(t, tab));
        }

        /// <summary>A tab's saveAll / saveAllDone (id: the request's), passed to every other tab; how many got it</summary>
        public static int Relay(ISaveAllTab from, string type, string id, string name = null, int count = 0)
        {
            if (string.IsNullOrEmpty(id) || id.Length > 100) return 0;
            object message;
            if (type == "saveAll") message = new Dictionary<string, object> { ["type"] = "saveAll", ["id"] = id, ["relayed"] = true };
            else if (type == "saveAllDone") message = new Dictionary<string, object> { ["type"] = "saveAllDone", ["id"] = id, ["name"] = name ?? "", ["count"] = count, ["relayed"] = true };
            else return 0;
            List<ISaveAllTab> others;
            lock (Tabs)
            {
                others = new List<ISaveAllTab>();
                foreach (var w in Tabs)
                    if (w.TryGetTarget(out var t) && !ReferenceEquals(t, from)) others.Add(t);
            }
            foreach (var t in others)
            {
                try { t.PostToApp(message); }
                catch (Exception) { /* a closing tab */ }
            }
            return others.Count;
        }
    }
}
