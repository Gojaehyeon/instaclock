import { signState } from '../../lib/oauth.js';

export const config = { runtime: 'edge' };

const APP_ID = process.env.IG_APP_ID;
const REDIRECT_URI = 'https://instaclock.gojaehyun.com/api/oauth/callback';
const SCOPE = 'instagram_business_basic,instagram_business_manage_insights';

export default async function handler(request) {
  if (!APP_ID) {
    return new Response('IG_APP_ID not configured', { status: 500 });
  }

  const url = new URL(request.url);
  const deviceId = url.searchParams.get('d') || '';

  const state = await signState({ d: deviceId });

  const auth = new URL('https://www.instagram.com/oauth/authorize');
  auth.searchParams.set('client_id', APP_ID);
  auth.searchParams.set('redirect_uri', REDIRECT_URI);
  auth.searchParams.set('scope', SCOPE);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('state', state);

  return Response.redirect(auth.toString(), 302);
}
