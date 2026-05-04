import { verifyState } from '../../lib/oauth.js';
import { kv } from '../../lib/kv.js';

export const config = { runtime: 'edge' };

const APP_ID = process.env.IG_APP_ID;
const APP_SECRET = process.env.IG_APP_SECRET;
const REDIRECT_URI = 'https://instaclock.gojaehyun.com/api/oauth/callback';

function htmlResponse(status, body) {
  return new Response(
    `<!doctype html><html lang=ko><head><meta charset=utf-8>` +
      `<meta name=viewport content="width=device-width,initial-scale=1">` +
      `<title>InstaClock</title>` +
      `<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#f0e0c0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}h1{font-size:24px;margin-bottom:12px}p{color:#9a9a9a;margin:6px 0;line-height:1.5}a{color:#f0e0c0}pre{font-size:11px;color:#6a6a6a;text-align:left;white-space:pre-wrap;word-break:break-all;max-width:420px;margin-top:16px}</style>` +
      `</head><body>${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

export default async function handler(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');

  if (errParam) {
    const desc = url.searchParams.get('error_description') || errParam;
    return htmlResponse(400, `<h1>인증 거부됨</h1><p>${desc}</p>`);
  }
  if (!code || !state) {
    return htmlResponse(400, `<h1>잘못된 요청</h1><p>code 또는 state 누락</p>`);
  }

  const verified = await verifyState(state);
  if (!verified) {
    return htmlResponse(400, `<h1>잘못된 요청</h1><p>state 검증 실패 (10분 이상 경과 또는 위조)</p>`);
  }

  const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: APP_ID,
      client_secret: APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });
  const shortData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !shortData.access_token) {
    return htmlResponse(500, `<h1>토큰 교환 실패</h1><pre>${JSON.stringify(shortData, null, 2)}</pre>`);
  }

  const longUrl = new URL('https://graph.instagram.com/access_token');
  longUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longUrl.searchParams.set('client_secret', APP_SECRET);
  longUrl.searchParams.set('access_token', shortData.access_token);
  const longRes = await fetch(longUrl);
  const longData = await longRes.json().catch(() => ({}));
  if (!longRes.ok || !longData.access_token) {
    return htmlResponse(500, `<h1>장기 토큰 교환 실패</h1><pre>${JSON.stringify(longData, null, 2)}</pre>`);
  }

  const meRes = await fetch(
    `https://graph.instagram.com/v21.0/me?fields=user_id,username,followers_count,account_type&access_token=${longData.access_token}`
  );
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !me.username) {
    return htmlResponse(500, `<h1>프로필 조회 실패</h1><pre>${JSON.stringify(me, null, 2)}</pre>`);
  }

  const igUserId = String(me.user_id || me.id || '');
  const now = Date.now();
  const igRecord = {
    token: longData.access_token,
    expiresAt: now + (longData.expires_in || 0) * 1000,
    refreshedAt: now,
    username: me.username,
    igUserId,
    accountType: me.account_type,
    followersCount: me.followers_count,
    lastSyncAt: now,
  };

  await kv.set(`ig:user:${me.username.toLowerCase()}`, igRecord);
  if (igUserId) {
    await kv.set(`ig:id:${igUserId}`, igRecord);
  }
  if (verified.d) {
    await kv.set(`device:${verified.d}`, {
      igUserId,
      username: me.username,
      pairedAt: now,
    });
  }

  return htmlResponse(
    200,
    `<h1>✓ 연결됨</h1>
    <p>@${me.username}</p>
    <p>팔로워 ${me.followers_count?.toLocaleString() || '?'}명</p>
    <p style="margin-top:24px"><a href="/?u=${encodeURIComponent(me.username)}">시계 보기 →</a></p>`
  );
}
