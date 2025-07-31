// src/media.js
// ----------------------------------------------------------------------------
// saveMedia – downloads a WhatsApp media object **once** and streams it ישירות
//              ל-Google Drive. מחזיר קישור-צפייה (webViewLink).
// ----------------------------------------------------------------------------
import axios                     from 'axios';
import { drive }                 from './gAuth.js';   // ✱ auth כבר מטופל שם
import { driveOpts }             from './driveUtils.js';
import { log }                   from './logger.js';

/**  Map helpers  */
const EXT  = { image:'jpg', audio:'ogg', video:'mp4', document:'pdf', sticker:'webp' };
const MIME = { image:'image/jpeg', audio:'audio/ogg', video:'video/mp4',
               document:'application/pdf', sticker:'image/webp' };

/**
 * @param {object} msg          – הודעת-WhatsApp המקורית (entry.messages[0])
 * @param {string} token        – Permanent/Business-token עם scope `whatsapp_*`
 * @param {string} parentId     – ID של תיקיית-Drive קיימת
 * @returns {string} webViewLink
 * @throws  {Error}  עם `code`   ('fb_token_expired' / 'fb_permission' / 'drive_quota' / …)
 */
export async function saveMedia (msg, token, parentId) {
  log.step('media.saveMedia', 'start', { type: msg?.type, parentId });

  /* ───── 1. ולידציה בסיסית ───── */
  const kind = msg?.type;
  if (!kind || !msg[kind]?.id) throw new Error('invalid_whatsapp_media_payload');
  const mediaId       = msg[kind].id;
  const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v23.0';

  /* ───── 2. קריאה ראשונה – מטא-דאטה ───── */
  let meta;
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
      { headers:{ Authorization:`Bearer ${token}` }, timeout:5_000 }
    );
    meta = data;                                         // { url, mime_type, … }
  } catch (err) {
    const fb = err.response?.data?.error;
    const code = fb?.code === 190 ? 'fb_token_expired'
              : fb?.code === 10  ? 'fb_permission'
              : 'fb_meta_failed';
    log.error('media.saveMedia', 'meta request failed', fb || err.message);
    throw Object.assign(new Error(code), { code });
  }

  /* ───── 3. קריאה שנייה – הורדת הבינארי כ-STREAM ───── */
  let stream;
  try {
    const res = await axios.get(meta.url, {
      responseType: 'stream',
      timeout     : 30_000,
      headers     : { Authorization:`Bearer ${token}` }   // חשוב! אחרת 401
    });
    stream = res.data;                                    // NodeJS.Readable
  } catch (err) {
    const fb = err.response?.data?.error;
    const code = fb?.code === 190 ? 'fb_token_expired'
              : fb?.code === 100 ? 'fb_bad_media_id'
              : 'fb_download_failed';
    log.error('media.saveMedia', 'download failed', fb || err.message);
    throw Object.assign(new Error(code), { code });
  }

  /* ───── 4. הכנה לשמות / MIME ───── */
  const mimeType = meta.mime_type || MIME[kind] || 'application/octet-stream';
  const ext      = EXT[kind]      || mimeType.split('/')[1]?.split('+')[0] || 'bin';
  const fileName = msg.document?.filename || `${mediaId}.${ext}`;

  /* ───── 5. העלאה ל-Google Drive ───── */
  try {
    const { data:file } = await drive.files.create({
      requestBody : { name:fileName, mimeType, parents:[parentId] },
      media       : { mimeType, body:stream },
      fields      : 'id, webViewLink',
      ...driveOpts                                   // shared-drive flags וכו'
    });
    log.info('media.saveMedia', 'uploaded', { driveId:file.id });
    return file.webViewLink;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    const quota = /Service Accounts do not have storage quota/i.test(msg);
    const code  = quota ? 'drive_quota_exceeded' : 'drive_upload_failed';
    log.error('media.saveMedia', code, msg);
    throw Object.assign(new Error(code), { code });
  }
}
