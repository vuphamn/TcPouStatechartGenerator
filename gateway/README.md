# Kval MachineScope gateway

The gateway lets the **web edition** of Kval MachineScope follow state machines in running PLCs. It runs on one machine in the PLC network, for example a server or an industrial PC. It does two things:

- serves the web app over HTTPS, so people open `https://<gateway>:8443/` in a browser and install nothing;
- gives the app's **Live** tab read-only access, over ADS, to the PLCs listed in its configuration.

```
browser ──HTTPS / WSS (token)──► gateway ──ADS (TCP 48898)──► PLC 1, PLC 2, ...
```

For a single person on a computer that can reach the PLC, the local helper [Kval MachineScope Link](../link/README.md) is simpler: no server, and the web app's *Via: This computer* option.

**What it does and doesn't do:**
- **PLCs:** browsers can only choose from the PLCs in `config.json`, never an arbitrary address.
- **Read-only:** the gateway reads variables (symbol info, handle, change notification). It writes nothing to a PLC except releasing its own variable handle.
- **Connections:** one ADS connection per PLC. Everyone following the same state variable shares one change notification. Guard values (the variables of the active state's transitions, see the main README) are read per viewer, at most `maxWatchedVariables` each.
- **Access tokens:** every browser needs one, unless people sign in with their company account (see [Sign-in with company accounts](#sign-in-with-company-accounts)). Only the tokens' SHA-256 hashes are stored. Connections and "go live" requests are logged with the token's or the user's name.
- **Alerts:** the gateway can follow machines by itself and post to a webhook when one is stuck or in error (see [Alerts](#alerts)).

## Install

Requires Node.js 20 or later on the gateway machine.

**Installed by the Kval MachineScope setup** (its *gateway* option), everything comes with it: Node.js (`node\node.exe`), the packages (`node_modules`), and a first `config.json` and certificate made for the computer's name (an update keeps yours). Skip steps 1 and 2: open a console in its folder (`C:\ProgramData\KvalMachineScope\Gateway` for all users, `%LOCALAPPDATA%\KvalMachineScope\Gateway` for one; the Start menu's **Kval MachineScope Gateway** opens it) and use `gateway.cmd` where this page says `node gateway.cjs`: `gateway.cmd start`, `gateway.cmd add-token alice`, `gateway.cmd init --host <name>` (after deleting `config.json`, for another host name). **Run at startup** then runs that Node.js too. At the end of the setup it offers to start the gateway (in a console window of its own: closing it stops the gateway) and open its setup page, with the steps that follow; the Start menu's **Kval MachineScope Gateway - setup page** does the same later (a gateway already running, e.g. by Run at startup: its page only). An update stops a running gateway first (its files would be in use) and starts its startup task again after.

1. **Build and copy:** on a development machine, run `npm run build:gateway`, which assembles `release/gateway` with its packages (`node_modules`). Copy that folder to the gateway machine.
2. **Install and initialize** on the gateway machine:
   ```powershell
   cd gateway
   npm install --omit=dev
   node gateway.cjs init --host machinescope-gw.example.local
   ```
   (PowerShell says *running scripts is disabled on this system*: run `npm.cmd install --omit=dev` instead; it changes no security setting.) Installed by the Kval MachineScope setup, skip `npm install`: its packages came with it.
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
   - `allowBrowse` (default `true`): `false` turns off the Symbols window, which lists the members of any symbol of the viewer's PLC, and reading the PLC's sources. While on, the Live tab shows the chosen PLC's state before going live (read every few seconds), and From PLC reads a POU's instances there first, to choose the one to follow before connecting.
   - `allowSources` (default `true`): `false` turns off only reading the PLC project's sources from the PLC (From PLC, and Open in the Symbols window: the files of its boot folder, read-only).
   - `devicesFolder` (default `Devices`, beside `config.json`): pictures of devices for the I/O tab's properties, named for their type (`EL1008.png`, `EL1008 front.jpg`); with TwinCAT's device descriptions when TwinCAT is on this server. `allowBrowse: false` turns these off too.
   - `allowBuild` (default `false`): `true` lets the web app's **Build…** rebuild a PLC's project with its edits on the gateway's computer, from the PLC's own copy or from the page's TwinCAT project folder (its files sent to the gateway, kept for that page until it closes). That needs TwinCAT XAE installed there, and the gateway running as a user who can start it: not as the SYSTEM service. Each build is in the audit log.
   - `allowWrite` (default `false`): with `allowBuild`, `true` also lets it **write** the built project to the PLC, and **Start the PLC** when a write left it in Stop (online change, or activate the configuration). It changes the machine's code: allow it only on a gateway that engineers use. Each write is in the audit log. It also lets the Live tab, not live, **Start**, **Stop** or **Restart** the chosen PLC, or set its TwinCAT from Config to **Run mode** (each asked first; in the audit log as `plc.start`, `plc.stop`, `plc.restart`, `plc.run`, with what the PLC answered). The Live tab's **History** of a PLC lists these from the audit log (the last 20, 90 days), with who did each.
   - `writeUsers` (optional): with `allowWrite`, only these users may write, for example `["alice@plant.com", "bob@plant.com"]` (their sign-in name, or a token's name). Everyone else may still build. A refused write is in the audit log too.
   - `localNetId`: the AMS NetId the gateway uses (its IP + `.1.1` by default). A PLC entry can override it.
   - `ip`: defaults to the first four numbers of `netId`. Use `host:port` for a forwarded ADS port.
   - `port`: the PLC runtime's ADS port (851 for the first PLC).
   - `allowedOrigins`: only needed when the web app is served from somewhere else, e.g. `["https://machinescope.example.com"]`.
4. **Add an ADS route on each PLC** to the gateway: AMS NetId = `localNetId`, address = the gateway's IP. Use the PLC's TwinCAT router (*Router > Edit Routes*) or an XAE connected to the PLC.
   **A PLC on the gateway's own computer** (TwinCAT installed there: the gateway on an IPC beside its PLC) needs no route: its address `127.0.0.1` (or the computer's own IP), its AMS NetId TwinCAT's own (*TwinCAT > Router > AMS NetId*, e.g. `10.88.88.201.1.1`). The gateway reaches it through the local TwinCAT router, as the desktop app does. `init` then gives the gateway's own `localNetId` the IP + `.1.2`, not TwinCAT's `.1.1`.
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
   To run it as a Windows service, use e.g. NSSM (`nssm install MachineScopeGateway "C:\Program Files\nodejs\node.exe" "C:\gateway\gateway.cjs start"`) or your usual service wrapper.

## Setup page

`https://localhost:8443/admin`, **on the gateway machine only**: requests from other computers get "not found". It has:

- **This gateway's AMS NetId** (`localNetId`), with suggestions from the machine's networks (each IP + `.1.1`).
- **Find PLCs on the network:** the TwinCAT device search (UDP 48899), the one the XAE's *Add Route* dialog uses. It lists each device's name, AMS NetId, address, TwinCAT version and OS. PLCs behind a router don't get the broadcast: enter their addresses in the field next to the button. Tick the PLCs and click **Add the ticked ones**; check their ids and names. **Check** on a found device runs the step-by-step check (below) before you add it. The search only asks: it changes nothing on the devices.
- **PLCs:** edit the list (id, name, AMS NetId, address, ADS port), add one by hand, remove one. **Test** connects to the PLC and reports its TwinCAT state and the PLC runtimes it finds on ports 851 to 854. When the PLC doesn't answer, it says which ADS route to add on the PLC. **Check** goes step by step, as the Live tab's Check does, from the gateway with its NetId: its address and network profile, ping, TwinCAT's search, the ADS port, the PLC's own NetId, the route. It shows the steps under the PLC's row. **Save to config.json** writes the list. The running gateway applies it at once: viewers of a PLC whose settings changed go live again.
- **Access tokens:** the names and creation dates; **Create token** shows the new token once, with a *Copy* button; **Revoke** stops a token at once. **View only (a display)** makes a token for a screen by the line: with it, the link to open on that screen (`/?board&view=<token>`). Signed in with it, the gateway answers the operator board only (its machines, saved boards and alerts); acknowledging, maintenance, reports and going live are refused.
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
- A host name the gateway doesn't know as its own (for a DNS alias) goes in `"admin": { "hosts": ["machinescope.example.local"] }`.

The search needs UDP 48899 open between the gateway and the PLCs (outgoing, and the replies back to the gateway).

## Alerts

The gateway follows the state machines of a PLC by itself, with no browser open, and posts to a webhook:
- **stuck:** a machine is longer in a state than the rule's limit (**Stuck after**, or a limit per state name);
- **error:** a machine goes into a state whose name matches the error pattern (default `ERROR|FAULT|ALARM|E_?STOP|ABORT`);
- **recovered:** a stuck machine, or one in an error state, leaves that state (unless turned off).
- **plcStopped:** the PLC itself stops running (Stop, no program) or stops answering, after it was running: one alert (*"⏹️ the PLC is stopped (it was running)"*), then **recovered** when it runs again. On by default (`"onPlcStop": false` turns it off; the setup page: **The PLC**). Its machine is `PLC`, its state the PLC's ADS state (read every 2 s).

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
- **`"format": "json"`:** the event as JSON, for your own service: `event` (stuck, error, recovered, plcStopped), `plc`, `plcName`, `machine`, `type`, `state`, `value`, `since`, `durationMs`, `text`, `at`.

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
- **On the board:** **Report...** (the last shift, today, yesterday) shows it, with **Download CSV** (a summary line, then every alert with who acknowledged it and when, then the notes).
- **Notes:** the notes written live through the gateway in the shift (the web app's Live tab, **+ Note**: kept in the audit log) are counted, the last three quoted with who wrote them.

## Operator board

A full-screen, read-only view for a screen by the line: `https://<gateway>:8443/?board`. The Live tab links to it (**Operator board**) when it goes through a gateway.
- **Muted alerts** (the PLC in maintenance, or in its rule's quiet hours) are still listed, greyed with **🔕 muted · maintenance** (or quiet hours): nobody is called (no webhook, no chime, never open), and a planned stop does not look like a fault. They are not counted in the shift report.
- **Each PLC's state** beside its name: **PLC runs** in green, or in amber **PLC: Stop**, **PLC: no program**… (its machines then keep their last states).
- **One tile per state machine** of the gateway's PLCs. Green is normal, amber is stuck (longer in a state than its limit), red is an error state; problems come first. Each tile shows the machine, its state and its time in state ("≥" when it was already in that state when the gateway began watching). The header counts the machines, the errors and the stuck ones, and has a clock.
- **The alerts panel** lists the alert history, newest first, with **Acknowledge** on the open ones. The bell hides it and counts the open ones.
- **Shelve…** on an open alarm (ISA-18.2): set it aside for 1, 2, 4 or 8 hours (at most `alarms.maxShelveHours`, 12 by default), with why. While shelved, that machine's alarms in that state are kept muted (*shelved: why*): not open, no chime, no webhook, nobody told; from any source (alert rules, drives, axes, anomalies). The shelved ones are listed at the top of the alerts (until when, by whom, why), with **Unshelve**; when their time is up they come back by themselves, said in the alert history. For those who acknowledge alarms; each in the audit log; kept in `shelves.json`.
- **Last time** on an alert: what the gateway knows of that machine in that state. How often it was in it in the last 90 days, the last time, how long it took to recover (the median), the note it was acknowledged with; the work orders done on it, with their root causes and parts (those from an alert of that state first, and the one that fixed this one); its root causes counted; its recovery guide (a click opens it); its earlier fault records. Not on a display.
- **A new alert** chimes (error: three times, stuck: once, escalated: its own tone, a PLC stopped: four falling notes) and its machine's tile flashes until the alert is acknowledged or resolved (at most a minute); the header flashes too. The speaker button turns the sound off and on (kept in that browser; `&sound=0` starts with it off). Browsers play sound only after the page was clicked or tapped once: until then the board says "tap once to enable sound".
- **A tile opens the machine's diagram**, live on that machine, in a new tab. When the web app has a sample of that POU type, it loads it at once. Otherwise a banner asks for the `.TcPOU` (**Browse...**); the app then goes live on the machine.
- **On a phone** (a narrow screen), the board shows **Machines** or **Alerts**, with a tab for each and the count of open alerts, and smaller tiles.
- **Watching:** the gateway follows the machines itself: one monitor per PLC, shared by every board, stopped a minute after the last board closes. The limits and error names come from an alert rule for that PLC and root when there is one.
- **Signing in:** the board asks for a token (kept in that browser, for a wall screen), or offers **Sign in** when company sign-in is set up. After a lost connection it connects again by itself.
- **A display:** `/?board&view=<token>` with a view-only token (the setup page): no sign-in, **view only** in the header, no Acknowledge, Maintenance or Report, and the tiles do not open diagrams.
- **Notes:** under each PLC's name, the notes written live on it in the last 24 h (the web app's Live tab, **+ Note**), newest first, with who wrote them: "jam cleared here — ann".
- **Filter** (the header; `/` goes there, Esc clears it): the machines whose path, state, type or PLC name has every word typed (`lockhead axis`), counted as *n of N machines*; a PLC with none is hidden. **Problems only**: the machines in error or stuck. Kept per board in that browser; `&filter=smLockManager` and `&problems=1` in the address set them for a wall screen.
- **Tree or Flat** (the header): **Tree** nests the machines as the program does (`smTable1` under `mainStateMachine`, an array's elements under it, `stations.station1` as one group). A closed branch still shows what is under it: how many machines, and how many are in error or stuck, coloured by the worst. Alt+click opens or closes a branch with everything under it. **Flat** is the tiles. The choice and the closed branches are kept in that browser; `&layout=tree` sets it for a wall screen.
- **Saved filters** (**Filters** in the header): views of the board kept on the gateway for the people who look at it, grouped as *Operators*, *Engineering*, *Maintenance*, *Office / production managers*, *Other*. One keeps:
  - the filter's words and **Problems only**;
  - Tree or Flat, and the page (Machines or I/O);
  - the alerts panel and the charted I/O signals;
  - optionally, only the machines chosen (**Select**) and only the PLCs shown.

  Applied, the header shows its name (× shows the whole board again). Each one's link (the copy icon, `&saved=<id>`) opens it on a wall screen, a display's too. They are kept in `board-filters.json` beside `config.json`.
- **Select** (the header): click machines to choose them (**All shown**, **None**), then:
  - **Record…**: the gateway records those machines, for some days. A recording made here covers only its own machines (its `machines` in `config.json`).
  - **Alarm…**: stuck after a time, an error state, the recovery, an optional webhook.
  - **Play back**.

  Each is a recording or alert rule in `config.json`, marked as made on the board (`fromBoard`: by whom, when), and listed on the setup page too. The dialog lists the ones already covering those machines; the ones made on the board can be removed there. The tiles show a recorded (⏺) and an alarmed (🔔) icon.
- **Play back…** (the header, or **Play back** in Select): the chosen machines (or the ones shown, the first 40) from the gateway's recordings, over the last hour, 8 hours or 24 hours. A lane per machine shows a bar per stay, coloured by state (error states red). Click or drag to move the cursor. **Play** runs it at 1×, 10×, 60× or 600×, and ⏮ / ⏭ step to the change before or after. Meanwhile the tiles show each machine as it was at the cursor; one not recorded is dimmed. **Live** goes back.
- **Who may change them:** everyone signed in (not a display) saves filters and adds recordings and alarms from the board. `"boardEditors": ["alice", "bob"]` in `config.json` limits it to those users. Each change is in the log and the audit log.
- **The I/O page** (**I/O** in the header; `&page=io`): each PLC's I/O devices, as its TwinCAT project in the PLC's boot folder describes them (read again every 10 minutes and after each download).
  - **States:** each box's state from its EtherCAT master, read every 2 seconds. OP is green; a box not in OP is red, with why (*SAFEOP*, *link lost* …); the PLC's header counts them.
  - **Hot Connect groups** (optional equipment, such as a shooter or a hopper attached or not): their head is the box the master identifies them by (named `(HC:<group>) …` by habit), its members the boxes after it. A group not attached (its head not there) shows *Hot Connect <group>: not attached*, its boxes grey. It is counted apart, not as *not OK*, and is not a risk. An attached group with a box out of OP still is.
  - **Other makers:** boxes of any maker the project has (Lenze drives, SMC valve terminals, HSD spindles …) show their maker beside the name.
  - **Tree or Network:** per device. In the tree, a box opens to its channels: **Linked only** shows the ones linked to a PLC variable, with the variable. The network is the cabling, as on the I/O tab.
  - **Filter** (every word, Esc clears it): boxes by name, type or maker; channels; PLC variables. A box's parents stay shown. In the network, the matches are listed to pick from. **Problems only**: the boxes not in OP.
  - **Signals:** tick a linked channel to chart its PLC variable live. A boolean is a band, a number a line with its range, on one time axis over 1, 5 or 15 minutes (the gateway keeps the last 15 minutes, so a chart starts full). Hover shows every value at a time; you can pause, export CSV, and **Record…** them (a recording of signals only). A recorded signal (⏺) goes back 1 h, 8 h or 24 h from its recording. Up to 20 signals per board, 50 per PLC across all boards.
  - **A box's properties:** its ⓘ in the tree, or right-click or Alt+click in the network, opens the I/O tab's panel. It shows the box's pictures (front, back, wiring) from the gateway's `Devices` folder (`EL1008 front.jpg` …), TwinCAT's device description on the gateway's computer, the maker's page, a search, the manual, its state and channels.
  - Read-only: nothing is written to the PLC. Off with `allowBrowse: false` or `allowSources: false`.
- **The Engineering page** (**Engineering** in the header, for engineers; `&page=eng`), from the gateway's recordings and the PLC projects it keeps:
  - **Timing:** each state's median time today against its normal (the median of its daily medians, the last 14 days). 30 % or more apart, with 3 stays today, is flagged.
  - **Transitions:** the last 24 hours' transitions against the 14 days before. A **new** one (never seen before) or a **rare** one (under 1 % of them) can be a fault path or a change in the program.
  - **Compare:** two windows (today, yesterday, the last 7 days, the 7 before) of one machine, or of two machines, side by side: each state's share of the time, its average and count, the average's change.
  - **What changed:** the PLC project's versions the gateway kept (its PLC projects), the files changed between two (added, removed, changed), and each one's diff.
- **Support bundle** (the ⛑ in the header, for engineers and supervisors): one zip for Kval support, of the last 24 hours, 3 days or 7 days. It holds the gateway and its settings (tokens by name only; webhooks, secrets and passwords left out), its load, the alerts, fault records (the last 50 in full), drives, the I/O fleet and risks, the PLC projects, work orders, recordings, its audit log, and the end of its log (2 MB). It is shared by a link (`/support/<id>.zip?key=…`) valid 1, 3 or 7 days, or downloaded and sent. Kept in `support/` until its link expires; each one made or fetched is in the audit log.
- **QR labels** (**QR labels…** in Select, on the Drives page, on the I/O page for the boxes its filter shows): a sheet of labels to print (or save as PDF) and stick on a cabinet, a drive, a terminal. Each QR code is the board's address of its item (`?board&focus=m:<plc>|<path>`, `d:` a drive, `b:` an I/O box). Scanned with a phone (signed in to the gateway), it opens:
  - **a machine:** big on the phone: its state and time in it, what to do (as on the Andon), its latest alerts, its fault records, its open work orders; **Call maintenance**, **Work order**, its diagram live; **The whole board** goes back.
  - **a drive:** the Drives page with its health and history.
  - **a box:** the I/O page, filtered to it, with its properties (pictures, the maker's page, the manual).
- **The board as an app, notifications on a device** (the 🔔 with rays in the header): the board installs as an app on a phone or a PC (the browser's **Install**, or **Add to Home Screen**), and tells that device of the alerts it wants, even with the board closed.
  - **Turning them on:** choose the kinds (error states, stuck, PLC stopped, drives, calls for maintenance, escalated, work orders, shift handover, spare parts low, recovered), **Turn on**, allow the browser's notifications. The board's PLCs only. **Send a test**; **Turn off**.
  - **A notification** names the PLC and the alert; a click opens the board at that machine.
  - **Needs:** the board over https (the gateway's https address; on this computer, `localhost` too), and a browser with push notifications. On an iPhone or iPad: add the board to the Home Screen first and open it from there.
  - **How:** standard Web Push (VAPID, RFC 8291 encryption), without any other service of Kval's. The gateway's key pair and the devices are kept in `push.json` beside `config.json`. The browser's push service (Google's, Apple's, Mozilla's, Microsoft's) carries the messages, so the gateway needs to reach the internet for this. A device its service no longer knows is dropped.
  - **Settings:** `"push": { "enabled": true, "subject": "mailto:maintenance@acme.com" }` (the contact the push services are given).
- **Shift handover** (the 🤝 in the header; amber, with a dot, while the last one is not read yet): what the outgoing shift hands the next one.
  - **This shift so far** (`config.shifts`; none: the last 8 hours), summed up by the gateway for the board's PLCs:
    - its alerts by kind, and the machines with most;
    - its stops, their downtime and top reasons (from the recordings), and how many still lack a reason;
    - the work orders opened, done and still open;
    - the drives in warning or alarm;
    - the alerts still open (and whether anyone took them).
  - **Hand over:** a note for the next shift (what is running, what to watch, what is waiting), with the summary as it was then. For those who may write notes. Told to the roles that want **handover** (Roles: Told of alerts).
  - **Photos:** **Photo…** adds one or more (a phone opens its camera) or a PDF, shown with the handover.
  - **Read it:** the next shift sees the last handover and marks it read. Who read it is kept. Earlier ones can be chosen.
  - **Kept:** `handover.json` beside `config.json` (the last 500), each one in the audit log.
- **Anomalies** (in the alert history, 🔍): live, from the recordings, what is unusual for a machine before it is a fault.
  - **A stay far from its usual:** each stay in a state, as it ends, against that state's stays of the last 14 days (their median and spread). Far longer (6 spreads, twice the median and 5 s more), or far shorter (a third of the median: a step skipped?).
  - **A new transition:** one not seen in those 14 days ("ENABLING → ERROR: a transition not seen in its last 14 days").
  - **Quiet:** kept in the alert history, never open, no chime; told to the roles and devices that want **anomaly**. One a machine and kind an hour at most.
  - **Settings:** `"anomalies": { "enabled": true, "days": 14, "minStays": 20, "spreads": 6 }`.
- **Guided recovery** (**Guide** on a stopped machine's tile; **Recovery steps** on the Andon page): the steps to bring a machine back from an error state, one at a time.
  - **A guide** is for a state, of a type of machine, of one machine, or of every machine in that state. The most particular one is offered.
  - **Its steps:** a step can be checked by the PLC itself, a variable at a value (`Close the guard | MAIN.bGuardClosed = TRUE`; numbers also `> 2`, `<= 40`). The checks are read from the PLC every 2 seconds while the guide is open: ✓ or ✗ with the value.
  - **Using it:** **Begin**; each step **Done** (its check's value kept) or **Skip**; then **Recovered**, **Still down: call maintenance** (a call with what was done), or **Stop**. For those who may acknowledge alerts.
  - **Writing one:** those who may edit the board (supervisors, engineers) write or change a guide from the same dialog (**+ Guide** on a stopped machine without one). One step a line.
  - **Kept:** `recovery-guides.json` and `recovery-runs.json` beside `config.json` (each use: who, each step's time, how it ended). The dialog shows how often a guide was used in 90 days, how often it recovered, and how long it took.
- **The Work page** (**Work** in the header; `&page=work`), for technicians and maintenance supervisors:
  - **Work orders:** from an alert (**Work order** on it), a call for maintenance (one by itself; `"workorders": { "fromCalls": false }` turns that off), a risk (**Work order** on the Risk page), or **New work order**. Each has its priority, who it is assigned to, and its log (what was done, what was found). A technician takes it, works on it, and closes it as done with its root cause and the parts used, or cancels it. Assigning it to someone else is for supervisors and engineers. *Open*, *Mine*, *To sign off*, *All*; CSV. Kept in `workorders.json`; each change in the audit log; a new one and an assignment told to the roles' channels that want `workorder`.
    - **Photos:** on a work order (**Photo…** on it or when it is made), and on a call for maintenance (in its dialog, before its reason: they go on its work order too). The board makes a phone's photo at most 1600 px and 512 KB (JPEG); a PDF up to 512 KB. Kept in `attachments/` beside `config.json` (in the backups too); shown to those who see what they are on. Added by those who may call, work on work orders or write handovers.
    - **Checklists:** templates on the setup page (Monitoring, *Checklists for work orders*: one a line, *Motor change: Lock out; Swap the motor; Check its rotation; Remove the lockout*). Chosen when a work order is made or later; each step ticked (by whom, when); it is done only when every step is.
    - **Sign-off:** a supervisor or an engineer signs a done work order off (not the one who did it, when roles are on); opened again, its sign-off goes. With *Work orders done are signed off* on (`workorders.signOff`), the Work page counts those done in the last 30 days and not signed off yet.
  - **KPIs:** over 7, 30, 90 or 365 days: preventive maintenance done on time (its work orders due in the window, done by their due date, a day's grace; those overdue now); the backlog (open work orders by age: under a day, 1–7, 7–30, over 30 days; by priority; the oldest, a click opens it); planned work (preventive) of all done; MTTR by week (a work order's start to done, an error alert's time to recover); the parts taken from stock per machine (by the work orders that took them).
  - **Calendar:** by month, the maintenance windows (past, in force, planned on the Machines page with **Maintenance…**) and the work orders due.
  - **Reliability:** over 30 or 90 days, each machine's failures (error states, from the alert history), MTBF (the days over its failures), MTTR (its time to recover: an alert's recovery, a work order's start to done) and its top root causes from the work orders done.
  - **Preventive:** maintenance plans, each every so many days, or operating hours, or both (grease the table bearings every 30 days; change the spindle belt every 2 000 h of running). Due ones first; the tab counts them.
    - **Its hours:** a drive's own operating hours (the Drives page reads them; the drive named), or a PLC variable that counts hours (times a scale: seconds 0.000277778).
    - **Its work order** is made by itself when it is due (7 days or 24 hours before, by default), one at a time: its steps as its note, due when the plan is. **Work order now** makes it sooner.
    - **Done:** its work order done, the plan is done then, at those hours: due again a full interval later. Cancelled: made again while still due.
    - **Who:** the plans are written by those who assign work; kept in `pm.json` beside `config.json`; the hours read every 10 minutes.
  - **Parts:** the spare parts kept for the machines: their number, name, where they are kept, how many, the level to reorder at, what they fit (device types, machines), the supplier. The ones to reorder come first, in red; the tab counts them.
    - **To order:** each part's use (taken, or used by work orders; not a count) over the last 90 days, the days its stock lasts at that, and its supplier's lead time (*Lead time*, 14 days by default). When it lasts less than its lead time and a week, or it is at its reorder level, *To order* says how many: its reorder level and its use over its lead time and 30 days, less its stock. **To reorder** shows those; the CSV has them.
    - **On the devices:** a drive's card on the Drives page counts the spare parts that fit it (red when none is in stock), and its detail lists them with their stock and where they are kept; so does an I/O box's properties. A part fits when a word of its *What it fits* (i550, EL1008, by commas) is in the device's name, type or product.
    - **A work order done** takes the parts it used from stock (**From stock…** beside the parts used; not more than there are). Its parts name them.
    - **Received / Taken** by hand, with why; each change of stock is kept (who, when, which work order). CSV of every part.
    - **Who:** the catalogue is written by those who assign work (supervisors, engineers); stock is received and taken by those who handle work orders.
    - **Told:** a part reaching its reorder level is told to the roles that want **parts** (Roles: Told of alerts). Kept in `spares.json` beside `config.json`.
- **The Andon page** (**Andon** in the header; `&page=andon`), for the operators by the line, big and plain. Each PLC shows *Running* or *N stopped*; the machines that stopped (an error state, stuck) come first as big cards with their state, their time in it, and **What to do**; the others are small chips.
  - **What to do:** the gateway's own steps for that state (`"andon": { "steps": { "DOOR_DASHER_ERROR": "Check the door sensor S12, then press Reset", "SM_TableManager.TABLE_ERROR": "…" } }`), else the state's description in the PLC's code: the comment on its enum member (`TABLE_ERROR := 9, // Check the clamp sensor, then Reset`, or the comment lines just above it).
  - **Call maintenance** (a machine's, or the line's): a reason (`"callReasons"`, by default Mechanical, Electrical, Material, Quality, Safety, Other) and a note. It is an alert: in the alert history, the chime on every board, the technicians' channel naming who is on call (`roles.notify` with the event `call`). The open calls show at the top, with who took one (acknowledged on the alerts panel).
- **The OEE page** (**OEE** in the header, for those who see the reports; `&page=oee`, `&window=week`), from the gateway's recordings (Select → Record… the machines first). Over today, yesterday, 7 or 30 days, it shows the line's and each machine's figures, by shift (`config.shifts`) or by day side by side, and three Pareto charts of the downtime: by the reasons given, by machine, by state. Each stop is listed with its reason. CSV, and **Print** (or save as PDF).
  - **Availability:** the time running normally, out of the time not in maintenance and with data. An error state, or the part of a stay beyond its limit (the PLC's alert rule's), is down.
  - **Performance** (when a machine's cycle is set): its entries into its cycle state times its ideal cycle time, out of its running time.
  - **Quality** (when a machine's part counters are set): its good parts out of its good and bad parts in the window. Each counter's rises are counted, and a drop is a reset. With one counter only, it is taken out of the cycles counted. The counters (`goodVar`, `badVar`: PLC variables that count up) are recorded with that PLC's recordings by themselves.
  - **OEE:** their product (what is known of them).
  - **By product** (or recipe): a PLC's variable that holds what it makes (a STRING or a number; Monitoring on the setup page, *By product*; `"products": { "line202": { "var": "GVL.sRecipe", "idealCycleSec": { "Door 36": 40 } } }`), recorded with that PLC's recordings. The window is split into the runs of each product: each product's OEE, availability, performance (against its own ideal cycle time when it has one, else the machine's), quality, the time it was made for, its runs, cycles and downtime.
  - **Energy per part:** each energy meter (Monitoring on the setup page, *Energy per part*): a PLC variable, its energy (Wh, kWh, MWh: a counter, a reset counted from zero) or its power (W, kW: integrated), recorded with that PLC's recordings. **Find its EL34xx** lists a PLC's EL34xx power measurement terminals and the PLC variables linked to them; a click adds one. The OEE page shows each meter's energy in the window, the parts its machines made (all of its PLC's, or those after *for*), its energy a part and, with a price a kWh, its cost; by product too. `"energy": { "meters": [{ "plc": "line202", "name": "Main feed", "var": "GVL.fEnergy", "unit": "kWh", "machines": ["MAIN.fbCell.smTable1"] }], "price": 0.18, "currency": "USD" }`.
  - **Why?** A machine in an error state, or stuck, longer than `reasonAfterMin` (2 by default) gets **Why?** on its tile. An operator picks a reason (`reasons`, with a note). Kept in `downtime.jsonl`; each stop of the report shows its reason, who gave it, and the note.
  - **Weekly summary:** `weekly` posts the last 7 days (OEE, availability, stops, the top reasons) to a webhook at a day and time.
  - **Settings:** `"oee": { "reasons": ["Waiting for material", "Jam", "Tool change", …], "reasonAfterMin": 2, "machines": [{ "plc": "line202", "machine": "MAIN.mainStateMachine.smTable1" (or "type": "SM_TableManager"), "cycleState": "TABLEMANAGER_DONE", "idealCycleSec": 42, "goodVar": "MAIN.nGoodParts", "badVar": "MAIN.nBadParts" }], "weekly": { "day": "Mon", "at": "07:00", "webhook": "https://…", "format": "teams", "link": "https://gateway:8443/?board&page=oee&window=week" } }`.
- **The Sites page** (**Sites** in the header, when this gateway follows others): the plant's other gateways, each one's PLCs, its machines in error or stuck, its open alerts, and a link to its own board. Worst first; one not reached says why.
  - **Following them:** the setup page's **Other gateways**: each one's name, address and a view-only token of it (its setup page, Tokens). It is followed as a display follows its board: nothing is changed there. **Its certificate not checked** for a self-signed one.
  - **Settings:** `"sites": [{ "id": "line4", "name": "Line 4", "url": "https://gw-line4:8443", "token": "…", "insecureTls": false }]`. Supervisors, engineers and managers see the page by default.
- **The Risk page** (**Risk** in the header; `&page=risk`), for a maintenance supervisor: across every PLC, what to look at first, worst first.
  - **Drives:** their health findings, and their heatsink's daily medians (while running) rising, carried forward to the warning threshold: "near its warning threshold in about 19 days" (within 90 days; a warning within 14).
  - **I/O boxes:** one out of OP now (alarm); one out of OP on 2 or more of the last 7 days (warning: its supply, cable, connectors); its CRC errors over 7 days (5: watch, 50: warning: its cable or connectors).
  - **Machines:** 5 or more faults or stuck states this week and at least twice the week before (10: warning).
  - **Inventory** (its tab): every I/O box of every PLC by maker, type and firmware, with how many and where (a row opens to each one). A type running several firmware versions across the fleet is marked ⚑. CSV of either tab.
  - **Alarm health** (its tab): the alert history over 24 hours, 7 or 30 days, as ISA-18.2 (and EEMUA 191) measure an alarm system.
    - **Alarms an hour:** about 6 (one in 10 minutes) is acceptable, up to 12 manageable, more overloaded. Then the busiest 10 minutes, and the floods (more than 10 in 10 minutes) with their share of the time (under 1 % is the target).
    - **Bad actors:** the 10 alarms raised most, with their share of all. **Task** on one makes a work order to fix it (its cause, a delay, a deadband), with why.
    - **Chattering:** an alarm raised 3 times or more within a minute (a delay or a deadband on it, in the PLC). **Task** too.
    - **Stale:** alarms open over 24 hours.
    - **Acknowledged in:** the median and 90 % time to acknowledge, and how many were not.
    - **What counts:** error states, stuck, PLCs stopped, drives, getting slower. Not calls, work orders or recoveries; muted ones (maintenance) counted apart.
  - **Changes** (its tab; counted while some are open): each change of a PLC's program the gateway saw, a download or an online change, with the files that changed (the project copy: Monitoring, Project copy).
    - **Explain** (engineers): why it was changed, and its work order. **Approve** (supervisors, engineers): by another person than the one who explained it, when roles are on.
    - **Told:** each change is told to the roles that want **change**: "its PLC program changed (download, 3 files): not explained yet". Kept in `changes.json` beside `config.json` (the last 1000); each explanation and approval in the audit log.
  - **How the boxes are followed:** each PLC's I/O is read every 30 minutes and its EtherCAT states every 60 seconds (counted per box and day: out of OP, CRC errors), kept in `fleet/<plc>/summary.json` (60 days). `"fleet": { "enabled": true, "everySeconds": 60, "limits": { "crcWarn": 50, "etaDays": 90 } }`.
- **Fault records** (**Faults** beside the alerts, an alert's **Fault record**): what led to a fault, kept by the gateway by itself.
  - **How it works:** for each PLC, the gateway keeps the last minute of every machine's state under its root (the PLC's alert rule's, else `MAIN.mainStateMachine`) and of the signals chosen for it. When a machine goes into an error state (the rule's error pattern, by default ERROR, FAULT, ALARM, E-STOP, ABORT in its name), that minute and the next one are kept as a fault record.
  - **What makes one:** a machine already in an error state when the gateway starts makes none. One that keeps falling into errors makes one every 5 minutes at most.
  - **The viewer:** a lane per machine (the faulted one first, then the ones that changed; the others on request), the moment of the fault marked. The cursor moves through it (play, the change before or after), and the signals kept with it are charted over the same two minutes.
  - **Its signals:** on the I/O page, chart the ones to keep and click **Keep with fault records** (technicians, supervisors, engineers when roles are on).
  - **TwinCAT logged events:** the PLC's own alarms and messages (its EventLogger) of the record's window, on its timeline and listed under it.
    - **How they get there:** in TwinCAT XAE, **View > Other Windows > TwinCAT Logged Events**, read the PLC's events, export them (CSV), and import that file on the setup page's **TwinCAT logged events** for its PLC.
    - Its columns are found by their names (English or German), its separator and date format by what it has. The same event is kept once; the last 50 000 a PLC (`eventlog/<plc>.jsonl`).
    - Not read live: the EventLogger has no interface documented for a program like the gateway (only Beckhoff's .NET one).
  - **Work orders:** **Work order** in the record makes one linked to it (technicians, supervisors, engineers when roles are on). The record lists its work orders, and the work order opens **its fault record**.
  - **Kept:** `faults/<plc>/<day>/<id>.json` beside `config.json`, 30 days.
  - **Cost:** it uses the shared notifications, so the machines the boards, alarms and recordings follow cost nothing more.
  - **Settings:** `"faults": { "enabled": true, "preSeconds": 60, "postSeconds": 60, "keepDays": 30, "root": "MAIN.mainStateMachine", "signals": { "line202": ["MAIN.fbDoor.bClosed"] } }`.
- **The Drives page** (**Drives** in the header; `&page=drives`): the health of every drive in the PLCs' I/O. The gateway reads them itself, from the drive, without the PLC's program.
  - **Which drives:** an EtherCAT box a drive profile matches. **Lenze i550**, any firmware, matched by its vendor and type. **HSD ES951 spindle** (ES95x), matched by its vendor (0x129) and type. **Any other maker's CiA 402 drive** (a non-Beckhoff box named or typed as a drive, inverter, VFD, spindle or servo). Valve terminals, robots and Beckhoff's own drives are left out.
  - **What is read:** the drive's own parameters (CoE objects) through the EtherCAT master, read-only: an SDO upload at the EtherCAT device's AMS NetId, with the slave's EtherCAT address as the ADS port. Every 30 seconds; hours and counters every 10 minutes; one drive after the other.
    - **Pinned to its serial:** each drive's serial number (CoE 0x1018:4) is kept the first time it is read (`summary.json`), and shown on its card. Drives alike that traded places follow their serials. A new serial where a drive was is *replaced?* (a watch alert), and its baseline starts again from that day.
    - **Its address from its PLC link:** a drive whose InfoData AdsAddr the PLC program links to a variable (an `AMSADDR`, e.g. `MAIN.fbFeed.stAdsAddr`, as Kval's drive blocks do) is read at the address that variable holds: the one the master gave it, exactly.
    - **Its address checked:** the address its project gives a drive (1000 + its box Id) can be another device's. Each drive's identity (CoE 0x1018: vendor, product code) is read at its address when its I/O is read. A drive not there is looked for: at the address the master gives its place on the bus, then among the master's slaves, or, when the master gives no addresses, in a scan of the addresses its project uses. The card shows *found at 1105, not 1021*. Several drives alike (the same identity) found by a scan are taken in order, and the card says so (*by order*). Not found anywhere: *not found on the EtherCAT bus*, with what answered at its address; it is not read until its I/O is read again. **Check a drive** shows each box's project address and its place on the bus as the master gives it.
    - For the i550, the objects of Lenze's i550 commissioning manual:
      - running: output frequency 0x2DDD, motor current 0x2D88, current and torque of rated 0x6078 and 0x6077;
      - supply and heat: DC-bus voltage 0x2D87, motor voltage 0x2D89, heatsink temperature and its warning threshold 0x2D84:1 and :2;
      - load: motor i²t 0x2D4F, device ixt 0x2D40:4;
      - fault: the error code 0x603F;
      - life diagnosis 0x2D81: operating and power-on hours, mains switching cycles, short circuits, earth faults.
    - For the ES951, the objects its EtherCAT description maps: spindle speed 0x6FF1:2, draw bar position 0x6FF1:1, P75 status 0x6FF0:1, and its C39 module's status, vibration velocity (RMS) and error flags 0x6010:1 to :3. Their scalings are not given: all ≈ until checked.
    - For CiA 402: the status word, the error code, the actual velocity, current, torque and DC-link voltage.
    - A value whose scaling the manual does not give is shown with ≈ ("to check once against the drive's keypad"). A value a firmware does not have is shown as *n/a*.
  - **How each drive is judged** (a health score, and *Healthy*, *Watch*, *Warning* or *Alarm*, with why):
    - **Its error code named:** an i550's code as the i550 commissioning manual's table names it (*In fault: error 0x2250 "CiA: Continuous over current (internal)"*). One whose name says it is a warning (0x4281 heat sink fan warning, 0x3222 DC-bus voltage too low for power up) is a *Warning*, not an *Alarm*. A profile of config.json names its codes so too with "errors": "lenze".
    - **No mains** (its DC bus under 50 V, the drive on its 24 V only): *No mains*, grey, not judged (its 0 °C and 0 A are not its values), and no alert. An error of the voltages inside the drive (0x32xx, such as 0x3222) is what a drive without mains reports, not a fault; any other error still is. Open alerts of that drive are closed (*no mains now*). `drives.limits.noMainsV` changes the 50 V.
    - **Its settings** (once a day, and when the gateway starts; `drives.settingsEveryHours`): an i550's minimum and maximum frequency, acceleration and deceleration time 1, motor control type, its motor's nameplate (rated speed, frequency, power, voltage, cos phi, current) and its max current, as Lenze's parameter attribute list scales them (0x2915–0x2918, 0x2C00, 0x2C01:4–8, 0x6073, 0x6075); a CiA 402 drive's 0x6073, 0x6075, 0x6080, 0x6083, 0x6084. Each against the last read: a change is an alert (*Drive B: its settings changed: Acceleration time 1: 10 s → 5 s*) and a change to explain and approve on the Risk page's Changes tab (*drive settings: Drive B, 1 setting*). A drive's detail shows its settings, each changed one with its date and what it was. A profile of config.json adds its own with `"settings": [ … ]` (as its params).
    - **Machine powered down:** most of a PLC's drives without mains (at least 2, and 60 % of those whose DC bus answers): one line on the Drives page (*⏻ Machine powered down … since 14:02*) in place of their cards (*Show its N drives* shows them), and one alert in place of one per drive (it closes their open alerts); *⚡ Machine powered again* when they are back. A drive whose DC bus is still charged but reports an undervoltage (0x32xx) is powering down with them, not in fault.
    - **Its mains signal** (Monitoring on the setup page, per PLC; `drives.mains: { "<plc id>": "MAIN.bMainsOn" }`): a BOOL, TRUE when the mains is on (`NOT GVL.bEStop`: TRUE when off). Off: every drive of that PLC powered down, whatever its DC bus. On, and a drive without DC bus: *No DC bus while the mains is on: its fuse, its mains contactor, its supply* (a warning). Without one, the gateway judges from the drives' DC bus.
    - **Partly read:** most of its values answering with an error (a wrong address, another firmware's objects) is *Watch*, not *Healthy*: "Only 2 of its 10 values answer".
    - **its limits:** in fault (an error code); the heatsink within 5 °C of its own warning threshold, or over it; the motor's i²t or the device's ixt at 80 % or 95 %; a new short circuit or earth fault in 7 days.
    - **its own past:** its baseline is the median of its daily medians over the last 14 days (at least 3), counted while running (the output frequency above 1 Hz). Running 5 °C warmer is *watch*, 8 °C *warning* ("check its fan and cooling, the load"). Drawing 10 % or 20 % more current at the same speed: "the load, bearings, the tool".
    - **its siblings:** the same model on the same PLC, today. 6 or 10 °C hotter than their median; its DC bus 10 % apart from theirs.
  - **Alerts:** a drive turning to *Warning* or *Alarm* is an alert in the alert history and on every board, with the chime (again after 12 hours if it stays so). Its recovery is said too. `drives.webhook` posts them.
  - **The page:** a card per drive, problems first, showing its heatsink, current, DC bus, frequency, i²t, hours, 24-hour lines of its heatsink and current, and its findings. There's a filter (name, PLC, model, finding) and **Problems only**. A card opens the drive's history over 24 h, 7 days or 30 days: its heatsink against its baseline (dashed) and its threshold (red), and every value with its scaling. CSV export. Saved filters keep the page (one for maintenance on the Drives page, problems only).
  - **Check a drive** (the setup page): to compare a drive with its keypad or its maker's software.
    - **List its drives:** a PLC's boxes of other makers, and which profile knows each one.
    - **Read its profile:** its identity (vendor, product code, against what its project expects), then every value it reads, as bytes, as each integer and float, and as the board reads it (with its scaling). A drive the board follows is read at the address it found it at.
    - **Read this object:** any one object (an index in hex, a subindex, a size). **At address**: its profile or an object read at another EtherCAT address.
    - **Scan the bus:** each EtherCAT address answering, the identity there (vendor, product code), and the project's box with that address (its own, or not: what was expected). A drive not at its project's address shows at its real one.
    - Read only, and it works with the drives monitor off. A value that is off: correct its profile in `drives.profiles`.
  - **Servo axes** (under the drives): every NC axis of the PLCs' programs (each `AXIS_REF`, AX5000, AX8000 or another), read from its `NcToPlc` every 10 seconds (Tc2_MC2: its error code, set and actual velocity, following error `PosDiff`, torque `ActTorque`).
    - **While it moves:** its following error and its torque kept; their 95th percentile a day (`axes/<plc>/summary.json`).
    - **Judged:** an NC error is an *Alarm*. Its following error 30 % (watch) or 60 % (warning) above its own last days, or its torque 15 % or 30 % above: "the mechanics (backlash, a bearing, a coupling), its tuning, the load", "friction, the load, its brake". Alerts as the drives'.
    - **Settings:** `"axes": { "enabled": true, "everySeconds": 10, "plcs": ["line202"], "limits": { "lagRise": { "watch": 30, "warn": 60 }, "torqueRise": { "watch": 15, "warn": 30 } } }`.
  - **Kept:** `drives/<plc>/<day>.jsonl` beside `config.json` (a value when it changes, else every 10 minutes; past days compressed; 90 days), and each day's statistics in `summary.json` (the baselines).
  - **Settings** in `config.json`: `"drives": { "enabled": true, "everySeconds": 30, "slowEveryMinutes": 10, "keepDays": 90, "plcs": ["line202"], "limits": { "heatsinkRise": { "watch": 5, "warn": 8 } }, "webhook": "https://…", "format": "teams", "profiles": [ … ] }`. A profile of your own, for another maker's drive: `{ "id": "acme", "name": "Acme", "match": { "vendorId": 2457, "type": "AD-?" }, "running": "freq", "params": [{ "key": "heatsink", "label": "Heatsink", "index": "0x2001", "sub": 1, "size": 2, "signed": true, "scale": 0.1, "unit": "°C", "trend": true, "peers": true }] }`. The same id replaces a built-in one, for example to correct a scaling. Off with `"enabled": false`, or `allowBrowse: false`.
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

**The log:** the gateway writes it to its console and to `gateway.log` beside `config.json` (at 5 MB it moves to `gateway.log.1`): run by the task it has no console, read the file then. A PLC that does not answer is retried every 30 s: the same error is logged once, then every 10 minutes with how many tries, and its connection when it comes back.

**Monitoring** (the setup page): what the gateway follows on each PLC by itself, without editing `config.json`.
- **Per PLC:** a row with **Drives**, **Fault records**, **I/O fleet** and **Project copy** to tick on or off.
- **Each monitor's settings:**
  - the drives': how often, how long they are kept, their limits for a warning or an alarm, a webhook;
  - the fault records': the seconds before and after, the days kept, the root, the signals kept with each PLC's faults;
  - the fleet's: how often, its CRC and trend limits for the Risk page;
  - the project copies': how often, how many versions.
- **The OEE settings:** the reasons offered and when **Why?** is asked; each machine's cycle state, ideal cycle time and good and bad counters; the weekly summary.
- **The andon's:** its steps by state, the reasons to call maintenance; whether a call makes a work order.
- **Saving:** one **Save monitoring**, checked; taken at once, without a restart.
- **Load** shows which monitors run on each PLC.

**Backup** (the setup page): the gateway in one file, to move it to another computer or to go back.
- **What it holds:** config.json (its PLCs, tokens' hashes, roles, every setting), the alert history, work orders, spare parts, preventive plans, recovery guides, handovers, changes, saved filters and boards, the push keys and devices, its certificates, the drives', axes' and fleet's day statistics, the logged events. The recordings and the fault records when ticked.
- **Encrypted** with a passphrase (AES-256-GCM, its key from the passphrase by scrypt; 8 characters at least): it holds passwords and tokens. Without its passphrase it cannot be restored. Kept in `backups/` (the last 10), downloaded from the page.
- **Restore:** its file and its passphrase. It is checked (a gateway's config.json), the gateway as it is now kept first (`backups/before-restore-<when>.kvalbk`, the same passphrase), then its files written back; its settings are taken at once. **Restart the gateway** to take everything (its Windows task starts it again within a minute; otherwise start it again by hand).
- **Scheduled:** **Make one by itself** every day, or every week on a day, at a time; a copy to a folder or a network share (its full path, `\\server\backups\line202`; the gateway's Windows account needs to write there), the newest *keep* (14) kept there; the recordings and fault records with it, when chosen. Its passphrase is set once: kept beside config.json in `backup-schedule.secret`, never shown back, never in a backup (keep it elsewhere too: without it a backup cannot be opened). **Make one now** runs it at once. Its last run is shown (made, copied); a failure is an alert (*💾 The scheduled backup failed …*, event `backup` for the roles' channels). `"backup": { "schedule": { "enabled": true, "every": "daily", "at": "02:00", "share": "…", "keep": 14 } }`.

**Certificate** (the setup page): the one the board and the setup page are served with (https): its names, its issuer, until when, the days left. The roles that want **cert** are told once a day from 30 days before it expires.
- **A self-signed one:** for the names given (empty: this computer's name and addresses). Browsers warn about it.
- **Our CA's:** **Make a request (CSR)** for the names given: send it to your company's CA; its key stays on the gateway (`pending-key.pem`) until the certificate the CA issued is pasted and installed (its chain after it). Its key is checked against it. Computers that trust your CA trust the board then.
- **A PFX** (its passphrase).
- **Taken at once,** without a restart; the one before kept (`cert-<when>.pem`).

**Reports by email** (the setup page's Shift reports, **Emailed to**): the shift report emailed each shift, daily (yesterday's) or weekly (the last 7 days) at a time, through the mail server of Email and SMS.
- **Its body:** the report (alerts by kind, time to acknowledge, the machines with most), then the stops and OEE, the work orders opened, done and open, the drives to watch, the alerts still open, and the board's link.
- **Attached:** every alert of the report, as CSV. **Email it now** sends the last shift's.
- `"reports": { "email": { "to": ["manager@acme.com"], "when": "shift" | "daily" | "weekly", "day": "mon", "at": "07:00" } }`.

**Exports** (the setup page): for other systems, read only.
- **The REST/JSON API:** `GET /api/v1/plcs`, `alerts` (`?since=`, `?limit=`), `workorders` (`?status=`), `oee` (`?from=`, `?to=`, `?by=shift|day`), `drives`, `axes`, `risks`, `changes`, with a token of the gateway (a view-only one is enough) as its bearer: `curl -H "Authorization: Bearer <token>" https://gateway:8443/api/v1/alerts`. `"api": { "enabled": false }` turns it off.
- **MQTT** (`"mqtt": { "url": "mqtt://broker:1883" or "mqtts://…:8883", "username", "password", "prefix": "kval/machinescope" }`): an MQTT 3.1.1 client of its own (QoS 0). `<prefix>/<plc>/alerts` each alert; `<prefix>/<plc>/state/<machine path>` each recorded machine's state (retained); `<prefix>/workorders` each work order made or changed; `<prefix>/gateway/status` online, or offline (its will, retained).
- **A CMMS hook** (SAP PM, Maximo or another): a work order made posts its body to the CMMS (its id there kept, `idPath`), done posts its done body to its done address.
  - `{number} {title} {plc} {plcName} {machine} {priority} {status} {assignee} {due} {rootCause} {parts} {createdBy} {createdAt} {externalId} {link}` are filled in (escaped for JSON in a body, for the URL in an address).
  - `"cmms": { "url": "https://cmms/api/wo", "body": "{\"description\":\"{title}\"}", "idPath": "data.id", "doneUrl": "https://cmms/api/wo/{externalId}/complete", "doneMethod": "PUT", "doneBody": "{\"remarks\":\"{rootCause}\"}", "headers": { "Authorization": "Basic …" } }`. Its headers and the MQTT password are left out of the support bundle.
- `"publicUrl": "https://gw-line4:8443"`: this gateway as others reach it (`{link}`, the reports' link).

**Roles** (the setup page's **Roles**, `config.json` `"roles"`): who may do what on the gateway. Without roles, everyone signed in may do everything (`writeUsers` and `boardEditors` still apply), and a view-only token is a display.

| Role | May |
|---|---|
| Operator | acknowledge alerts, write notes, call maintenance, give downtime reasons |
| Service / maintenance technician | as an operator, and set maintenance windows, handle work orders and fault records |
| Maintenance supervisor | as a technician, and assign work, add alarms and recordings, save the board's filters, the reports |
| Engineer | as a supervisor, and build and write to the PLCs (with `allowWrite`, `writeUsers`) |
| Production / office manager | see the boards, write notes, the reports |

- **Who has which:** by user (a token's name, a company sign-in), by a company sign-in's group or app role, else the default role (none: nothing beyond looking).
- **What the gateway does with it:** it refuses the rest, with the reason, and writes the refusal in its audit log. The board and the web app hide what a role may not do, and the board shows the role in its header.
- **Its pages:** the board shows each role its own pages, in one row (icons, the active page named, when the window is not wide; one page only: no row).
  - By default: operator Andon and Machines; technician those, I/O, Drives, Risk and Work; supervisor those and OEE; engineer every page; manager Andon, Machines, Risk, OEE and Work.
  - The setup page's Roles changes them (`"pages": { "operator": ["andon", "machines"] }`).
  - What a role may do there is still its role's.
- **Its language:** the board in English or Spanish (**EN / ES** in the header; `&lang=es` in the address).
  - In Spanish: what operators use (the header, the machines' tiles, Andon, alerts, Why?, calls for maintenance, recovery guides, shift handover, a machine's label on a phone). The Engineering, OEE, Work, Drives, I/O and Risk pages stay in English.
  - Which: the address, else the viewer's own choice (kept in that browser), else the role's (operators Spanish by default; the setup page's Roles sets each role's, `"languages": { "technician": "es" }`), else the browser's.
- **Start page:** each role can start on a saved filter of the board (an operator on its line's machines, a technician on the Drives page …). The address (`&saved=`) or the viewer's own choice comes first.
- **Told of alerts:** each role can have channels (Teams, Slack or JSON webhooks) for the alerts it wants (error, stuck, PLC stopped, drive, getting slower, call, work order, shift handover, spare parts low, program changes, recovered, escalated). An on-call schedule (`Bob; Mon-Fri; 06:00-14:00`, overnight too: `22:00-06:00`) names who is on call in each message.
  - **By email or SMS:** a channel can be **Email** (its addresses) or **SMS** (its numbers) instead of a webhook. With an on-call schedule whose people have their address or number (`Bob; Mon-Fri; 06:00-14:00; +15551234567`), only those on call now are emailed or texted; else the channel's own.
  - **Email and SMS** (the setup page): the mail server (SMTP: port 587 with STARTTLS, 465 with TLS; its user, password and sender) and the SMS provider (Twilio: its account SID, token and number; or any provider's web API, its address with `{to}` and `{text}`), each with **Send a test**. Passwords and tokens are never shown again (left empty, the saved one stays), and the support bundle leaves them out, with the people's addresses and numbers.
- Example: `"roles": { "users": { "ann": "operator", "bob@acme.com": "technician" }, "groups": { "Maintenance": "technician" }, "default": "operator", "startPages": { "operator": "<saved filter id>" }, "pages": { "manager": ["oee", "risk", "work"] }, "notify": [{ "role": "technician", "webhook": "https://…", "format": "teams", "events": ["error", "stuck", "drive", "call"], "onCall": [{ "name": "Bob", "days": "Mon-Fri", "from": "06:00", "to": "14:00" }] }] }`.

**Load** (the setup page): what the gateway costs this computer and each PLC, measured every few seconds.
- **This computer:** its CPU for all programs (the PLC's Windows side, KvalCAM, browsers …) and its free memory.
- **The gateway:** its own CPU, memory and answer delay.
- **Each PLC:** its ADS notifications. Every variable that the boards, alarms, recordings, live diagrams and I/O charts follow is **one** notification, shared by all of them (on change, checked every 10 ms). Before, a machine on the board, alarmed and recorded cost three. Also the changes per second, and the drives read.
- **Each PLC's tasks** (`TwinCAT_SystemInfoVarList._TaskInfo[1..4]`): the cycle time and the last execution time (read every 2 seconds), the longest seen, and every overrun counted (`CycleTimeExceeded` followed on change), since the gateway started and in the last hour, plus real-time violations on a shared core. A PLC whose task keeps its cycle is not slowed by the gateway: TwinCAT's real time runs before any Windows program.

**PLC projects kept here:** each PLC's project as the PLC keeps it in its boot folder (its TwinCAT configuration, `CurrentConfig.tszip`, and its PLC project's sources, `CurrentConfig\<project>.tpzip`), the PLC's copy the golden one. Unpacked as a TwinCAT project in `PlcProjects\<plc id>\current\` beside `config.json` (the `.tsproj` at its root, the PLC project in its own folder), to open, compare or back up. Checked at start and every 10 minutes: the PLC's `_AppInfo` (`AppTimestamp`, its build's time; `OnlineChangeCnt`) is read first, a few bytes; only when it changed are the archives read and compared, and another version replaces `current\` (the one before kept in `history\`, the last 20). Local changes to `current\` are undone from the archives kept here. Sources older than the program the PLC runs (a download without its sources) are said. The setup page's **PLC projects** lists each PLC (in step, downloaded, restored, no sources) with **Check now**. **From PLC** in the web app uses this copy when it is in step with the PLC (the PLC's `_AppInfo` the same as when the copy was read): it opens faster and reads only a few bytes from the PLC. After another download or online change it reads the PLC as before and checks the copy then. The message after From PLC says which one was used. The PLC must keep its sources: *PLC project > Settings > Source download*. In `config.json`: `"projectSync": { "enabled": true, "everyMinutes": 10, "keep": 20, "folder": "PlcProjects" }`; `allowSources: false` turns it off too.

**State names:** a board's tiles name each machine's state from its state variable's enum, as the PLC describes it. A state variable the PLC knows only as a number (Kval's `KvalStateMachineBase.machineState : INT`, the enum used in the code) is named from the PLC project's sources on the PLC (its boot folder's copy: the project downloaded with its sources): each type's enum found from its `CASE` labels or assignments, its members from its `.TcDUT`. Without them the tiles show the numbers (`#3`), and the log says why.

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
