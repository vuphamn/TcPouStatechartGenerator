# Kval StateScope gateway

The gateway lets the **web edition** of Kval StateScope follow state machines in running PLCs. It runs on one machine in the PLC network, for example a server or an industrial PC. It does two things:

- serves the web app over HTTPS, so people open `https://<gateway>:8443/` in a browser and install nothing;
- gives the app's **Live** tab read-only access, over ADS, to the PLCs listed in its configuration.

```
browser ──HTTPS / WSS (token)──► gateway ──ADS (TCP 48898)──► PLC 1, PLC 2, ...
```

For a single person on a computer that can reach the PLC, the local helper [Kval StateScope Link](../link/README.md) is simpler: no server, and the web app's *Via: This computer* option.

**What it does and doesn't do:**
- **PLCs:** browsers can only choose from the PLCs in `config.json`, never an arbitrary address.
- **Read-only:** the gateway reads variables (symbol info, handle, change notification). It writes nothing to a PLC except releasing its own variable handle.
- **Connections:** one ADS connection per PLC. Everyone following the same state variable shares one change notification. Guard values (the variables of the active state's transitions, see the main README) are read per viewer, at most `maxWatchedVariables` each.
- **Access tokens:** every browser needs one. Only their SHA-256 hashes are stored. Connections and "go live" requests are logged with the token's name.

## Install

Requires Node.js 20 or later on the gateway machine.

1. **Build and copy:** on a development machine, run `npm run build:gateway`, which assembles `release/gateway`. Copy that folder to the gateway machine.
2. **Install and initialize** on the gateway machine:
   ```powershell
   cd gateway
   npm install --omit=dev
   node gateway.cjs init --host statescope-gw.example.local
   ```
   `init` creates `config.json` and a self-signed certificate for that host name. For browsers to trust the gateway, replace `cert.pem` / `key.pem` with a certificate from your company CA. Alternatively, set `tls.pfx` and `tls.passphrase`.
3. **Edit `config.json`:**
   ```json
   {
     "port": 8443,
     "tls": { "cert": "cert.pem", "key": "key.pem" },
     "localNetId": "192.168.1.5.1.1",
     "plcs": [
       { "id": "line202", "name": "Line 202", "netId": "192.168.1.20.1.1", "ip": "192.168.1.20", "port": 851 }
     ],
     "maxViewers": 50,
     "maxWatchedVariables": 100,
     "allowedOrigins": []
   }
   ```
   - `maxWatchedVariables`: the most guard variables one viewer may follow (a larger request is ignored).
   - `localNetId`: the AMS NetId the gateway uses (its IP + `.1.1` by default). A PLC entry can override it.
   - `ip`: defaults to the first four numbers of `netId`. Use `host:port` for a forwarded ADS port.
   - `port`: the PLC runtime's ADS port (851 for the first PLC).
   - `allowedOrigins`: only needed when the web app is served from somewhere else, e.g. `["https://statescope.example.com"]`.
4. **Add an ADS route on each PLC** to the gateway: AMS NetId = `localNetId`, address = the gateway's IP. Use the PLC's TwinCAT router (*Router > Edit Routes*) or an XAE connected to the PLC.
5. **Create access tokens.** Each token is shown once; give it to its user:
   ```powershell
   node gateway.cjs add-token alice
   node gateway.cjs remove-token alice
   ```
   A running gateway picks up token changes within 10 s.
6. **Start the gateway:**
   ```powershell
   node gateway.cjs start
   ```
   To run it as a Windows service, use e.g. NSSM (`nssm install StateScopeGateway "C:\Program Files\nodejs\node.exe" "C:\gateway\gateway.cjs start"`) or your usual service wrapper.

## Use

1. Open `https://<gateway>:8443/` and load a `.TcPOU`: *Browse*, or drop it on the file name in the header.
2. Open the **Live** tab and enter your access token. *Remember* keeps it in this browser.
3. Choose the PLC and click **Go live**.

The gateway finds the POU's instances from the PLC's own symbol tables: nested members, members inherited from a base function block, and array elements (up to 16). With several instances, the others are offered in the Instance field. You can also type a path.

## Testing without TLS

With `"insecure": true` and no `tls` entry, the gateway serves plain HTTP / WS and logs a warning. Tokens and data then cross the network in clear text, so use this only on a test bench.

## Log

The log goes to the console, one line per event with a time stamp:
- sign-ins, rejected tokens, and IP addresses blocked after 10 failures a minute;
- "go live" requests, with user, PLC and variable;
- ADS connections to the PLCs, and handles released.
