using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;

namespace KvalMachineScope.Xae
{
    /// <summary>The Kval MachineScope document tab</summary>
    [Guid(PackageGuids.ToolWindowString)]
    public sealed class MachineScopeToolWindow : ToolWindowPane
    {
        public MachineScopeToolWindow() : base(null)
        {
            Caption = "Kval MachineScope";
            Control = new MachineScopeControl(this);
            Content = Control;
        }

        internal MachineScopeControl Control { get; }

        protected override void Dispose(bool disposing)
        {
            if (disposing) Control.Shutdown();
            base.Dispose(disposing);
        }
    }
}
