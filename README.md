# scodezy-logcat

Live `adb logcat` of Android TVs in the browser: **http://127.0.0.1:3737** (this PC only).

## Run (pm2)

```
cd D:\OneDrive\Programming\Workspaces\nodeJS\scodezy-logcat
npm install
pm2 start ecosystem.config.js
pm2 save
```

Restart: `pm2 restart scodezy-logcat` - logs: `pm2 logs scodezy-logcat`.
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
