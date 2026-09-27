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
- **Operator boards:** saved boards (id, title, PLCs, root, a default limit), each with its link `/?board=<id>`.
- **Recordings:** what the gateway records all day, for how many days, the disk it uses, and **Check for slowdowns now**.
- **Shift reports:** the shifts and the reports webhook; **Preview the last shift**, **Send it now**.
- **Run at startup (Windows):** install, remove, or switch to the startup task (see [Run at startup](#run-at-startup-windows)).
- **Audit log:** search it (text, last 24 h to a year) and **Export CSV** (see [Audit log](#audit-log)).

The page writes only `localNetId`, `plcs`, `tokens`, `alerts`, `boards`, `recordings`, `shifts` and `reports`; other settings in `config.json` stay as they are. Changes are only accepted from the page itself (its origin is checked) and under the gateway's own host names. The ADS routes themselves are added on the PLCs, as before.

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

- **Escalation:** `"escalateAfterMin": 15` posts an alert again when nobody has acknowledged it within 15 minutes (once): *"⏰ Not acknowledged for 15 min: ..."*. It goes to `"escalateWebhook"` (for example a supervisor's channel, with `"escalateFormat"`), else to the rule's webhook. The board marks it **escalated**.
- **Quiet hours:** `"quietHours": "Mon-Fri 22:00-06:00; Sat,Sun"`. No alerts at those times: days (`Mon`-`Sun`, ranges and lists), a time range (it may pass midnight; it belongs to the day it starts on), or whole days. A machine stuck during quiet hours is reported when they end, if it is still stuck.
- **Maintenance:** set on the operator board (**Maintenance...** on a PLC: 30 min to 8 h, with a note), now or **planned** for a date and time (**starting**; up to 90 days ahead). The PLC's alerts are muted during the window, the board shows who set it and why (planned windows too, with × to remove one), and the PLC's rule webhooks get a message when it is planned, when it starts and when it ends. It is kept in `maintenance.json` with the past windows (the availability counts them); it ends by itself, or with **End**.

### Alert history and acknowledging

Every alert is kept in `alerts-history.json` next to `config.json` (the latest 1000). People signed in to the gateway (token or company account) see the list on the [operator board](#operator-board).
- **Acknowledge**, with an optional note such as "on my way", marks an alert as seen. Every open board shows who acknowledged it and when. The rule's webhook gets a message: *"👤 alice@example.com acknowledged: Line 202: MAIN.mainStateMachine.aDoors[2] is in DOOR_DASHER_ERROR · on my way"*. In the JSON format, `event` is `acknowledged`, with `by` and `note`.
- **Resolved:** a recovery marks that machine's open alerts as resolved.
- **Logged:** each acknowledgement goes into the gateway's log.

### Shift reports

Per shift (`"shifts": [{ "name": "Early", "from": "06:00", "to": "14:00" }, { "name": "Late", "from": "14:00", "to": "22:00" }, { "name": "Night", "from": "22:00", "to": "06:00" }]`; none: one per day), a report of the alerts: how many of each kind, how many acknowledged and how long it took (average, longest), how long until resolved, escalations, what is still open, the machines with the most, and the maintenance windows.
- **Posted** to `"reports": { "webhook": "https://...", "format": "teams" }` when each shift ends (the setup page sets both).
- **On the board:** **Report...** (the last shift, today, yesterday) shows it, with **Download CSV** (a summary line, then every alert with who acknowledged it and when).

## Operator board

A full-screen, read-only view for a screen by the line: `https://<gateway>:8443/?board`. The Live tab links to it (**Operator board**) when it goes through a gateway.
- **One tile per state machine** of the gateway's PLCs. Green is normal, amber is stuck (longer in a state than its limit), red is an error state; problems come first. Each tile shows the machine, its state and its time in state ("≥" when it was already in that state when the gateway began watching). The header counts the machines, the errors and the stuck ones, and has a clock.
- **The alerts panel** lists the alert history, newest first, with **Acknowledge** on the open ones. The bell hides it and counts the open ones.
- **A new alert** chimes (error: three times, stuck: once, escalated: its own tone) and its machine's tile flashes until the alert is acknowledged or resolved (at most a minute); the header flashes too. The speaker button turns the sound off and on (kept in that browser; `&sound=0` starts with it off). Browsers play sound only after the page was clicked or tapped once: until then the board says "tap once to enable sound".
- **A tile opens the machine's diagram**, live on that machine, in a new tab. When the web app has a sample of that POU type, it loads it at once. Otherwise a banner asks for the `.TcPOU` (**Browse...**); the app then goes live on the machine.
- **On a phone** (a narrow screen), the board shows **Machines** or **Alerts**, with a tab for each and the count of open alerts, and smaller tiles.
- **Watching:** the gateway follows the machines itself: one monitor per PLC, shared by every board, stopped a minute after the last board closes. The limits and error names come from an alert rule for that PLC and root when there is one.
- **Signing in:** the board asks for a token (kept in that browser, for a wall screen), or offers **Sign in** when company sign-in is set up. After a lost connection it connects again by itself.
- **Saved boards:** `/?board=<id>` opens a board saved on the setup page (its PLCs, title, root and default limit); the header switches between them. The address options below override a saved board's.
- **Maintenance:** each PLC has **Maintenance...** (see [Alerts](#alerts)); a PLC in maintenance shows the banner and dimmed tiles, and its planned windows are listed.
- **The header** also counts the **escalated** alerts, and has **Report...** (see [Shift reports](#shift-reports)).
- **Kiosk mode:** `&cycle=30` rotates through the saved boards every 30 s (`&boards=line202,line237`: those only), showing which one of how many.
- **Address options:**
  - `&plcs=line202,line237`: only these PLCs (default: all);
  - `&root=MAIN.mainStateMachine`: where the machines are looked for;
  - `&title=Line%20202`: the board's title;
  - `&stuck=300`: a default limit in seconds, for PLCs without an alert rule;
  - `&alerts=0`: start with the alerts panel hidden;
  - `&gateway=host:8443`: a board served from somewhere else (with a token).

## Recordings

The gateway can record the state machines of a PLC all day, with no browser open. It records every change of their state variables, with the PLC's time, into one file per day: `recordings/<id>/<YYYY-MM-DD>.jsonl` next to `config.json`. Days older than the rule keeps are deleted.
```json
"recordings": [
  { "id": "line202", "name": "Line 202", "plc": "line202", "root": "MAIN.mainStateMachine", "stateVar": "machineState", "days": 14 }
]
```
- **Variables too** (`"vars": ["MAIN.fbLine.bDoorClosed", ...]`, at most 100): recorded with the machines (lines `{ "t", "x": "<path>", "v" }`). A replay then shows their values: the guard values on the diagram, and a small chart each under the replay's slider.
- **Storage:** past days are compressed (`.jsonl.gz`, `"compress": false` to keep them plain); `"maxMB": 500` deletes the oldest days beyond that size. The setup page shows the disk each recording uses.
- **Getting slower:** `"slowerPct": 30` checks the trends once a day: a machine's state whose average over the last 3 days is more than 30% above the days before is reported, as a 🐢 alert on the boards (and in the history), and on `"slowerWebhook"` (`"slowerFormat"`). Once per state and day.

In the web app, the Live tab (through the gateway) has **Gateway recordings...**: pick a recording, a machine and a time window (the last hour, 8 h, a day, 3 days, or any dates), and **Replay** plays it on the diagram like a saved recording, with the trail, Transition History and the measured state times. Only the state variables are recorded on the gateway, not guard values. A window is at most 31 days.

**Availability** (the third tab): for today, yesterday and today, or the last 7 or 14 days (per shift when there are shifts), each machine's time normal, in an error state, stuck (the part of stays beyond the limits of the gateway's alert rule for that PLC and root) and in maintenance, as a bar and percentages of the time with data; **CSV** saves it. Before a machine's first recorded value there is no data.

**Trends** (the dialog's second tab): for a machine and the last 7 to 90 days, per state: the stays, the average, the latest day's average and 90%, the daily average as a small line, and **change**. **Change** compares the latest 3 days' average with the days before; more than +25% is shown in red, because the state is getting slower (for example a wearing sensor or axis). The slowest-growing states come first. A stay counts for the day it ends. When the gateway was off, the stay across the gap counts as one long stay.

Each line of a file is small (about 60 bytes). A machine that changes state every second makes about 5 MB a day.

## Run at startup (Windows)

The setup page's **Run at startup** installs the gateway as a Windows scheduled task: it starts with the computer (as SYSTEM, before anyone signs in), is started again within a minute when it stops, and has no time limit. It runs `node gateway.cjs start --config <this config.json>`. Installing and removing need the gateway to run as an administrator once (right-click the console, *Run as administrator*). **Switch to the task now** stops the console gateway and starts the task a few seconds later (the same port).

A scheduled task needs no service wrapper; if you prefer a Windows service, NSSM or WinSW run it the same way.

## Audit log

Who did what, one JSON line per event in `audit-YYYY-MM.jsonl` next to `config.json` (kept 24 months): sign-ins (token or company account, with the address), going live (PLC, variable), acknowledgements (with the note), maintenance set and ended (planned too), replays and availability of recordings, reports, and every change on the setup page. The setup page searches it (any text: a user, an action, a PLC, a machine) over the last 24 h to a year, and exports it as CSV.

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
- operator boards: who watches which PLCs; maintenance planned, set and ended; escalations; replays of recordings; slowdowns; reports posted; the startup task;
- the setup page's actions (searches, PLC lists saved, tokens created or revoked) and refused requests to it;
- "go live" requests, with user, PLC and variable;
- ADS connections to the PLCs, and handles released.
