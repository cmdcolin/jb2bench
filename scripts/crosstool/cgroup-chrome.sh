#!/bin/sh
# Puppeteer's executablePath for MEMORY_PEAK=1 runs. systemd-run --scope moves
# this process into a fresh transient scope and execs Chrome in it, keeping the
# PID. Chrome is handed a dead session bus, or it asks systemd for a scope of
# its own and moves the browser process out, leaving its children behind.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
exec systemd-run --user --scope --quiet -p MemoryAccounting=yes -- \
  env DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent "$SCOPED_CHROME" "$@"
