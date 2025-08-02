// ────────────────────────────────────────────────────────────────
//  src/chatHistory.js   ·   Production build  (v2025-08-02)
//  Utilities for manipulating GPT conversation history + Redis helpers
// ────────────────────────────────────────────────────────────────

import redis       from './redis.js';
import { log }     from './logger.js';

/* ─────────────────────  System‑prompt handling  ───────────────────── */
export function ensureSystemPrompt(history, prompt) {
  if (!history.length || history[0].role !== 'system') {
    return [{ role: 'system', content: prompt }, ...history];
  }
  return history;
}

/* ─────────────────────  Sanitise for OpenAI  ───────────────────── */
export function sanitizeForOpenAI(history) {
  return history.map(m => {
    const msg = { ...m };
    if (msg.role !== 'tool') {
      if (msg.content == null) msg.content = '';
      if (typeof msg.content !== 'string') msg.content = JSON.stringify(msg.content);
    } else {
      if (typeof msg.content !== 'string') msg.content = JSON.stringify(msg.content ?? {});
    }
    return msg;
  });
}

/* ─────────────────────  Repair history structure  ───────────────────── */
export function repairHistory(history) {
  const cleaned = [];
  const report  = { dropped: 0, fixed: 0, orphanTools: 0, removedToolCalls: 0 };

  const pending = []; // assistant msgs awaiting tools
  const clone   = o => JSON.parse(JSON.stringify(o));

  for (const msg of history) {
    if (!msg || !msg.role) { report.dropped++; continue; }

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const a         = clone(msg);
      const ids       = new Set(a.tool_calls.map(tc => tc.id).filter(Boolean));
      const responded = new Set();
      pending.push({ idx: cleaned.length, ids, responded });
      cleaned.push(a);
      continue;
    }

    if (msg.role === 'tool') {
      const id = msg.tool_call_id;
      if (!id) { report.orphanTools++; continue; }
      let frame = null;
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].ids.has(id)) { frame = pending[i]; break; }
      }
      if (!frame) { report.orphanTools++; continue; }
      frame.responded.add(id);
      cleaned.push(clone(msg));
      continue;
    }

    cleaned.push(clone(msg));
  }

  // strip unresolved tool_calls
  for (const frame of pending) {
    const unresolved = [...frame.ids].filter(id => !frame.responded.has(id));
    if (!unresolved.length) continue;
    const assistantMsg = cleaned[frame.idx];
    if (!assistantMsg.tool_calls) continue;
    const before = assistantMsg.tool_calls.length;
    assistantMsg.tool_calls = assistantMsg.tool_calls.filter(tc => !unresolved.includes(tc.id));
    const after  = assistantMsg.tool_calls.length;
    report.removedToolCalls += (before - after);
    if (!assistantMsg.tool_calls.length) delete assistantMsg.tool_calls;
    report.fixed++;
  }

  return { history: cleaned, report };
}

/* ─────────────────────  NEW  ↴  Redis helpers  ───────────────────── */

/**
 * Build a plain‑text transcript string from Redis key.
 * @param {string} convKey – e.g. "conv:+972501234567"
 * @returns {string}
 */
export async function buildLogFromRedis(convKey) {
  log.step('chatHistory.buildLogFromRedis', 'start', { convKey });
  try {
    const raw = await redis.get(convKey);
    if (!raw) return '';

    const arr = JSON.parse(raw);
    const txt = arr
      .filter(m => m.role === 'assistant' || m.role === 'user')
      .map(m => `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join(' / ');

    log.step('chatHistory.buildLogFromRedis', 'done', { len: txt.length });
    return txt;
  } catch (e) {
    log.error('chatHistory.buildLogFromRedis', 'failed', e);
    return '';
  }
}

/**
 * Optionally clear history after persist to keep Redis clean.
 */
export async function clearHistory(convKey) {
  try { await redis.del(convKey); } catch {/* ignore */}
}

export default {
  ensureSystemPrompt,
  sanitizeForOpenAI,
  repairHistory,
  buildLogFromRedis,
  clearHistory
};
