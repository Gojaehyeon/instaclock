#!/bin/bash
# Run on the always-on host (mac mini, etc.) to set up the instaclock proxy
# tunnel. Idempotent — safe to re-run.
#
#   curl -fsSL https://raw.githubusercontent.com/Gojaehyeon/instaclock/main/scripts/setup-host.sh | bash
#
# After completion the proxy is reachable at https://api.gojaehyun.com.

set -euo pipefail

INSTALL_DIR="$HOME/instaclock-host"
TUNNEL_NAME="instaclock"
DOMAIN="api.gojaehyun.com"

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  BREW_PREFIX="/opt/homebrew"
else
  BREW_PREFIX="/usr/local"
fi
export PATH="$BREW_PREFIX/bin:$PATH"

say() { printf "\033[1;36m▶ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*"; }
ok() { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }

say "Detected $ARCH (brew prefix: $BREW_PREFIX)"

if ! command -v brew >/dev/null 2>&1; then
  say "Installing Homebrew (will ask for sudo password)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$($BREW_PREFIX/bin/brew shellenv)"
fi

for pkg in node cloudflared git; do
  if ! command -v $pkg >/dev/null 2>&1; then
    say "Installing $pkg..."
    brew install $pkg
  else
    ok "$pkg already installed"
  fi
done

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
if [ -d .git ]; then
  say "Updating existing checkout..."
  git fetch -q origin main && git reset -q --hard origin/main
else
  say "Cloning repo..."
  git clone -q https://github.com/Gojaehyeon/instaclock.git .
fi

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo
  warn "Cloudflare login required."
  warn "A browser will open. Pick the domain that holds gojaehyun.com."
  echo
  cloudflared tunnel login
fi

if cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "$TUNNEL_NAME"; then
  ok "Tunnel '$TUNNEL_NAME' already exists"
else
  say "Creating tunnel '$TUNNEL_NAME'..."
  cloudflared tunnel create "$TUNNEL_NAME"
fi
TUNNEL_ID=$(cloudflared tunnel list | awk -v n="$TUNNEL_NAME" '$2==n {print $1}')
say "Tunnel ID: $TUNNEL_ID"

say "Routing $DOMAIN -> $TUNNEL_NAME (ok if already mapped)..."
cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN" 2>&1 | grep -v "already exists" || true

cat > "$HOME/.cloudflared/config.yml" <<EOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json
ingress:
  - hostname: $DOMAIN
    service: http://localhost:3001
  - service: http_status:404
EOF
ok "Wrote ~/.cloudflared/config.yml"

NODE_BIN=$(command -v node)
CLOUDFLARED_BIN=$(command -v cloudflared)

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$HOME/Library/LaunchAgents/com.instaclock.proxy.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.instaclock.proxy</string>
  <key>ProgramArguments</key><array>
    <string>$NODE_BIN</string>
    <string>$INSTALL_DIR/server.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$INSTALL_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/instaclock-proxy.log</string>
  <key>StandardErrorPath</key><string>/tmp/instaclock-proxy.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$BREW_PREFIX/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

cat > "$HOME/Library/LaunchAgents/com.instaclock.tunnel.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.instaclock.tunnel</string>
  <key>ProgramArguments</key><array>
    <string>$CLOUDFLARED_BIN</string>
    <string>tunnel</string>
    <string>run</string>
    <string>$TUNNEL_NAME</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/instaclock-tunnel.log</string>
  <key>StandardErrorPath</key><string>/tmp/instaclock-tunnel.err</string>
</dict>
</plist>
EOF
ok "Wrote LaunchAgents"

launchctl unload "$HOME/Library/LaunchAgents/com.instaclock.proxy.plist" 2>/dev/null || true
launchctl unload "$HOME/Library/LaunchAgents/com.instaclock.tunnel.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/com.instaclock.proxy.plist"
launchctl load "$HOME/Library/LaunchAgents/com.instaclock.tunnel.plist"
ok "Loaded LaunchAgents"

say "Waiting 8s for services..."
sleep 8

LOCAL=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/api/follower?username=gojaehyun.go" || echo "000")
PUB=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/api/follower?username=gojaehyun.go" --max-time 15 || echo "000")

echo
ok "Local proxy: HTTP $LOCAL"
ok "Public ($DOMAIN): HTTP $PUB"
echo
if [ "$PUB" = "200" ]; then
  ok "Setup complete. Tunnel is live at https://$DOMAIN"
  curl -s --compressed "https://$DOMAIN/api/follower?username=gojaehyun.go"
  echo
  echo
  ok "Tell Claude: 'host setup done — switch vercel rewrite to api.gojaehyun.com'"
else
  warn "Public endpoint not ready yet (HTTP $PUB)."
  warn "DNS may take a minute to propagate. Check tail -f /tmp/instaclock-tunnel.log"
fi
