// ────────────────────────────────────────────────────────────────
//  src/linkPoller.js   ·   Production build  (v2025-08-03)
// ────────────────────────────────────────────────────────────────
import 'dotenv/config';
import {
  getDuePhones,
  consumePhone,
  quitRedis
} from './linkScheduler.js';
import {
  sendWhatsApp,
  summarizeTranscript,
  saveChatBundleUpdate
} from './functionsImpl.js';
import { buildLogFromRedis } from './chatHistory.js';
import { log } from './logger.js';

/* ───────── Config ───────── */
const POLL_EVERY = Number(process.env.POLL_EVERY_MS) || 10_000; // 10 s
let   stopping   = false;

/* ───────── Worker Tick ───────── */
async function tick () {
  if (stopping) return;
  const now = Date.now();

  let rows;
  try {
    rows = await getDuePhones(now);     // [ phone, score, phone, score … ]
  } catch (e) {
    log.error('linkPoller', 'redis_zrange_failed', e);
    return;
  }
  if (!rows.length) return;

  /* parse WITHSCORES flat array */
  const phones = [];
  for (let i = 0; i < rows.length; i += 2) phones.push(rows[i]);

  log.info('linkPoller', 'due_phones', { phones });

  for (;;) {
    const { phone, folderId } = await consumePhone();
    if (!phone) break;                 // queue empty
    if (!folderId) {
      log.error('linkPoller', 'folder_missing', { phone });
      continue;
    }

    log.step('linkPoller', 'process.start', { phone });

    try {
      /* build RAW transcript */
      const raw = await buildLogFromRedis(`conv:${phone}`);

      /* GPT summary */
      const { ok: sumOK, summary, error: sumErr } = await summarizeTranscript(raw);
      if (!sumOK) log.error('linkPoller', 'summary_failed', { phone, err: sumErr });

      /* append / update bundle */
      const r = await saveChatBundleUpdate({ folderId, raw, summary: summary || '' });
      if (!r.ok) log.error('linkPoller', 'saveBundle_failed', { phone, err: r.error });

      /* send Drive link */
      const link = `https://drive.google.com/drive/folders/${folderId}`;
      await sendWhatsApp({
        to  : phone,
        text: `סיימנו לקלוט את כלל המסמכים – תוכל לצפות כאן:\n${link}`
      });

      log.step('linkPoller', 'process.done', { phone });
    } catch (e) {
      log.error('linkPoller', 'process_failed', { phone, err: e });
    }
  }
}

/* ───────── Interval & Shutdown ───────── */
const interval = setInterval(tick, POLL_EVERY);
log.info('linkPoller', 'started', { every_ms: POLL_EVERY });

async function shutdown () {
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
