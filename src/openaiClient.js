// ────────────────────────────────────────────────────────────────
//  src/openaiClient.js  ·  Lazy, config-driven OpenAI client
// ────────────────────────────────────────────────────────────────
//  Built lazily (not at import time) so the process can boot without a
//  key, and rebuilt automatically when the key is changed via the UI.
// ────────────────────────────────────────────────────────────────
import { OpenAI } from 'openai';
import cfg        from './config.js';

let client    = null;
let cachedKey = null;

export function openai() {
  const key = cfg.get('OPENAI_API_KEY');
  if (!client || key !== cachedKey) {
    client    = new OpenAI({ apiKey: key || 'missing-key' });
    cachedKey = key;
  }
  return client;
}

export default { openai };
