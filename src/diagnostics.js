// ────────────────────────────────────────────────────────────────
//  src/diagnostics.js  ·  Health checks for every external dependency
// ────────────────────────────────────────────────────────────────
//  Each check returns a normalised result so the dashboard, the REST
//  API and the `doctor` CLI can all share the same logic:
//    { service, status:'ok'|'fail'|'skip', detail, latencyMs }
// ────────────────────────────────────────────────────────────────
import axios  from 'axios';
import redis  from './redis.js';
import cfg    from './config.js';
import { log } from './logger.js';

const TIMEOUT = Number(process.env.HEALTHCHECK_TIMEOUT_MS) || 7000;

const result = (service, status, detail = '', t0 = null) => ({
  service,
  status,
  detail,
  latencyMs: t0 == null ? null : Date.now() - t0
});

const graphError = e => {
  const fb = e.response?.data?.error;
  if (fb?.code === 190) return 'token expired / invalid';
  if (fb?.code === 10)  return 'permission missing';
  return fb?.message || e.message;
};

/* ───────── Redis ───────── */
export async function checkRedis() {
  const t0 = Date.now();
  try {
    const pong = await redis.ping();
    return result('Redis', pong === 'PONG' ? 'ok' : 'fail', String(pong), t0);
  } catch (e) {
    return result('Redis', 'fail', e.message, t0);
  }
}

/* ───────── WhatsApp Graph API ───────── */
export async function checkWhatsApp() {
  const token = cfg.get('PERMANENT_WABA_TOKEN');
  const id    = cfg.get('WHATSAPP_PHONE_NUMBER_ID');
  const base  = cfg.get('GRAPH_BASE');
  const ver   = cfg.get('GRAPH_VERSION');
  if (!token || !id) return result('WhatsApp', 'skip', 'missing token / phone-number id');

  const t0 = Date.now();
  try {
    const { data } = await axios.get(`${base}/${ver}/${id}`, {
      params : { fields: 'display_phone_number,verified_name' },
      headers: { Authorization: `Bearer ${token}` },
      timeout: TIMEOUT
    });
    const detail = [data.verified_name, data.display_phone_number].filter(Boolean).join(' · ') || 'connected';
    return result('WhatsApp', 'ok', detail, t0);
  } catch (e) {
    return result('WhatsApp', 'fail', graphError(e), t0);
  }
}

/* ───────── OpenAI ───────── */
export async function checkOpenAI() {
  const key  = cfg.get('OPENAI_API_KEY');
  const base = cfg.get('OPENAI_BASE') || 'https://api.openai.com';
  if (!key) return result('OpenAI', 'skip', 'missing api key');

  const t0 = Date.now();
  try {
    const { data } = await axios.get(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      timeout: TIMEOUT
    });
    const n = Array.isArray(data?.data) ? data.data.length : 0;
    return result('OpenAI', 'ok', `${n} models reachable`, t0);
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    return result('OpenAI', 'fail', msg, t0);
  }
}

/* ───────── Google Workspace (Sheets + Drive) ─────────
   gAuth is imported lazily so missing credentials degrade to a failed
   check instead of crashing the whole process at import time. */
export async function checkGoogle() {
  const sheetId = cfg.get('SHEETS_ID');
  const rootId  = cfg.get('DRIVE_ROOT_ID');
  if (!sheetId && !rootId) return result('Google', 'skip', 'missing SHEETS_ID / DRIVE_ROOT_ID');

  const t0 = Date.now();
  try {
    const { sheets, drive } = await import('./gAuth.js');
    const parts = [];

    if (sheetId) {
      const { data } = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'properties.title' });
      parts.push(`Sheet "${data.properties?.title || sheetId}"`);
    }
    if (rootId) {
      const { data } = await drive.files.get({ fileId: rootId, fields: 'name', supportsAllDrives: true });
      parts.push(`Drive "${data.name || rootId}"`);
    }
    return result('Google', 'ok', parts.join(' · ') || 'connected', t0);
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    return result('Google', 'fail', msg, t0);
  }
}

/** Run every check in parallel and summarise. */
export async function checkAll() {
  const checks = await Promise.all([
    checkRedis(),
    checkWhatsApp(),
    checkOpenAI(),
    checkGoogle()
  ]);
  const ok = checks.every(c => c.status !== 'fail');
  log.info('diagnostics', 'checkAll', { ok, checks: checks.map(c => `${c.service}:${c.status}`) });
  return { ok, checks };
}

export default { checkRedis, checkWhatsApp, checkOpenAI, checkGoogle, checkAll };
