/** Ensure system prompt is first. */
export function ensureSystemPrompt(history, prompt) {
  if (!history.length || history[0].role !== 'system') {
    return [{ role: 'system', content: prompt }, ...history];
  }
  return history;
}

/** Sanitize history for OpenAI (no null content, tool content is string). */
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

/**
 * Repair OpenAI chat history so it's valid:
 * - Assistant with tool_calls must be followed by matching tool messages.
 * - Orphan tools/messages are dropped.
 */
export function repairHistory(history) {
  const cleaned = [];
  const report  = { dropped: 0, fixed: 0, orphanTools: 0, removedToolCalls: 0 };

  const pending = []; // stack of assistant msgs awaiting tools
  const clone = o => JSON.parse(JSON.stringify(o));

  for (const msg of history) {
    if (!msg || !msg.role) { report.dropped++; continue; }

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const a = clone(msg);
      const ids = new Set(a.tool_calls.map(tc => tc.id).filter(Boolean));
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

  // remove unresolved ids
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