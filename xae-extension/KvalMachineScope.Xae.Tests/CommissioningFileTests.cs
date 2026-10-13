using System.Collections.Generic;
using System.IO;
using KvalMachineScope.Xae;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KvalMachineScope.Xae.Tests
{
    [TestClass]
    public class CommissioningFileTests
    {
        [TestMethod]
        public void KeepsTheListAndWhoSetWhich()
        {
            var dir = Path.Combine(Path.GetTempPath(), "kss-comm-" + System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                Assert.AreEqual(0, CommissioningFile.Read(dir, "SM_A").allowed.Count);
                var t = CommissioningFile.Save(dir, "SM_A", new List<string> { "IDLE", "bad name!", "RUN" }, null, "ann", out var e1);
                Assert.IsNull(e1);
                CollectionAssert.AreEqual(new[] { "IDLE", "RUN" }, t.allowed);
                t = CommissioningFile.Save(dir, "SM_A", null, new CommissioningFile.Entry { state = "RUN", from = "IDLE", plc = "5.1.2.3.1.1:851", ok = true }, "ann", out _);
                Assert.AreEqual(1, t.log.Count);
                Assert.AreEqual("ann", t.log[0].user);
                CollectionAssert.AreEqual(new[] { "IDLE", "RUN" }, t.allowed);
                var back = CommissioningFile.Read(dir, "SM_A");
                Assert.AreEqual("RUN", back.log[0].state);
                Assert.IsTrue(back.log[0].ok);
                Assert.AreEqual(0, CommissioningFile.Read(dir, "SM_B").log.Count);
                Assert.IsNull(CommissioningFile.Save(dir, "not a type", null, null, "x", out var e2));
                Assert.IsNotNull(e2);
            }
            finally
            {
                Directory.Delete(dir, true);
            }
        }
    }
}
