// Shared test helpers (not a test file – no `.test.` in the name).
import http  from 'node:http';
import redis from '../src/redis.js';

/** Spin up a tiny HTTP server. `routes` maps "METHOD /path-prefix" → handler(req,res,body). */
export function mockServer(handler) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => handler(req, res, body));
    });
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ srv, port, base: `http://127.0.0.1:${port}`, close: () => new Promise(r => srv.close(r)) });
    });
  });
}

export const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

/** True if a Redis server answers PING quickly (won't hang when down). */
export async function redisUp() {
  try {
    const ping = redis.ping();
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500));
    const pong = await Promise.race([ping, timeout]);
    return pong === 'PONG';
  } catch {
    try { redis.disconnect(); } catch {}   // stop background reconnection attempts
    return false;
  }
}

export { redis };
