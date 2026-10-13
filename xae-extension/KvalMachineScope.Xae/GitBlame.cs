using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// git blame --line-porcelain's output read: a line each of the file, who last changed it (as shared/gitHistory.cjs
    /// does for the desktop app and VS Code): its commit (7 characters; 0000000: not committed yet), author, date
    /// (YYYY-MM-DD), the commit's summary (at most 160 characters) and the line's text
    /// </summary>
    public static class GitBlame
    {
        public sealed class Line
        {
            public string hash { get; set; }
            public string author { get; set; }
            public string date { get; set; }
            public string summary { get; set; }
            public string text { get; set; }
        }

        private static readonly Regex Header = new Regex(@"^([0-9a-f]{40}) \d+ \d+", RegexOptions.Compiled);

        public static List<Line> Parse(string output)
        {
            var lines = new List<Line>();
            Line cur = null;
            foreach (var raw in (output ?? "").Split('\n'))
            {
                if (raw.StartsWith("\t"))
                {
                    if (cur != null)
                    {
                        cur.text = raw.Substring(1).TrimEnd('\r');
                        lines.Add(cur);
                    }
                    cur = null;
                    continue;
                }
                var l = raw.TrimEnd('\r');
                var head = Header.Match(l);
                if (head.Success)
                {
                    cur = new Line { hash = head.Groups[1].Value.Substring(0, 7), author = "", date = "", summary = "" };
                    continue;
                }
                if (cur == null) continue;
                if (l.StartsWith("author ")) cur.author = l.Substring(7);
                else if (l.StartsWith("author-time ") && long.TryParse(l.Substring(12), out var secs))
                    cur.date = DateTimeOffset.FromUnixTimeSeconds(secs).UtcDateTime.ToString("yyyy-MM-dd");
                else if (l.StartsWith("summary ")) cur.summary = l.Length > 168 ? l.Substring(8, 160) : l.Substring(8);
            }
            return lines;
        }
    }
}
