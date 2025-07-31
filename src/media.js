import axios from 'axios';
import { drive, sheets } from './gAuth.js';
import { driveOpts } from './driveUtils.js';
import { log } from './logger.js';
import { Readable } from 'stream'

// Use same Service Account everywhere


export async function saveMedia(msg, token, parentId) {
  log.step('media.saveMedia', 'start', { type: msg?.type, parentId });
  if (!msg?.type || !msg[msg.type]?.id) throw new Error('invalid_whatsapp_media_payload');

  const mediaId = msg[msg.type].id;
  const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v23.0';

  const metaRes = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 });
  const meta = metaRes.data;

 const bin = await axios.get(meta.url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    headers: { Authorization: `Bearer ${token}` }   // ← 401
  });  
  const buffer = Buffer.from(bin.data);
  const stream = Readable.from(buffer);     //  Buffer -> Readable

  const extMap  = { image: 'jpg', audio: 'ogg', video: 'mp4', document: 'pdf', sticker: 'webp' };
  const mimeMap = { image: 'image/jpeg', audio: 'audio/ogg', video: 'video/mp4', document: 'application/pdf', sticker: 'image/webp' };
  const mimeType = meta.mime_type || mimeMap[msg.type] || 'application/octet-stream';
  const ext      = extMap[msg.type]  || (mimeType.split('/')[1]?.split('+')[0] ?? 'bin');

  const originalName = msg.document?.filename || `${mediaId}.${ext}`;

  const { data: file } = await drive.files.create({
    requestBody: { name: originalName, mimeType, parents: [parentId] },
    media: { mimeType, body: stream},
    fields: 'id, webViewLink',
    ...driveOpts
  });

  return file.webViewLink;
}