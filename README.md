# 📁 Office‑Automation‑Law‑bot

> Conversational intake assistant for a boutique Israeli law firm — a **cloud‑native, event‑driven micro‑service** that fuses the **WhatsApp Business Cloud API**, **OpenAI** tool‑calling, and **Google Workspace** (Drive + Sheets) into one seamless workflow, with a built‑in **operator dashboard** and **browser‑based configuration**.

<p align="center">
  <b>Production hardened • Zero‑loss media capture • Cumulative summaries • Live operator dashboard • Self‑service settings + health checks</b>
</p>

---

## ✨ What it does

| # | Capability | Outcome |
|---|---|---|
| **1** | **On‑boarding over WhatsApp** — confirms the client's phone & full name once, verifies by national‑ID, and walks them through a structured intake | friction‑free first contact |
| **2** | **Auto‑provisioning** — creates a dedicated Google Drive folder **and upserts a Sheets row** per client (keyed by ID) | single source of truth |
| **3** | **Zero‑loss media** — every photo/document/video/audio is streamed to Drive through a FIFO queue with per‑user de‑dup | nothing slips through |
| **4** | **Cumulative summarisation** — after a quiet period the model appends a time‑stamped session summary to `summary.txt` and the raw transcript to `chat.txt` (**append‑only, never overwrites**) | paralegal skims one file instead of scrolling chat |
| **5** | **Single “done” link** — after the upload burst settles the client receives one consolidated Drive link (no per‑file spam) | tidy UX |
| **6** | **Operator dashboard** 🆕 — WhatsApp‑style RTL web UI to read every conversation and **reply directly** to clients | humans stay in the loop |
| **7** | **Self‑service settings + health** 🆕 — edit configuration and verify every integration from the browser | ops without the shell |

> **Delta:** summaries are cumulative; each session is time‑stamped, forming a living chronology per case.

---

## 🏗️ High‑level architecture

```
                         ┌──────────────────────────── webhook process ───────────────────────────┐
WhatsApp ↔ Meta Webhook  │  webhookServer (Express)                                                 │
   POST /webhook  ───────┼─▶ verify X-Hub-Signature-256 (config-gated)                              │
                         │   filter echoes / statuses / placeholders                               │
                         │   └─▶ agentHandle ─▶ queueInboundMedia (Redis FIFO)                      │
                         │                      └─▶ GPT tool-loop (bounded) ─▶ tools                │
   GET  /admin           │   mountAdmin: dashboard SPA + REST API + settings + health               │
   GET  /admin/settings  │                                                                          │
                         └──────────────────────────────────────────────────────────────────────────┘
                                              │ shared state / queues
                                              ▼
                        Redis 7  (durable state, queues, locks, chat mirror)
                          • conv:{phone}        – GPT history (windowed, 30d TTL)
                          • client:{phone}      – phone/name confirmation FSM
                          • mediaQ:{phone}      – FIFO of inbound media ids
                          • mediaSeen:{phone}   – SET of seen media ids (dedup)
                          • linkDueZ / linkFolderH – ZSET/HASH: phones due for a Drive link
                          • sumSlot:{folderId}  – summary de-dup slot (poller vs idle)
                          • lock:bundle:{folderId} – serialises Drive append writes
                          • chatlog/chatmeta/chats:index – dashboard message mirror
                                              ▲
                         ┌────────────────────┴───────────── poller process ──────────────────────┐
                         │  linkPoller: pops due phones ─▶ summarise ─▶ append chat.txt/summary.txt │
                         │              ─▶ send one consolidated Drive link                          │
                         └──────────────────────────────────────────────────────────────────────────┘

  Google Workspace (OAuth 2.0)            OpenAI                       Diagnostics
   • Drive  – case folders + logs          • chat tool-calling          • Redis / WhatsApp /
   • Sheets – client registry (upsert)     • transcript summaries         OpenAI / Google checks
```

The diagram source lives in [`architecture.mmd`](architecture.mmd) (Mermaid).

### Two runtime roles, one image
`RUN_ROLE` selects the entry point in `src/index.js`:
- `webhook` → `src/webhookServer.js` (Meta webhook **+** operator dashboard/API)
- `poller` → `src/linkPoller.js` (background summariser + Drive‑link sender)

---

## 🧰 Tech stack

- **Node 22 (ES Modules)**, **Express 5**, **Axios**, **Day.js**
- **OpenAI** tool‑calling (default model `gpt-4o-mini`, configurable)
- **WhatsApp Business Cloud API** (Graph `v23.0`, configurable)
- **Google Drive & Sheets** via **OAuth 2.0** (installed‑app credentials)
- **Redis 7**: LIST/SET/ZSET/HASH + locks as durable queues and state (lazy‑connect client)
- **Vanilla‑JS RTL dashboard** (no build step) served by Express
- **Docker Compose** with a **sidecar ngrok** tunnel
- **`node:test`** suite + **`doctor`** health CLI
- **Structured logging** with timezone‑aware timestamps

---

## 🚀 Quick start

### Local (Node)

```bash
npm install
cp .env.sample .env            # then fill the vars (see table) — or fill them later in the UI
npm run doctor                 # verify Redis / WhatsApp / OpenAI / Google connectivity
npm test                       # run the automated suite (starts a local Redis for tests)

npm run start:webhook          # webhook + dashboard  → http://localhost:8197/admin
npm run start:poller           # background summariser/link worker (separate terminal)
```

### Docker (production‑like)

```bash
docker compose up -d --build   # webhook + poller + redis + ngrok sidecar
# Point Meta's Webhook config at:  https://<your-ngrok-domain>/webhook
# Open the dashboard at:           https://<your-ngrok-domain>/admin
```

### Containers

| Service | Role | Notes |
|---|---|---|
| `webhook` | Express server: Meta webhooks **+** operator dashboard/API | responds fast; offloads heavy work |
| `poller` | Background worker: consolidated Drive link + appended logs | idempotent; driven by Redis ZSET |
| `redis` | Durable queue/state/locks | AOF enabled; password protected |
| `ngrok` | Public HTTPS tunnel into `webhook:8197` | uses your reserved domain |

---

## 🔧 Configuration

All settings resolve through one layered source of truth (`src/config.js`):

> **runtime overrides** (stored in **Redis**, editable from the UI, shared across every service) → **`process.env`** → **schema default**

Request‑time values (WhatsApp token, OpenAI key/model, Graph version, Sheet/Drive IDs) take effect **live** after a UI edit; infrastructure keys are flagged *“requires restart.”*

| Variable | Group | Purpose | Example / default |
|---|---|---|---|
| `PERMANENT_WABA_TOKEN` | WhatsApp | Long‑lived token (send + media download) | `EAAG…` |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp | Phone number id for Graph API | `123456789012345` |
| `WHATSAPP_BUSINESS_NUMBER` | WhatsApp | Your own WABA number (echo filter) | `972797290682` |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp | Webhook verify challenge | `my-verify-secret` |
| `WHATSAPP_APP_SECRET` | WhatsApp | Meta App secret — enables `X-Hub-Signature-256` verification (recommended) | `a1b2c3…` |
| `GRAPH_VERSION` | WhatsApp | Graph API version | `v23.0` |
| `GRAPH_BASE` | WhatsApp | Graph API base URL (override for testing) | `https://graph.facebook.com` |
| `OPENAI_API_KEY` | OpenAI | OpenAI key | `sk-…` |
| `OPENAI_MODEL` | OpenAI | Chat / tool‑calling model | `gpt-4o-mini` |
| `SUMMARY_MODEL` | OpenAI | Model used for transcript summaries | `gpt-4o-mini` |
| `OPENAI_BASE` | OpenAI | API base URL (override for testing) | `https://api.openai.com` |
| `SHEETS_ID` | Google | Google Sheet id of the Clients registry | `1Abc…XYZ` |
| `SHEET_NAME` | Google | Sheet tab name | `Clients` |
| `DRIVE_ROOT_ID` | Google | Parent Drive folder for client cases | `1F0l…abc` |
| `DRIVE_MODE` | Google | empty (My Drive) or `shared` (Shared Drive) | *(empty)* |
| `REDIS_HOST` / `REDIS_PORT` | Redis | Redis connection | `redis` / `6379` |
| `REDIS_PASS` | Redis | Redis password | strong string |
| `REDIS_NS` | Redis | Key namespace (staging/prod isolation) | `prod` |
| `PORT` | App | HTTP port | `8197` |
| `ADMIN_USER` / `ADMIN_PASS` | App | HTTP Basic credentials for `/admin` (open if unset — dev only) | `admin` / `strong-pass` |
| `DEBUG_LEVEL` | App | 0/1/2/3 (silent/errors/info/debug) | `2` |
| `LOG_TZ` | App | Logger timezone | `Asia/Jerusalem` |
| `MAX_TOOL_TURNS` | App | Safety cap on the GPT tool‑call loop per message | `8` |
| `HISTORY_WINDOW` | App | Max chat‑history messages kept in the GPT context | `40` |
| `CHAT_LOG_MAX` / `CHAT_LOG_TTL_SEC` | App | Dashboard message buffer size / retention | `1000` / `5184000` |
| _(UI overrides)_ | — | Persisted in a Redis hash `{REDIS_NS}:cfg:overrides`, shared across services | — |
| `NGROK_AUTHTOKEN` / `NGROK_DOMAIN` / `NGROK_REGION` | Infra | ngrok sidecar tunnel | — |

> **Google auth:** this build uses **OAuth 2.0 installed‑app** credentials. Place `client_secret.json` and a generated `token.json` at the project root (Docker mounts both into the container). Generate the token once with `node src/token.js` or `node quickstart.js` and authorise the Drive + Sheets scopes. All four credential files are git‑ignored.

---

## 🖥️ Operator dashboard — live chats

A built‑in web UI exposes every WhatsApp conversation for the legal team — no extra service to deploy.

- **URL:** `https://<your-domain>/admin` (served by the `webhook` container on port `8197`)
- **What you get:** WhatsApp‑style RTL Hebrew interface — conversation list sorted by recency, unread badges, full message thread (inbound + outbound + media markers), the client's Drive folder link, and a **reply box** so an operator can message the client directly (sent through the same WhatsApp Graph API and logged back into the thread).
- **Storage:** messages are mirrored into Redis (`chatlog:{phone}`, `chatmeta:{phone}`, `chats:index`) independently of the GPT tool‑calling history, so the dashboard survives history windowing/compaction.
- **Auth:** set `ADMIN_USER` + `ADMIN_PASS` for HTTP Basic protection (constant‑time compare). Leave unset only for local development.

REST API (same auth): `GET /api/conversations`, `GET /api/conversations/:phone`, `POST /api/conversations/:phone/reply`, `POST /api/conversations/:phone/read`.

---

## ⚙️ Settings UI & service health

The dashboard's ⚙️ button opens **`/admin/settings.html`** — a single screen to configure the system and verify every integration without touching the shell.

- **Edit configuration in the browser:** every setting (grouped by WhatsApp / OpenAI / Google / Redis / App) is editable. Secrets are masked (`••••`) and never sent back to the client; submitting an unchanged mask leaves the secret intact.
- **Live persistence:** edits persist to **Redis** (a shared hash, read by every service) and mirror into `process.env`, taking effect live for request‑time values; the poller reloads each tick so changes propagate without a redeploy. Infra keys are flagged *“requires restart.”*
- **Live health panel:** a status lamp per service (Redis / WhatsApp / OpenAI / Google) with latency and detail, backed by `GET /api/health/services`.

Config REST API (same auth): `GET /api/config`, `PUT /api/config`, `GET /api/health/services`.

---

## 🩺 Diagnostics & tests

```bash
npm run doctor   # check every external service (exit 1 if any fail) — great for CI/healthchecks
npm test         # full suite: config, validators, history repair, conversation store,
                 # WhatsApp send (mocked Graph), diagnostics, dashboard API  (30 tests)
```

- **`src/diagnostics.js`** holds the shared checks used by the CLI, the API and the settings UI — one source of truth for “is service X reachable?”.
- The test suite (Node's built‑in `node:test`) mocks the external HTTP boundaries (Graph / OpenAI) via `GRAPH_BASE` / `OPENAI_BASE`, and runs Redis‑backed tests against a local server (`pretest` starts one automatically). **No real credentials required.**

---

## 🛡️ Reliability & hardening

Failure points addressed in the current build:

- **FSM state preservation** — confirming/overriding the phone no longer wipes the client's name/confirmation flags (spread‑merge, not replace).
- **Bounded GPT loop** — `MAX_TOOL_TURNS` caps tool‑call iterations per message (no runaway cost/latency).
- **History windowing** — only the system prompt + last `HISTORY_WINDOW` turns enter the model; orphaned tool frames are healed by `repairHistory()`.
- **Single‑writer summaries** — `linkPoller` and `idleManager` claim a per‑folder `sumSlot` before summarising, preventing duplicate timestamp blocks.
- **Serialised Drive appends** — a per‑folder Redis lock (`lock:bundle:{folderId}`) stops concurrent read‑modify‑write from losing log content.
- **Webhook authenticity** — `X-Hub-Signature-256` HMAC verification (enabled once `WHATSAPP_APP_SECRET` is set).
- **Idempotent media** — per‑user `mediaSeen` SET de‑dups Meta re‑deliveries; single enqueue path.
- **Lazy Redis connect** — no socket until first command; clean process exit.

---

## 🗂️ Project structure

```
src/
  index.js            – role selector (webhook | poller); loads layered config first
  config.js           – central, schema-driven configuration (UI-editable)
  webhookServer.js    – Express: Meta webhook + signature verify + mounts dashboard
  adminServer.js      – REST API + Basic auth + static SPA (chats, config, health)
  agentLoop.js        – GPT tool-calling loop, onboarding FSM, history windowing
  functionsImpl.js    – tool implementations (lookup, folder, media, send, bundle)
  clientLookup.js     – Google Sheets upsert / lookup (config-driven)
  conversationStore.js– durable per-phone message mirror for the dashboard
  diagnostics.js      – Redis/WhatsApp/OpenAI/Google health checks
  doctor.js           – CLI wrapper around diagnostics (CI/healthcheck)
  linkPoller.js       – background summariser + consolidated Drive-link sender
  linkScheduler.js    – media FIFO, dedup, link scheduling, summary-slot claim
  idleManager.js      – idle-timeout summary (de-duped vs poller)
  media.js            – WhatsApp media download → Drive upload (streamed)
  driveUtils.js       – Drive folder helpers / shared-drive options
  chatHistory.js      – history repair/sanitise + Redis transcript builder
  openaiClient.js     – lazy, config-driven OpenAI client
  gAuth.js            – Google OAuth2 client (Drive + Sheets)
  redis.js            – shared ioredis client (lazy connect)
  logger.js           – timezone-aware structured logger
  validators.js       – phone / full-name regexes
public/
  admin.html          – chats dashboard (RTL SPA)
  settings.html       – configuration + health dashboard
config/
  functions.json      – OpenAI tool/function schemas
  runtime.json        – UI-saved overrides (git-ignored)
test/                 – node:test suite (config, store, whatsapp, diagnostics, admin, …)
```

---

## 📝 Logging & time zone

The logger prints timezone‑aware timestamps. Set `LOG_TZ=Asia/Jerusalem` (on both `webhook` and `poller`) so operational logs align with Israel local time. `DEBUG_LEVEL` controls verbosity (0=silent … 3=debug). The Docker image installs `tzdata` and sets `TZ=Asia/Jerusalem` for system tools.

---

## 🔒 Security & privacy

- WhatsApp/OpenAI tokens are never logged; only error codes & messages.
- Inbound webhooks are authenticated with `X-Hub-Signature-256` when `WHATSAPP_APP_SECRET` is set.
- Dashboard/API protected by HTTP Basic (constant‑time compare); secrets are masked in the settings API and never returned to the browser.
- Redis is password‑protected with AOF persistence; mount a volume for durability.
- Credentials (`client_secret.json`, `token.json`, `service-account.json`) and UI overrides (`config/runtime.json`) are git‑ignored.

---

## 💡 Why it matters (problem → solution → impact)

- **Problem:** Lawyer intake on WhatsApp is chaotic — files scatter, follow‑ups are manual, and context gets lost.
- **Solution:** Treat messaging as events. Stream every artifact to Drive, capture state in Redis, let the model summarise the narrative after quiet periods, and give the team a live dashboard + self‑service configuration.
- **Impact:** Paralegals stop hunting screenshots; attorneys open one folder with `chat.txt` + `summary.txt`; operators reply from one screen — and ops can verify health and rotate keys without a deploy.

> Result: faster triage, fewer back‑and‑forths, and auditable case history.

---

## 🗺️ Roadmap

- ✅ Operator dashboard with live conversations + reply
- ✅ Browser‑based configuration + service health checks
- ✅ Automated test suite + `doctor` CLI
- LLM‑based document classification + OCR summary
- BigQuery + Looker Studio intake KPIs
- Vault‑mode encryption on uploads (Tink/KMS)
- Per‑operator auth (sessions/roles) for the dashboard
- Helm chart & GitHub Actions for one‑click deploy

---

## 👋 About the author

I architect, code, and ship **production‑grade** systems bridging real‑time messaging, AI inference, and cloud APIs — comfortable across Linux containers, Redis internals, OAuth 2.0 flows, and LLM prompt/tool design.

> Let’s build the next delightful workflow together.

---

© 2025 Neora — MIT License
