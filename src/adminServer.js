// ────────────────────────────────────────────────────────────────
//  src/adminServer.js  ·  Operator dashboard (REST API + static SPA)
// ────────────────────────────────────────────────────────────────
//  Mounts on the existing webhook Express app:
//    GET  /admin                              → chat dashboard (SPA)
//    GET  /api/health                         → liveness
//    GET  /api/conversations                  → conversation list
//    GET  /api/conversations/:phone           → full thread (marks read)
//    POST /api/conversations/:phone/read      → reset unread badge
//    POST /api/conversations/:phone/reply     → operator sends a message
//
//  Protected by HTTP Basic auth when ADMIN_USER & ADMIN_PASS are set.
// ────────────────────────────────────────────────────────────────
import express              from 'express';
import path                 from 'node:path';
import { fileURLToPath }    from 'node:url';
import { timingSafeEqual }  from 'node:crypto';
import {
  listConversations,
  getConversation,
  markRead
} from './conversationStore.js';
import { sendWhatsApp } from './functionsImpl.js';
import cfg              from './config.js';
import { checkAll }     from './diagnostics.js';
import { log }          from './logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/* ───────── Basic-auth (constant-time, env-gated) ───────── */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function basicAuth(req, res, next) {
  const USER = process.env.ADMIN_USER;
  const PASS = process.env.ADMIN_PASS;
  if (!USER || !PASS) return next();                 // dev mode: open

  const hdr = req.headers.authorization || '';
  const [scheme, encoded] = hdr.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, p] = Buffer.from(encoded, 'base64').toString().split(':');
    if (safeEqual(u, USER) && safeEqual(p, PASS)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="LawBot Admin"');
  return res.status(401).send('Authentication required');
}

const asInt = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

/**
 * Register dashboard + API routes on the given Express app.
 * @param {import('express').Express} app
 */
export function mountAdmin(app) {
  const api = express.Router();
  api.use(basicAuth);

  api.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Deep health check of every external service (Redis/WhatsApp/OpenAI/Google).
  api.get('/health/services', async (_req, res) => {
    try { res.json({ ok: true, ...(await checkAll()) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Runtime configuration (settings UI) ──
  api.get('/config', (_req, res) =>
    res.json({ ok: true, settings: cfg.all() }));

  api.put('/config', async (req, res) => {
    const updates = req.body && typeof req.body === 'object' ? req.body : {};
    const { applied, requiresRestart } = await cfg.update(updates);
    log.info('adminServer', 'config_updated', { applied });
    res.json({ ok: true, applied, requiresRestart, settings: cfg.all() });
  });

  api.get('/conversations', async (req, res) => {
    const limit = asInt(req.query.limit, 200);
    res.json({ ok: true, conversations: await listConversations({ limit }) });
  });

  api.get('/conversations/:phone', async (req, res) => {
    const { phone } = req.params;
    const limit = asInt(req.query.limit, 500);
    const convo = await getConversation(phone, { limit });
    await markRead(phone);
    res.json({ ok: true, ...convo });
  });

  api.post('/conversations/:phone/read', async (req, res) => {
    await markRead(req.params.phone);
    res.json({ ok: true });
  });

  api.post('/conversations/:phone/reply', async (req, res) => {
    const { phone } = req.params;
    const text = (req.body?.text || '').toString().trim();
    if (!text) return res.status(400).json({ ok: false, error: 'empty_text' });

    // sendWhatsApp records the outbound message in the conversation store.
    const result = await sendWhatsApp({ to: phone, text });
    if (!result.ok) {
      log.error('adminServer', 'reply_failed', { phone, err: result.error });
      return res.status(502).json({ ok: false, error: result.error });
    }
    res.json({ ok: true });
  });

  app.use('/api', api);

  // Static SPA (guarded by the same basic-auth).
  app.get('/admin', basicAuth, (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
  app.use('/admin', basicAuth, express.static(PUBLIC_DIR));

  log.info('adminServer', 'mounted', {
    routes: ['/admin', '/api/conversations'],
    auth  : Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASS)
  });
}

export default { mountAdmin };
