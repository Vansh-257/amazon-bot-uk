#!/bin/bash
# ==========================================================
# Rocket UK - Token Capture (Windows launcher)
# Starts the local token sink server (port 3010) and launches
# Chrome with a dedicated profile + the unpacked extension.
# ==========================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_PATH="$SCRIPT_DIR/rocket_uk"
PROFILE_DIR="$SCRIPT_DIR/chrome-profile"
SERVER_SCRIPT="$SCRIPT_DIR/server.js"
CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"
URL="https://auth.hiring.amazon.com/#/login"
PORT=3010

# --- validate ---
if [ ! -d "$EXT_PATH" ]; then
  echo "Extension not found at: $EXT_PATH"
  exit 1
fi
if [ ! -f "$SERVER_SCRIPT" ]; then
  echo "server.js not found at: $SERVER_SCRIPT"
  exit 1
fi
if [ ! -x "$CHROME_PATH" ] && [ ! -f "$CHROME_PATH" ]; then
  echo "Chrome not found at: $CHROME_PATH"
  echo "Edit CHROME_PATH in this script to point to your chrome.exe"
  exit 1
fi

mkdir -p "$PROFILE_DIR"

# --- start sink server if not already running ---
server_running=0
if command -v netstat >/dev/null 2>&1; then
  if netstat -an 2>/dev/null | grep -q ":$PORT[[:space:]].*LISTENING"; then
    server_running=1
  fi
fi

if [ "$server_running" -eq 1 ]; then
  echo "Token server already running on :$PORT"
else
  echo "Starting token server on :$PORT ..."
  node "$SERVER_SCRIPT" &
  SERVER_PID=$!
  echo "Token server started (PID: $SERVER_PID)"
  sleep 1
fi

# --- launch Chrome with the extension ---
echo "Launching Chrome with extension: $EXT_PATH"
echo "Profile: $PROFILE_DIR"
echo "URL: $URL"

"$CHROME_PATH" \
  --user-data-dir="$PROFILE_DIR" \
  --load-extension="$EXT_PATH" \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=DisableLoadExtensionCommandLineSwitch \
  "$URL"
