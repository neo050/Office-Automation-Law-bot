import { test } from 'node:test';
import assert    from 'node:assert/strict';
import {
  ensureSystemPrompt,
  sanitizeForOpenAI,
  repairHistory
} from '../src/chatHistory.js';

test('ensureSystemPrompt prepends only when missing', () => {
  const without = ensureSystemPrompt([{ role: 'user', content: 'hi' }], 'SYS');
  assert.equal(without[0].role, 'system');
  assert.equal(without[0].content, 'SYS');

  const already = ensureSystemPrompt([{ role: 'system', content: 'X' }], 'SYS');
  assert.equal(already.length, 1);
  assert.equal(already[0].content, 'X');
});

test('sanitizeForOpenAI coerces non-string content to strings', () => {
  const out = sanitizeForOpenAI([
    { role: 'assistant', content: null },
    { role: 'user', content: { a: 1 } },
    { role: 'tool', tool_call_id: 't1', content: { ok: true } }
  ]);
  assert.equal(out[0].content, '');
  assert.equal(typeof out[1].content, 'string');
  assert.equal(typeof out[2].content, 'string');
});

test('repairHistory drops orphan tool messages', () => {
  const { history, report } = repairHistory([
    { role: 'user', content: 'hi' },
    { role: 'tool', tool_call_id: 'ghost', content: '{}' }   // no matching assistant
  ]);
  assert.equal(history.length, 1);
  assert.equal(report.orphanTools, 1);
});

test('repairHistory strips unresolved tool_calls from assistant', () => {
  const { history } = repairHistory([
    { role: 'assistant', content: '', tool_calls: [
      { id: 'a', function: { name: 'f', arguments: '{}' } },
      { id: 'b', function: { name: 'g', arguments: '{}' } }
    ]},
    { role: 'tool', tool_call_id: 'a', content: '{"ok":true}' }   // only 'a' answered
  ]);
  const asst = history.find(m => m.role === 'assistant');
  assert.equal(asst.tool_calls.length, 1);
  assert.equal(asst.tool_calls[0].id, 'a');
});

test('repairHistory removes tool_calls entirely when none resolved', () => {
  const { history } = repairHistory([
    { role: 'assistant', content: 'hello', tool_calls: [
      { id: 'x', function: { name: 'f', arguments: '{}' } }
    ]}
  ]);
  const asst = history.find(m => m.role === 'assistant');
  assert.ok(!asst.tool_calls);
});
