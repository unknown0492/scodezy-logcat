# Changelog

## 1.0.0 - 03-11-2026
- First version: web page on http://127.0.0.1:3737 (pm2 process scodezy-logcat).
- Device IPs and package names remembered (data/history.json), removable.
- Selecting a device connects it on scodezy-logcat's own adb server (port 5038), so other tools cannot
  disconnect it; watchdog reconnects every 2 s and logcat resumes without gaps or repeats.
- Package dropdown with "Only this package" (follows the app's PIDs, also after a restart, via pidof /
  ps and ActivityManager "Start proc" lines); unticked shows all lines with the app's lines tinted.
- Live search (only matching lines, highlighted), log level filter, Clear screen, Jump to latest.
- Save: .txt download of the filtered results or all lines of the device (server keeps 200,000 lines).
