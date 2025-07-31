// ─────────────────────────────────────────────────────────────────────────────
//  src/linkPoller.js
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { getDuePhones, consumePhone, quitRedis } from './linkScheduler.js';
import { sendWhatsApp } from './functionsImpl.js';

const POLL_EVERY = 10_000; // 10 sec
let stopping = false;

async function tick() {
  if (stopping) return;
  const now = Date.now();
  let phones;
  try {
    phones = await getDuePhones(now);
  } catch (e) {
    console.error('[poller] Redis zrangebyscore failed:', e);
    return;
  }
  if (!phones.length) return;

  console.log(`[poller] sending folder links to:`, phones);
  for (const p of phones) {
    try {
      const folderId = await consumePhone(p);
      if (!folderId) continue; // safety
      const link = `https://drive.google.com/drive/folders/${folderId}`;
      await sendWhatsApp({ to: p, text: `סיימנו לקלוט את כלל המסמכים – תוכל לצפות כאן:\n${link}` });
    } catch (e) {
      console.error('[poller] failed for', p, e);
    }
  }
}

const interval = setInterval(tick, POLL_EVERY);
console.log('📡 linkPoller running every', POLL_EVERY/1000, 'sec');

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
process.on('unhandledRejection', err => { console.error('[poller] unhandledRejection', err); });

async function shutdown() {
  if (stopping) return; stopping = true;
  clearInterval(interval);
  await quitRedis();
  process.exit(0);
}