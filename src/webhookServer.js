
// ─────────────────────────────────────────────────────────────────────────────
//  src/webhookServer.js  – HTTP only
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import { agentHandle } from './agentLoop.js';
import { queueInboundMedia } from './linkScheduler.js';

const app = express();
app.use(express.json({ limit:'2mb' }));

app.get('/webhook', (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const ok = req.query['hub.mode'] === 'subscribe' &&
            req.query['hub.verify_token'] === verifyToken;
  if (ok) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const value   = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (message) {
      await queueInboundMedia(message); // ✔ loss‑free
      await agentHandle(message);
    }
  } catch (err) {
    console.error('[webhook] handler failed', err);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 8197;
app.listen(PORT, () => console.log('✅ Webhook server listening on', PORT));

process.on('unhandledRejection', err => { console.error('[webhook] unhandledRejection', err); });
