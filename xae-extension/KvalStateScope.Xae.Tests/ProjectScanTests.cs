using System;
using System.IO;
using System.Linq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("KvalStateScope.Xae.Tests")]

namespace KvalStateScope.Xae.Tests
{
    /// <summary>The PLC project's files as XAE sends them to the app: a small project folder made for each test</summary>
    [TestClass]
    public class ProjectScanTests
    {
        private string _root;

        private static string Pou(string name, string decl, string body) =>
            $"﻿<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<TcPlcObject><POU Name=\"{name}\"><Declaration><![CDATA[{decl}]]></Declaration><Implementation><ST><![CDATA[{body}]]></ST></Implementation><LineIds Name=\"{name}\"><LineId Id=\"1\" Count=\"1\" /></LineIds></POU></TcPlcObject>";

        private string Write(string rel, string content)
        {
            var path = Path.Combine(_root, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, content);
            return path;
        }

        [TestInitialize]
        public void Setup()
        {
            _root = Path.Combine(Path.GetTempPath(), "kss-scan-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_root);
            Write("Line.plcproj", "<Project/>");
            Write(@"POUs\SM_X.TcPOU", Pou("SM_X", "FUNCTION_BLOCK SM_X\nVAR_INPUT\n\tcmd_bStart : BOOL;\nEND_VAR", "cmd_bStart := FALSE;"));
            Write(@"POUs\PRG_Line.TcPOU", Pou("PRG_Line", "PROGRAM PRG_Line\nVAR\n\tsmX : SM_X;\nEND_VAR", "smX.cmd_bStart := TRUE;"));
            Write(@"POUs\PRG_Other.TcPOU", Pou("PRG_Other", "PROGRAM PRG_Other\nVAR\n\tn : INT;\nEND_VAR", "n := n + 1;"));
            Write(@"GVLs\GVL_IO.TcGVL", "<TcPlcObject><GVL Name=\"GVL_IO\"><Declaration><![CDATA[VAR_GLOBAL\n\tbDoor : BOOL;\nEND_VAR]]></Declaration></GVL></TcPlcObject>");
            Write(@"DUTs\E_S.TcDUT", "<TcPlcObject><DUT Name=\"E_S\"><Declaration><![CDATA[TYPE E_S :\n(\n\tS_A,\n\tS_B\n);\nEND_TYPE]]></Declaration></DUT></TcPlcObject>");
            Write(@"_Libraries\Lib\FB_Lib.TcPOU", Pou("FB_Lib", "FUNCTION_BLOCK FB_Lib", "cmd_bStart := TRUE;"));
        }

        [TestCleanup]
        public void Cleanup()
        {
            try { Directory.Delete(_root, true); } catch (IOException) { }
        }

        [TestMethod]
        public void SymbolFiles_are_the_type_files_without_implementations()
        {
            var files = ProjectScan.SymbolFiles(_root);
            CollectionAssert.AreEquivalent(new[] { "E_S.TcDUT", "GVL_IO.TcGVL", "PRG_Line.TcPOU", "PRG_Other.TcPOU", "SM_X.TcPOU" }, files.Select(f => f.name).ToArray(), "the project's own, not a library's");
            var pou = files.Single(f => f.name == "PRG_Line.TcPOU").content;
            StringAssert.Contains(pou, "smX : SM_X;", "the declaration kept");
            Assert.IsFalse(pou.Contains("<Implementation>") || pou.Contains("<LineIds"), "implementation and line ids left out");
            // (StartsWith with a culture ignores U+FEFF: the first character itself)
            Assert.AreNotEqual((char)0xFEFF, pou[0], "no BOM");
        }

        [TestMethod]
        public void SymbolFiles_stop_at_the_size_limit()
        {
            Assert.IsTrue(ProjectScan.SymbolFiles(_root, 200).Count < 5);
        }

        [TestMethod]
        public void UsesOf_lists_the_other_POUs_with_the_name_in_full()
        {
            var self = Path.Combine(_root, @"POUs\SM_X.TcPOU");
            var uses = ProjectScan.UsesOf(_root, "cmd_bStart", self);
            CollectionAssert.AreEqual(new[] { "PRG_Line.TcPOU" }, uses.Select(f => f.name).ToArray(), "not the POU itself, not a library, not one without the name");
            StringAssert.Contains(uses[0].content, "<Implementation>", "in full");
            Assert.AreEqual(0, ProjectScan.UsesOf(_root, "cmd_bStart;DROP", self).Count, "a name only");
            Assert.AreEqual(0, ProjectScan.UsesOf(_root, "CMD_BSTARTX", self).Count, "as a whole word");
        }

        [TestMethod]
        public void FindType_finds_a_POU_DUT_or_GVL_by_its_name()
        {
            StringAssert.EndsWith(ProjectScan.FindType(_root, "SM_X", ".TcPOU"), "SM_X.TcPOU");
            StringAssert.EndsWith(ProjectScan.FindType(_root, "E_S", ".TcPOU", ".TcDUT"), "E_S.TcDUT");
            Assert.IsNull(ProjectScan.FindType(_root, "FB_Lib", ".TcPOU"), "not a library's");
            Assert.IsNull(ProjectScan.FindType(_root, "..\\x", ".TcPOU"), "a name only");
        }

        [TestMethod]
        public void ProjectPou_allows_only_existing_POUs_inside_the_project()
        {
            Assert.IsNotNull(ProjectScan.ProjectPou(_root, Path.Combine(_root, @"POUs\PRG_Line.TcPOU")));
            Assert.IsNull(ProjectScan.ProjectPou(_root, Path.Combine(_root, @"POUs\..\..\evil.TcPOU")), "outside the folder");
            Assert.IsNull(ProjectScan.ProjectPou(_root, Path.Combine(_root, @"GVLs\GVL_IO.TcGVL")), "a POU only");
            Assert.IsNull(ProjectScan.ProjectPou(_root, Path.Combine(_root, @"POUs\Missing.TcPOU")), "an existing one");
            Assert.IsNull(ProjectScan.ProjectPou(_root + "Other", Path.Combine(_root, @"POUs\PRG_Line.TcPOU")), "a folder with the same start is no parent");
        }
    }
}
