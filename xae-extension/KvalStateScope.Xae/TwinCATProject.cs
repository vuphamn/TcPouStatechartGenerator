using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using EnvDTE;
using EnvDTE80;
using Microsoft.CSharp.RuntimeBinder;
using Microsoft.VisualStudio.Shell;

namespace KvalStateScope.Xae
{
    /// <summary>
    /// Access to POUs / DUTs of an open TwinCAT project through Beckhoff's Automation Interface (ITcSysManager,
    /// ITcSmTreeItem, ITcPlcPou.DocumentXml). DocumentXml is the object in the .TcPOU / .TcDUT file format; setting it
    /// updates XAE's project and TwinCAT writes the file itself. Late bound, so it works with any TwinCAT 3 version.
    /// </summary>
    internal static class TwinCATProject
    {
        /// <summary>
        /// The PLC tree item of a .TcPOU / .TcDUT that belongs to a TwinCAT project open in the IDE, or null.
        /// The tree mirrors the folders of the PLC project: TIPC^&lt;PLC&gt;^&lt;name&gt; Project^POUs^...^SM_X
        /// </summary>
        public static object FindTreeItem(IServiceProvider services, string filePath)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var plcproj = FindPlcProjectFile(filePath);
            if (plcproj == null) return null;
            var plcDir = Path.GetDirectoryName(plcproj);
            var relative = filePath.Substring(plcDir.Length).TrimStart(Path.DirectorySeparatorChar);
            var segments = relative.Split(Path.DirectorySeparatorChar).ToList();
            segments[segments.Count - 1] = Path.GetFileNameWithoutExtension(segments[segments.Count - 1]);
            var tail = string.Join("^", segments);
            var projectNodeName = Path.GetFileNameWithoutExtension(plcproj) + " Project";

            if (!(services.GetService(typeof(DTE)) is DTE2 dte)) return null;
            foreach (var sysManager in SystemManagers(dte))
            {
                dynamic sys = sysManager;
                dynamic tipc;
                int plcCount;
                try
                {
                    tipc = sys.LookupTreeItem("TIPC");
                    plcCount = (int)tipc.ChildCount;
                }
                catch (Exception ex) when (ex is COMException || ex is RuntimeBinderException) { continue; }
                for (var i = 1; i <= plcCount; i++)
                {
                    string plcPath, plcName;
                    try
                    {
                        dynamic plc = tipc.Child(i);
                        plcPath = (string)plc.PathName;
                        plcName = (string)plc.Name;
                    }
                    catch (Exception ex) when (ex is COMException || ex is RuntimeBinderException) { continue; }
                    // The nested PLC project node is normally "<plcproj name> Project" (or "<PLC name> Project")
                    foreach (var node in new[] { projectNodeName, plcName + " Project" }.Distinct())
                    {
                        try
                        {
                            object item = sys.LookupTreeItem($"{plcPath}^{node}^{tail}");
                            if (item != null) return item;
                        }
                        catch (Exception ex) when (ex is COMException || ex is RuntimeBinderException) { }
                    }
                }
            }
            return null;
        }

        /// <summary>The object as XAE has it (same format as the file)</summary>
        public static string ReadXml(object treeItem)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            return (string)((dynamic)treeItem).DocumentXml;
        }

        /// <summary>Replaces the object in XAE's project; TwinCAT also writes it to its file. Closes an open editor of it</summary>
        public static void WriteXml(object treeItem, string xml)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            ((dynamic)treeItem).DocumentXml = xml;
        }

        /// <summary>
        /// Writes an edited object into XAE. Only the declarations / ST implementations that changed are written, on the
        /// object or its methods, actions and property accessors: that keeps the object ids and leaves an open editor
        /// alone. Replacing the whole object (DocumentXml) makes TwinCAT generate new ids and close the editor, so it is
        /// only used when the structure changed (e.g. a method added or removed, or non-ST code edited).
        /// Returns "parts" (with the number written) or "document".
        /// </summary>
        public static string WriteChanges(object treeItem, string newXml, out int partsWritten)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            partsWritten = 0;
            var oldXml = ReadXml(treeItem);
            var changes = DiffParts(oldXml, newXml);
            if (changes == null)
            {
                WriteXml(treeItem, newXml);
                return "document";
            }
            foreach (var change in changes)
            {
                dynamic target = treeItem;
                foreach (var name in change.Path) target = target.LookupChild(name);
                if (change.Declaration != null) { target.DeclarationText = change.Declaration; partsWritten++; }
                if (change.Implementation != null) { target.ImplementationText = change.Implementation; partsWritten++; }
            }
            return "parts";
        }

        private sealed class Part
        {
            public List<string> Path;
            public string Declaration;
            public string ImplementationKind;
            public string Implementation;
            public string ImplementationXml;
        }

        internal sealed class PartChange
        {
            public List<string> Path;
            public string Declaration;
            public string Implementation;
        }

        private static readonly HashSet<string> SubObjects = new HashSet<string> { "Method", "Action", "Property", "Get", "Set", "Transition" };

        /// <summary>The part edits that turn oldXml into newXml, or null when the change is not only in ST / declarations</summary>
        internal static List<PartChange> DiffParts(string oldXml, string newXml)
        {
            System.Xml.Linq.XElement oldRoot, newRoot;
            try
            {
                oldRoot = System.Xml.Linq.XDocument.Parse(oldXml.TrimStart('﻿')).Root?.Elements().FirstOrDefault();
                newRoot = System.Xml.Linq.XDocument.Parse(newXml.TrimStart('﻿')).Root?.Elements().FirstOrDefault();
            }
            catch (System.Xml.XmlException) { return null; }
            if (oldRoot == null || newRoot == null || oldRoot.Name != newRoot.Name
                || (string)oldRoot.Attribute("Name") != (string)newRoot.Attribute("Name")) return null;

            var oldParts = Collect(oldRoot);
            var newParts = Collect(newRoot);
            if (oldParts.Count != newParts.Count || oldParts.Keys.Any(k => !newParts.ContainsKey(k))) return null;

            var changes = new List<PartChange>();
            foreach (var key in newParts.Keys)
            {
                var o = oldParts[key];
                var n = newParts[key];
                if (o.ImplementationKind != n.ImplementationKind) return null;
                // Graphical / non-ST implementations are only written as a whole object
                if (n.ImplementationKind != null && n.ImplementationKind != "ST" && o.ImplementationXml != n.ImplementationXml) return null;
                var change = new PartChange { Path = n.Path };
                if (!SameText(o.Declaration, n.Declaration)) change.Declaration = Crlf(n.Declaration ?? "");
                if (n.ImplementationKind == "ST" && !SameText(o.Implementation, n.Implementation)) change.Implementation = Crlf(n.Implementation ?? "");
                if (change.Declaration != null || change.Implementation != null) changes.Add(change);
            }
            return changes;
        }

        private static Dictionary<string, Part> Collect(System.Xml.Linq.XElement root)
        {
            var parts = new Dictionary<string, Part>();
            void Visit(System.Xml.Linq.XElement el, List<string> path)
            {
                var impl = el.Element("Implementation")?.Elements().FirstOrDefault();
                parts[string.Join("/", path)] = new Part
                {
                    Path = path,
                    Declaration = el.Element("Declaration")?.Value,
                    ImplementationKind = impl?.Name.LocalName,
                    Implementation = impl?.Name.LocalName == "ST" ? impl.Value : null,
                    ImplementationXml = impl?.ToString(),
                };
                foreach (var child in el.Elements().Where(c => SubObjects.Contains(c.Name.LocalName)))
                {
                    var name = (string)child.Attribute("Name") ?? child.Name.LocalName;
                    Visit(child, new List<string>(path) { name });
                }
            }
            Visit(root, new List<string>());
            return parts;
        }

        private static bool SameText(string a, string b) =>
            (a ?? "").Replace("\r\n", "\n") == (b ?? "").Replace("\r\n", "\n");

        // TwinCAT keeps CRLF line endings in its objects
        private static string Crlf(string text) => text.Replace("\r\n", "\n").Replace("\n", "\r\n");

        public static string TreePath(object treeItem)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try { return (string)((dynamic)treeItem).PathName; }
            catch (Exception ex) when (ex is COMException || ex is RuntimeBinderException) { return null; }
        }

        private static IEnumerable<object> SystemManagers(DTE2 dte)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var result = new List<object>();
            void Visit(Project project, int depth)
            {
                ThreadHelper.ThrowIfNotOnUIThread();
                if (project == null || depth > 4) return;
                object obj = null;
                try { obj = project.Object; } catch (COMException) { } catch (NotImplementedException) { }
                if (obj != null)
                {
                    try
                    {
                        // Only TwinCAT projects answer LookupTreeItem
                        ((dynamic)obj).LookupTreeItem("TIPC");
                        result.Add(obj);
                        return;
                    }
                    catch (Exception ex) when (ex is COMException || ex is RuntimeBinderException) { }
                }
                // Solution folders
                try
                {
                    foreach (ProjectItem child in project.ProjectItems)
                        Visit(child.SubProject, depth + 1);
                }
                catch (Exception ex) when (ex is COMException || ex is NotImplementedException || ex is NullReferenceException) { }
            }
            try
            {
                foreach (Project p in dte.Solution.Projects) Visit(p, 0);
            }
            catch (COMException) { }
            return result;
        }

        private static string FindPlcProjectFile(string filePath)
        {
            var dir = Path.GetDirectoryName(filePath);
            for (var depth = 0; dir != null && depth < 12; depth++, dir = Path.GetDirectoryName(dir))
            {
                try
                {
                    var plcproj = Directory.GetFiles(dir, "*.plcproj").FirstOrDefault();
                    if (plcproj != null) return plcproj;
                }
                catch (IOException) { return null; }
                catch (UnauthorizedAccessException) { return null; }
            }
            return null;
        }
    }
}
