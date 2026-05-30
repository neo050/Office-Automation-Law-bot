import { test } from 'node:test';
import assert    from 'node:assert/strict';
import { PHONE_RE, NAME_RE } from '../src/validators.js';

test('PHONE_RE accepts 10–12 digit numbers, rejects junk', () => {
  assert.ok(PHONE_RE.test('972501234567'));
  assert.ok(PHONE_RE.test('0501234567'));
  assert.ok(!PHONE_RE.test('123'));            // too short
  assert.ok(!PHONE_RE.test('+972501234567'));  // '+' not allowed
  assert.ok(!PHONE_RE.test('97250123456789')); // too long
});

test('NAME_RE accepts multi-word Hebrew/Latin names', () => {
  assert.ok(NAME_RE.test('משה כהן'));
  assert.ok(NAME_RE.test('John Doe'));
  assert.ok(NAME_RE.test('דנה לוי כהן'));
  assert.ok(!NAME_RE.test('משה'));   // single word
  assert.ok(!NAME_RE.test('a b'));   // single letters
  assert.ok(!NAME_RE.test(''));
});
