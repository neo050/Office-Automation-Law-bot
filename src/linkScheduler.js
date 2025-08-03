// ────────────────────────────────────────────────────────────────
//  src/linkScheduler.js  ·  Media FIFO, dedup & single-link scheduler  (v2025-08-03)
// ────────────────────────────────────────────────────────────────
import redis from './redis.js';
import { log } from './logger.js';

/* ───────────── Namespacing (staging / prod) ───────────── */
const NS        = process.env.REDIS_NS ? `${process.env.REDIS_NS}:` : '';
const Q         = phone => `${NS}mediaQ:${phone}`;         // LPUSH / RPOP
const Z_DUE     = `${NS}linkDueZ`;                         // ZSET  phone → due
const H_DIR     = `${NS}linkFolderH`;                      // HASH  phone → folderId
const SEEN_SET  = phone => `${NS}mediaSeen:${phone}`;      // SET   mediaId
const SEEN_TTL  = 60 * 60;                                 // 1 h

/* ───────────── Tunables (shared) ───────────── */
export const MEDIA_Q_MAX = 50;
export const MEDIA_Q_TTL = 60 * 10;            // 10 min
export const LINK_DELAY  = 5 * 60 * 1000;      // 5 min

/* ───────── enqueue (loss-free + dedup) ───────── */
export async function queueInboundMedia (msg) {
  const kinds = ['image', 'audio', 'video', 'document', 'sticker'];
  if (!kinds.includes(msg.type)) return;

  const id = msg[msg.type]?.id;
  if (!id) return;

  /* ① per-user dedup */
  const seenKey  = SEEN_SET(msg.from);
  const isDup    = await redis.sismember(seenKey, id);
  if (isDup) return;

  await redis.multi()
    .sadd(seenKey, id).expire(seenKey, SEEN_TTL)
    /* ② FIFO queue */
    .lpush(Q(msg.from), JSON.stringify({ id, type: msg.type }))
    .ltrim(Q(msg.from), 0, MEDIA_Q_MAX - 1)
    .expire(Q(msg.from), MEDIA_Q_TTL)
    .exec();
}

/* ───────── FIFO helpers ───────── */
export async function popNextMedia (phone) {
  const raw = await redis.rpop(Q(phone));
  return raw ? JSON.parse(raw) : null;
}

/* ───────── single-link scheduler ─────────
   保证  1 entry בלבד ב-ZSET לכל phone. */
export async function scheduleFolderLink (phone, folderId) {
  const due = Date.now() + LINK_DELAY;

  const [ , updated ] = await redis.multi()
    /* ZADD GT CH  → מעדכן רק אם התאריך **מאוחר** יותר */
    .zadd(Z_DUE, 'GT', 'CH', due, phone)
    .hset(H_DIR, phone, folderId)
    .exec();

  log.step('linkScheduler.scheduleLink', { phone, due, updated }); // updated=1 אם שונתה רשומה
}

/* ───────── poller helpers ───────── */
export async function getDuePhones (now) {
  /* WITHSCORES → [ phone, score, phone, score … ] */
  return redis.zrangebyscore(Z_DUE, 0, now, 'WITHSCORES');
}

export async function consumePhone () {
  /* ZPOPMIN – אטומי, שולף phone בעל due הקטן ביותר */
  const res = await redis.zpopmin(Z_DUE);
  if (!res.length) return { phone:null, folderId:null };

  const [ phone ] = res;                              // res = [ phone, score ]
  const [ folderId ] = await redis.hmget(H_DIR, phone);
  await redis.hdel(H_DIR, phone);

  log.step('linkScheduler.consumePhone', { phone, folderId });
  return { phone, folderId };
}

/* graceful shutdown */
export async function quitRedis () {
  try { await redis.quit(); } catch {/* ignore */}
}
