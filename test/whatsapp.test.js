import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import cfg    from '../src/config.js';
import { sendWhatsApp } from '../src/functionsImpl.js';
import { checkWhatsApp } from '../src/diagnostics.js';
import { mockServer, json, redis, redisUp } from './helpers.js';

let server, lastRequest, HAVE_REDIS;

before(async () => {
  HAVE_REDIS = await redisUp();
  server = await mockServer((req, res, body) => {
    lastRequest = { method: req.method, url: req.url, auth: req.headers.authorization, body };
    // GET /{ver}/{id}  → phone-number metadata (diagnostics)
    if (req.method === 'GET') {
      if (req.headers.authorization === 'Bearer good')
        return json(res, 200, { display_phone_number: '+972-79-729-0682', verified_name: 'Eden Law' });
      return json(res, 401, { error: { code: 190, message: 'expired' } });
    }
    // POST /{ver}/{id}/messages → send
    if (req.method === 'POST') {
      const ok = req.headers.authorization === 'Bearer good';
      if (ok) return json(res, 200, { messages: [{ id: 'wamid.X' }] });
      return json(res, 401, { error: { code: 190, message: 'token expired' } });
    }
    json(res, 404, {});
  });
  cfg.update({
    GRAPH_BASE: server.base,
    GRAPH_VERSION: 'v23.0',
    WHATSAPP_PHONE_NUMBER_ID: '12345',
    PERMANENT_WABA_TOKEN: 'good'
  });
});

after(async () => { await server.close(); try { await redis.quit(); } catch {} });

test('sendWhatsApp posts to Graph with bearer token and returns ok', async () => {
  const r = await sendWhatsApp({ to: '972500000001', text: 'בדיקה' });
  assert.equal(r.ok, true);
  assert.equal(lastRequest.method, 'POST');
  assert.match(lastRequest.url, /\/v23\.0\/12345\/messages$/);
  assert.equal(lastRequest.auth, 'Bearer good');
  const sent = JSON.parse(lastRequest.body);
  assert.equal(sent.messaging_product, 'whatsapp');
  assert.equal(sent.text.body, 'בדיקה');
});

test('sendWhatsApp mirrors the outbound message into the store', async (t) => {
  if (!HAVE_REDIS) return t.skip('no redis');
  await redis.flushdb();
  await sendWhatsApp({ to: '972500000009', text: 'תועד?' });
  const { default: store } = await import('../src/conversationStore.js');
  const convo = await store.getConversation('972500000009');
  assert.equal(convo.messages.at(-1).direction, 'out');
  assert.equal(convo.messages.at(-1).text, 'תועד?');
});

test('sendWhatsApp maps a 401/code-190 to token_expired', async () => {
  cfg.update({ PERMANENT_WABA_TOKEN: 'bad' });
  const r = await sendWhatsApp({ to: '972500000001', text: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'token_expired');
  cfg.update({ PERMANENT_WABA_TOKEN: 'good' });   // restore
});

test('diagnostics.checkWhatsApp reports ok with verified name', async () => {
  const r = await checkWhatsApp();
  assert.equal(r.status, 'ok');
  assert.match(r.detail, /Eden Law/);
});

test('diagnostics.checkWhatsApp skips when token is missing', async () => {
  cfg.update({ PERMANENT_WABA_TOKEN: '' });
  const r = await checkWhatsApp();
  assert.equal(r.status, 'skip');
  cfg.update({ PERMANENT_WABA_TOKEN: 'good' });
});
