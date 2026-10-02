using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;

namespace KvalStateScope.Xae
{
    /// <summary>The Kval MachineScope document tab</summary>
    [Guid(PackageGuids.ToolWindowString)]
    public sealed class StateScopeToolWindow : ToolWindowPane
    {
        public StateScopeToolWindow() : base(null)
        {
            Caption = "Kval MachineScope";
            Control = new StateScopeControl(this);
            Content = Control;
        }

        internal StateScopeControl Control { get; }

        protected override void Dispose(bool disposing)
        {
            if (disposing) Control.Shutdown();
            base.Dispose(disposing);
        }
    }
}
