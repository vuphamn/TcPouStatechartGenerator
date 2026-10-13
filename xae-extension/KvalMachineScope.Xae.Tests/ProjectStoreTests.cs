using System.Collections.Generic;
using System.IO;
using KvalMachineScope.Xae;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KvalMachineScope.Xae.Tests
{
    [TestClass]
    public class ProjectStoreTests
    {
        [TestMethod]
        public void KeepsEachPouTypesValue()
        {
            var dir = Path.Combine(Path.GetTempPath(), "kss-store-" + System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                Assert.IsNull(ProjectStore.Read(dir, "alerts", "SM_A", out _));
                var value = new Dictionary<string, object> { ["Night"] = new Dictionary<string, object> { ["exprs"] = new object[] { "= x > 1" } } };
                Assert.IsTrue(ProjectStore.Save(dir, "alerts", "SM_A", value, out var e1), e1);
                Assert.IsTrue(ProjectStore.Save(dir, "alerts", "SM_B", new Dictionary<string, object> { ["Day"] = new Dictionary<string, object>() }, out _));
                var back = ProjectStore.Read(dir, "alerts", "SM_A", out _) as Dictionary<string, object>;
                Assert.IsNotNull(back);
                Assert.IsTrue(back.ContainsKey("Night"));
                StringAssert.Contains(File.ReadAllText(Path.Combine(dir, "MachineScope.alerts.json")), "SM_B");
                Assert.IsTrue(ProjectStore.Save(dir, "alerts", "SM_A", null, out _));
                Assert.IsNull(ProjectStore.Read(dir, "alerts", "SM_A", out _));
                Assert.IsFalse(ProjectStore.Save(dir, "secrets", "SM_A", value, out var e2));
                Assert.IsNotNull(e2);
                Assert.IsFalse(ProjectStore.Save(dir, "alerts", "../x", value, out _));
            }
            finally
            {
                Directory.Delete(dir, true);
            }
        }
    }
}
