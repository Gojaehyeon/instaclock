import http from 'node:http';
import handler from './lib/follower.js';

const PORT = Number(process.env.PORT || 3001);

http
  .createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname !== '/api/follower') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    try {
      const request = new Request(`http://localhost${req.url}`);
      const response = await handler(request);
      const body = await response.text();
      const headers = {};
      response.headers.forEach((v, k) => {
        headers[k] = v;
      });
      headers['Access-Control-Allow-Origin'] = '*';
      res.writeHead(response.status, headers);
      res.end(body);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e?.message || 'server error' }));
    }
  })
  .listen(PORT, () => {
    console.log(`instaclock proxy listening on :${PORT}`);
  });
