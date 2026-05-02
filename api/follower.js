export const config = {
  runtime: 'edge',
};

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

function parseEnglishCount(raw) {
  const s = raw.trim().replace(/,/g, '');
  if (/^\d+$/.test(s)) return { count: parseInt(s, 10), exact: true };
  const m = s.match(/^([\d.]+)\s*([KMB])$/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()];
  return { count: Math.round(parseFloat(m[1]) * mult), exact: false };
}

function parseKoreanCount(raw) {
  const s = raw.trim();
  const m = s.match(/^([\d.,]+)\s*(억|만|천)?$/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(num)) return null;
  const unit = m[2];
  if (!unit) return { count: Math.round(num), exact: true };
  const mult = { 천: 1e3, 만: 1e4, 억: 1e8 }[unit];
  return { count: Math.round(num * mult), exact: false };
}

function extractFollowers(html) {
  let m = html.match(/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
  if (m) return { count: parseInt(m[1], 10), exact: true, source: 'edge_followed_by' };

  m = html.match(/"follower_count"\s*:\s*(\d+)/);
  if (m) return { count: parseInt(m[1], 10), exact: true, source: 'follower_count' };

  m = html.match(/"followers_count"\s*:\s*(\d+)/);
  if (m) return { count: parseInt(m[1], 10), exact: true, source: 'followers_count' };

  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (og) {
    const desc = og[1];

    let f = desc.match(/([\d.,]+\s*[KMB]?)\s+Followers/i);
    if (f) {
      const r = parseEnglishCount(f[1]);
      if (r) return { ...r, source: 'og:en' };
    }

    f = desc.match(/팔로워\s*([\d.,]+\s*(?:억|만|천)?)명?/);
    if (f) {
      const r = parseKoreanCount(f[1]);
      if (r) return { ...r, source: 'og:ko' };
    }
  }

  return null;
}

function isValidUsername(u) {
  return /^[a-z0-9._]{1,30}$/.test(u);
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 's-maxage=30, stale-while-revalidate=60',
    },
  });
}

export default async function handler(request) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('username') || '').trim();
  const username = raw.replace(/^@/, '').toLowerCase();

  if (!username) return jsonResponse(400, { error: 'username required' });
  if (!isValidUsername(username)) return jsonResponse(400, { error: 'invalid username' });

  try {
    const response = await fetch(`https://www.instagram.com/${username}/`, {
      headers: HEADERS,
      redirect: 'follow',
    });

    if (response.status === 404) {
      return jsonResponse(404, { error: 'user not found', username });
    }
    if (!response.ok) {
      return jsonResponse(502, {
        error: `instagram returned ${response.status}`,
        username,
      });
    }

    const html = await response.text();
    const result = extractFollowers(html);

    if (!result) {
      return jsonResponse(503, {
        error: 'could not parse follower count (instagram may have changed format or is blocking)',
        username,
      });
    }

    return jsonResponse(200, {
      username,
      followers: result.count,
      exact: result.exact,
      source: result.source,
      ts: Date.now(),
    });
  } catch (e) {
    return jsonResponse(500, { error: e.message || 'fetch failed', username });
  }
}
