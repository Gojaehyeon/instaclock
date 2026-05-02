#!/bin/bash
# Auto-managed by launchd: ensures the proxy + cloudflared tunnel are running,
# and rotates the tunnel URL into vercel.json + redeploys on change.

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd /Users/go/develop/instaclock

LOG=/tmp/instaclock-sync.log
PROXY_LOG=/tmp/instaclock-proxy.log
TUNNEL_LOG=/tmp/instaclock-tunnel.log

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

if ! curl -s -o /dev/null -m 2 http://localhost:3001/ 2>/dev/null; then
  log "starting proxy"
  nohup node server.mjs > "$PROXY_LOG" 2>&1 &
  sleep 2
fi

if ! pgrep -f "cloudflared.*localhost:3001" >/dev/null 2>&1; then
  log "starting cloudflared"
  : > "$TUNNEL_LOG"
  nohup cloudflared tunnel --url http://localhost:3001 > "$TUNNEL_LOG" 2>&1 &
  sleep 10
fi

URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)
if [ -z "${URL:-}" ]; then
  log "no tunnel url yet"
  exit 0
fi

CURRENT=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' vercel.json | head -1 || true)
if [ "$URL" = "$CURRENT" ]; then
  exit 0
fi

log "rotating url: $CURRENT -> $URL"
if [ -n "$CURRENT" ]; then
  sed -i '' "s|$CURRENT|$URL|" vercel.json
else
  log "vercel.json missing trycloudflare host; bailing"
  exit 1
fi

git add vercel.json
git -c commit.gpgsign=false commit -m "auto: rotate tunnel url to $URL" >> "$LOG" 2>&1
git push -q origin main >> "$LOG" 2>&1
vercel --prod --yes --scope gojaehyeons-projects >> "$LOG" 2>&1
log "deployed"
