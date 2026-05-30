// ────────────────────────────────────────────────────────────────
//  src/config.js  ·  Central configuration (single source of truth)
// ────────────────────────────────────────────────────────────────
//  Layered resolution (highest wins):
//    1. runtime overrides  (stored in Redis – editable from the UI, SHARED
//       across every service: webhook, poller, …)
//    2. process.env
//    3. schema default
//
//  load()   – read overrides from Redis and mirror them into process.env so
//             modules that read process.env at import time still see them.
//  get()    – resolve a single key through the layers (synchronous, hot path).
//  all()    – schema + current values (secrets masked) for the settings UI.
//  update() – validate, apply to process.env, persist to Redis (shared).
//
//  Why Redis (not a file): on a cloud host the filesystem is ephemeral and
//  per-instance, so a file can't be shared between the webhook and poller and
//  doesn't survive redeploys. A Redis hash is durable (volume-backed) and a
//  single source of truth that every service reads.
// ────────────────────────────────────────────────────────────────
import redis from './redis.js';

export const MASK = '••••••••';

/** Declarative description of every setting the app understands. */
export const SCHEMA = [
  // ── WhatsApp ──
  { key:'PERMANENT_WABA_TOKEN',      group:'WhatsApp', label:'WhatsApp Token',            secret:true },
  { key:'WHATSAPP_PHONE_NUMBER_ID',  group:'WhatsApp', label:'Phone Number ID' },
  { key:'WHATSAPP_BUSINESS_NUMBER',  group:'WhatsApp', label:'Business Number (echo filter)' },
  { key:'WHATSAPP_VERIFY_TOKEN',     group:'WhatsApp', label:'Webhook Verify Token',      secret:true },
  { key:'WHATSAPP_APP_SECRET',       group:'WhatsApp', label:'App Secret (signature)',    secret:true },
  { key:'GRAPH_VERSION',             group:'WhatsApp', label:'Graph API Version',         default:'v23.0' },
  { key:'GRAPH_BASE',                group:'WhatsApp', label:'Graph API Base URL',        default:'https://graph.facebook.com' },

  // ── OpenAI ──
  { key:'OPENAI_API_KEY',            group:'OpenAI',   label:'OpenAI API Key',            secret:true },
  { key:'OPENAI_MODEL',              group:'OpenAI',   label:'Chat Model',                default:'gpt-4o-mini' },
  { key:'SUMMARY_MODEL',             group:'OpenAI',   label:'Summary Model',             default:'gpt-4o-mini' },
  { key:'OPENAI_BASE',               group:'OpenAI',   label:'OpenAI API Base URL',       default:'https://api.openai.com' },

  // ── Google Workspace ──
  { key:'SHEETS_ID',                 group:'Google',   label:'Spreadsheet ID' },
  { key:'SHEET_NAME',                group:'Google',   label:'Sheet Tab Name',            default:'Clients' },
  { key:'DRIVE_ROOT_ID',             group:'Google',   label:'Drive Root Folder ID' },
  { key:'DRIVE_MODE',                group:'Google',   label:'Drive Mode (empty / shared)' },
  { key:'GOOGLE_CLIENT_SECRET_JSON', group:'Google',   label:'OAuth client_secret.json (JSON or base64)', secret:true, requiresRestart:true },
  { key:'GOOGLE_TOKEN_JSON',         group:'Google',   label:'OAuth token.json (JSON or base64)',         secret:true, requiresRestart:true },

  // ── Redis ──
  { key:'REDIS_HOST',                group:'Redis',    label:'Redis Host',  default:'127.0.0.1', requiresRestart:true },
  { key:'REDIS_PORT',                group:'Redis',    label:'Redis Port',  default:'6379',      requiresRestart:true },
  { key:'REDIS_PASS',                group:'Redis',    label:'Redis Password', secret:true,      requiresRestart:true },
  { key:'REDIS_NS',                  group:'Redis',    label:'Redis Namespace (staging/prod)',   requiresRestart:true },

  // ── App / Dashboard ──
  { key:'PORT',                      group:'App',      label:'HTTP Port',         default:'8197', requiresRestart:true },
  { key:'ADMIN_USER',                group:'App',      label:'Dashboard Username' },
  { key:'ADMIN_PASS',                group:'App',      label:'Dashboard Password', secret:true },
  { key:'DEBUG_LEVEL',               group:'App',      label:'Debug Level (0-3)', default:'2' },
  { key:'LOG_TZ',                    group:'App',      label:'Log Timezone',      default:'Asia/Jerusalem' },
  { key:'MAX_TOOL_TURNS',            group:'App',      label:'Max GPT Tool Turns', default:'8' },
  { key:'HISTORY_WINDOW',            group:'App',      label:'GPT History Window', default:'40' }
];

const KEY_SET = new Set(SCHEMA.map(s => s.key));
// Namespaced so staging/prod don't collide; every service uses the same key.
const NS      = process.env.REDIS_NS ? `${process.env.REDIS_NS}:` : '';
const CFG_KEY = `${NS}cfg:overrides`;

let overrides = {};   // key → string (loaded from Redis + live updates)

/** Read the overrides hash from Redis and mirror values into process.env. */
export async function load() {
  try {
    const obj = await redis.hgetall(CFG_KEY);   // {} when the hash is absent
    overrides = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (!KEY_SET.has(k)) continue;
      const val = v == null ? '' : String(v);
      overrides[k] = val;
      if (val !== '') process.env[k] = val;
    }
  } catch (e) {
    // Don't crash boot if Redis is briefly unavailable — env + defaults still apply.
    console.warn('[config] could not load overrides from Redis:', e.message);
  }
  return overrides;
}

/** Resolve one key: override → env → schema default → undefined. */
export function get(key) {
  if (overrides[key] !== undefined && overrides[key] !== '') return overrides[key];
  const env = process.env[key];
  if (env !== undefined && env !== '') return env;
  return SCHEMA.find(s => s.key === key)?.default;
}

/** Whether a key currently resolves to a non-empty value. */
export function isSet(key) {
  const v = get(key);
  return v !== undefined && v !== '';
}

/** Schema + current values for the settings UI (secrets masked unless reveal). */
export function all({ reveal = false } = {}) {
  return SCHEMA.map(s => {
    const v   = get(s.key);
    const set = v !== undefined && v !== '';
    let value = set ? String(v) : '';
    if (s.secret && set && !reveal) value = MASK;
    return {
      key             : s.key,
      label           : s.label,
      group           : s.group,
      secret          : Boolean(s.secret),
      requiresRestart : Boolean(s.requiresRestart),
      default         : s.default ?? '',
      isSet           : set,
      value
    };
  });
}

/**
 * Validate + persist updates. Unknown keys and untouched masked secrets are
 * ignored. The in-memory + process.env mutation happens synchronously (before
 * the first await), so callers that only need the live effect may skip awaiting;
 * await to be sure the change is durably written to Redis.
 * Returns the keys that were actually applied.
 */
export async function update(updates = {}) {
  const applied = [];
  let restart   = false;
  for (const [k, raw] of Object.entries(updates)) {
    if (!KEY_SET.has(k)) continue;
    if (raw === MASK)    continue;                 // unchanged masked secret
    const val = raw == null ? '' : String(raw).trim();
    overrides[k] = val;
    if (val === '') delete process.env[k];
    else            process.env[k] = val;
    applied.push(k);
    if (SCHEMA.find(s => s.key === k)?.requiresRestart) restart = true;
  }
  if (applied.length) await persist();
  return { applied, requiresRestart: restart };
}

async function persist() {
  // Only keep non-empty overrides; rebuild the hash so cleared keys disappear.
  const clean = {};
  for (const [k, v] of Object.entries(overrides)) if (v !== '') clean[k] = v;
  try {
    const multi = redis.multi();
    multi.del(CFG_KEY);
    if (Object.keys(clean).length) multi.hset(CFG_KEY, clean);
    await multi.exec();
  } catch (e) {
    console.warn('[config] could not persist overrides to Redis:', e.message);
  }
}

export default { SCHEMA, MASK, load, get, isSet, all, update };
