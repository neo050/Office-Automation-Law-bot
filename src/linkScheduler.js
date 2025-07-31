// ─────────────────────────────────────────────────────────────────────────────
// linkScheduler.js  ·  Media FIFO, dedup & single‑link scheduler  (31‑Jul‑25)
// ─────────────────────────────────────────────────────────────────────────────
import redis from './redis.js';

/* ─────────────── Namespacing (staging / prod) ─────────────── */
const NS        = process.env.REDIS_NS ? `${process.env.REDIS_NS}:` : '';
const Q         = phone => `${NS}mediaQ:${phone}`;        // LPUSH / RPOP
const Z_DUE     = `${NS}linkDueZ`;                        // ZSET phone→due
const H_DIR     = `${NS}linkFolderH`;                     // HASH phone→folderId
const SEEN_SET  = phone => `${NS}mediaSeen:${phone}`;     // SET  mediaId
const SEEN_TTL  = 60 * 60;                                // 1 h

/* ─────────────── Tunables (shared) ─────────────── */
export const MEDIA_Q_MAX  = 50;
export const MEDIA_Q_TTL  = 60 * 10;      // 10 min
export const LINK_DELAY   = 5 * 60 * 1000;// 5 min (300 000 ms)

/* ───────────────── enqueue (loss‑free + dedup) ───────────────── */
export async function queueInboundMedia(msg) {
  const kinds = ['image', 'audio', 'video', 'document', 'sticker'];
  if (!kinds.includes(msg.type)) return;

  const id = msg[msg.type]?.id;
  if (!id) return;

  /* ---- ① Dedup per user ---- */
  const seenKey = SEEN_SET(msg.from);
  const already = await redis.sismember(seenKey, id);
  if (already) return;                           // אותו קובץ – מדלגים

  await redis
    .multi()
    .sadd(seenKey, id)                           // זוכר שראינו
    .expire(seenKey, SEEN_TTL)
    /* ---- ② Push לתור FIFO ---- */
    .lpush(Q(msg.from), JSON.stringify({ id, type: msg.type }))
    .ltrim(Q(msg.from), 0, MEDIA_Q_MAX - 1)
    .expire(Q(msg.from), MEDIA_Q_TTL)
    .exec();
}

/* ───────────────── FIFO helpers ───────────────── */
export async function popNextMedia(phone) {
  const raw = await redis.rpop(Q(phone));        // oldest → FIFO
  return raw ? JSON.parse(raw) : null;
}

/* ───────────────── single‑link scheduler ───────────────── */
export async function scheduleFolderLink(phone, folderId) {
  const due = Date.now() + LINK_DELAY;
  await redis
    .multi()
    .zadd(Z_DUE, due, phone)
    .hset(H_DIR, phone, folderId)
    .exec();
}

/*  poller helpers  */
export async function getDuePhones(now) {
  return redis.zrangebyscore(Z_DUE, 0, now);
}
export async function consumePhone(phone) {
  // זורקים מה‑ZSET לפני שליחה כדי למנוע מרוץ כפול
  const [, [ , folderId ]] = await redis
    .multi()
    .zrem(Z_DUE, phone)
    .hget(H_DIR, phone)
    .hdel(H_DIR, phone)
    .exec();
  return folderId;   // יכול להיות null
}

/* graceful shutdown */
export async function quitRedis() {
  try { await redis.quit(); } catch {/* ignore */}
}
