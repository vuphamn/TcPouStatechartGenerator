using KvalMachineScope.Xae;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KvalMachineScope.Xae.Tests
{
    [TestClass]
    public class GitBlameTests
    {
        [TestMethod]
        public void ReadsEachLineWithItsCommit()
        {
            var output =
                "1111111111111111111111111111111111111111 1 1 2\r\n" +
                "author Ann\r\nauthor-time 1760000000\r\nsummary CLAMPED: a probe\r\nfilename x.TcPOU\r\n" +
                "\tline one\r\n" +
                "1111111111111111111111111111111111111111 2 2\r\n" +
                "author Ann\r\nauthor-time 1760000000\r\nsummary CLAMPED: a probe\r\nfilename x.TcPOU\r\n" +
                "\tline two\r\n" +
                "0000000000000000000000000000000000000000 3 3 1\r\n" +
                "author Not Committed Yet\r\nauthor-time 1760100000\r\nsummary Version of x.TcPOU from x.TcPOU\r\nfilename x.TcPOU\r\n" +
                "\t\tindented\r\n";
            var lines = GitBlame.Parse(output);
            Assert.AreEqual(3, lines.Count);
            Assert.AreEqual("1111111", lines[0].hash);
            Assert.AreEqual("Ann", lines[1].author);
            Assert.AreEqual("2025-10-09", lines[0].date);
            Assert.AreEqual("CLAMPED: a probe", lines[1].summary);
            Assert.AreEqual("line two", lines[1].text);
            Assert.AreEqual("0000000", lines[2].hash);
            Assert.AreEqual("\tindented", lines[2].text);
        }

        [TestMethod]
        public void LongSummariesAreCut()
        {
            var lines = GitBlame.Parse("2222222222222222222222222222222222222222 1 1 1\nauthor B\nsummary " + new string('x', 400) + "\n\tt\n");
            Assert.AreEqual(160, lines[0].summary.Length);
        }
    }
}
