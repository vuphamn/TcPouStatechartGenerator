using System.IO;
using KvalMachineScope.Xae;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KvalMachineScope.Xae.Tests
{
    [TestClass]
    public class AssistantContextTests
    {
        [TestMethod]
        public void SetsUpAFolderAndWritesTheSelectionThereOnly()
        {
            var root = Path.Combine(Path.GetTempPath(), "kss-assistant-" + System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            try
            {
                var pou = Path.Combine(root, "EFX", "POUs", "EFX.TcPOU");
                Assert.IsFalse(AssistantContext.IsSetUp(root));
                Assert.IsFalse(AssistantContext.WriteSelection(root, pou, "x"));
                Assert.IsFalse(Directory.Exists(Path.Combine(root, ".machinescope")));
                File.WriteAllText(Path.Combine(root, "CLAUDE.md"), "# EFX\n\nOur notes.\n");
                var r = AssistantContext.SetupFolder(root);
                Assert.IsTrue(r.Updated);
                Assert.IsFalse(r.Created);
                var claude = File.ReadAllText(r.Claude);
                StringAssert.StartsWith(claude, "# EFX\n\nOur notes.\n\n" + AssistantContext.Start);
                StringAssert.Contains(claude, ".machinescope/selection.md");
                StringAssert.Contains(claude, "write a quote as `$'`");
                StringAssert.Contains(File.ReadAllText(Path.Combine(root, ".machinescope", ".gitignore")), "\n*\n");
                // (GitHub Copilot's: .github\copilot-instructions.md, created with the same section)
                Assert.AreEqual("created", r.CopilotResult);
                Assert.AreEqual(Path.Combine(root, ".github", "copilot-instructions.md"), r.Copilot);
                StringAssert.StartsWith(File.ReadAllText(r.Copilot), AssistantContext.Start);
                StringAssert.Contains(File.ReadAllText(r.Copilot), ".machinescope/selection.md");
                // (set up again: replaced, not added twice)
                AssistantContext.SetupFolder(root);
                var again = File.ReadAllText(r.Claude);
                Assert.AreEqual(2, again.Split(new[] { AssistantContext.End }, System.StringSplitOptions.None).Length);
                Assert.AreEqual(2, File.ReadAllText(r.Copilot).Split(new[] { AssistantContext.End }, System.StringSplitOptions.None).Length);
                StringAssert.Contains(again, "Our notes.");
                Assert.IsTrue(AssistantContext.WriteSelection(root, pou, "file `%POU_PATH%`"));
                Assert.AreEqual("file `EFX/POUs/EFX.TcPOU`", File.ReadAllText(Path.Combine(root, ".machinescope", "selection.md")));
                Assert.IsTrue(AssistantContext.WriteSelection(root, Path.Combine(Path.GetTempPath(), "elsewhere.TcPOU"), "file `%POU_PATH%`"));
                Assert.AreEqual("file `(not in this folder)`", File.ReadAllText(Path.Combine(root, ".machinescope", "selection.md")));
            }
            finally
            {
                Directory.Delete(root, true);
            }
        }
    }
}
