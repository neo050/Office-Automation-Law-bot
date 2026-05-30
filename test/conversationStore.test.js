import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import store  from '../src/conversationStore.js';
import { redis, redisUp } from './helpers.js';

let HAVE_REDIS = false;
before(async () => { HAVE_REDIS = await redisUp(); if (HAVE_REDIS) await redis.flushdb(); });
after(async () => { try { await redis.quit(); } catch {} });

test('conversationStore: records, indexes, unread, media, markRead', { skip: undefined }, async (t) => {
  if (!HAVE_REDIS) return t.skip('no redis');
  await redis.flushdb();
  const p1 = '972500000001', p2 = '972500000002';

  await store.recordMessage(p1, { direction: 'in',  text: 'שלום' });
  await new Promise(r => setTimeout(r, 5));
  await store.recordMessage(p1, { direction: 'out', text: 'בוקר טוב' });
  await store.recordMessage(p1, { direction: 'in',  type: 'image', mediaId: 'abc' });
  await store.setMeta(p1, { name: 'משה כהן', folderId: 'F1', state: 'active' });

  await store.recordMessage(p2, { direction: 'in', text: 'תאונה' });

  const list = await store.listConversations({});
  assert.equal(list.length, 2);
  assert.equal(list[0].phone, p2, 'most-recent first');

  const c1 = list.find(c => c.phone === p1);
  assert.equal(c1.name, 'משה כהן');
  assert.equal(c1.folderId, 'F1');
  assert.equal(c1.unread, 1, 'in→out(reset)→in ⇒ 1');

  const convo = await store.getConversation(p1);
  assert.equal(convo.messages.length, 3);
  assert.equal(convo.messages[0].text, 'שלום');
  assert.equal(convo.messages[2].type, 'image');

  await store.markRead(p1);
  assert.equal((await store.getConversation(p1)).unread, 0);
});

test('conversationStore: setMeta makes an empty conversation visible', async (t) => {
  if (!HAVE_REDIS) return t.skip('no redis');
  await redis.flushdb();
  await store.setMeta('972599999999', { name: 'ללא הודעות' });
  const list = await store.listConversations({});
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'ללא הודעות');
});
