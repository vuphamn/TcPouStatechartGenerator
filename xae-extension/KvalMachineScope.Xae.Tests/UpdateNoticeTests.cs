using System.IO;
using KvalMachineScope.Xae;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KvalMachineScope.Xae.Tests
{
    /// <summary>What's new after an update: a first install says nothing; the same version nothing; a newer one, once</summary>
    [TestClass]
    public class UpdateNoticeTests
    {
        [TestMethod]
        public void SaidOnceAfterAnUpdateNotOnAFirstInstall()
        {
            var dir = Path.Combine(Path.GetTempPath(), "kss-update-" + Path.GetRandomFileName());
            var was = UpdateNotice.FilePath;
            UpdateNotice.FilePath = Path.Combine(dir, "xae-version.txt");
            try
            {
                Assert.IsNull(UpdateNotice.Check("0.8.0"), "a first install: nothing");
                Assert.IsNull(UpdateNotice.Check("0.8.0"), "the same version: nothing");
                Assert.AreEqual("0.8.0", UpdateNotice.Check("0.9.0"), "an update: the version before");
                Assert.IsNull(UpdateNotice.Check("0.9.0"), "said once");
                Assert.IsNull(UpdateNotice.Check(""), "no version: nothing");
            }
            finally
            {
                UpdateNotice.FilePath = was;
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
            }
        }
    }
}
