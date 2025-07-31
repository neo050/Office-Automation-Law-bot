import { google } from 'googleapis';
import { saveMedia } from './media.js';
import fs from 'fs/promises';

const creds  = JSON.parse(await fs.readFile('client_secret.json'));
const token  = JSON.parse(await fs.readFile('token.json'));
const { client_id, client_secret } = creds.installed;

const oAuth2 = new google.auth.OAuth2(
  client_id, client_secret, 'urn:ietf:wg:oauth:2.0:oob'
);
oAuth2.setCredentials(token);

const drive = google.drive({ version: 'v3', auth: oAuth2 });

export async function upsertMessageDrive(msg) {
  const rootId = process.env.DRIVE_ROOT_ID;           // Folder or Shared-Drive ID
  const phone  = msg.from;                            // "15551234567"
  const dateKey = new Date(+msg.timestamp * 1000)
                    .toISOString().slice(0,10);       // "2025-07-27"

  /* 1️⃣  ensure phone folder */
  const phoneFolder = await ensureFolder(phone, rootId);

  /* 2️⃣  ensure date folder */
  const dayFolder = await ensureFolder(dateKey, phoneFolder.id);

  /* 3️⃣  אם Text – צור קובץ txt */
  if (msg.type === 'text') {
    await drive.files.create({
      requestBody: {
        name: `msg-${msg.id}.txt`,
        mimeType: 'text/plain',
        parents: [dayFolder.id]
      },
      media: { mimeType: 'text/plain', body: msg.text.body },
      fields: 'id',
      ...driveOpts()
    });
  } else {
    /* 4️⃣  Media */
    await saveMedia(msg, process.env.PERMANENT_WABA_TOKEN, dayFolder.id);
  }
}

/* ---------- helpers ---------- */

function driveOpts() {
  return process.env.DRIVE_MODE === 'shared'
    ? { supportsAllDrives:true, driveId:process.env.DRIVE_ROOT_ID }
    : {};
}

async function ensureFolder(name, parentId) {
  const { data:{ files } } = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' ` +
       `and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields:'files(id,name)',
    ...driveOpts()
  });
  if (files.length) return files[0];

  const { data } = await drive.files.create({
    requestBody:{ name, mimeType:'application/vnd.google-apps.folder', parents:[parentId] },
    fields:'id,name',
    ...driveOpts()
  });
  return data;
}
