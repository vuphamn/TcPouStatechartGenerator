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
- **Access tokens:** every browser needs one, unless people sign in with their company account (see [Sign-in with company accounts](#sign-in-with-company-accounts)). Only the tokens' SHA-256 hashes are stored. Connections and "go live" requests are logged with the token's or the user's name.
- **Alerts:** the gateway can follow machines by itself and post to a webhook when one is stuck or in error (see [Alerts](#alerts)).

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
3. **Set up the PLCs:** start the gateway (step 6) and open its **setup page** on the gateway machine, `https://localhost:8443/admin` (see [Setup page](#setup-page)): search the network for the PLCs, tick them, test them, save. Or edit `config.json` by hand:
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
   - `maxWatchedVariables`: the most guard variables one viewer may follow (a larger request is ignored). The Symbols window's values count too; the app asks for at most 100 in all.
   - `allowBrowse` (default `true`): `false` turns off the Symbols window, which lists the members of any symbol of the viewer's PLC.
   - `localNetId`: the AMS NetId the gateway uses (its IP + `.1.1` by default). A PLC entry can override it.
   - `ip`: defaults to the first four numbers of `netId`. Use `host:port` for a forwarded ADS port.
   - `port`: the PLC runtime's ADS port (851 for the first PLC).
   - `allowedOrigins`: only needed when the web app is served from somewhere else, e.g. `["https://statescope.example.com"]`.
4. **Add an ADS route on each PLC** to the gateway: AMS NetId = `localNetId`, address = the gateway's IP. Use the PLC's TwinCAT router (*Router > Edit Routes*) or an XAE connected to the PLC.
5. **Create access tokens** on the setup page, or from the command line. Each token is shown once; give it to its user:
   ```powershell
   node gateway.cjs add-token alice
   node gateway.cjs remove-token alice
   ```
   A running gateway picks up token changes within 10 s, and changes to `plcs` / `localNetId` as well (edited by hand: a PLC whose settings changed is disconnected, its viewers go live again).
6. **Start the gateway:**
   ```powershell
   node gateway.cjs start
   ```
   To run it as a Windows service, use e.g. NSSM (`nssm install StateScopeGateway "C:\Program Files\nodejs\node.exe" "C:\gateway\gateway.cjs start"`) or your usual service wrapper.

## Setup page

`https://localhost:8443/admin`, **on the gateway machine only**: requests from other computers get "not found". It has:

- **This gateway's AMS NetId** (`localNetId`), with suggestions from the machine's networks (each IP + `.1.1`).
- **Find PLCs on the network:** the TwinCAT device search (UDP 48899), the one the XAE's *Add Route* dialog uses. It lists each device's name, AMS NetId, address, TwinCAT version and OS. PLCs behind a router don't get the broadcast: enter their addresses in the field next to the button. Tick the PLCs and click **Add the ticked ones**; check their ids and names. The search only asks: it changes nothing on the devices.
- **PLCs:** edit the list (id, name, AMS NetId, address, ADS port), add one by hand, remove one. **Test** connects to the PLC and reports its TwinCAT state and the PLC runtimes it finds on ports 851 to 854. When the PLC doesn't answer, it says which ADS route to add on the PLC. **Save to config.json** writes the list. The running gateway applies it at once: viewers of a PLC whose settings changed go live again.
- **Access tokens:** the names and creation dates; **Create token** shows the new token once, with a *Copy* button; **Revoke** stops a token at once.
- **Alerts:** add, change and remove alert rules, **Send a test message** to a webhook, and see each rule's state (watching how many machines, the last alert).

The page writes only `localNetId`, `plcs`, `tokens` and `alerts`; other settings in `config.json` stay as they are. Changes are only accepted from the page itself (its origin is checked) and under the gateway's own host names. The ADS routes themselves are added on the PLCs, as before.

Settings:
- `"admin": { "enabled": false }` turns the page off.
- `"admin": { "allowFrom": ["192.168.1.7"] }` also allows those addresses (an admin's workstation). Anyone who can open the page can create tokens: keep this list short.
- A host name the gateway doesn't know as its own (for a DNS alias) goes in `"admin": { "hosts": ["statescope.example.local"] }`.

The search needs UDP 48899 open between the gateway and the PLCs (outgoing, and the replies back to the gateway).

## Alerts

The gateway follows the state machines of a PLC by itself, with no browser open, and posts to a webhook:
- **stuck:** a machine is longer in a state than the rule's limit (**Stuck after**, or a limit per state name);
- **error:** a machine goes into a state whose name matches the error pattern (default `ERROR|FAULT|ALARM|E_?STOP|ABORT`);
- **recovered:** a stuck machine, or one in an error state, leaves that state (unless turned off).

There is one message per machine and kind per stay; a machine that goes in and out of an error again sends at most one error message every 5 minutes. The machines are found like the Machine Overview finds them: every member under the root (`MAIN.mainStateMachine` by default) that has the state variable, with state names from the PLC's enum types. The monitor shares the PLC's ADS connection with the viewers, and connects again after a lost connection.

Set the rules up on the setup page (**Alerts**), or in `config.json`:
```json
"alerts": [
  {
    "id": "line202", "name": "Line 202", "plc": "line202", "root": "MAIN.mainStateMachine", "stateVar": "machineState",
    "stuckAfterMs": 300000, "stateLimits": { "TABLEMANAGER_HOMMING": 60000 },
    "onError": true, "errorPattern": "ERROR|FAULT|ALARM|E_?STOP|ABORT", "notifyRecovery": true,
    "webhook": "https://...", "format": "teams"
  }
]
```
- **Teams:** a channel's *Workflows* ("Post to a channel when a webhook request is received"), or an *Incoming Webhook* connector; `"format": "teams"` sends `{ "text": ... }`.
- **Slack:** an incoming webhook; `"format": "slack"`.
- **`"format": "json"`:** the event as JSON, for your own service: `event` (stuck, error, recovered), `plc`, `plcName`, `machine`, `type`, `state`, `value`, `since`, `durationMs`, `text`, `at`.

The time in state counts from when the gateway first saw the machine in it (after a restart, from then).

A rule without a webhook still records its alerts: they go to the alert history and the operator board only.

### Alert history and acknowledging

Every alert is kept in `alerts-history.json` next to `config.json` (the latest 1000). People signed in to the gateway (token or company account) see the list on the [operator board](#operator-board).
- **Acknowledge**, with an optional note such as "on my way", marks an alert as seen. Every open board shows who acknowledged it and when. The rule's webhook gets a message: *"👤 alice@example.com acknowledged: Line 202: MAIN.mainStateMachine.aDoors[2] is in DOOR_DASHER_ERROR · on my way"*. In the JSON format, `event` is `acknowledged`, with `by` and `note`.
- **Resolved:** a recovery marks that machine's open alerts as resolved.
- **Logged:** each acknowledgement goes into the gateway's log.

## Operator board

A full-screen, read-only view for a screen by the line: `https://<gateway>:8443/?board`. The Live tab links to it (**Operator board**) when it goes through a gateway.
- **One tile per state machine** of the gateway's PLCs. Green is normal, amber is stuck (longer in a state than its limit), red is an error state; problems come first. Each tile shows the machine, its state and its time in state ("≥" when it was already in that state when the gateway began watching). The header counts the machines, the errors and the stuck ones, and has a clock.
- **The alerts panel** lists the alert history, newest first, with **Acknowledge** on the open ones. The bell hides it and counts the open ones.
- **Watching:** the gateway follows the machines itself: one monitor per PLC, shared by every board, stopped a minute after the last board closes. The limits and error names come from an alert rule for that PLC and root when there is one.
- **Signing in:** the board asks for a token (kept in that browser, for a wall screen), or offers **Sign in** when company sign-in is set up. After a lost connection it connects again by itself.
- **Address options:**
  - `&plcs=line202,line237`: only these PLCs (default: all);
  - `&root=MAIN.mainStateMachine`: where the machines are looked for;
  - `&title=Line%20202`: the board's title;
  - `&stuck=300`: a default limit in seconds, for PLCs without an alert rule;
  - `&alerts=0`: start with the alerts panel hidden;
  - `&gateway=host:8443`: a board served from somewhere else (with a token).

## Sign-in with company accounts

Instead of access tokens (or next to them), people can sign in with their company account through OpenID Connect: Microsoft Entra ID (Microsoft 365 accounts), ADFS, Okta, Google and others. The web app served by the gateway then shows **Sign in with ...** in the Live tab.

1. **Register an application** with your identity provider. For Entra ID: *App registrations > New registration*, a *Web* redirect URI `https://<gateway>:8443/auth/callback`, and a client secret (*Certificates & secrets*). For group rules, add the *groups* claim (*Token configuration*).
2. **Configure the gateway:**
   ```json
   "oidc": {
     "name": "Microsoft",
     "issuer": "https://login.microsoftonline.com/<tenant id>/v2.0",
     "clientId": "<application (client) id>",
     "clientSecret": "<client secret>",
     "allowedDomains": ["example.com"],
     "allowedUsers": [],
     "allowedGroups": [],
     "tokens": true,
     "sessionHours": 12
   }
   ```
   - `issuer`: the provider's issuer. The gateway reads `<issuer>/.well-known/openid-configuration`.
   - **Who may use the gateway:** anyone signed in when all three lists are empty. Otherwise the user's e-mail is in `allowedUsers`, or its domain is in `allowedDomains`, or one of its `groups` / `roles` claims is in `allowedGroups` (Entra ID: group object ids).
   - `tokens`: `false` accepts only signed-in users; access tokens are then refused.
   - `redirectUri`: only when the gateway is reached under another address than the one the browser uses (a reverse proxy).
   - `name`: shown on the button.
3. A running gateway picks up changes within 10 s.

**How it works:**
- The sign-in uses the authorization code flow with PKCE, a state and a nonce.
- The ID token is checked: the signature against the provider's published keys, the issuer, the audience, the expiry and the nonce.
- The session is an HttpOnly, SameSite=Lax cookie (Secure over HTTPS). It lasts `sessionHours` and lives in the gateway's memory: after a restart, people sign in again.
- Sign-in works for the web app served by the gateway. A web app from another address still needs a token.
- Sign-ins, refused users and sign-outs are logged.

## Use

1. Open `https://<gateway>:8443/` and load a `.TcPOU`: *Browse*, or drop it on the file name in the header.
2. Open the **Live** tab and enter your access token (*Remember* keeps it in this browser), or click **Sign in with ...** when the gateway has sign-in set up.
3. Choose the PLC and click **Go live**.

The gateway finds the POU's instances from the PLC's own symbol tables: nested members, members inherited from a base function block, and array elements (up to 16). With several instances, the others are offered in the Instance field. You can also type a path.

## Testing without TLS

With `"insecure": true` and no `tls` entry, the gateway serves plain HTTP / WS and logs a warning. Tokens and data then cross the network in clear text, so use this only on a test bench.

## Log

The log goes to the console, one line per event with a time stamp:
- sign-ins (tokens and company accounts), rejected tokens and users, sign-outs, and IP addresses blocked after 10 failures a minute;
- alerts: the rules' machines followed, each message sent (or a webhook that failed), and acknowledgements;
- operator boards: who watches which PLCs;
- the setup page's actions (searches, PLC lists saved, tokens created or revoked) and refused requests to it;
- "go live" requests, with user, PLC and variable;
- ADS connections to the PLCs, and handles released.
