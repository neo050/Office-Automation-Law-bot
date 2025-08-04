// ────────────────────────────────────────────────────────────────
//  src/functionsImpl.js · Production build  (v2025-08-04)
//  Implements: client lookup, folder mgmt, media save, WhatsApp send,
//              GPT summary, Drive append-update bundle.
// ────────────────────────────────────────────────────────────────

import { drive }                    from './gAuth.js';
import axios                        from 'axios';
import dayjs                        from 'dayjs';
import { OpenAI }                   from 'openai';
import { log }                      from './logger.js';
import { ensureFolder }             from './driveUtils.js';
import { saveMedia as saveWhatsApp } from './media.js';
import {
  upsertClientRow,
  updateDriveFolderId
}                                   from './clientLookup.js';
import { PHONE_RE, NAME_RE }        from './validators.js';

// ─────────────────────  OpenAI init  ─────────────────────
const openai        = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || 'gpt-4o-mini';

// ─────────────────────  1. lookupClient  ─────────────────────
export async function lookupClient({ id, fullName = '', phone = '' }) {
  log.step('functions.lookupClient', 'start', { id });

  /* ולידציה קשיחה לפני גישה לגוגל-Sheets */
  if (!PHONE_RE.test(phone)) {
    log.error('lookupClient', 'missing_or_bad_phone', { id, phone });
    return { ok: false, error: 'missing_phone' };
  }
  if (!NAME_RE.test(fullName)) {
    log.error('lookupClient', 'missing_or_bad_fullName', { id, fullName });
    return { ok: false, error: 'missing_fullName' };
  }

  try {
    const res = await upsertClientRow({ id, fullName, phone });
    return { ok: true, ...res };
  } catch (e) {
    log.error('functions.lookupClient', 'failed', e);
    return { ok: false, error: e.message };
  }
}

// ─────────────────────  2. createFolder  ─────────────────────
export async function createFolder({ id, fullName, phone = '' }) {
  log.step('functions.createFolder', 'start', { id, fullName });

  /* same validation as lookupClient */
  if (!PHONE_RE.test(phone)) {
    log.error('createFolder', 'missing_or_bad_phone', { id, phone });
    return { ok: false, error: 'missing_phone' };
  }
  if (!NAME_RE.test(fullName)) {
    log.error('createFolder', 'missing_or_bad_fullName', { id, fullName });
    return { ok: false, error: 'missing_fullName' };
  }

  try {
    const { rowNumber, driveFolderId } =
      await upsertClientRow({ id, fullName, phone });

    if (driveFolderId)
      return { ok: true, folderId: driveFolderId, rowNumber };

    const rootId     = process.env.DRIVE_ROOT_ID;
    const folderName = `${id}_${fullName.replace(/\s+/g, '')}`;
    const folder     = await ensureFolder(folderName, rootId);

    await updateDriveFolderId(rowNumber, folder.id);
    return { ok: true, folderId: folder.id, rowNumber };
  } catch (e) {
    log.error('functions.createFolder', 'failed', e);
    return { ok: false, error: e.message };
  }
}

// ─────────────────────  3. saveMedia  ─────────────────────
export async function saveMedia({ folderId, mediaId, mediaType }) {
  log.step('functions.saveMedia', 'start', { folderId, mediaId, mediaType });

  const allowed = ['image', 'audio', 'video', 'document', 'sticker'];
  if (!mediaId || !allowed.includes(mediaType))
    return { ok: false, error: 'bad_media_args' };

  try {
    const url = await saveWhatsApp(
      { [mediaType]: { id: mediaId }, type: mediaType },
      process.env.PERMANENT_WABA_TOKEN,
      folderId
    );
    return { ok: true, url };
  } catch (e) {
    const fbErr = e.response?.data?.error;
    log.error('functions.saveMedia', 'failed', fbErr || e);

    if (fbErr?.code === 190 || e.response?.status === 401)
      return { ok: false, error: 'token_expired' };
    if (fbErr?.code === 10)
      return { ok: false, error: 'fb_permission_missing', details: fbErr.message };
    if (fbErr?.code === 100)
      return { ok: false, error: 'bad_media_id' };

    return { ok: false, error: fbErr?.message || e.message };
  }
}

// ─────────────────────  4. sendWhatsApp  ─────────────────────
export async function sendWhatsApp({ to, text = null, templateName = null }) {
  log.step('functions.sendWhatsApp', 'start', { to, templateName });

  const TOKEN         = process.env.PERMANENT_WABA_TOKEN;
  const PHONE_ID      = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v23.0';

  const body = templateName
    ? {
        messaging_product: 'whatsapp',
        to,
        type     : 'template',
        template : { name: templateName, language: { code: 'he' } }
      }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      };

  try {
    await axios.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`,
      body,
      {
        headers: {
          Authorization : `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 7000
      }
    );
    return { ok: true };
  } catch (e) {
    const fbErr = e.response?.data?.error;
    log.error('functions.sendWhatsApp', 'failed', fbErr || e);
    if (e.response?.status === 401 && fbErr?.code === 190)
      return { ok: false, error: 'token_expired' };
    return { ok: false, error: fbErr?.message || e.message };
  }
}

// ─────────────────────  5. GPT summary  ─────────────────────
export async function summarizeTranscript(transcript) {
  log.step('functions.summarizeTranscript', 'start');

  try {
    const { choices } = await openai.chat.completions.create({
      model       : SUMMARY_MODEL,
      temperature : 0.3,
      max_tokens  : 400,
      messages    : [
        {
          role   : 'system',
          content:
            'אתה עורך-סיכום במשרד עורכי-דין. הפק תקציר פורמלי הכולל:\n' +
            '• פרטי זיהוי ומידע ללקוח.\n' +
            '• סוגי תיקים / נזקים רלוונטיים.\n' +
            '• מסמכים שהתקבלו או חסרים.\n' +
            '• פעולות המשך ותזכורות.\n' +
            'השתמש בעברית רהוטה ותמציתית.'
        },
        {
          role   : 'user',
          content: `שיחה מלאה:\n\n${transcript}\n\n---\nסכם בהתאם להנחיות.`
        }
      ]
    });

    const summary = choices[0].message.content.trim();
    log.step('functions.summarizeTranscript', 'done');
    return { ok: true, summary };
  } catch (e) {
    log.error('functions.summarizeTranscript', 'failed', e);
    return { ok: false, error: e.message };
  }
}

// ─────────────────────  6. Drive append/update  ─────────────────────
export async function saveChatBundleUpdate({ folderId, raw, summary }) {
  log.step('functions.saveChatBundleUpdate', 'start', { folderId });

  const stamp  = dayjs().format('YYYY-MM-DD HH:mm');
  const header = `\n\n### ${stamp}\n`;

  /** helper: append or create text file */
  const upsert = async (name, body) => {
    const { data: { files } } = await drive.files.list({
      q        : `'${folderId}' in parents and name='${name}' and trashed=false`,
      fields   : 'files(id)',
      spaces   : 'drive',
      pageSize : 1
    });

    if (files.length) {
      const id       = files[0].id;
      const download = await drive.files.get(
        { fileId: id, alt: 'media' },
        { responseType: 'stream' }
      );

      const chunks = [];
      for await (const c of download.data) chunks.push(c);
      const existing = Buffer.concat(chunks).toString('utf8');
      const combined = existing + header + body;

      await drive.files.update({
        fileId     : id,
        media      : { mimeType: 'text/plain', body: combined },
        requestBody: { mimeType: 'text/plain' }
      });
      return id;
    }

    const { data } = await drive.files.create({
      requestBody: { name, mimeType: 'text/plain', parents: [folderId] },
      media      : { mimeType: 'text/plain', body: header + body },
      fields     : 'id'
    });
    return data.id;
  };

  try {
    await Promise.all([
      upsert('chat.txt'   , raw     ),
      upsert('summary.txt', summary )
    ]);
    log.step('functions.saveChatBundleUpdate', 'done');
    return { ok: true };
  } catch (e) {
    log.error('functions.saveChatBundleUpdate', 'failed', e.response?.data || e);
    return { ok: false, error: e.message };
  }
}

// ─────────────────────  Back-compat: saveChatLog  ─────────────────────
export async function saveChatLog({ folderId, log: chatLog }) {
  return saveChatBundleUpdate({ folderId, raw: chatLog, summary: '' });
}

// ─────────────────────  Exports  ─────────────────────
export default {
  lookupClient,
  createFolder,
  saveMedia,
  sendWhatsApp,
  summarizeTranscript,
  saveChatBundleUpdate,
  saveChatLog // legacy
};
