using System;

namespace KvalStateScope.Xae
{
    /// <summary>Ids shared with KvalStateScopePackage.vsct</summary>
    internal static class PackageGuids
    {
        public const string PackageString = "e0718790-a072-4c96-ba71-67161c7fdaa6";
        public const string CommandSetString = "98c96b86-2fe9-4ee8-b8c5-1bcb0d95d6c5";
        public const string ToolWindowString = "f492afd1-443c-4978-8f71-ef1d120a3d50";

        public static readonly Guid CommandSet = new Guid(CommandSetString);
    }

    internal static class CommandIds
    {
        /// <summary>Context menus: only visible when the selection / document is a .TcPOU</summary>
        public const int OpenSelected = 0x0100;
        /// <summary>Tools menu: always visible; opens the selected / active .TcPOU, else asks for one</summary>
        public const int OpenFromTools = 0x0101;
    }
}
