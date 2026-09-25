using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace KvalStateScope.Xae
{
    /// <summary>
    /// Watches one PLC variable over ADS (TwinCAT's own TcAdsDll.dll through the local AMS router) with a change
    /// notification: the PLC sends every new value with its PLC time stamp, so short states are not missed the way
    /// polling would miss them. Values are queued on the ADS thread and taken with <see cref="Drain"/>.
    /// </summary>
    internal sealed class LiveMonitor : IDisposable
    {
        public sealed class Sample
        {
            /// <summary>PLC time of the change, ms since 1970 (UTC)</summary>
            public double t { get; set; }
            public long value { get; set; }
        }

        public sealed class SymbolInfo
        {
            public int Size;
            public string Type;
        }

        private readonly ConcurrentQueue<Sample> _queue = new ConcurrentQueue<Sample>();
        // Kept referenced: the native side calls it for as long as the notification exists
        private readonly AdsNative.NotificationCallback _callback;
        private int _port;
        private AdsNative.AmsAddr _target;
        private uint _handle;
        private uint _notification;
        private int _size;

        public string TargetText { get; private set; }

        public LiveMonitor()
        {
            _callback = OnNotification;
        }

        /// <summary>Opens an ADS port to the PLC runtime; returns its ADS state ("Run", "Stop", ...)</summary>
        public string Connect(string netId, ushort amsPort)
        {
            AdsNative.EnsureLoaded();
            _port = AdsNative.AdsPortOpenEx();
            if (_port == 0) throw new AdsException("Could not open an ADS port (is the TwinCAT router running?)", 0);
            AdsNative.AdsSyncSetTimeoutEx(_port, 2000);
            var local = new AdsNative.AmsAddr { NetId = new byte[6] };
            Check(AdsNative.AdsGetLocalAddressEx(_port, ref local), "Reading the local AMS address");
            _target = new AdsNative.AmsAddr { NetId = string.IsNullOrWhiteSpace(netId) ? local.NetId : ParseNetId(netId), Port = amsPort };
            TargetText = $"{FormatNetId(_target.NetId)}:{amsPort}";
            Check(AdsNative.AdsSyncReadStateReqEx(_port, ref _target, out var adsState, out _), $"Connecting to {TargetText}");
            return AdsStateName(adsState);
        }

        /// <summary>The PLC's ADS state now ("Run", "Stop", ...)</summary>
        public string ReadState()
        {
            if (_port == 0) throw new AdsException("Not connected", 0);
            Check(AdsNative.AdsSyncReadStateReqEx(_port, ref _target, out var adsState, out _), $"Reading the state of {TargetText}");
            return AdsStateName(adsState);
        }

        /// <summary>The symbol's size and type, or null when the PLC has no such symbol</summary>
        public SymbolInfo Probe(string symbol)
        {
            var name = Encoding.Default.GetBytes(symbol + "\0");
            var buffer = new byte[0xFFFF];
            var err = AdsNative.AdsSyncReadWriteReqEx2(_port, ref _target, AdsNative.SymInfoByNameEx, 0, (uint)buffer.Length, buffer, (uint)name.Length, name, out var read);
            if (err == AdsNative.ErrSymbolNotFound || err == AdsNative.ErrInvalidIndexOffset) return null;
            Check(err, $"Looking up {symbol}");
            if (read < 30) return null;
            // AdsSymbolEntry: entryLength, iGroup, iOffs, size, dataType, flags (uint) then name/type/comment lengths (ushort)
            var size = BitConverter.ToInt32(buffer, 12);
            var nameLength = BitConverter.ToUInt16(buffer, 24);
            var typeLength = BitConverter.ToUInt16(buffer, 26);
            var type = Encoding.Default.GetString(buffer, 30 + nameLength + 1, typeLength);
            return new SymbolInfo { Size = size, Type = type };
        }

        /// <summary>Starts the change notification; the current value is queued first</summary>
        public void Subscribe(string symbol, int size)
        {
            if (size != 1 && size != 2 && size != 4 && size != 8) throw new AdsException($"{symbol} is {size} bytes: only integer / enum variables can be followed", 0);
            _size = size;
            var name = Encoding.Default.GetBytes(symbol + "\0");
            var handle = new byte[4];
            Check(AdsNative.AdsSyncReadWriteReqEx2(_port, ref _target, AdsNative.SymHandleByName, 0, 4, handle, (uint)name.Length, name, out _), $"Getting a handle for {symbol}");
            _handle = BitConverter.ToUInt32(handle, 0);

            var value = new byte[size];
            Check(AdsNative.AdsSyncReadReqEx2(_port, ref _target, AdsNative.SymValueByHandle, _handle, (uint)size, value, out _), $"Reading {symbol}");
            _queue.Enqueue(new Sample { t = (DateTime.UtcNow - Epoch).TotalMilliseconds, value = Decode(value, 0, size) });

            var attrib = new AdsNative.NotificationAttrib
            {
                cbLength = (uint)size,
                nTransMode = AdsNative.TransServerOnChange,
                nMaxDelay = 0,
                // Check every 1 ms (in 100 ns units); the PLC checks at most once per task cycle
                nCycleTime = 10000,
            };
            Check(AdsNative.AdsSyncAddDeviceNotificationReqEx(_port, ref _target, AdsNative.SymValueByHandle, _handle, ref attrib, _callback, 0, out _notification),
                $"Subscribing to {symbol}");
        }

        public List<Sample> Drain()
        {
            var list = new List<Sample>();
            while (_queue.TryDequeue(out var s)) list.Add(s);
            return list;
        }

        private static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        // ADS thread
        private void OnNotification(IntPtr addr, IntPtr header, uint user)
        {
            try
            {
                // AdsNotificationHeader (packed): hNotification (uint), nTimeStamp (FILETIME), cbSampleSize (uint), data
                var stamp = Marshal.ReadInt64(header, 4);
                var sampleSize = Marshal.ReadInt32(header, 12);
                var data = new byte[Math.Min(sampleSize, 8)];
                Marshal.Copy(header + 16, data, 0, data.Length);
                var t = stamp > 0 ? (DateTime.FromFileTimeUtc(stamp) - Epoch).TotalMilliseconds : (DateTime.UtcNow - Epoch).TotalMilliseconds;
                _queue.Enqueue(new Sample { t = t, value = Decode(data, 0, Math.Min(_size, data.Length)) });
            }
            catch (Exception) { /* never throw into the native caller */ }
        }

        private static long Decode(byte[] data, int offset, int size)
        {
            switch (size)
            {
                case 1: return data[offset];
                case 2: return BitConverter.ToInt16(data, offset);
                case 4: return BitConverter.ToInt32(data, offset);
                case 8: return BitConverter.ToInt64(data, offset);
                default: return 0;
            }
        }

        public void Dispose()
        {
            if (_port == 0) return;
            try
            {
                if (_notification != 0) AdsNative.AdsSyncDelDeviceNotificationReqEx(_port, ref _target, _notification);
                if (_handle != 0)
                {
                    var h = BitConverter.GetBytes(_handle);
                    AdsNative.AdsSyncWriteReqEx(_port, ref _target, AdsNative.SymReleaseHandle, 0, 4, h);
                }
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException)) { Log.Write("live: cleanup: " + ex.Message); }
            AdsNative.AdsPortCloseEx(_port);
            _port = 0;
            _notification = 0;
            _handle = 0;
        }

        private static void Check(int err, string what)
        {
            if (err != 0) throw new AdsException($"{what}: {AdsNative.ErrorText(err)}", err);
        }

        private static byte[] ParseNetId(string text)
        {
            var parts = text.Trim().Split('.');
            if (parts.Length != 6) throw new AdsException($"'{text}' is not an AMS NetId (a.b.c.d.e.f)", 0);
            var bytes = new byte[6];
            for (var i = 0; i < 6; i++)
                if (!byte.TryParse(parts[i], out bytes[i])) throw new AdsException($"'{text}' is not an AMS NetId (a.b.c.d.e.f)", 0);
            return bytes;
        }

        private static string FormatNetId(byte[] b) => string.Join(".", b);

        private static string AdsStateName(ushort state)
        {
            switch (state)
            {
                case 5: return "Run";
                case 6: return "Stop";
                case 15: return "Config";
                case 16: return "Reconfig";
                case 11: return "Error";
                default: return "state " + state;
            }
        }
    }

    internal sealed class AdsException : Exception
    {
        public int Code { get; }
        public AdsException(string message, int code) : base(message) { Code = code; }
    }

    /// <summary>TcAdsDll.dll (installed with TwinCAT; TwinCAT 4026 keeps it in Common64, not System32)</summary>
    internal static class AdsNative
    {
        public const uint SymHandleByName = 0xF003;
        public const uint SymValueByHandle = 0xF005;
        public const uint SymReleaseHandle = 0xF006;
        public const uint SymInfoByNameEx = 0xF009;
        public const int TransServerOnChange = 4;
        public const int ErrInvalidIndexOffset = 0x703;
        public const int ErrSymbolNotFound = 0x710;

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        public struct AmsAddr
        {
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)] public byte[] NetId;
            public ushort Port;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        public struct NotificationAttrib
        {
            public uint cbLength;
            public int nTransMode;
            public uint nMaxDelay;
            public uint nCycleTime;
        }

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        public delegate void NotificationCallback(IntPtr addr, IntPtr header, uint user);

        private const string Dll = "TcAdsDll.dll";
        private static bool _loaded;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibrary(string path);

        public static void EnsureLoaded()
        {
            if (_loaded) return;
            var candidates = new List<string>();
            foreach (var root in new[] { InstallDir(), @"C:\Program Files (x86)\Beckhoff\TwinCAT", @"C:\TwinCAT" })
            {
                if (string.IsNullOrEmpty(root)) continue;
                candidates.Add(Path.Combine(root, Environment.Is64BitProcess ? "Common64" : "Common32", Dll));
            }
            candidates.Add(Path.Combine(Environment.SystemDirectory, Dll));
            foreach (var path in candidates)
            {
                if (File.Exists(path) && LoadLibrary(path) != IntPtr.Zero)
                {
                    Log.Write("live: loaded " + path);
                    _loaded = true;
                    return;
                }
            }
            throw new AdsException("TcAdsDll.dll was not found: is TwinCAT installed on this computer?", 0);
        }

        private static string InstallDir()
        {
            try
            {
                using (var key = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine, Microsoft.Win32.RegistryView.Registry32)
                    .OpenSubKey(@"SOFTWARE\Beckhoff\TwinCAT3"))
                {
                    var dir = key?.GetValue("InstallDir") as string;
                    // InstallDir is ...\TwinCAT\3.1\ : Common64 is next to 3.1
                    return string.IsNullOrEmpty(dir) ? null : Path.GetDirectoryName(dir.TrimEnd('\\'));
                }
            }
            catch (Exception ex) when (ex is System.Security.SecurityException || ex is IOException || ex is UnauthorizedAccessException) { return null; }
        }

        [DllImport(Dll)] public static extern int AdsPortOpenEx();
        [DllImport(Dll)] public static extern int AdsPortCloseEx(int port);
        [DllImport(Dll)] public static extern int AdsGetLocalAddressEx(int port, ref AmsAddr addr);
        [DllImport(Dll)] public static extern int AdsSyncSetTimeoutEx(int port, int ms);
        [DllImport(Dll)] public static extern int AdsSyncReadStateReqEx(int port, ref AmsAddr addr, out ushort adsState, out ushort deviceState);
        [DllImport(Dll)] public static extern int AdsSyncReadReqEx2(int port, ref AmsAddr addr, uint indexGroup, uint indexOffset, uint length, byte[] data, out uint bytesRead);
        [DllImport(Dll)] public static extern int AdsSyncWriteReqEx(int port, ref AmsAddr addr, uint indexGroup, uint indexOffset, uint length, byte[] data);
        [DllImport(Dll)] public static extern int AdsSyncReadWriteReqEx2(int port, ref AmsAddr addr, uint indexGroup, uint indexOffset, uint readLength, byte[] readData, uint writeLength, byte[] writeData, out uint bytesRead);
        [DllImport(Dll)] public static extern int AdsSyncAddDeviceNotificationReqEx(int port, ref AmsAddr addr, uint indexGroup, uint indexOffset, ref NotificationAttrib attrib, NotificationCallback callback, uint user, out uint notification);
        [DllImport(Dll)] public static extern int AdsSyncDelDeviceNotificationReqEx(int port, ref AmsAddr addr, uint notification);

        public static string ErrorText(int code)
        {
            switch (code)
            {
                case 0x6: return "target port not found (is the PLC running? is it the right ADS port?) [0x6]";
                case 0x7: return "target computer not found (is there an ADS route to it?) [0x7]";
                case 0x12: return "port disabled: the TwinCAT system on this computer is not started [0x12]";
                case 0x18: return "invalid AMS port [0x18]";
                case 0x1B: return "host unreachable [0x1B]";
                case 0x1E: return "access denied (ADS route / secure ADS settings) [0x1E]";
                case 0x701: return "service not supported [0x701]";
                case 0x710: return "symbol not found (log in / download the PLC program?) [0x710]";
                case 0x745: return "timeout [0x745]";
                case 0x746: return "timeout (no answer from the target) [0x746]";
                case 0x748: return "the TwinCAT router is not running [0x748]";
                default: return $"ADS error 0x{code:X}";
            }
        }
    }
}
