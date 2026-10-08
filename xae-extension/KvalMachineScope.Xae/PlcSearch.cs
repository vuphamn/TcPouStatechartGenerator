using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Xml.Linq;

namespace KvalMachineScope.Xae
{
    /// <summary>
    /// The Live tab's Browse: the PLCs this computer's TwinCAT router has a route to (StaticRoutes.xml), and the TwinCAT
    /// devices on the network (the UDP 48899 search of XAE's Add Route dialog). XAE goes live through its router, so a
    /// device found on the network is marked when it has no route yet. Read-only: nothing is changed anywhere.
    /// </summary>
    internal static class PlcSearch
    {
        private const uint Magic = 0x71146603;

        public sealed class Found
        {
            public string netId { get; set; }
            public string ip { get; set; }
            public string name { get; set; } = "";
            public string twincat { get; set; } = "";
            public string os { get; set; } = "";
            /// <summary>The TwinCAT router here has a route to it (XAE can go live on it)</summary>
            public bool route { get; set; }
            /// <summary>"route" (from the routes, not found on the network) or "network"</summary>
            public string source { get; set; }
        }

        /// <summary>The routes of this computer's TwinCAT router (name, address, AMS NetId)</summary>
        public static List<Found> Routes()
        {
            var list = new List<Found>();
            foreach (var file in RouteFiles())
            {
                try
                {
                    foreach (var r in XDocument.Load(file).Descendants().Where(e => e.Name.LocalName == "Route"))
                    {
                        string Field(string n) => r.Elements().FirstOrDefault(e => e.Name.LocalName == n)?.Value?.Trim() ?? "";
                        var netId = Field("NetId");
                        if (!IsNetId(netId) || list.Any(x => x.netId == netId)) continue;
                        list.Add(new Found { netId = netId, ip = Field("Address"), name = Field("Name"), route = true, source = "route" });
                    }
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is System.Xml.XmlException)
                {
                    Log.Write($"plc search: {file}: {ex.Message}");
                }
                if (list.Count > 0) break;
            }
            return list;
        }

        private static IEnumerable<string> RouteFiles() =>
            RouteDirs().Select(d => Path.Combine(d, "StaticRoutes.xml")).Where(File.Exists).Distinct(StringComparer.OrdinalIgnoreCase);

        /// <summary>Where TwinCAT keeps StaticRoutes.xml: each install's place (the existing ones are read)</summary>
        internal static List<string> RouteDirs()
        {
            var dirs = new List<string>
            {
                // TwinCAT 3.1.4026: its configuration in ProgramData; earlier: under the installation (C:\TwinCAT\3.1)
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), @"Beckhoff\TwinCAT\3.1\Target"),
                @"C:\TwinCAT\3.1\Target",
            };
            try
            {
                using (var key = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine, Microsoft.Win32.RegistryView.Registry32)
                    .OpenSubKey(@"SOFTWARE\Beckhoff\TwinCAT3\System"))
                {
                    if (key?.GetValue("TcBootDir") is string boot && !string.IsNullOrEmpty(boot)) dirs.Insert(0, Path.Combine(Path.GetDirectoryName(boot.TrimEnd('\\')) ?? boot, "Target"));
                }
                // TwinCAT installed by its Package Manager (4026): under its installation folder (TwinCAT3's TwinCATDir:
                // C:\Program Files (x86)\Beckhoff\TwinCAT\3.1\Target)
                using (var key = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine, Microsoft.Win32.RegistryView.Registry32)
                    .OpenSubKey(@"SOFTWARE\Beckhoff\TwinCAT3"))
                {
                    if (key?.GetValue("TwinCATDir") is string tc && !string.IsNullOrEmpty(tc)) dirs.Add(Path.Combine(tc, @"3.1\Target"));
                }
            }
            catch (Exception ex) when (ex is System.Security.SecurityException || ex is IOException || ex is UnauthorizedAccessException) { }
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            if (!string.IsNullOrEmpty(programFiles)) dirs.Add(Path.Combine(programFiles, @"Beckhoff\TwinCAT\3.1\Target"));
            return dirs;
        }

        private static bool IsNetId(string s)
        {
            var parts = (s ?? "").Split('.');
            return parts.Length == 6 && parts.All(p => byte.TryParse(p, out _));
        }

        /// <summary>This computer's AMS NetId (from its TwinCAT router), for the search request</summary>
        private static byte[] LocalNetId()
        {
            try
            {
                AdsNative.EnsureLoaded();
                var port = AdsNative.AdsPortOpenEx();
                if (port == 0) return new byte[] { 0, 0, 0, 0, 1, 1 };
                try
                {
                    var local = new AdsNative.AmsAddr { NetId = new byte[6] };
                    return AdsNative.AdsGetLocalAddressEx(port, ref local) == 0 ? local.NetId : new byte[] { 0, 0, 0, 0, 1, 1 };
                }
                finally { AdsNative.AdsPortCloseEx(port); }
            }
            catch (Exception ex) when (ex is AdsException || ex is DllNotFoundException || ex is EntryPointNotFoundException)
            {
                return new byte[] { 0, 0, 0, 0, 1, 1 };
            }
        }

        /// <summary>
        /// The TwinCAT devices that answer the search: broadcast on each IPv4 network of this computer, and sent to each
        /// of the addresses (PLCs behind a router). Waits timeoutMs for the answers.
        /// </summary>
        public static List<Found> Search(IEnumerable<string> addresses, int timeoutMs, List<string> errors, int port = 48899)
        {
            var request = new byte[24];
            BitConverter.GetBytes(Magic).CopyTo(request, 0);
            BitConverter.GetBytes(1u).CopyTo(request, 8);
            LocalNetId().CopyTo(request, 12);
            BitConverter.GetBytes((ushort)10000).CopyTo(request, 18);

            var targets = new List<KeyValuePair<IPAddress, IPAddress>>(); // (bind, send to)
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback))
            {
                foreach (var a in ni.GetIPProperties().UnicastAddresses.Where(u => u.Address.AddressFamily == AddressFamily.InterNetwork && u.IPv4Mask != null))
                {
                    var ip = a.Address.GetAddressBytes();
                    var mask = a.IPv4Mask.GetAddressBytes();
                    var bc = new byte[4];
                    for (var i = 0; i < 4; i++) bc[i] = (byte)(ip[i] | ~mask[i]);
                    targets.Add(new KeyValuePair<IPAddress, IPAddress>(a.Address, new IPAddress(bc)));
                }
            }
            foreach (var a in addresses ?? Enumerable.Empty<string>())
            {
                try
                {
                    var ip = IPAddress.TryParse(a, out var parsed) ? parsed : Dns.GetHostAddresses(a).FirstOrDefault(x => x.AddressFamily == AddressFamily.InterNetwork);
                    if (ip != null) targets.Add(new KeyValuePair<IPAddress, IPAddress>(IPAddress.Any, ip));
                    else errors.Add($"{a}: no IPv4 address");
                }
                catch (SocketException ex) { errors.Add($"{a}: {ex.Message}"); }
            }

            var found = new Dictionary<string, Found>();
            var sockets = new List<UdpClient>();
            try
            {
                foreach (var t in targets)
                {
                    try
                    {
                        var udp = new UdpClient(new IPEndPoint(t.Key, 0)) { EnableBroadcast = true };
                        sockets.Add(udp);
                        udp.Send(request, request.Length, new IPEndPoint(t.Value, port));
                    }
                    catch (SocketException ex) { errors.Add($"{t.Value}: {ex.Message}"); }
                }
                var until = DateTime.UtcNow.AddMilliseconds(timeoutMs);
                while (DateTime.UtcNow < until && sockets.Count > 0)
                {
                    var any = false;
                    foreach (var udp in sockets)
                    {
                        while (udp.Available > 0)
                        {
                            any = true;
                            var from = new IPEndPoint(IPAddress.Any, 0);
                            byte[] data;
                            try { data = udp.Receive(ref from); }
                            catch (SocketException) { break; }
                            var d = Parse(data, from.Address.ToString());
                            if (d != null && !found.ContainsKey(d.netId)) found[d.netId] = d;
                        }
                    }
                    if (!any) System.Threading.Thread.Sleep(30);
                }
            }
            finally
            {
                foreach (var s in sockets) s.Close();
            }
            return found.Values.ToList();
        }

        private static Found Parse(byte[] b, string address)
        {
            if (b.Length < 24 || BitConverter.ToUInt32(b, 0) != Magic || BitConverter.ToUInt32(b, 8) != 0x80000001) return null;
            var d = new Found { netId = string.Join(".", b.Skip(12).Take(6)), ip = address, source = "network" };
            var count = BitConverter.ToUInt32(b, 20);
            var p = 24;
            for (var i = 0; i < count && p + 4 <= b.Length; i++)
            {
                var tag = BitConverter.ToUInt16(b, p);
                var len = BitConverter.ToUInt16(b, p + 2);
                var start = p + 4;
                var n = Math.Min(len, b.Length - start);
                p = start + len;
                if (n <= 0) continue;
                if (tag == 5) d.name = CString(b, start, n);
                else if (tag == 3 && n >= 4) d.twincat = $"{b[start]}.{b[start + 1]}.{BitConverter.ToUInt16(b, start + 2)}";
                else if (tag == 4 && n >= 20)
                {
                    var platform = BitConverter.ToUInt32(b, start + 16);
                    var name = platform == 3 ? "Windows CE" : platform == 2 ? "Windows" : platform == 5 || platform == 6 ? "TwinCAT/BSD" : "OS";
                    d.os = $"{name} {BitConverter.ToUInt32(b, start + 4)}.{BitConverter.ToUInt32(b, start + 8)}.{BitConverter.ToUInt32(b, start + 12)}";
                }
            }
            return d;
        }

        private static string CString(byte[] b, int start, int n)
        {
            var end = Array.IndexOf(b, (byte)0, start, n);
            return Encoding.GetEncoding(1252).GetString(b, start, (end < 0 ? start + n : end) - start).Trim();
        }

        /// <summary>The routes and the devices found, one entry per AMS NetId: a found device is marked when it has a route</summary>
        public static List<Found> Browse(IEnumerable<string> addresses, List<string> errors)
        {
            var routes = Routes();
            var network = Search(addresses, 2000, errors);
            foreach (var d in network)
            {
                var r = routes.FirstOrDefault(x => x.netId == d.netId);
                if (r == null) continue;
                d.route = true;
                if (string.IsNullOrEmpty(d.name)) d.name = r.name;
                routes.Remove(r);
            }
            return network.Concat(routes).ToList();
        }
    }
}
