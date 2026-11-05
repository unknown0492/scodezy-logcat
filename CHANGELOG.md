# Changelog

## 1.0.2 - 05-11-2026

- Tag column: double-click any tag to widen the column to the longest tag shown (it keeps widening when a
  longer tag arrives); double-click again to go back to the 140 px column with "...". Remembered in this
  browser (localStorage scodezy-logcat-tag-fit). The double-click no longer leaves the word selected.

## 1.0.1 - 03-11-2026
- New look: one slim toolbar (device, package, Only this package switch / search, level, Save, Clear) and
  the rest of the screen for logs; adding a device or package is "+ Add new..." inside its dropdown,
  removing is "Remove ... from the list" there too.
- Light / dark theme button (remembered in the browser; first visit follows the Windows theme).
- Log lines in columns: time, PID (TID on hover), coloured level badge, tag, message; warnings and
  errors tinted; selected package's lines marked with a blue edge; empty-state hint; status pill with
  pulsing dot and the device IP; footer with PIDs, counts and "Latest".
- Fix: a page opening a TV that is already streaming could show a line twice (backlog + the next
  batch); the page now skips line numbers it already has.
- LOGCAT_DATA_DIR: folder of history.json (tests use their own, the real list is never touched).

## 1.0.0 - 03-11-2026
- First version: web page on http://127.0.0.1:3737 (pm2 process scodezy-logcat).
- Device IPs and package names remembered (data/history.json), removable.
- Selecting a device connects it on scodezy-logcat's own adb server (port 5038), so other tools cannot
  disconnect it; watchdog reconnects every 2 s and logcat resumes without gaps or repeats.
- Package dropdown with "Only this package" (follows the app's PIDs, also after a restart, via pidof /
  ps and ActivityManager "Start proc" lines); unticked shows all lines with the app's lines tinted.
- Live search (only matching lines, highlighted), log level filter, Clear screen, Jump to latest.
- Save: .txt download of the filtered results or all lines of the device (server keeps 200,000 lines).
