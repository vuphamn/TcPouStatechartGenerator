using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;

namespace KvalStateScope.Xae
{
    /// <summary>The Kval StateScope document tab</summary>
    [Guid(PackageGuids.ToolWindowString)]
    public sealed class StateScopeToolWindow : ToolWindowPane
    {
        public StateScopeToolWindow() : base(null)
        {
            Caption = "Kval StateScope";
            Control = new StateScopeControl(this);
            Content = Control;
        }

        internal StateScopeControl Control { get; }
    }
}
