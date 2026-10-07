using System.IO;
using KvalMachineScope.Xae;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KvalMachineScope.Xae.Tests
{
    /// <summary>The POU each MachineScope tab showed last, for the tabs the IDE restores when it opens again</summary>
    [TestClass]
    public class TabMemoryTests
    {
        [TestMethod]
        public void EachIdesTabsTheirLastPouWhileItIsThere()
        {
            var dir = Path.Combine(Path.GetTempPath(), "kss-tabmemory-" + Path.GetRandomFileName());
            Directory.CreateDirectory(dir);
            var was = TabMemory.FilePath;
            TabMemory.FilePath = Path.Combine(dir, "tabs.txt");
            try
            {
                var a = Path.Combine(dir, "SM_A.TcPOU");
                var b = Path.Combine(dir, "SM_B.TcPOU");
                File.WriteAllText(a, "a");
                File.WriteAllText(b, "b");
                Assert.IsNull(TabMemory.Recall("TcXaeShell", 0), "nothing yet");
                TabMemory.Remember("TcXaeShell", 0, a);
                TabMemory.Remember("TcXaeShell", 1, b);
                TabMemory.Remember("devenv", 0, b);
                Assert.AreEqual(a, TabMemory.Recall("TcXaeShell", 0));
                Assert.AreEqual(b, TabMemory.Recall("TcXaeShell", 1));
                Assert.AreEqual(b, TabMemory.Recall("devenv", 0), "each IDE its own");
                TabMemory.Remember("TcXaeShell", 0, b);
                Assert.AreEqual(b, TabMemory.Recall("TcXaeShell", 0), "the last one");
                File.Delete(b);
                Assert.IsNull(TabMemory.Recall("TcXaeShell", 1), "a file no longer there: none");
                Assert.IsNull(TabMemory.Recall("TcXaeShell", -1), "an unknown tab: none");
            }
            finally
            {
                TabMemory.FilePath = was;
                Directory.Delete(dir, true);
            }
        }
    }
}
