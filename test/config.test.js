import { test } from 'node:test';
import assert    from 'node:assert/strict';
import fs        from 'node:fs';
import cfg, { MASK, SCHEMA } from '../src/config.js';

const FILE = process.env.RUNTIME_CONFIG_FILE;

test('config: schema is non-empty and every entry has key+label+group', () => {
  assert.ok(SCHEMA.length > 10);
  for (const s of SCHEMA) {
    assert.ok(s.key && s.label && s.group, `bad schema entry ${JSON.stringify(s)}`);
  }
});

test('config: get() falls back to schema default', () => {
  delete process.env.GRAPH_VERSION;
  fs.rmSync(FILE, { force: true });
  cfg.load();
  assert.equal(cfg.get('GRAPH_VERSION'), 'v23.0');
});

test('config: update() persists, applies to process.env, and reloads', () => {
  fs.rmSync(FILE, { force: true });
  cfg.load();

  const { applied } = cfg.update({ GRAPH_VERSION: 'v20.0', UNKNOWN_KEY: 'x' });
  assert.deepEqual(applied, ['GRAPH_VERSION']);            // unknown key ignored
  assert.equal(cfg.get('GRAPH_VERSION'), 'v20.0');
  assert.equal(process.env.GRAPH_VERSION, 'v20.0');        // mirrored to env

  // persisted to disk and survives a fresh load
  assert.ok(fs.existsSync(FILE));
  cfg.load();
  assert.equal(cfg.get('GRAPH_VERSION'), 'v20.0');
});

test('config: requiresRestart is reported for infra keys', () => {
  const { requiresRestart } = cfg.update({ REDIS_HOST: 'redis-prod' });
  assert.equal(requiresRestart, true);
});

test('config: all() masks secrets but reveals presence', () => {
  cfg.update({ OPENAI_API_KEY: 'sk-secret-value' });
  const row = cfg.all().find(r => r.key === 'OPENAI_API_KEY');
  assert.equal(row.secret, true);
  assert.equal(row.isSet, true);
  assert.equal(row.value, MASK);                           // never leaks the secret

  const revealed = cfg.all({ reveal: true }).find(r => r.key === 'OPENAI_API_KEY');
  assert.equal(revealed.value, 'sk-secret-value');
});

test('config: update() ignores an unchanged masked secret', () => {
  cfg.update({ OPENAI_API_KEY: 'sk-real' });
  const { applied } = cfg.update({ OPENAI_API_KEY: MASK });   // UI sent the mask back
  assert.ok(!applied.includes('OPENAI_API_KEY'));
  assert.equal(cfg.get('OPENAI_API_KEY'), 'sk-real');         // unchanged
});
