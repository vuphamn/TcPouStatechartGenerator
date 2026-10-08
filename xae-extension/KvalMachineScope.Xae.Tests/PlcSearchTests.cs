using System;
using System.IO;
using System.Linq;
using KvalMachineScope.Xae;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KvalMachineScope.Xae
{
    /// <summary>(the extension's log: MachineScopeControl.cs, which needs Visual Studio; here, nothing)</summary>
    internal static class Log
    {
        public static void Write(string message) { }
    }
}

namespace KvalMachineScope.Xae.Tests
{
    /// <summary>The Live tab's Browse: where this computer's TwinCAT routes (StaticRoutes.xml) are looked for</summary>
    [TestClass]
    public class PlcSearchTests
    {
        [TestMethod]
        public void RoutesLookedForWhereEachTwinCATKeepsThem()
        {
            var dirs = PlcSearch.RouteDirs();
            var programData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), @"Beckhoff\TwinCAT\3.1\Target");
            var packageManager = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Beckhoff\TwinCAT\3.1\Target");
            Assert.IsTrue(dirs.Contains(programData, StringComparer.OrdinalIgnoreCase), "4026's configuration folder");
            Assert.IsTrue(dirs.Contains(@"C:\TwinCAT\3.1\Target", StringComparer.OrdinalIgnoreCase), "4024's installation folder");
            // (TwinCAT installed by its Package Manager keeps them under its installation folder)
            Assert.IsTrue(dirs.Contains(packageManager, StringComparer.OrdinalIgnoreCase), $"the Package Manager's installation folder ({string.Join("; ", dirs)})");
        }
    }
}
