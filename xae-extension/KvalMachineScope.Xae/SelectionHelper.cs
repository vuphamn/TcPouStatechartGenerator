using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// Finds the .TcPOU file behind the current selection. TwinCAT's PLC tree is its own hierarchy, so several
    /// ways are tried: canonical name, save name, the DTE project item, and finally the node name looked up in
    /// the project folder.
    /// </summary>
    internal static class SelectionHelper
    {
        private static readonly Dictionary<string, string> NameLookupCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public static bool IsPou(string path) =>
            !string.IsNullOrEmpty(path) && path.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase) && File.Exists(path);

        /// <summary>The .TcPOU of the active document (when a document tab is active) or of the selected tree item</summary>
        public static string GetSelectedPouPath(IServiceProvider services)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var dte = services.GetService(typeof(DTE)) as DTE2;
            try
            {
                if (dte?.ActiveWindow?.Type == vsWindowType.vsWindowTypeDocument && IsPou(dte.ActiveDocument?.FullName))
                    return dte.ActiveDocument.FullName;
            }
            catch (COMException) { }
            catch (ArgumentException) { }

            var fromHierarchy = FromHierarchySelection(services);
            if (fromHierarchy != null) return fromHierarchy;

            try
            {
                if (dte?.SelectedItems != null)
                {
                    var solutionFolder = GetSolutionFolder(services);
                    foreach (SelectedItem item in dte.SelectedItems)
                    {
                        var path = FromProjectItem(item.ProjectItem)
                            // TwinCAT PLC tree items report no file names: "SM_X (FB)" -> SM_X.TcPOU below the solution
                            ?? LookupByName(item.ProjectItem?.Name ?? item.Name, solutionFolder);
                        if (path != null) return path;
                    }
                }
            }
            catch (COMException) { }
            catch (ArgumentException) { }

            // Right-clicking an item of Solution Explorer while another window is active (the editor, a MachineScope
            // tab): the menu is asked before Solution Explorer becomes the active window, so the IDE's selection is
            // still that other window's. Solution Explorer's own selection is already the right-clicked item.
            return FromSolutionExplorer(services);
        }

        /// <summary>The .TcPOU selected in Solution Explorer (TwinCAT's PLC tree), whichever window is active</summary>
        private static string FromSolutionExplorer(IServiceProvider services)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!(services.GetService(typeof(SVsUIShell)) is IVsUIShell shell)) return null;
            var solutionExplorer = VSConstants.StandardToolWindows.SolutionExplorer;
            // (not created when it is not open)
            if (ErrorHandler.Failed(shell.FindToolWindow((uint)__VSFINDTOOLWIN.FTW_fFindFirst, ref solutionExplorer, out var frame)) || frame == null)
                return null;
            if (ErrorHandler.Failed(frame.GetProperty((int)__VSFPROPID.VSFPROPID_DocView, out var view)) || !(view is IVsUIHierarchyWindow window))
                return null;
            var hierarchyPtr = IntPtr.Zero;
            try
            {
                if (ErrorHandler.Failed(window.GetCurrentSelection(out hierarchyPtr, out uint itemId, out IVsMultiItemSelect multi)))
                    return null;
                if (hierarchyPtr == IntPtr.Zero || multi != null || itemId == VSConstants.VSITEMID_NIL) return null;
                return Marshal.GetObjectForIUnknown(hierarchyPtr) is IVsHierarchy hierarchy ? FromHierarchyItem(hierarchy, itemId) : null;
            }
            catch (COMException) { return null; }
            finally
            {
                if (hierarchyPtr != IntPtr.Zero) Marshal.Release(hierarchyPtr);
            }
        }

        /// <summary>Diagnostics: what each source of the selection says (the log)</summary>
        public static string Describe(IServiceProvider services)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var dte = services.GetService(typeof(DTE)) as DTE2;
            string Try(Func<string> f) { try { return f() ?? "-"; } catch (Exception ex) { return ex.GetType().Name; } }
            var window = Try(() => $"{dte?.ActiveWindow?.Type} '{dte?.ActiveWindow?.Caption}'");
            var document = Try(() => Path.GetFileName(dte?.ActiveDocument?.FullName));
            var hierarchy = Try(() => Path.GetFileName(FromHierarchySelection(services)));
            var items = Try(() => string.Join(",", dte.SelectedItems.Cast<SelectedItem>().Select(i => i.Name)));
            var tree = Try(() => Path.GetFileName(FromSolutionExplorer(services)));
            return $"window {window}, document {document}, hierarchy {hierarchy}, selected items {items}, Solution Explorer {tree}";
        }

        /// <summary>The active document if it is a .TcPOU</summary>
        public static string GetActivePouPath(IServiceProvider services)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                var dte = services.GetService(typeof(DTE)) as DTE2;
                var path = dte?.ActiveDocument?.FullName;
                return IsPou(path) ? path : null;
            }
            catch (COMException) { return null; }
            catch (ArgumentException) { return null; }
        }

        public static string GetSolutionFolder(IServiceProvider services)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                var dte = services.GetService(typeof(DTE)) as DTE2;
                var sln = dte?.Solution?.FullName;
                return string.IsNullOrEmpty(sln) ? null : Path.GetDirectoryName(sln);
            }
            catch (COMException) { return null; }
        }

        private static string FromProjectItem(ProjectItem item)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (item == null) return null;
            try
            {
                for (short i = 1; i <= item.FileCount; i++)
                {
                    var path = item.FileNames[i];
                    if (IsPou(path)) return path;
                }
            }
            catch (COMException) { }
            catch (ArgumentException) { }
            catch (NotImplementedException) { }
            return null;
        }

        private static string FromHierarchySelection(IServiceProvider services)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!(services.GetService(typeof(SVsShellMonitorSelection)) is IVsMonitorSelection monitor)) return null;
            IntPtr hierarchyPtr = IntPtr.Zero, containerPtr = IntPtr.Zero;
            try
            {
                if (ErrorHandler.Failed(monitor.GetCurrentSelection(out hierarchyPtr, out uint itemId, out IVsMultiItemSelect multi, out containerPtr)))
                    return null;
                if (hierarchyPtr == IntPtr.Zero || multi != null || itemId == VSConstants.VSITEMID_NIL) return null;
                if (!(Marshal.GetObjectForIUnknown(hierarchyPtr) is IVsHierarchy hierarchy)) return null;
                return FromHierarchyItem(hierarchy, itemId);
            }
            finally
            {
                if (hierarchyPtr != IntPtr.Zero) Marshal.Release(hierarchyPtr);
                if (containerPtr != IntPtr.Zero) Marshal.Release(containerPtr);
            }
        }

        private static string FromHierarchyItem(IVsHierarchy hierarchy, uint itemId)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                if (ErrorHandler.Succeeded(hierarchy.GetCanonicalName(itemId, out string canonical)) && IsPou(canonical))
                    return canonical;
            }
            catch (COMException) { }

            if (GetStringProperty(hierarchy, itemId, (int)__VSHPROPID.VSHPROPID_SaveName) is string saveName && IsPou(saveName))
                return saveName;

            if (GetProperty(hierarchy, itemId, (int)__VSHPROPID.VSHPROPID_ExtObject) is ProjectItem projectItem)
            {
                var path = FromProjectItem(projectItem);
                if (path != null) return path;
            }

            // Last resort: "SM_TableManager (FB)" -> SM_TableManager.TcPOU below the project folder (or the solution)
            var name = GetStringProperty(hierarchy, itemId, (int)__VSHPROPID.VSHPROPID_Name);
            return LookupByName(name, ProjectFolder(hierarchy)) ?? LookupByName(name, SolutionFolderOf(hierarchy));
        }

        private static string SolutionFolderOf(IVsHierarchy hierarchy)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                return hierarchy.GetSite(out var site) == VSConstants.S_OK && site != null
                    ? GetSolutionFolder(new ServiceProvider(site))
                    : null;
            }
            catch (COMException) { return null; }
        }

        private static string ProjectFolder(IVsHierarchy hierarchy)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (GetStringProperty(hierarchy, VSConstants.VSITEMID_ROOT, (int)__VSHPROPID.VSHPROPID_ProjectDir) is string dir && Directory.Exists(dir))
                return dir;
            try
            {
                if (ErrorHandler.Succeeded(hierarchy.GetCanonicalName(VSConstants.VSITEMID_ROOT, out string rootFile)) && !string.IsNullOrEmpty(rootFile))
                {
                    var folder = File.Exists(rootFile) ? Path.GetDirectoryName(rootFile) : rootFile;
                    if (Directory.Exists(folder)) return folder;
                }
            }
            catch (COMException) { }
            catch (ArgumentException) { }
            return null;
        }

        private static string LookupByName(string nodeName, string folder)
        {
            if (string.IsNullOrWhiteSpace(nodeName) || folder == null) return null;
            var baseName = Regex.Replace(nodeName.Trim(), @"\s*\(.*\)\s*$", "");
            if (baseName.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase)) baseName = Path.GetFileNameWithoutExtension(baseName);
            if (baseName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return null;
            var key = folder + "|" + baseName;
            lock (NameLookupCache)
            {
                if (NameLookupCache.TryGetValue(key, out var cached)) return IsPou(cached) ? cached : null;
            }
            string found = null;
            try
            {
                found = Directory.EnumerateFiles(folder, baseName + ".TcPOU", SearchOption.AllDirectories).FirstOrDefault();
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            lock (NameLookupCache) NameLookupCache[key] = found;
            return found;
        }

        private static object GetProperty(IVsHierarchy hierarchy, uint itemId, int propId)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                return ErrorHandler.Succeeded(hierarchy.GetProperty(itemId, propId, out object value)) ? value : null;
            }
            catch (COMException) { return null; }
            catch (NotImplementedException) { return null; }
        }

        private static string GetStringProperty(IVsHierarchy hierarchy, uint itemId, int propId)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            return GetProperty(hierarchy, itemId, propId) as string;
        }
    }
}
