using System.Collections.Generic;
using KvalStateScope.Xae;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KvalStateScope.Xae.Tests
{
    /// <summary>Save All relayed between the MachineScope tabs of one XAE (a tab with a WebView2 profile of its own)</summary>
    [TestClass]
    public class SaveAllRelayTests
    {
        private sealed class Tab : ISaveAllTab
        {
            public readonly List<Dictionary<string, object>> Got = new List<Dictionary<string, object>>();
            public void PostToApp(object message) => Got.Add((Dictionary<string, object>)message);
        }

        [TestMethod]
        public void SaveAllGoesToTheOtherTabsAndTheAnswersBack()
        {
            var a = new Tab();
            var b = new Tab();
            var c = new Tab();
            SaveAllRelay.Register(a);
            SaveAllRelay.Register(b);
            SaveAllRelay.Register(c);
            try
            {
                Assert.AreEqual(2, SaveAllRelay.Relay(a, "saveAll", "r1"));
                Assert.AreEqual(0, a.Got.Count, "not back to the tab that asked");
                Assert.AreEqual("saveAll", b.Got[0]["type"]);
                Assert.AreEqual("r1", c.Got[0]["id"]);

                SaveAllRelay.Relay(b, "saveAllDone", "r1", "SM_Table.TcPOU", 2);
                Assert.AreEqual("saveAllDone", a.Got[0]["type"]);
                Assert.AreEqual("SM_Table.TcPOU", a.Got[0]["name"]);
                Assert.AreEqual(2, a.Got[0]["count"]);
            }
            finally
            {
                SaveAllRelay.Unregister(a);
                SaveAllRelay.Unregister(b);
                SaveAllRelay.Unregister(c);
            }
        }

        [TestMethod]
        public void OtherMessagesAndClosedTabsAreLeftOut()
        {
            var a = new Tab();
            var b = new Tab();
            SaveAllRelay.Register(a);
            SaveAllRelay.Register(b);
            SaveAllRelay.Register(b);
            try
            {
                Assert.AreEqual(0, SaveAllRelay.Relay(a, "navigate", "r2"), "only Save All's messages");
                Assert.AreEqual(0, SaveAllRelay.Relay(a, "saveAll", ""), "no id: nothing");
                Assert.AreEqual(1, SaveAllRelay.Relay(a, "saveAll", "r3"), "registered twice: told once");
                SaveAllRelay.Unregister(b);
                Assert.AreEqual(0, SaveAllRelay.Relay(a, "saveAll", "r4"), "a closed tab: not told");
            }
            finally
            {
                SaveAllRelay.Unregister(a);
                SaveAllRelay.Unregister(b);
            }
        }
    }
}
