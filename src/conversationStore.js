// ────────────────────────────────────────────────────────────────
//  src/conversationStore.js  ·  Conversation persistence for the UI
// ────────────────────────────────────────────────────────────────
//  Stores a durable, UI-friendly record of every inbound/outbound
//  message, independent of the GPT "history" used for tool-calling.
//
//  Redis layout (namespaced):
//    chatlog:{phone}   – LIST  of JSON message rows (capped, FIFO)
//    chatmeta:{phone}  – HASH  { name, folderId, lastText, lastTs,
//                                lastDir, unread, state }
//    chats:index       – ZSET  phone → lastActivity (ms) for sorting
// ────────────────────────────────────────────────────────────────
import redis     from './redis.js';
import { log }   from './logger.js';

const NS         = process.env.REDIS_NS ? `${process.env.REDIS_NS}:` : '';
const LOG_KEY    = phone => `${NS}chatlog:${phone}`;
const META_KEY   = phone => `${NS}chatmeta:${phone}`;
const INDEX_KEY  = `${NS}chats:index`;

const MAX_MESSAGES = Number(process.env.CHAT_LOG_MAX) || 1000;
const TTL_SEC      = Number(process.env.CHAT_LOG_TTL_SEC) || 60 * 60 * 24 * 60; // 60 d

/**
 * Append a single message to a conversation and refresh metadata/index.
 * Never throws – persistence must not break the messaging flow.
 *
 * @param {string} phone
 * @param {object} m
 * @param {'in'|'out'} m.direction
 * @param {string}     [m.type='text']
 * @param {string}     [m.text='']
 * @param {string|null}[m.mediaId=null]
 * @param {number}     [m.ts=Date.now()]
 */
export async function recordMessage(phone, {
  direction,
  type     = 'text',
  text     = '',
  mediaId  = null,
  ts       = Date.now()
} = {}) {
  if (!phone || (direction !== 'in' && direction !== 'out')) return;

  const preview = (text && text.trim()) ? text.trim().slice(0, 200) : `[${type}]`;
  const row     = JSON.stringify({ direction, type, text: text || '', mediaId, ts });

  try {
    const tx = redis.multi()
      .rpush(LOG_KEY(phone), row)
      .ltrim(LOG_KEY(phone), -MAX_MESSAGES, -1)
      .expire(LOG_KEY(phone), TTL_SEC)
      .zadd(INDEX_KEY, ts, phone)
      .hset(META_KEY(phone), 'lastText', preview, 'lastTs', ts, 'lastDir', direction)
      .expire(META_KEY(phone), TTL_SEC);

    // Inbound bumps the unread counter; outbound clears it (we replied).
    if (direction === 'in') tx.hincrby(META_KEY(phone), 'unread', 1);
    else                    tx.hset(META_KEY(phone), 'unread', 0);

    await tx.exec();
  } catch (e) {
    log.error('conversationStore.recordMessage', 'failed', { phone, err: e.message });
  }
}

/** Merge metadata fields (name / folderId / state …) for a conversation. */
export async function setMeta(phone, fields = {}) {
  if (!phone) return;
  const flat = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    flat.push(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  if (!flat.length) return;
  try {
    await redis.multi()
      .hset(META_KEY(phone), ...flat)
      .expire(META_KEY(phone), TTL_SEC)
      // make sure the conversation shows up even before its first message
      .zadd(INDEX_KEY, 'NX', Date.now(), phone)
      .exec();
  } catch (e) {
    log.error('conversationStore.setMeta', 'failed', { phone, err: e.message });
  }
}

/** Reset the unread counter (called when an operator opens the thread). */
export async function markRead(phone) {
  if (!phone) return;
  try { await redis.hset(META_KEY(phone), 'unread', 0); }
  catch (e) { log.error('conversationStore.markRead', 'failed', { phone, err: e.message }); }
}

/**
 * List conversations sorted by most-recent activity.
 * @returns {Promise<Array<{phone,name,folderId,lastText,lastTs,lastDir,unread,state}>>}
 */
export async function listConversations({ limit = 200 } = {}) {
  try {
    const flat = await redis.zrevrange(INDEX_KEY, 0, limit - 1, 'WITHSCORES');
    if (!flat.length) return [];

    const phones = [];
    for (let i = 0; i < flat.length; i += 2) phones.push(flat[i]);

    const pipe = redis.pipeline();
    phones.forEach(p => pipe.hgetall(META_KEY(p)));
    const metas = await pipe.exec();

    return phones.map((phone, i) => {
      const meta = (metas[i] && metas[i][1]) || {};
      return {
        phone,
        name     : meta.name     || null,
        folderId : meta.folderId || null,
        state    : meta.state    || null,
        lastText : meta.lastText || '',
        lastTs   : Number(meta.lastTs) || 0,
        lastDir  : meta.lastDir  || null,
        unread   : Number(meta.unread) || 0
      };
    });
  } catch (e) {
    log.error('conversationStore.listConversations', 'failed', e.message);
    return [];
  }
}

/** Fetch the message thread (oldest → newest) plus metadata for one phone. */
export async function getConversation(phone, { limit = 500 } = {}) {
  try {
    const [rows, meta] = await Promise.all([
      redis.lrange(LOG_KEY(phone), -limit, -1),
      redis.hgetall(META_KEY(phone))
    ]);

    const messages = rows.map(r => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean);

    return {
      phone,
      name     : meta?.name     || null,
      folderId : meta?.folderId || null,
      state    : meta?.state    || null,
      unread   : Number(meta?.unread) || 0,
      messages
    };
  } catch (e) {
    log.error('conversationStore.getConversation', 'failed', { phone, err: e.message });
    return { phone, name: null, folderId: null, state: null, unread: 0, messages: [] };
  }
}

export default {
  recordMessage,
  setMeta,
  markRead,
  listConversations,
  getConversation
};
