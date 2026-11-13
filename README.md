# scodezy-logcat

Live `adb logcat` of Android TVs in the browser: **http://127.0.0.1:3737** (this PC only).

## Install on any PC (one line)

In PowerShell (Windows 10 / 11):

```
irm https://raw.githubusercontent.com/unknown0492/scodezy-logcat/main/install.ps1 | iex
```

It installs Node.js LTS when missing (winget, else the official MSI: Windows asks for permission), downloads
Google's platform-tools when adb is not on the PATH, puts scodezy-logcat in `%LOCALAPPDATA%\scodezy-logcat`,
starts it with pm2, makes it start again at Windows sign-in (Startup folder) and opens http://127.0.0.1:3737.
Run the same line again to update (remembered TVs and packages in `data\` are kept). Options, set before the line:
`$env:LOGCAT_INSTALL_DIR` (folder), `$env:LOGCAT_BRANCH` (default main), `$env:LOGCAT_SKIP_START = '1'` (install only).

## Run (pm2)

```
cd D:\OneDrive\Programming\Workspaces\nodeJS\scodezy-logcat
npm install
pm2 start ecosystem.config.js
pm2 save
```

Restart: `pm2 restart scodezy-logcat` - logs: `pm2 logs scodezy-logcat`.
In Windows PowerShell type `pm2.cmd ...` (e.g. `pm2.cmd list`): plain `pm2` runs `pm2.ps1`, which the default
execution policy ("running scripts is disabled on this system") blocks. In Command Prompt plain `pm2` works.
Needs `adb` on the PATH (or `ADB_PATH`).

## Using it

- **Device**: pick a TV in the dropdown, or "+ Add new device..." to type its IP (Enter); remembered in
  data/history.json. "Remove ... from the list" in the same dropdown removes it. Picking a TV connects it
  and streams its logcat.
- **Package**: "+ Add new package..." in its dropdown; select it to follow that app (its process IDs, also after
  the app restarts). **Only this package** shows only that app's lines; unticked, all lines show and
  the app's lines are tinted.
- **Search**: shows only the lines containing the text (new lines too) and highlights it; x clears it.
- **Level**: lowest level shown (Debug and up ... Fatal only).
- **Save**: downloads a .txt of this device - the filtered results, or all lines since it was opened.
- **Clear** empties the view only (Save still has every line).
- **Light / dark**: the round button at the top right (remembered in the browser).

## Staying connected

scodezy-logcat uses its **own adb server on port 5038**. Other tools on this PC (estv-ops, setup bats,
`adb disconnect`, `adb kill-server`) talk to the shared server on 5037 and cannot disconnect the TVs
opened here. A watchdog checks every 2 s and reconnects when the TV dropped (reboot, WiFi); logcat
resumes from the last line without gaps or repeats. A TV nobody has open for 10 minutes is let go.

The server keeps up to 200,000 lines per device for Save; the page keeps the latest 20,000 and shows
the latest 3,000 that pass the filters.

## Settings (environment)

| Variable | Default | |
|---|---|---|
| LOGCAT_HOST | 127.0.0.1 | Address of the page |
| LOGCAT_PORT | 3737 | Port of the page |
| LOGCAT_ADB_PORT | 5038 | Port of the private adb server |
| ADB_PATH | adb | adb executable |
| LOGCAT_DATA_DIR | data | Folder of history.json |
