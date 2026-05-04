import { kv } from '../lib/kv.js';

export const config = {
  runtime: 'edge',
};

const GRAPH_VERSION = 'v21.0';
const IG_TOKEN = process.env.IG_TOKEN;
const IG_USERNAME = (process.env.IG_USERNAME || 'gojaehyun.go').toLowerCase();
const PROXY_URL = process.env.INSTACLOCK_PROXY_URL;
const PROXY_KEY = process.env.INSTACLOCK_KEY;

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 's-maxage=5, stale-while-revalidate=15',
    },
  });
}

function isValidUsername(u) {
  return /^[a-z0-9._]{1,30}$/.test(u);
}

async function fetchViaGraphApi(token) {
  const url = `https://graph.instagram.com/${GRAPH_VERSION}/me?fields=username,followers_count&access_token=${token}`;
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = data?.error?.message || `graph api ${r.status}`;
    throw new Error(err);
  }
  return {
    username: data.username,
    followers: data.followers_count,
    source: 'graph_api',
  };
}

async function fetchOther(username) {
  if (!PROXY_URL || !PROXY_KEY) {
    throw new Error('proxy not configured');
  }
  const base = PROXY_URL.replace(/\/$/, '');
  const url = `${base}/follower?username=${encodeURIComponent(username)}`;
  const r = await fetch(url, { headers: { 'x-api-key': PROXY_KEY } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data?.error || `proxy ${r.status}`);
  }
  return {
    username: data.username,
    followers: data.followers,
    source: data.source || 'scrape_residential',
  };
}

async function resolveByDevice(deviceId) {
  const dev = await kv.get(`device:${deviceId}`);
  if (!dev?.igUserId) return null;
  const rec = await kv.get(`ig:id:${dev.igUserId}`);
  return rec?.token ? rec : null;
}

export default async function handler(request) {
  const url = new URL(request.url);
  const deviceId = (url.searchParams.get('d') || '').trim();
  const raw = (url.searchParams.get('username') || '').trim();
  const username = raw.replace(/^@/, '').toLowerCase();

  try {
    if (deviceId) {
      const rec = await resolveByDevice(deviceId);
      if (!rec) return jsonResponse(404, { error: 'device not paired', deviceId });
      const result = await fetchViaGraphApi(rec.token);
      return jsonResponse(200, { ...result, exact: true, ts: Date.now() });
    }

    if (!username) return jsonResponse(400, { error: 'username or d required' });
    if (!isValidUsername(username)) return jsonResponse(400, { error: 'invalid username' });

    const rec = await kv.get(`ig:user:${username}`);
    if (rec?.token) {
      const result = await fetchViaGraphApi(rec.token);
      return jsonResponse(200, { ...result, exact: true, ts: Date.now() });
    }

    if (username === IG_USERNAME && IG_TOKEN) {
      const result = await fetchViaGraphApi(IG_TOKEN);
      return jsonResponse(200, { ...result, exact: true, ts: Date.now() });
    }

    const result = await fetchOther(username);
    return jsonResponse(200, { ...result, exact: true, ts: Date.now() });
  } catch (e) {
    return jsonResponse(503, { error: e.message || 'fetch error', username, deviceId });
  }
}
