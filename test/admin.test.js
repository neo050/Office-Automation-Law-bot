import { test, before, after } from 'node:test';
import assert  from 'node:assert/strict';
import express from 'express';
import { mountAdmin } from '../src/adminServer.js';
import store   from '../src/conversationStore.js';
import { redis, redisUp } from './helpers.js';

let srv, base, HAVE_REDIS;
const AUTH = 'Basic ' + Buffer.from('admin:secret').toString('base64');

before(async () => {
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASS = 'secret';
  HAVE_REDIS = await redisUp();
  if (HAVE_REDIS) {
    await redis.flushdb();
    await store.recordMessage('972511112222', { direction: 'in', text: 'בדיקה' });
    await store.setMeta('972511112222', { name: 'טסט', folderId: 'F1' });
  }
  const app = express();
  app.use(express.json());
  mountAdmin(app);
  srv  = app.listen(0);
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { srv?.close(); try { await redis.quit(); } catch {} });

const GET  = (p, auth = AUTH) => fetch(base + p, { headers: { Authorization: auth } });
const send = (method) => (p, body) => fetch(base + p, {
  method, headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
const POST = send('POST');
const PUT  = send('PUT');

test('admin: requires auth', async () => {
  assert.equal((await fetch(base + '/api/conversations')).status, 401);
});

test('admin: lists conversations', async (t) => {
  if (!HAVE_REDIS) return t.skip('no redis');
  const j = await (await GET('/api/conversations')).json();
  assert.equal(j.ok, true);
  assert.equal(j.conversations[0].name, 'טסט');
});

test('admin: returns a thread and marks read', async (t) => {
  if (!HAVE_REDIS) return t.skip('no redis');
  const j = await (await GET('/api/conversations/972511112222')).json();
  assert.equal(j.messages.length, 1);
  assert.equal(j.folderId, 'F1');
});

test('admin: rejects an empty reply', async () => {
  assert.equal((await POST('/api/conversations/972511112222/reply', { text: '' })).status, 400);
});

test('admin: serves the dashboard SPA', async () => {
  const html = await (await GET('/admin')).text();
  assert.match(html, /צ׳אטים עם לקוחות/);
});

test('admin: config GET masks secrets, PUT applies', async () => {
  let j = await (await GET('/api/config')).json();
  assert.ok(Array.isArray(j.settings));
  const apiKey = j.settings.find(s => s.key === 'OPENAI_API_KEY');
  assert.equal(apiKey.secret, true);

  const put = await (await PUT('/api/config', { GRAPH_VERSION: 'v21.0' })).json();
  assert.ok(put.applied.includes('GRAPH_VERSION'));
  j = await (await GET('/api/config')).json();
  assert.equal(j.settings.find(s => s.key === 'GRAPH_VERSION').value, 'v21.0');
});

test('admin: deep service health endpoint responds', async () => {
  const j = await (await GET('/api/health/services')).json();
  assert.equal(typeof j.ok, 'boolean');
  assert.ok(Array.isArray(j.checks));
  assert.ok(j.checks.find(c => c.service === 'Redis'));
});
