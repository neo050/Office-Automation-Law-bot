
// ─────────────────────────────────────────────────────────────────────────────
//  src/webhookServer.js  – HTTP only (webhook + operator dashboard)
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import crypto  from 'node:crypto';
import { agentHandle } from './agentLoop.js';
import { mountAdmin }  from './adminServer.js';
import cfg from './config.js';
import { log } from './logger.js';

const app = express();
// Capture the raw body so we can verify Meta's X-Hub-Signature-256 HMAC.
app.use(express.json({
  limit : '2mb',
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

/* ───────── Webhook signature verification (config-gated) ───────── */
function verifySignature(req) {
  const APP_SECRET = cfg.get('WHATSAPP_APP_SECRET');
  if (!APP_SECRET) return true;                       // not configured → skip (dev)
  const sig = req.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto
    .createHmac('sha256', APP_SECRET)
    .update(req.rawBody || Buffer.alloc(0))
    .digest('hex');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

app.get('/webhook', (req, res) => {
  const verifyToken = cfg.get('WHATSAPP_VERIFY_TOKEN');
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

  /* ⓪ Authenticate the payload before trusting any of it */
  if (!verifySignature(req)) {
    log.error('webhook', 'bad_signature', { ip: req.ip });
    return res.sendStatus(403);
  }

  try {
    /* ① חילוץ הערך הרלוונטי מה-payload */
    const value    = req.body.entry?.[0]?.changes?.[0]?.value;
    const message  = value?.messages?.[0];        // הודעת טקסט / מדיה
    const statuses = value?.statuses;             // delivered / read / failed

    /* ② Echo & Status filtering */
    const MY_WABA = cfg.get('WHATSAPP_BUSINESS_NUMBER'); // "972797290682"

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
    /* ③ עיבוד הודעה אמיתית – agentHandle כבר אחראי על queueInboundMedia */
    if (message) {
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

/* ───────── Operator dashboard (UI + REST API) ───────── */
mountAdmin(app);

const PORT = cfg.get('PORT') || 8197;
app.listen(PORT, () => console.log('✅ Webhook + dashboard listening on', PORT, '· UI: /admin'));

process.on('unhandledRejection', err => { console.error('[webhook] unhandledRejection', err); });
