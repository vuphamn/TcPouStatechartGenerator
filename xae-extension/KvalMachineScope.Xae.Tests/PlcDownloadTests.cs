using System;
using System.IO;
using KvalMachineScope.Xae;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KvalMachineScope.Xae.Tests
{
    /// <summary>
    /// Download and start's PLC projects: the ones a .tsproj's &lt;Plc&gt; holds (not other projects of it); a missing file:
    /// none. Without TwinCAT's automation assembly loaded, Run says so (the real-PLC check: tests/plc/xae-download.ps1)
    /// </summary>
    [TestClass]
    public class PlcDownloadTests
    {
        [TestMethod]
        public void ThePlcProjectsOfATsproj()
        {
            const string xml = "<TcSmProject><Project><System><Tasks><Task><Name>PlcTask</Name></Task></Tasks></System>" +
                "<Plc><Project GUID=\"{1}\" Name=\"KssPlc\" PrjFilePath=\"KssPlc\\KssPlc.plcproj\"/><Project Name=\"Second\"/><Project Name=\"KssPlc\"/></Plc>" +
                "<Io><Project Name=\"NotAPlc\"/></Io></Project></TcSmProject>";
            CollectionAssert.AreEqual(new[] { "KssPlc", "Second" }, PlcDownload.PlcProjectNamesIn(xml));
            Assert.AreEqual(0, PlcDownload.PlcProjectNamesIn("<TcSmProject/>").Count, "no PLC");
            Assert.AreEqual(0, PlcDownload.PlcProjectNames(Path.Combine(Path.GetTempPath(), "kss-none-" + Path.GetRandomFileName() + ".tsproj")).Count, "no file");
        }

        [TestMethod]
        public void WithoutTwinCATsAutomationItSaysSo()
        {
            var ex = Assert.ThrowsException<InvalidOperationException>(() => PlcDownload.Run(new object(), new[] { "KssPlc" }, null));
            StringAssert.Contains(ex.Message, "TCatSysManagerLib");
        }
    }
}
