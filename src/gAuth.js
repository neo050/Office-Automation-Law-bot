import fs from 'fs/promises';
import { google } from 'googleapis';

/* ---------- load credentials ---------- */
const creds  = JSON.parse(await fs.readFile('client_secret.json'));
const token  = JSON.parse(await fs.readFile('token.json'));

const { client_id, client_secret } = creds.installed;

export const oAuth2 = new google.auth.OAuth2(
  client_id,
  client_secret,
  'urn:ietf:wg:oauth:2.0:oob'   // redirect URI של desktop
);
oAuth2.setCredentials(token);

/* auto‑refresh (שומר קובץ בכל חידוש) */
oAuth2.on('tokens', async t => {
  const merged = { ...token, ...t };
  await fs.writeFile('token.json', JSON.stringify(merged, null, 2));
  console.log('[OAuth] token refreshed & saved');
});

/* ---------- API instances ---------- */
export const drive  = google.drive({  version: 'v3', auth: oAuth2 });
export const sheets = google.sheets({ version: 'v4', auth: oAuth2 });