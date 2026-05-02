export const config = {
  runtime: 'edge',
};

const GRAPH_VERSION = 'v21.0';
const IG_TOKEN = process.env.IG_TOKEN;
const IG_USERNAME = (process.env.IG_USERNAME || 'gojaehyun.go').toLowerCase();

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

async function fetchOwn() {
  const url = `https://graph.instagram.com/${GRAPH_VERSION}/me?fields=username,followers_count&access_token=${IG_TOKEN}`;
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = data?.error?.message || `graph api ${r.status}`;
    throw new Error(err);
  }
  return { username: data.username, followers: data.followers_count };
}

async function fetchOther(username) {
  const fields = `business_discovery.username(${username}){username,followers_count}`;
  const url = `https://graph.instagram.com/${GRAPH_VERSION}/me?fields=${encodeURIComponent(fields)}&access_token=${IG_TOKEN}`;
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.business_discovery) {
    const msg = data?.error?.message || 'not a public business/creator account';
    throw new Error(msg);
  }
  return {
    username: data.business_discovery.username,
    followers: data.business_discovery.followers_count,
  };
}

export default async function handler(request) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('username') || '').trim();
  const username = raw.replace(/^@/, '').toLowerCase();

  if (!username) return jsonResponse(400, { error: 'username required' });
  if (!isValidUsername(username)) return jsonResponse(400, { error: 'invalid username' });
  if (!IG_TOKEN) return jsonResponse(500, { error: 'IG_TOKEN env var not set' });

  try {
    const result =
      username === IG_USERNAME ? await fetchOwn() : await fetchOther(username);

    return jsonResponse(200, {
      username: result.username,
      followers: result.followers,
      exact: true,
      source: 'graph_api',
      ts: Date.now(),
    });
  } catch (e) {
    return jsonResponse(503, { error: e.message || 'graph api error', username });
  }
}
