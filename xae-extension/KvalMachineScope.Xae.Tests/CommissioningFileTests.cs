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

        [TestMethod]
        public void KeepsSavedSequencesByName()
        {
            var dir = Path.Combine(Path.GetTempPath(), "kss-comm-" + System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                var seqs = new List<CommissioningFile.Sequence>
                {
                    new CommissioningFile.Sequence { name = "Clamp test", states = new List<string> { "IDLE", "CLAMP", "bad state!", "UNCLAMP" } },
                    new CommissioningFile.Sequence { name = "clamp TEST", states = new List<string> { "A", "B" } },
                    new CommissioningFile.Sequence { name = "Too short", states = new List<string> { "A" } },
                    new CommissioningFile.Sequence { name = "bad:name", states = new List<string> { "A", "B" } },
                };
                var t = CommissioningFile.Save(dir, "SM_A", null, null, "ann", out var e, seqs);
                Assert.IsNull(e);
                Assert.AreEqual(1, t.sequences.Count);
                CollectionAssert.AreEqual(new[] { "IDLE", "CLAMP", "UNCLAMP" }, t.sequences[0].states);
                // (a state set later keeps them; read back from the file)
                CommissioningFile.Save(dir, "SM_A", null, new CommissioningFile.Entry { state = "IDLE", ok = true }, "ann", out _);
                var back = CommissioningFile.Read(dir, "SM_A");
                Assert.AreEqual("Clamp test", back.sequences[0].name);
                Assert.AreEqual(3, back.sequences[0].states.Count);
                Assert.AreEqual(1, back.log.Count);
                Assert.AreEqual(0, CommissioningFile.Save(dir, "SM_A", null, null, "ann", out _, new List<CommissioningFile.Sequence>()).sequences.Count);
            }
            finally
            {
                Directory.Delete(dir, true);
            }
        }
    }
}
