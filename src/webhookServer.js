
// ─────────────────────────────────────────────────────────────────────────────
//  src/webhookServer.js  – HTTP only
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import { agentHandle } from './agentLoop.js';
import { queueInboundMedia } from './linkScheduler.js';
import { log } from './logger.js';

const app = express();
app.use(express.json({ limit:'2mb' }));

app.get('/webhook', (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const ok = req.query['hub.mode'] === 'subscribe' &&
            req.query['hub.verify_token'] === verifyToken;
  if (ok) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

const DROP_TYPES = ['unsupported', 'reaction', 'location'];

// ───────────────────────────────────────────────
// POST /webhook  – Meta callback (messages + statuses)
// ───────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const t0 = Date.now();                                           // מטריצת זמן לבנצ'מרק

  try {
    /* ① חילוץ הערך הרלוונטי מה-payload */
    const value    = req.body.entry?.[0]?.changes?.[0]?.value;
    const message  = value?.messages?.[0];        // הודעת טקסט / מדיה
    const statuses = value?.statuses;             // delivered / read / failed

    /* ② Echo & Status filtering */
    const MY_WABA = process.env.WHATSAPP_BUSINESS_NUMBER; // "972797290682"

    if (message?.from === MY_WABA) {
      log.debug('webhook', 'echo_skip', { from: message.from });
      return res.sendStatus(200);
    }

    if (statuses?.length) {
      log.debug('webhook', 'status_skip', { statuses });
      return res.sendStatus(200);
    }
    if (message && DROP_TYPES.includes(message.type)) {
        log.info('webhook', 'drop_placeholder', { from: message.from, type: message.type });
        return res.sendStatus(200);          // ✨ לא נכנס ל-agentLoop
    }
    /* ③ עיבוד הודעה אמיתית */
    if (message) {
      log.step('webhook', 'queueInboundMedia.start', { from: message.from, type: message.type });
      await queueInboundMedia(message);

      log.step('webhook', 'agentHandle.start', { from: message.from, type: message.type });
      await agentHandle(message);
    }
  } catch (err) {
    log.error('webhook', 'handler_failed', err);
    // חזרה 200 גם במקרה של שגיאה כדי למנוע re-delivery אינסופי ממטא
  }

  /* ④ סיום */
  res.sendStatus(200);
  log.info('webhook', 'done', { ms: Date.now() - t0 });
});

const PORT = process.env.PORT || 8197;
app.listen(PORT, () => console.log('✅ Webhook server listening on', PORT));

process.on('unhandledRejection', err => { console.error('[webhook] unhandledRejection', err); });
