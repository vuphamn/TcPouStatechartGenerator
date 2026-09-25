using System;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.OLE.Interop;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace KvalStateScope.Xae
{
    /// <summary>
    /// Answers for our commands before any window does. TwinCAT's PLC tree shows its context menu through its own
    /// command target, which does not pass other extensions' commands on, so a dynamically visible command placed in
    /// that menu would stay hidden. Priority command targets are asked first by the IDE's command routing.
    /// </summary>
    internal sealed class PriorityCommandTarget : IOleCommandTarget
    {
        private readonly KvalStateScopePackage _package;
        private readonly Action<string> _open;
        private DateTime _lastLog = DateTime.MinValue;
        private bool? _lastVisible;

        private PriorityCommandTarget(KvalStateScopePackage package, Action<string> open)
        {
            _package = package;
            _open = open;
        }

        public static uint Register(KvalStateScopePackage package, Action<string> open)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!(Package.GetGlobalService(typeof(SVsRegisterPriorityCommandTarget)) is IVsRegisterPriorityCommandTarget registrar)) return 0;
            return ErrorHandler.Succeeded(registrar.RegisterPriorityCommandTarget(0, new PriorityCommandTarget(package, open), out var cookie)) ? cookie : 0;
        }

        public int QueryStatus(ref Guid pguidCmdGroup, uint cCmds, OLECMD[] prgCmds, IntPtr pCmdText)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (pguidCmdGroup != PackageGuids.CommandSet || cCmds != 1 || prgCmds[0].cmdID != CommandIds.OpenSelected)
                return (int)Microsoft.VisualStudio.OLE.Interop.Constants.OLECMDERR_E_NOTSUPPORTED;

            var visible = SelectionHelper.GetSelectedPouPath(_package) != null;
            prgCmds[0].cmdf = (uint)OLECMDF.OLECMDF_SUPPORTED | (visible ? (uint)OLECMDF.OLECMDF_ENABLED : (uint)OLECMDF.OLECMDF_INVISIBLE);
            // Diagnostics: log changes, and at most every 10 s
            if (_lastVisible != visible || (DateTime.Now - _lastLog).TotalSeconds > 10)
            {
                Log.Write($"context menu query: {(visible ? "shown" : "hidden")} ({SelectionHelper.GetSelectedPouPath(_package) ?? "no .TcPOU selected"})");
                _lastVisible = visible;
                _lastLog = DateTime.Now;
            }
            return VSConstants.S_OK;
        }

        public int Exec(ref Guid pguidCmdGroup, uint nCmdID, uint nCmdexecopt, IntPtr pvaIn, IntPtr pvaOut)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (pguidCmdGroup != PackageGuids.CommandSet || nCmdID != CommandIds.OpenSelected)
                return (int)Microsoft.VisualStudio.OLE.Interop.Constants.OLECMDERR_E_NOTSUPPORTED;
            var path = SelectionHelper.GetSelectedPouPath(_package);
            if (path == null) return VSConstants.S_OK;
            _open(path);
            return VSConstants.S_OK;
        }
    }
}
