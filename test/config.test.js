import { test, before, after } from 'node:test';
import assert    from 'node:assert/strict';
import cfg, { MASK, SCHEMA } from '../src/config.js';
import { redis, redisUp } from './helpers.js';

const NS      = process.env.REDIS_NS ? `${process.env.REDIS_NS}:` : '';
const CFG_KEY = `${NS}cfg:overrides`;

let HAVE_REDIS = false;
before(async () => { HAVE_REDIS = await redisUp(); });
after(async () => { try { await redis.quit(); } catch {} });

test('config: schema is non-empty and every entry has key+label+group', () => {
  assert.ok(SCHEMA.length > 10);
  for (const s of SCHEMA) {
    assert.ok(s.key && s.label && s.group, `bad schema entry ${JSON.stringify(s)}`);
  }
});

test('config: get() falls back to schema default', async (t) => {
  if (!HAVE_REDIS) return t.skip('no redis');
  await redis.del(CFG_KEY);
  delete process.env.GRAPH_VERSION;
  await cfg.load();
  assert.equal(cfg.get('GRAPH_VERSION'), 'v23.0');
});

test('config: update() persists to Redis, applies to env, and survives a reload', async (t) => {
  if (!HAVE_REDIS) return t.skip('no redis');
  await redis.del(CFG_KEY);
  delete process.env.GRAPH_VERSION;
  await cfg.load();

  const { applied } = await cfg.update({ GRAPH_VERSION: 'v20.0', UNKNOWN_KEY: 'x' });
  assert.deepEqual(applied, ['GRAPH_VERSION']);            // unknown key ignored
  assert.equal(cfg.get('GRAPH_VERSION'), 'v20.0');
  assert.equal(process.env.GRAPH_VERSION, 'v20.0');        // mirrored to env

  // Prove durability: clear the in-memory + env copy, reload purely from Redis.
  delete process.env.GRAPH_VERSION;
  await cfg.load();
  assert.equal(cfg.get('GRAPH_VERSION'), 'v20.0');
});

test('config: requiresRestart is reported for infra keys', async (t) => {
  if (!HAVE_REDIS) return t.skip('no redis');
  await redis.del(CFG_KEY);
  await cfg.load();
  const { requiresRestart } = await cfg.update({ REDIS_HOST: 'redis-prod' });
  assert.equal(requiresRestart, true);
});

test('config: all() masks secrets but reveals presence', async (t) => {
  if (!HAVE_REDIS) return t.skip('no redis');
  await redis.del(CFG_KEY);
  await cfg.load();
  await cfg.update({ OPENAI_API_KEY: 'sk-secret-value' });
  const row = cfg.all().find(r => r.key === 'OPENAI_API_KEY');
  assert.equal(row.secret, true);
  assert.equal(row.isSet, true);
  assert.equal(row.value, MASK);                           // never leaks the secret

  const revealed = cfg.all({ reveal: true }).find(r => r.key === 'OPENAI_API_KEY');
  assert.equal(revealed.value, 'sk-secret-value');
});

test('config: update() ignores an unchanged masked secret', async (t) => {
  if (!HAVE_REDIS) return t.skip('no redis');
  await redis.del(CFG_KEY);
  await cfg.load();
  await cfg.update({ OPENAI_API_KEY: 'sk-real' });
  const { applied } = await cfg.update({ OPENAI_API_KEY: MASK });   // UI sent the mask back
  assert.ok(!applied.includes('OPENAI_API_KEY'));
  assert.equal(cfg.get('OPENAI_API_KEY'), 'sk-real');              // unchanged
});
