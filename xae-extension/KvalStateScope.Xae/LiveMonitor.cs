using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
            /// <summary>ADS data type id (ADST_*): enums have their base type's</summary>
            public int DataType;
        }

        /// <summary>A guard variable's new value (bool, long, double or string; null when not a finite number)</summary>
        public sealed class VarSample
        {
            public string id { get; set; }
            public double t { get; set; }
            public object v { get; set; }
        }

        /// <summary>Where a guard variable was found, or why not</summary>
        public sealed class VarResult
        {
            public string id { get; set; }
            public string symbol { get; set; }
            public string type { get; set; }
            public string error { get; set; }
        }

        private sealed class VarSub
        {
            public string Id;
            public string Symbol;
            public SymbolInfo Info;
            public uint Handle;
            public uint Notification;
            public uint User;
        }

        private readonly ConcurrentQueue<Sample> _queue = new ConcurrentQueue<Sample>();
        // Kept referenced: the native side calls it for as long as the notification exists
        private readonly AdsNative.NotificationCallback _callback;
        private readonly AdsNative.NotificationCallback _varCallback;
        // Guard variables: by id (changed under _varLock, on one worker thread at a time) and by notification user
        private readonly object _varLock = new object();
        private readonly Dictionary<string, VarSub> _vars = new Dictionary<string, VarSub>(StringComparer.Ordinal);
        private readonly ConcurrentDictionary<uint, VarSub> _varsByUser = new ConcurrentDictionary<uint, VarSub>();
        private readonly HashSet<string> _varsFailed = new HashSet<string>(StringComparer.Ordinal);
        private readonly ConcurrentQueue<VarSample> _varQueue = new ConcurrentQueue<VarSample>();
        private uint _nextUser = 1;
        private int _port;
        private AdsNative.AmsAddr _target;
        private uint _handle;
        private uint _notification;
        private int _size;

        public string TargetText { get; private set; }

        public LiveMonitor()
        {
            _callback = OnNotification;
            _varCallback = OnVarNotification;
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
            var dataType = BitConverter.ToInt32(buffer, 16);
            var nameLength = BitConverter.ToUInt16(buffer, 24);
            var typeLength = BitConverter.ToUInt16(buffer, 26);
            var type = Encoding.Default.GetString(buffer, 30 + nameLength + 1, typeLength);
            return new SymbolInfo { Size = size, Type = type, DataType = dataType };
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

        // ---- Symbol browser: a symbol's members, one level (same rules as shared/tcAds.cjs browseSymbol) ----

        /// <summary>A member of a browsed symbol (value: shown with its value; struct / array: has members)</summary>
        public sealed class BrowseChild
        {
            public string name { get; set; }
            public string path { get; set; }
            public string type { get; set; }
            public string kind { get; set; }
            public bool stateMachine { get; set; }
            /// <summary>A state machine's state variable type, and its names by value when the PLC describes the enum</summary>
            public string stateType { get; set; }
            public Dictionary<string, string> stateNames { get; set; }
        }

        public sealed class BrowseResult
        {
            public string path { get; set; }
            /// <summary>The symbol's type (not "type": that is the message's)</summary>
            public string symbolType { get; set; }
            public string kind { get; set; }
            public bool stateMachine { get; set; }
            public bool truncated { get; set; }
            public string stateType { get; set; }
            public Dictionary<string, string> stateNames { get; set; }
            public List<BrowseChild> children { get; set; } = new List<BrowseChild>();
            public string error { get; set; }
        }

        private sealed class DataType
        {
            public string Name, Type;
            public int Size, AdsType;
            public List<KeyValuePair<int, int>> Bounds = new List<KeyValuePair<int, int>>(); // (low, count)
            public List<DataType> SubItems = new List<DataType>();
            /// <summary>An enum's members by value (null: not an enum, or not described)</summary>
            public Dictionary<string, string> EnumValues;
        }

        private const int AdstBigType = 65, MaxBrowseChildren = 500, MaxArrayChildren = 100;
        // Data types by name for this connection (null: the PLC has none)
        private readonly Dictionary<string, DataType> _dataTypes = new Dictionary<string, DataType>(StringComparer.OrdinalIgnoreCase);
        private static readonly System.Text.RegularExpressions.Regex ArrayRx =
            new System.Text.RegularExpressions.Regex(@"^ARRAY\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*OF\s+(.+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        private static DataType ParseDataType(byte[] b, int at, out int length)
        {
            length = BitConverter.ToInt32(b, at);
            var dt = new DataType { Size = BitConverter.ToInt32(b, at + 16), AdsType = BitConverter.ToInt32(b, at + 24) };
            var flags = BitConverter.ToUInt32(b, at + 28);
            int nameLength = BitConverter.ToUInt16(b, at + 32), typeLength = BitConverter.ToUInt16(b, at + 34), commentLength = BitConverter.ToUInt16(b, at + 36);
            int arrayDim = BitConverter.ToUInt16(b, at + 38), subCount = BitConverter.ToUInt16(b, at + 40);
            var p = at + 42;
            dt.Name = Encoding.Default.GetString(b, p, nameLength);
            p += nameLength + 1;
            dt.Type = Encoding.Default.GetString(b, p, typeLength);
            p += typeLength + 1 + commentLength + 1;
            for (var i = 0; i < arrayDim; i++, p += 8) dt.Bounds.Add(new KeyValuePair<int, int>(BitConverter.ToInt32(b, p), BitConverter.ToInt32(b, p + 4)));
            for (var i = 0; i < subCount && p + 42 <= at + length; i++)
            {
                dt.SubItems.Add(ParseDataType(b, p, out var subLength));
                if (subLength <= 0) break;
                p += subLength;
            }
            dt.EnumValues = EnumInfos(b, p, at + length, flags, dt.Size);
            return dt;
        }

        // AdsDatatypeEntry flags of the optional parts after the sub items (in this order)
        private const uint DtTypeGuid = 0x80, DtCopyMask = 0x200, DtMethodInfos = 0x800, DtAttributes = 0x1000, DtEnumInfos = 0x2000;

        /// <summary>An enum's members (value -> name) from the entry's optional parts (same as shared/tcAds.cjs)</summary>
        private static Dictionary<string, string> EnumInfos(byte[] b, int p, int end, uint flags, int size)
        {
            if ((flags & DtEnumInfos) == 0 || (size != 1 && size != 2 && size != 4 && size != 8)) return null;
            try
            {
                if ((flags & DtTypeGuid) != 0) p += 16;
                if ((flags & DtCopyMask) != 0) p += size;
                if ((flags & DtMethodInfos) != 0)
                {
                    int count = BitConverter.ToUInt16(b, p);
                    p += 2;
                    for (var i = 0; i < count; i++) p += BitConverter.ToInt32(b, p);
                }
                if ((flags & DtAttributes) != 0)
                {
                    int count = BitConverter.ToUInt16(b, p);
                    p += 2;
                    for (var i = 0; i < count; i++) p += 2 + b[p] + 1 + b[p + 1] + 1;
                }
                int members = BitConverter.ToUInt16(b, p);
                p += 2;
                var values = new Dictionary<string, string>();
                for (var i = 0; i < members && p < end; i++)
                {
                    int nameLength = b[p];
                    var name = Encoding.Default.GetString(b, p + 1, nameLength);
                    p += 1 + nameLength + 1;
                    long value = size == 1 ? (sbyte)b[p] : size == 2 ? BitConverter.ToInt16(b, p) : size == 4 ? BitConverter.ToInt32(b, p) : BitConverter.ToInt64(b, p);
                    p += size;
                    values[value.ToString(System.Globalization.CultureInfo.InvariantCulture)] = name;
                }
                return values.Count > 0 ? values : null;
            }
            catch (ArgumentException) { return null; }
            catch (IndexOutOfRangeException) { return null; }
        }

        private DataType DataTypeInfo(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            if (_dataTypes.TryGetValue(name, out var cached)) return cached;
            var request = Encoding.Default.GetBytes(name + "\0");
            var buffer = new byte[0xFFFF];
            var err = AdsNative.AdsSyncReadWriteReqEx2(_port, ref _target, AdsNative.DtInfoByNameEx, 0, (uint)buffer.Length, buffer, (uint)request.Length, request, out var read);
            DataType dt = null;
            if (err == 0 && read >= 42) dt = ParseDataType(buffer, 0, out _);
            else if (err != AdsNative.ErrSymbolNotFound && err != AdsNative.ErrInvalidIndexOffset && err != 0x707) Check(err, $"Reading the data type {name}");
            _dataTypes[name] = dt;
            return dt;
        }

        private static string LastSegment(string type) => (type ?? "").Trim().Split('.').Last();

        /// <summary>The type's members, with those of the function block it extends (when the PLC lists them there)</summary>
        private List<DataType> MembersOf(DataType dt, int depth = 0)
        {
            if (dt == null) return new List<DataType>();
            var own = dt.SubItems;
            if (depth > 6 || string.IsNullOrEmpty(dt.Type) || string.Equals(LastSegment(dt.Type), LastSegment(dt.Name), StringComparison.OrdinalIgnoreCase)
                || System.Text.RegularExpressions.Regex.IsMatch(dt.Type, @"^(ARRAY|POINTER|REFERENCE)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return own;
            var baseType = DataTypeInfo(dt.Type);
            if (baseType == null || baseType.SubItems.Count == 0) return own;
            var names = new HashSet<string>(own.Select(m => m.Name), StringComparer.OrdinalIgnoreCase);
            return MembersOf(baseType, depth + 1).Where(m => !names.Contains(m.Name)).Concat(own).ToList();
        }

        private static string Kind(string type, int size, int adsType, List<KeyValuePair<int, int>> bounds)
        {
            type = type ?? "";
            if (System.Text.RegularExpressions.Regex.IsMatch(type, @"^(POINTER|REFERENCE)\s+TO\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
                || System.Text.RegularExpressions.Regex.IsMatch(type, @"^(PVOID|ITC\w*|I_\w+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return "other";
            if (type.StartsWith("ARRAY", StringComparison.OrdinalIgnoreCase) || (bounds != null && bounds.Count > 0))
                return ArrayRx.IsMatch(type) || (bounds != null && bounds.Count == 1) ? "array" : "other";
            if (IsSimple(new SymbolInfo { Size = size, DataType = adsType })) return "value";
            return adsType == AdstBigType ? "struct" : "other";
        }

        private DataType StateMemberOf(string type, string stateVar) =>
            MembersOf(DataTypeInfo(type)).FirstOrDefault(m => string.Equals(m.Name, stateVar, StringComparison.OrdinalIgnoreCase));

        /// <summary>The state variable's type and, for an enum the PLC describes, its names (Machine Overview)</summary>
        private void AddStateInfo(BrowseChild child, string type, string stateVar)
        {
            var m = StateMemberOf(type, stateVar);
            if (m == null) return;
            child.stateMachine = true;
            child.stateType = m.Type;
            child.stateNames = DataTypeInfo(m.Type)?.EnumValues;
        }

        /// <summary>The symbol and its members (or array elements), one level</summary>
        public BrowseResult Browse(string symbolPath, string stateVar)
        {
            lock (_varLock)
            {
                var info = Probe(symbolPath);
                if (info == null) return new BrowseResult { path = symbolPath, error = $"{symbolPath} is not in the PLC" };
                var node = new BrowseResult { path = symbolPath, symbolType = info.Type, kind = Kind(info.Type, info.Size, info.DataType, null) };
                BrowseChild Describe(string name, string childPath, string type, int size, int adsType, List<KeyValuePair<int, int>> bounds)
                {
                    var kind = Kind(type, size, adsType, bounds);
                    var child = new BrowseChild { name = name, path = childPath, type = type, kind = kind };
                    if (kind == "struct") AddStateInfo(child, type, stateVar);
                    return child;
                }
                if (node.kind == "array")
                {
                    int low, high;
                    string element;
                    var m = ArrayRx.Match(info.Type);
                    var dt = DataTypeInfo(info.Type);
                    if (m.Success) { low = int.Parse(m.Groups[1].Value); high = int.Parse(m.Groups[2].Value); element = m.Groups[3].Value.Trim(); }
                    else if (dt != null && dt.Bounds.Count == 1) { low = dt.Bounds[0].Key; high = low + dt.Bounds[0].Value - 1; element = dt.Type; }
                    else return node;
                    var el = DataTypeInfo(element);
                    var last = Math.Min(high, low + MaxArrayChildren - 1);
                    node.truncated = last < high;
                    for (var i = low; i <= last; i++)
                        node.children.Add(Describe($"[{i}]", $"{symbolPath}[{i}]", element, el?.Size ?? 0, el?.AdsType ?? AdstBigType, el?.Bounds));
                    return node;
                }
                if (node.kind != "struct") return node;
                var members = MembersOf(DataTypeInfo(info.Type));
                node.stateMachine = members.Any(x => string.Equals(x.Name, stateVar, StringComparison.OrdinalIgnoreCase));
                if (node.stateMachine)
                {
                    var own = new BrowseChild();
                    AddStateInfo(own, info.Type, stateVar);
                    node.stateType = own.stateType;
                    node.stateNames = own.stateNames;
                }
                node.truncated = members.Count > MaxBrowseChildren;
                foreach (var x in members.Take(MaxBrowseChildren))
                {
                    if (!System.Text.RegularExpressions.Regex.IsMatch(x.Name, @"^[A-Za-z_]\w*$")) continue;
                    node.children.Add(Describe(x.Name, $"{symbolPath}.{x.Name}", x.Type, x.Size, x.AdsType, x.Bounds));
                }
                return node;
            }
        }

        // ADS data type ids of values that can be shown as they are
        private const int AdstInt16 = 2, AdstInt32 = 3, AdstReal32 = 4, AdstReal64 = 5, AdstInt8 = 16, AdstUInt8 = 17, AdstUInt16 = 18,
            AdstUInt32 = 19, AdstInt64 = 20, AdstUInt64 = 21, AdstString = 30, AdstWString = 31, AdstBit = 33;
        private const int MaxValueSize = 512;

        private static bool IsSimple(SymbolInfo info)
        {
            if (info.Size <= 0 || info.Size > MaxValueSize) return false;
            switch (info.DataType)
            {
                case AdstInt16: case AdstInt32: case AdstReal32: case AdstReal64: case AdstInt8: case AdstUInt8: case AdstUInt16:
                case AdstUInt32: case AdstInt64: case AdstUInt64: case AdstString: case AdstWString: case AdstBit:
                    return true;
                default:
                    return false;
            }
        }

        private static object DecodeTyped(byte[] d, int dataType)
        {
            switch (dataType)
            {
                case AdstBit: return d[0] != 0;
                case AdstInt8: return (long)(sbyte)d[0];
                case AdstUInt8: return (long)d[0];
                case AdstInt16: return (long)BitConverter.ToInt16(d, 0);
                case AdstUInt16: return (long)BitConverter.ToUInt16(d, 0);
                case AdstInt32: return (long)BitConverter.ToInt32(d, 0);
                case AdstUInt32: return (long)BitConverter.ToUInt32(d, 0);
                case AdstInt64: return BitConverter.ToInt64(d, 0);
                case AdstUInt64: return (double)BitConverter.ToUInt64(d, 0);
                case AdstReal32: { var f = BitConverter.ToSingle(d, 0); return float.IsNaN(f) || float.IsInfinity(f) ? null : (object)(double)f; }
                case AdstReal64: { var f = BitConverter.ToDouble(d, 0); return double.IsNaN(f) || double.IsInfinity(f) ? null : (object)f; }
                case AdstString:
                {
                    var end = Array.IndexOf(d, (byte)0);
                    return Encoding.Default.GetString(d, 0, end < 0 ? d.Length : end);
                }
                case AdstWString:
                {
                    var end = 0;
                    while (end + 1 < d.Length && (d[end] != 0 || d[end + 1] != 0)) end += 2;
                    return Encoding.Unicode.GetString(d, 0, end);
                }
                default: return null;
            }
        }

        /// <summary>
        /// Follows exactly these guard variables (id -> candidate paths, the first the PLC has is used); the others are
        /// released. Returns the lookup results of the newly asked ones. Blocks on ADS: call it off the UI thread.
        /// </summary>
        public List<VarResult> SetVars(IList<KeyValuePair<string, List<string>>> wanted)
        {
            var results = new List<VarResult>();
            lock (_varLock)
            {
                if (_port == 0) return results;
                var ids = new HashSet<string>(wanted.Select(w => w.Key), StringComparer.Ordinal);
                foreach (var old in _vars.Values.Where(v => !ids.Contains(v.Id)).ToList()) ReleaseVar(old);
                _varsFailed.RemoveWhere(id => !ids.Contains(id));
                foreach (var w in wanted)
                {
                    if (_vars.ContainsKey(w.Key) || _varsFailed.Contains(w.Key)) continue;
                    var result = new VarResult { id = w.Key };
                    try
                    {
                        SymbolInfo info = null;
                        string symbol = null;
                        foreach (var c in w.Value)
                        {
                            info = Probe(c);
                            if (info != null) { symbol = c; break; }
                        }
                        if (info == null)
                        {
                            result.error = "not in the PLC (a local of the method, a property or a method?)";
                        }
                        else if (!IsSimple(info))
                        {
                            result.symbol = symbol;
                            result.type = info.Type;
                            result.error = $"{info.Type} is not a simple value";
                        }
                        else
                        {
                            result.symbol = symbol;
                            result.type = info.Type;
                            SubscribeVar(w.Key, symbol, info);
                        }
                    }
                    catch (AdsException ex)
                    {
                        result.error = ex.Message;
                    }
                    if (result.error != null) _varsFailed.Add(w.Key);
                    results.Add(result);
                }
            }
            return results;
        }

        private void SubscribeVar(string id, string symbol, SymbolInfo info)
        {
            var name = Encoding.Default.GetBytes(symbol + "\0");
            var handle = new byte[4];
            Check(AdsNative.AdsSyncReadWriteReqEx2(_port, ref _target, AdsNative.SymHandleByName, 0, 4, handle, (uint)name.Length, name, out _), $"Getting a handle for {symbol}");
            var sub = new VarSub { Id = id, Symbol = symbol, Info = info, Handle = BitConverter.ToUInt32(handle, 0), User = _nextUser++ };
            _vars[id] = sub;
            var value = new byte[info.Size];
            Check(AdsNative.AdsSyncReadReqEx2(_port, ref _target, AdsNative.SymValueByHandle, sub.Handle, (uint)info.Size, value, out _), $"Reading {symbol}");
            _varQueue.Enqueue(new VarSample { id = id, t = (DateTime.UtcNow - Epoch).TotalMilliseconds, v = DecodeTyped(value, info.DataType) });
            _varsByUser[sub.User] = sub;
            var attrib = new AdsNative.NotificationAttrib
            {
                cbLength = (uint)info.Size,
                nTransMode = AdsNative.TransServerOnChange,
                nMaxDelay = 0,
                // Every 10 ms (in 100 ns units): guard values are for people
                nCycleTime = 100000,
            };
            Check(AdsNative.AdsSyncAddDeviceNotificationReqEx(_port, ref _target, AdsNative.SymValueByHandle, sub.Handle, ref attrib, _varCallback, sub.User, out sub.Notification),
                $"Subscribing to {symbol}");
        }

        private void ReleaseVar(VarSub sub)
        {
            _vars.Remove(sub.Id);
            _varsByUser.TryRemove(sub.User, out _);
            try
            {
                if (sub.Notification != 0) AdsNative.AdsSyncDelDeviceNotificationReqEx(_port, ref _target, sub.Notification);
                if (sub.Handle != 0) AdsNative.AdsSyncWriteReqEx(_port, ref _target, AdsNative.SymReleaseHandle, 0, 4, BitConverter.GetBytes(sub.Handle));
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException)) { Log.Write("live: release " + sub.Symbol + ": " + ex.Message); }
        }

        public List<VarSample> DrainVars()
        {
            var list = new List<VarSample>();
            while (_varQueue.TryDequeue(out var s)) list.Add(s);
            return list;
        }

        // ADS thread
        private void OnVarNotification(IntPtr addr, IntPtr header, uint user)
        {
            try
            {
                if (!_varsByUser.TryGetValue(user, out var sub)) return;
                var stamp = Marshal.ReadInt64(header, 4);
                var sampleSize = Marshal.ReadInt32(header, 12);
                var data = new byte[Math.Max(8, Math.Min(sampleSize, MaxValueSize))];
                Marshal.Copy(header + 16, data, 0, Math.Min(sampleSize, MaxValueSize));
                var t = stamp > 0 ? (DateTime.FromFileTimeUtc(stamp) - Epoch).TotalMilliseconds : (DateTime.UtcNow - Epoch).TotalMilliseconds;
                _varQueue.Enqueue(new VarSample { id = sub.Id, t = t, v = DecodeTyped(data, sub.Info.DataType) });
            }
            catch (Exception) { /* never throw into the native caller */ }
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
            lock (_varLock)
            {
                foreach (var sub in _vars.Values.ToList()) ReleaseVar(sub);
            }
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
        public const uint DtInfoByNameEx = 0xF011;
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
