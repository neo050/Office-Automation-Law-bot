import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import cfg    from '../src/config.js';
import { checkOpenAI, checkRedis } from '../src/diagnostics.js';
import { mockServer, json, redis, redisUp } from './helpers.js';

let server;
before(async () => {
  server = await mockServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      if (req.headers.authorization === 'Bearer good')
        return json(res, 200, { data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] });
      return json(res, 401, { error: { message: 'invalid api key' } });
    }
    json(res, 404, {});
  });
  cfg.update({ OPENAI_BASE: server.base });
});
after(async () => { await server.close(); try { await redis.quit(); } catch {} });

test('checkOpenAI: ok with a valid key', async () => {
  cfg.update({ OPENAI_API_KEY: 'good' });
  const r = await checkOpenAI();
  assert.equal(r.status, 'ok');
  assert.match(r.detail, /2 models/);
});

test('checkOpenAI: fail with a bad key', async () => {
  cfg.update({ OPENAI_API_KEY: 'bad' });
  const r = await checkOpenAI();
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /invalid api key/);
  cfg.update({ OPENAI_API_KEY: 'good' });
});

test('checkRedis: ok when redis is running', async (t) => {
  if (!(await redisUp())) return t.skip('no redis');
  const r = await checkRedis();
  assert.equal(r.status, 'ok');
  assert.equal(r.detail, 'PONG');
});
