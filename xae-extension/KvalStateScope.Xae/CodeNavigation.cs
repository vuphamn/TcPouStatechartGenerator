using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio.TextManager.Interop;

namespace KvalStateScope.Xae
{
    /// <summary>
    /// Opens a method of a POU in TwinCAT's editor at a line, the way a user would: the method's node in the project
    /// tree is "double-clicked" (TwinCAT opens its editor), then the caret is moved to the line.
    /// </summary>
    internal static class CodeNavigation
    {
        private const int MaxNodes = 20000;

        /// <summary>Lines scrolled past the target first, so that it ends up with code below it (see GoToAsync)</summary>
        private const int ContextLines = 12;

        /// <summary>Returns null on success, else why it could not navigate</summary>
        public static async Task<string> GoToAsync(IServiceProvider services, string pouPath, string method, int line, string text)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            var pouName = Path.GetFileNameWithoutExtension(pouPath);
            var caption = method != null ? pouName + "." + method : pouName;
            var node = FindNode(services, pouPath, method);
            if (node == null) return $"{caption} was not found in an open TwinCAT project";
            var (hierarchy, itemId) = node.Value;
            Log.Write($"navigate: {Path.GetFileName(pouPath)} {method} line {line} (tree item {itemId})");

            if (!OpenNode(services, hierarchy, itemId)) return "TwinCAT did not open the editor";

            // The editor opens asynchronously: wait for its window, then place the caret
            for (var attempt = 0; attempt < 30; attempt++)
            {
                await Task.Delay(150);
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                var editor = FindEditor(services, caption, line, text);
                if (editor == null) continue;
                var (frame, view, buffer, target, lineCount) = editor.Value;
                frame.Show();
                view.SendExplicitFocus();
                // TwinCAT scrolls only as far as needed to show the caret, which would leave a line further down on
                // the last visible row: go past it first (the scroll happens when the editor repaints), then to it
                view.SetCaretPos(Math.Min(target + ContextLines, lineCount - 1), 0);
                await Task.Delay(300);
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                view.SetCaretPos(target, 0);
                view.SetSelection(target, 0, target, LineText(buffer, target).Length);
                view.SendExplicitFocus();
                Log.Write($"caret: line {target + 1} of {lineCount} in '{caption}'");
                return null;
            }
            Log.Write($"caret: no editor window '{caption}'");
            return $"Opened {caption}; go to line {line}";
        }

        /// <summary>
        /// Opens a tree node's editor like a double-click. TwinCAT does not take every way of doing that, so the
        /// standard ones are tried in turn (each is logged).
        /// </summary>
        private static bool OpenNode(IServiceProvider services, IVsHierarchy hierarchy, uint itemId)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var cmds = VSConstants.GUID_VsUIHierarchyWindowCmds;
            var doubleClick = (uint)VSConstants.VsUIHierarchyWindowCmdIds.UIHWCMDID_DoubleClick;
            var enterKey = (uint)VSConstants.VsUIHierarchyWindowCmdIds.UIHWCMDID_EnterKey;

            if (hierarchy is IVsUIHierarchy ui)
            {
                var hr = ui.ExecCommand(itemId, ref cmds, doubleClick, 0, IntPtr.Zero, IntPtr.Zero);
                Log.Write($"open: tree double-click 0x{hr:X8}");
                if (hr == VSConstants.S_OK) return true; // S_FALSE: not handled
                hr = ui.ExecCommand(itemId, ref cmds, enterKey, 0, IntPtr.Zero, IntPtr.Zero);
                Log.Write($"open: tree enter key 0x{hr:X8}");
                if (hr == VSConstants.S_OK) return true; // S_FALSE: not handled
            }

            if (hierarchy is IVsProject project)
            {
                var view = VSConstants.LOGVIEWID_Primary;
                var hr = project.OpenItem(itemId, ref view, IntPtr.Zero, out var frame);
                Log.Write($"open: IVsProject.OpenItem 0x{hr:X8}");
                if (ErrorHandler.Succeeded(hr) && frame != null)
                {
                    frame.Show();
                    return true;
                }
            }

            // As the tree window does it: select the node, then send the double-click / Enter to the window
            try
            {
                var window = VsShellUtilities.GetUIHierarchyWindow(services as IServiceProvider ?? ServiceProvider.GlobalProvider, VSConstants.StandardToolWindows.SolutionExplorer);
                if (window != null && hierarchy is IVsUIHierarchy uiHierarchy)
                {
                    var hr = window.ExpandItem(uiHierarchy, itemId, EXPANDFLAGS.EXPF_SelectItem);
                    Log.Write($"open: select in tree window 0x{hr:X8}");
                    if (window is Microsoft.VisualStudio.OLE.Interop.IOleCommandTarget target)
                    {
                        foreach (var id in new[] { doubleClick, enterKey })
                        {
                            hr = target.Exec(ref cmds, id, 0, IntPtr.Zero, IntPtr.Zero);
                            Log.Write($"open: tree window command {id} 0x{hr:X8}");
                            if (hr == VSConstants.S_OK) return true; // S_FALSE: not handled
                        }
                    }
                }
            }
            catch (Exception ex) when (ex is COMException || ex is InvalidCastException)
            {
                Log.Write("open: tree window: " + ex.Message);
            }
            return false;
        }

        /// <summary>
        /// The editor window of the POU / method and the line to go to. TwinCAT's editor window (VSEditor, hosting the
        /// CODESYS declaration and implementation editors) is itself an IVsTextView whose lines are the declaration's
        /// followed by the implementation's. The app counts lines in the implementation, so the line holding
        /// <paramref name="text"/> nearest to it is used.
        /// </summary>
        private static (IVsWindowFrame frame, IVsTextView view, IVsTextLines buffer, int target, int lineCount)? FindEditor(
            IServiceProvider services, string caption, int line, string text)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var frame = FindFrame(services, caption);
            if (frame == null) return null;
            if (ErrorHandler.Failed(frame.GetProperty((int)__VSFPROPID.VSFPROPID_DocView, out var docView)) || docView == null) return null;
            if (!(docView is IVsTextView view))
            {
                Log.Write($"caret: '{caption}' is no text view ({docView.GetType().FullName})");
                return null;
            }
            if (ErrorHandler.Failed(view.GetBuffer(out var buffer)) || buffer == null) return null;
            buffer.GetLineCount(out var lineCount);
            if (lineCount <= 0) return null;

            var target = Math.Max(0, Math.Min(line - 1, lineCount - 1));
            var want = (text ?? "").Trim();
            if (want.Length > 0)
            {
                var found = -1;
                for (var i = 0; i < lineCount; i++)
                {
                    if (LineText(buffer, i).Trim() == want && (found < 0 || Math.Abs(i - target) < Math.Abs(found - target))) found = i;
                }
                if (found >= 0) target = found;
                else Log.Write($"caret: '{want}' not found in '{caption}', using line {line}");
            }
            return (frame, view, buffer, target, lineCount);
        }

        private static string LineText(IVsTextLines buffer, int line)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (ErrorHandler.Failed(buffer.GetLengthOfLine(line, out var length))) return "";
            return ErrorHandler.Succeeded(buffer.GetLineText(line, 0, line, length, out var s)) ? s ?? "" : "";
        }

        /// <summary>The document window with this caption ("SM_X.doState"; TwinCAT may add " [Online]" etc.)</summary>
        private static IVsWindowFrame FindFrame(IServiceProvider services, string caption)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!(services.GetService(typeof(SVsUIShell)) is IVsUIShell shell)) return null;
            if (ErrorHandler.Failed(shell.GetDocumentWindowEnum(out var frames)) || frames == null) return null;
            var batch = new IVsWindowFrame[1];
            while (frames.Next(1, batch, out var fetched) == VSConstants.S_OK && fetched == 1)
            {
                if (ErrorHandler.Succeeded(batch[0].GetProperty((int)__VSFPROPID.VSFPROPID_Caption, out var c)) && c is string s
                    && (string.Equals(s.Trim(), caption, StringComparison.OrdinalIgnoreCase)
                        || s.StartsWith(caption + " ", StringComparison.OrdinalIgnoreCase)))
                    return batch[0];
            }
            return null;
        }

        /// <summary>The tree node of the POU (by its file) and, when given, of its method child</summary>
        private static (IVsHierarchy, uint)? FindNode(IServiceProvider services, string pouPath, string method)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!(services.GetService(typeof(SVsSolution)) is IVsSolution solution)) return null;
            var projectsGuid = Guid.Empty;
            if (ErrorHandler.Failed(solution.GetProjectEnum((uint)__VSENUMPROJFLAGS.EPF_LOADEDINSOLUTION, ref projectsGuid, out var projects))) return null;
            var batch = new IVsHierarchy[1];
            var visited = 0;
            while (projects.Next(1, batch, out var fetched) == VSConstants.S_OK && fetched == 1)
            {
                var pou = FindByFile(batch[0], VSConstants.VSITEMID_ROOT, pouPath, 0, ref visited);
                if (pou == null) continue;
                if (method == null) return pou;
                var (hier, pouItem) = pou.Value;
                foreach (var child in Children(hier, pouItem))
                {
                    if (string.Equals(NodeName(hier, child), method, StringComparison.OrdinalIgnoreCase)) return (hier, child);
                }
                Log.Write($"navigate: no child '{method}' under the POU node");
                return pou;
            }
            return null;
        }

        private static (IVsHierarchy, uint)? FindByFile(IVsHierarchy hier, uint item, string file, int depth, ref int visited)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (depth > 25 || ++visited > MaxNodes) return null;
            // Nested hierarchy (e.g. the PLC project inside the TwinCAT project)
            var nestedGuid = typeof(IVsHierarchy).GUID;
            if (item != VSConstants.VSITEMID_ROOT
                && ErrorHandler.Succeeded(hier.GetNestedHierarchy(item, ref nestedGuid, out var nestedPtr, out var nestedRoot))
                && nestedPtr != IntPtr.Zero)
            {
                try
                {
                    if (Marshal.GetObjectForIUnknown(nestedPtr) is IVsHierarchy nested)
                        return FindByFile(nested, nestedRoot, file, depth + 1, ref visited);
                }
                finally { Marshal.Release(nestedPtr); }
            }
            if (item != VSConstants.VSITEMID_ROOT && ErrorHandler.Succeeded(hier.GetCanonicalName(item, out var canonical))
                && string.Equals(canonical, file, StringComparison.OrdinalIgnoreCase))
                return (hier, item);
            foreach (var child in Children(hier, item))
            {
                var hit = FindByFile(hier, child, file, depth + 1, ref visited);
                if (hit != null) return hit;
            }
            return null;
        }

        private static IEnumerable<uint> Children(IVsHierarchy hier, uint item)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var list = new List<uint>();
            if (ErrorHandler.Failed(hier.GetProperty(item, (int)__VSHPROPID.VSHPROPID_FirstChild, out var first))) return list;
            var child = ToItemId(first);
            for (var n = 0; child != VSConstants.VSITEMID_NIL && n < 5000; n++)
            {
                list.Add(child);
                if (ErrorHandler.Failed(hier.GetProperty(child, (int)__VSHPROPID.VSHPROPID_NextSibling, out var next))) break;
                child = ToItemId(next);
            }
            return list;
        }

        private static uint ToItemId(object value)
        {
            switch (value)
            {
                case int i: return unchecked((uint)i);
                case uint u: return u;
                case short s: return unchecked((uint)s);
                case long l: return unchecked((uint)l);
                default: return VSConstants.VSITEMID_NIL;
            }
        }

        /// <summary>Tree caption without TwinCAT's type suffix: "doState : BOOL" / "SM_X (FB)" -> "doState" / "SM_X"</summary>
        private static string NodeName(IVsHierarchy hier, uint item)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (ErrorHandler.Failed(hier.GetProperty(item, (int)__VSHPROPID.VSHPROPID_Name, out var name)) || !(name is string s)) return null;
            return Regex.Replace(s.Trim(), @"\s*(\(.*\)|:.*)$", "");
        }
    }
}
