#!/bin/bash
# Chrome mit Remote-Debugging starten (einmalig ausführen)
# Danach kann der Agent ohne neue Session verbinden
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome" \
  --no-first-run \
  --no-default-browser-check \
  > /dev/null 2>&1 &
echo "Chrome mit CDP auf Port 9222 gestartet (PID: $!)"
