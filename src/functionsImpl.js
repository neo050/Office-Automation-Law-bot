import { drive, sheets } from './gAuth.js';
import axios from 'axios';
import { upsertClientRow, updateDriveFolderId } from './clientLookup.js';
import { ensureFolder } from './driveUtils.js';
import { saveMedia as saveWhatsAppMedia } from './media.js';
import { log } from './logger.js';



// 1. lookupClient
export async function lookupClient({ id, fullName = '', phone = '' }) {
  log.step('functions.lookupClient', 'start', { id });
  try {
    const res = await upsertClientRow({ id, fullName, phone });
    return { ok: true, ...res };
  } catch (e) {
    log.error('functions.lookupClient', 'failed', e);
    return { ok: false, error: e.message };
  }
}

// 2. createFolder
export async function createFolder({ id, fullName, phone = ''}) {
  log.step('functions.createFolder', 'start', { id, fullName });
  try {
    const { rowNumber, driveFolderId } = await upsertClientRow({ id, fullName, phone });
    if (driveFolderId) return { ok: true, folderId: driveFolderId, rowNumber };

    const rootId = process.env.DRIVE_ROOT_ID;
    const folderName = `${id}_${fullName.replace(/\s+/g, '')}`;
    const folder = await ensureFolder(folderName, rootId);
    await updateDriveFolderId(rowNumber, folder.id);

    return { ok: true, folderId: folder.id, rowNumber };
  } catch (e) {
    log.error('functions.createFolder', 'failed', e);
    return { ok: false, error: e.message };
  }
}

// 3. saveMedia
export async function saveMedia({ folderId, mediaId, mediaType }) {
  log.step('functions.saveMedia', 'start', { folderId, mediaId, mediaType });
  const allowed = ['image', 'audio', 'video', 'document', 'sticker'];
  if (!mediaId || !allowed.includes(mediaType)) return { ok: false, error: 'bad_media_args' };
  try {
    const url = await saveWhatsAppMedia({ [mediaType]: { id: mediaId }, type: mediaType }, process.env.PERMANENT_WABA_TOKEN, folderId);
    return { ok: true, url };
  } catch (e) {
  const fbErr = e.response?.data?.error;
  console.error('[functions.saveMedia] failed', fbErr || e);

  if (fbErr?.code === 190 || e.response?.status === 401) return { ok:false, error: 'token_expired' };
  if (fbErr?.code === 10)  return { ok:false, error: 'fb_permission_missing', details: fbErr.message };
  if (fbErr?.code === 100) return { ok:false, error: 'bad_media_id' };

  return { ok:false, error: fbErr?.message || e.message };
}

}

// 4. sendWhatsApp
export async function sendWhatsApp({ to, text = null, templateName = null }) {
  log.step('functions.sendWhatsApp', 'start', { to, templateName });
  const TOKEN = process.env.PERMANENT_WABA_TOKEN;
  const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v23.0';

  const body = templateName
    ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: templateName, language: { code: 'he' } } }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };

  try {
    await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`, body, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      timeout: 7000
    });
    return { ok: true };
  } catch (e) {
    const fbErr = e.response?.data?.error;
    log.error('functions.sendWhatsApp', 'failed', fbErr || e);
    if (e.response?.status === 401 && fbErr?.code === 190) return { ok: false, error: 'token_expired' };
    return { ok: false, error: fbErr?.message || e.message };
  }
}

// 5. saveChatLog (soft-fail on quota)
export async function saveChatLog({ folderId, log: chatLog }) {
  log.step('functions.saveChatLog', 'start', { folderId });
  try {
    await drive.files.create({
      requestBody: { name: 'chat.txt', mimeType: 'text/plain', parents: [folderId] },
      media: { mimeType: 'text/plain', body: chatLog },
      fields: 'id'
    });
    return { ok: true, saved: true };
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    if (e.response?.status === 403 && /Service Accounts do not have storage quota/i.test(msg)) {
      log.info('functions.saveChatLog', 'no_quota_service_account');
      return { ok: false, error: 'no_quota_service_account' };
    }
    log.error('functions.saveChatLog', 'failed', e.response?.data || e);
    return { ok: false, error: msg };
  }
}

export default { lookupClient, createFolder, saveMedia, sendWhatsApp, saveChatLog };