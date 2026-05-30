// ────────────────────────────────────────────────────────────────
//  src/config.js  ·  Central configuration (single source of truth)
// ────────────────────────────────────────────────────────────────
//  Layered resolution (highest wins):
//    1. runtime overrides file  (config/runtime.json – editable from UI)
//    2. process.env
//    3. schema default
//
//  load()   – read the overrides file and mirror it into process.env so
//             modules that read process.env at import time still see them.
//  get()    – resolve a single key through the layers.
//  all()    – schema + current values (secrets masked) for the settings UI.
//  update() – validate, persist to the overrides file, apply to process.env.
// ────────────────────────────────────────────────────────────────
import fs   from 'node:fs';
import path from 'node:path';

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

const KEY_SET      = new Set(SCHEMA.map(s => s.key));
const RUNTIME_FILE = process.env.RUNTIME_CONFIG_FILE || path.join('config', 'runtime.json');

let overrides = {};   // key → string (from runtime file + live updates)

/** Read the overrides file (if any) and mirror values into process.env. */
export function load() {
  try {
    const raw = fs.readFileSync(RUNTIME_FILE, 'utf8');
    const obj = JSON.parse(raw);
    overrides = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!KEY_SET.has(k)) continue;
      const val = v == null ? '' : String(v);
      overrides[k] = val;
      if (val !== '') process.env[k] = val;
    }
  } catch {/* no file yet – fine */}
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
 * Validate + persist updates. Unknown keys and untouched masked secrets
 * are ignored. Returns the keys that were actually applied.
 */
export function update(updates = {}) {
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
  if (applied.length) persist();
  return { applied, requiresRestart: restart };
}

function persist() {
  const dir = path.dirname(RUNTIME_FILE);
  fs.mkdirSync(dir, { recursive: true });
  // Only keep non-empty overrides in the file.
  const clean = {};
  for (const [k, v] of Object.entries(overrides)) if (v !== '') clean[k] = v;
  fs.writeFileSync(RUNTIME_FILE, JSON.stringify(clean, null, 2));
}

export default { SCHEMA, MASK, load, get, isSet, all, update };
