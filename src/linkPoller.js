// ────────────────────────────────────────────────────────────────
//  src/linkPoller.js   ·   Production build  (v2025-08-02)
//  Purpose  : Polls Redis ZSET for phones whose Drive‑link is due,
//             summarises transcript via GPT, appends RAW+SUMMARY to Drive,
//             sends consolidated WhatsApp link, and logs every step.
//  Interval : configurable via POLL_EVERY env (default 10 000 ms).
//  Depends  : functionsImpl.js (sendWhatsApp, summarizeTranscript,
//                               saveChatBundleUpdate), chatHistory.buildLog…
//  Logging  : uses log.step / log.info / log.error (same conventions).
// ────────────────────────────────────────────────────────────────

import 'dotenv/config';
import {
  getDuePhones,
  consumePhone,
  quitRedis
}                           from './linkScheduler.js';
import {
  sendWhatsApp,
  summarizeTranscript,
  saveChatBundleUpdate
}                           from './functionsImpl.js';
import { buildLogFromRedis } from './chatHistory.js';
import { log }               from './logger.js';

// ─────────────────────  Config  ─────────────────────
const POLL_EVERY = Number(process.env.POLL_EVERY_MS) || 10_000; // 10 sec default
let stopping     = false;

// ─────────────────────  Worker Tick  ─────────────────────
async function tick() {
  if (stopping) return;

  const now = Date.now();
  let phones;

  /* ① fetch due phones */
  try {
    phones = await getDuePhones(now);
  } catch (e) {
    log.error('linkPoller', 'redis_zrange_failed', e);
    return;
  }
  if (!phones.length) return;

  log.info('linkPoller', 'due_phones', { phones });

  for (const phone of phones) {
    log.step('linkPoller', 'process_phone.start', { phone });
    try {
      /* ② consume ZSET & resolve folder */
      const folderId = await consumePhone(phone);
      if (!folderId) {
        log.error('linkPoller', 'folder_missing', { phone });
        continue; // safety – skip
      }

      /* ③ build RAW log from Redis */
      const raw = await buildLogFromRedis(`conv:${phone}`);

      /* ④ GPT summary */
      const { ok: sumOK, summary, error: sumErr } = await summarizeTranscript(raw);
      if (!sumOK) log.error('linkPoller', 'summary_failed', { phone, err: sumErr });

      /* ⑤ append/update Drive bundle */
      const res = await saveChatBundleUpdate({ folderId, raw, summary: summary || '' });
      if (!res.ok) log.error('linkPoller', 'saveBundle_failed', { phone, err: res.error });

      /* ⑥ send consolidated WhatsApp link to client */
      const link = `https://drive.google.com/drive/folders/${folderId}`;
      await sendWhatsApp({ to: phone, text: `סיימנו לקלוט את כלל המסמכים – תוכל לצפות כאן:\n${link}` });

      log.step('linkPoller', 'process_phone.done', { phone });
    } catch (e) {
      log.error('linkPoller', 'process_phone.failed', { phone, err: e });
    }
  }
}

// ─────────────────────  Interval & Shutdown  ─────────────────────
const interval = setInterval(tick, POLL_EVERY);
log.info('linkPoller', 'started', { every_ms: POLL_EVERY });

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  await quitRedis();
  log.info('linkPoller', 'shutdown');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
process.on('unhandledRejection', err => {
  log.error('linkPoller', 'unhandledRejection', err);
});
