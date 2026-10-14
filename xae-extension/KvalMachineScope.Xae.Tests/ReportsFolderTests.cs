using System.IO;
using KvalMachineScope.Xae;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KvalMachineScope.Xae.Tests
{
    [TestClass]
    public class ReportsFolderTests
    {
        [TestMethod]
        public void SavesListsAndReadsReports()
        {
            var dir = Path.Combine(Path.GetTempPath(), "kss-reports-" + System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                Assert.AreEqual(0, ReportsFolder.List(dir).Count);
                Assert.IsNotNull(ReportsFolder.Save(dir, "SM_A_test_report_2026-10-14-0800.json", "{\"pou\":\"SM_A\"}", out var e1));
                Assert.IsNull(e1);
                Assert.IsNotNull(ReportsFolder.Save(dir, "SM_A_shift_2026-10-14_06-14.html", "<html></html>", out _));
                Assert.IsNull(ReportsFolder.Save(dir, "..\\escape.json", "{}", out var e2));
                Assert.IsNotNull(e2);
                Assert.IsNull(ReportsFolder.Save(dir, "notes.txt", "x", out _));
                var list = ReportsFolder.List(dir);
                Assert.AreEqual(2, list.Count);
                Assert.AreEqual("{\"pou\":\"SM_A\"}", ReportsFolder.Read(dir, "SM_A_test_report_2026-10-14-0800.json", out _));
                Assert.IsNull(ReportsFolder.Read(dir, "missing.json", out var e3));
                Assert.AreEqual("No such report", e3);
                Assert.IsNull(ReportsFolder.Save(null, "a.json", "{}", out var e4));
                Assert.IsNotNull(e4);
            }
            finally
            {
                Directory.Delete(dir, true);
            }
        }
    }
}
