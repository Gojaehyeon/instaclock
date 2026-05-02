export const config = {
  runtime: 'edge',
};

const UA =
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36';

function apiHeaders(username) {
  return {
    'User-Agent': UA,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
    'x-ig-app-id': '936619743392459',
    'X-Requested-With': 'XMLHttpRequest',
    'X-ASBD-ID': '129477',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    Referer: `https://www.instagram.com/${username}/`,
    Origin: 'https://www.instagram.com',
  };
}

function htmlHeaders() {
  return {
    'User-Agent': UA,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  };
}

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

function extractFromText(text) {
  let m = text.match(/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
  if (m) return { count: parseInt(m[1], 10), exact: true, source: 'edge_followed_by' };

  m = text.match(/"follower_count"\s*:\s*(\d+)/);
  if (m) return { count: parseInt(m[1], 10), exact: true, source: 'follower_count' };

  m = text.match(/"followers_count"\s*:\s*(\d+)/);
  if (m) return { count: parseInt(m[1], 10), exact: true, source: 'followers_count' };

  const og = text.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
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
      'cache-control': 's-maxage=5, stale-while-revalidate=15',
    },
  });
}

function parseSetCookie(setCookieHeader) {
  if (!setCookieHeader) return '';
  const pairs = [];
  setCookieHeader.split(/,(?=\s*[^;,\s]+=)/).forEach((c) => {
    const m = c.trim().match(/^([^=]+=[^;]+)/);
    if (m) pairs.push(m[1]);
  });
  return pairs.join('; ');
}

async function tryWebProfileInfo(username) {
  let cookieStr = '';
  try {
    const warmup = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      headers: htmlHeaders(),
      redirect: 'follow',
    });
    cookieStr = parseSetCookie(warmup.headers.get('set-cookie') || '');
  } catch {}

  const apiH = apiHeaders(username);
  if (cookieStr) apiH.Cookie = cookieStr;

  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const r = await fetch(url, { headers: apiH, redirect: 'follow' });
  if (r.status === 404) return { notFound: true };
  if (!r.ok) return { error: `web_profile_info status ${r.status}`, hadCookies: !!cookieStr };
  const text = await r.text();
  const ext = extractFromText(text);
  if (ext) return { result: ext };
  return { error: 'web_profile_info returned no count' };
}

async function tryProfileHtml(username) {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const r = await fetch(url, { headers: htmlHeaders(), redirect: 'follow' });
  if (r.status === 404) return { notFound: true };
  if (!r.ok) return { error: `profile html status ${r.status}` };
  const text = await r.text();
  const ext = extractFromText(text);
  if (ext) return { result: ext };
  return { error: 'profile html had no recognizable count' };
}

export default async function handler(request) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('username') || '').trim();
  const username = raw.replace(/^@/, '').toLowerCase();

  if (!username) return jsonResponse(400, { error: 'username required' });
  if (!isValidUsername(username)) return jsonResponse(400, { error: 'invalid username' });

  const attempts = [];
  try {
    let r = await tryWebProfileInfo(username);
    attempts.push({ method: 'web_profile_info', ...r, result: r.result ? 'ok' : undefined });
    if (r.notFound) return jsonResponse(404, { error: 'user not found', username });
    if (r.result) {
      return jsonResponse(200, {
        username,
        followers: r.result.count,
        exact: r.result.exact,
        source: r.result.source,
        ts: Date.now(),
      });
    }

    r = await tryProfileHtml(username);
    attempts.push({ method: 'profile_html', ...r, result: r.result ? 'ok' : undefined });
    if (r.notFound) return jsonResponse(404, { error: 'user not found', username });
    if (r.result) {
      return jsonResponse(200, {
        username,
        followers: r.result.count,
        exact: r.result.exact,
        source: r.result.source,
        ts: Date.now(),
      });
    }

    return jsonResponse(503, {
      error: 'instagram blocked or response format changed',
      username,
      attempts,
    });
  } catch (e) {
    return jsonResponse(500, { error: e.message || 'fetch failed', username, attempts });
  }
}
