const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function cmd(...args) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`kv ${r.status}: ${text}`);
  }
  const data = await r.json();
  return data.result;
}

export const kv = {
  async get(key) {
    const raw = await cmd('GET', key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  },
  async set(key, value, opts = {}) {
    const args = ['SET', key, JSON.stringify(value)];
    if (opts.ex) args.push('EX', String(opts.ex));
    return cmd(...args);
  },
  async del(key) {
    return cmd('DEL', key);
  },
};
