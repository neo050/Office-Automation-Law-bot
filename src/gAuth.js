import fs from 'fs/promises';
import { google } from 'googleapis';

/* ----------------------------------------------------------------------
 *  Load Google OAuth credentials.
 *
 *  Source priority (so the same code runs locally AND on cloud hosts with
 *  an ephemeral / read-only filesystem like Railway, Fly, Render):
 *    1. Environment variable holding the JSON itself (raw or base64)
 *         GOOGLE_CLIENT_SECRET_JSON   ← contents of client_secret.json
 *         GOOGLE_TOKEN_JSON           ← contents of token.json
 *    2. A file on disk (the classic local / docker-compose flow)
 *         client_secret.json / token.json  (paths overridable via env)
 * -------------------------------------------------------------------- */

/** Parse a JSON blob that may be raw JSON or base64-encoded JSON. */
function parseJsonBlob(str, label) {
  const s = String(str).trim();
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
    } catch {
      throw new Error(`[gAuth] ${label} is set but is not valid JSON or base64-JSON`);
    }
  }
}

/** Read credentials from an env var if present, else from a file. */
async function loadCred({ envVar, file, label }) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.trim() !== '') {
    return parseJsonBlob(fromEnv, envVar);
  }
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    throw new Error(
      `[gAuth] Google credentials missing: set ${envVar} or provide ${file} (${e.code || e.message})`
    );
  }
}

const CLIENT_SECRET_FILE = process.env.GOOGLE_CLIENT_SECRET_FILE || 'client_secret.json';
const TOKEN_FILE         = process.env.GOOGLE_TOKEN_FILE         || 'token.json';

// Load creds, but DON'T crash the whole process if they're missing. On a cloud
// host a boot-time throw becomes a crash-loop; instead we degrade gracefully so
// the webhook + dashboard + health checks still come up and report Google as
// "not configured" until the credentials are supplied (env or file).
let creds, token;
export let isGoogleConfigured = false;
try {
  creds = await loadCred({ envVar: 'GOOGLE_CLIENT_SECRET_JSON', file: CLIENT_SECRET_FILE, label: 'client_secret' });
  token = await loadCred({ envVar: 'GOOGLE_TOKEN_JSON',         file: TOKEN_FILE,         label: 'token' });
  isGoogleConfigured = true;
} catch (e) {
  console.warn('[gAuth] Google Drive/Sheets disabled —', e.message);
  creds = { installed: {} };   // empty client → API calls fail with a clear auth error, not a boot crash
  token = {};
}

// Support both "installed" (desktop) and "web" client_secret shapes.
const app = creds.installed || creds.web || creds;
const { client_id, client_secret, redirect_uris } = app;

export const oAuth2 = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris?.[0]  // redirect URI של desktop
);
oAuth2.setCredentials(token);

/* auto‑refresh: keep the refreshed token in memory always, and best‑effort
 * persist it to disk. On a read-only/ephemeral FS the write may fail — that's
 * fine: the long-lived refresh_token came from the env/file and survives a
 * restart, so the access token is simply re-minted on next boot. */
oAuth2.on('tokens', async t => {
  const merged = { ...token, ...t };
  try {
    await fs.writeFile(TOKEN_FILE, JSON.stringify(merged, null, 2));
    console.log('[OAuth] token refreshed & saved');
  } catch (e) {
    console.log('[OAuth] token refreshed (not persisted to disk:', e.code || e.message, ')');
  }
});

/* ---------- API instances ---------- */
export const drive  = google.drive({  version: 'v3', auth: oAuth2 });
export const sheets = google.sheets({ version: 'v4', auth: oAuth2 });
