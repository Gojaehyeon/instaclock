const SECRET = process.env.OAUTH_STATE_SECRET;
const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

let keyPromise;
function getKey() {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      'raw',
      enc.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }
  return keyPromise;
}

async function hmac(data) {
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

export async function signState(payload) {
  const body = b64urlEncode(enc.encode(JSON.stringify({ ...payload, t: Date.now() })));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

export async function verifyState(state, maxAgeMs = 600_000) {
  if (!state) return null;
  const dot = state.indexOf('.');
  if (dot < 0) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = await hmac(body);
  if (sig !== expected) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body));
  } catch {
    return null;
  }
  if (typeof payload?.t !== 'number') return null;
  if (Date.now() - payload.t > maxAgeMs) return null;
  return payload;
}
