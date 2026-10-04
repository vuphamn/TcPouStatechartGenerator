# Kval MachineScope Link

A small helper for the **web edition**. A browser can't talk ADS, so Link does it for the web app's **Live** tab: the page talks to Link at `ws://127.0.0.1:48960`, and Link talks ADS straight to the PLC, the same way the desktop app does.

```
web app (any host) ──ws://127.0.0.1──► Kval MachineScope Link ──ADS (TCP 48898)──► PLC
```

Use it when the web edition runs on a computer that can reach the PLC. When a team should watch machines from browsers without installing anything, use the [gateway](../gateway/README.md) instead.

## Build

```powershell
npm run build:link
```

This builds `release/link/Kval MachineScope Link.exe`. It's a single file that needs no Node.js on the laptop: the bundle is packed into a copy of `node.exe`, which is why it's about 90 MB. `release/link/machinescope-link.cjs` is the same program as one plain JavaScript file, runnable with `node`.

**Signing:** packing the bundle into `node.exe` invalidates Node's own signature, so Windows treats the exe as unsigned. SmartScreen may warn when it's downloaded. Sign it with your company's code-signing certificate before handing it out (`signtool sign /fd sha256 ...`).

## Use

1. **Start `Kval MachineScope Link.exe`** and keep its window open while you go live. It opens **its page** in your browser, `http://127.0.0.1:48960/`, which shows:
   - the **pairing code**, with a *Copy* button (the code is kept in `%APPDATA%\KvalMachineScope\link.json`);
   - the **paired pages**: each web app page connected to Link, since when, and the variable it follows;
   - **Make a new code**: pages paired with the old code have to enter the new one;
   - **Start when I sign in**: a shortcut in your Startup folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`) starts Link minimized, without its page, each time you sign in to Windows. It's per user and needs no administrator. *Don't start when I sign in* removes the shortcut.
   - **Its version:** when it was built and its code stamp, a short hash of the code it runs. If the installed Link (in Program Files) is not the one running, the page says so, because the Start menu starts that copy. The web app compares Link's stamp with its own and says, in the Live tab, when Link is another version.
   - **Replace the installed Link with this one:** shown when this Link is a newer build than the installed copy. A per-user install is a plain copy; in Program Files, Windows asks for an administrator first. The Start menu then starts this version.
   - **Updates:** Link checks the web edition's releases on GitHub a minute after it starts, then every 6 hours, for a newer Link. **Update now** downloads it and checks it against the SHA-256 GitHub gives for it. It then puts it in place of Link's own file (in Program Files, Windows asks for an administrator first) and starts it. **Update by itself** (on by default) does that without asking, but only while no page is live through Link. Pages paired with it go live again. Only a built Link updates itself; run from its sources, it only says that one is available. `KSS_LINK_UPDATES=off` stops the checks. The MachineScope page asks for it too: when Link is another version than the page, its notice in the Live tab has **Update Link** (Link checks, and updates itself when a newer one is released; a Link run from its sources, or one built here that is newer than the released one, is rebuilt instead: `npm run build:link`).

   The code is also in Link's window. Started again while it runs, Link opens the page of the running one and exits. In the web app, **Open Link** (Live tab, next to *Remember*) opens the page too.
2. **Set up the Live tab** in the web app:
   - **Via:** *This computer* (the default, unless the page is served by a gateway).
   - **Pairing:** enter the code once. *Remember* keeps it in this browser.
   - **Target:** the PLC's **AMS NetId**, or **Browse**: Link searches the network for TwinCAT devices (UDP 48899, as XAE's *Add Route* dialog does) and lists them with the remembered PLCs. The PLC IP defaults to the first four numbers of the NetId; enter it if it differs. The ADS port defaults to 851.
   - **Add route** (in Browse): with the PLC's user and password, Link asks the PLC for an ADS route to this computer. The password goes only to the PLC, and is not logged.
3. **Go live.** The first time, the PLC needs an **ADS route** for this computer. The Live tab shows exactly what to add: this PC's AMS NetId and IP.

Instances are found from the PLC's own symbol tables. The web app has no project files.

**Build from the project's folder:** for a POU not opened from the PLC, the web app's **Build…** sends the TwinCAT project's folder (granted in the browser) to Link, which keeps a copy for that page and builds it with TwinCAT XAE on this computer. The next build sends only the files that changed. After a write, the new compile information goes back to the page, into the folder. The copy is removed when the page closes.

Link also reads the **guard values** the Live tab asks for: the variables in the active state's transition conditions (see the main README). It also serves the Machine Overview's **Other PLCs**, one connection per PLC shown. All of this is read-only.

**Build and write back:** with TwinCAT XAE on this computer, Link also runs the web app's **Build…**. It rebuilds the PLC's project, from the PLC's own copy, with the POU edited in the page, and writes it to the PLC when you confirm. See the main README. Link's window logs each build and write.

**Options:**
- `--port <n>`: another port, if 48960 is taken. Enter the same port next to the pairing code.
- `--new-code`: a new pairing code. Browsers paired with the old one have to enter the new one.
- `--no-open`: don't open the page in the browser at start (it isn't opened either when Link runs without a console window, for example as a scheduled task).

## Security

Any web page you visit could try to reach a port on your computer. Link protects against that:

- It listens on **127.0.0.1 only**, and accepts only connections whose Host is `127.0.0.1` / `localhost`. That blocks DNS-rebinding tricks.
- **Its page** can't be read by other sites: it sends no CORS headers and can't be framed, so a web page can't learn the code. A new code is only made from Link's own page (its origin is checked).
- A page must present the **pairing code** before it can do anything. After 10 wrong codes in a minute, Link refuses further attempts for that minute.
- It only **reads**: symbol info, one variable handle, a change notification. Addresses and variable paths are checked before anything reaches the PLC. The one exception is **Add route**, and only when asked: it sends the route request, with the credentials you enter, to the PLC.
- It logs every page that connects, by its origin, and what it follows.

Browsers allow `ws://127.0.0.1` from HTTPS pages. Recent Chrome and Edge versions may ask once whether the site may access devices on your local network: allow it for the MachineScope site.
