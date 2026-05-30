# 📁 Office‑Automation‑Law‑bot — August 2025 Edition

> Conversational intake assistant for a boutique Israeli law firm — a **cloud‑native, event‑driven micro‑service** that fuses **WhatsApp Business Cloud API**, **OpenAI GPT‑4o**, and **Google Workspace (My Drive via Service Account)** into one seamless workflow.

<p align="center">
  <b>Production hardened • Zero‑loss media capture • Time‑boxed summaries • One clean Drive link</b>
</p>

---

## ✨ What it does — v2

| # | Flow element | New in v2? | Outcome |
|---|---|---|---|
| **1** | **On‑boarding over WhatsApp** — verifies client by national‑ID and walks them through a structured intake |  | friction‑free first contact |
| **2** | **Auto‑provisioning** — creates a dedicated Google Drive folder **and updates a Sheets row** per client |  | single source of truth |
| **3** | **Zero‑loss media** — every photo/document/video is streamed to Drive through a FIFO queue with de‑dup |  | nothing slips through |
| **4** | **Smart summarisation ▸❯** — after each quiet period GPT‑4o appends a time‑stamped session summary to `summary.txt` and raw transcript to `chat.txt` (**never overwrites**) | **✔** | paralegal skims one file instead of scrolling chat |
| **5** | **Single “done” link** — after ~5 min idle the client receives one consolidated Drive link (no per‑file spam) |  | tidy UX |

> **Delta:** summaries are cumulative; each session is time‑stamped, forming a living chronology per case.

---

## 🏗️ High‑level architecture

```
WhatsApp ↔ Meta Webhook  →  webhookServer
                              └─ filters statuses/placeholders
                              └─ queues inbound media (Redis LIST)
                              └─ hands off to agentLoop (GPT tools)

Redis (state + queues)
  • conv:{phone}       – JSON chat history (3d TTL)
  • client:{phone}     – phone/name confirmation state (24h TTL)
  • mediaQ:{phone}     – FIFO of inbound media ids (10m TTL)
  • mediaSeen:{phone}  – SET of seen media ids (1h TTL)
  • linkDueZ           – ZSET of phones due for Drive link
  • linkFolderH        – HASH phone → folderId

Agent (agentLoop)
  • Confirms phone & full name once → persists to Redis
  • Orchestrates tool‑calls: lookupClient, createFolder, saveMedia, sendWhatsApp, saveChatBundleUpdate
  • Persists history + bumps idle timer

Background worker (linkPoller)
  • Every N seconds: picks due phones from linkDueZ
  • Builds raw transcript from Redis → OpenAI summarize
  • Writes/updates chat.txt + summary.txt in Drive
  • Sends one consolidated Drive link to the client

Google Workspace
  • Drive (My Drive via Service Account) – case folders + text logs
  • Sheets – client registry (upsert by ID)
```

---

## 🧰 Tech stack

- **Node 22 (ES Modules)**, **Axios**, **Day.js**
- **OpenAI GPT‑4o** tool‑calling
- **WhatsApp Business Cloud API** (Graph v23.0)
- **Google Drive & Sheets** via **Service Account** (My Drive)
- **Redis 7**: LIST/SET/ZSET/HASH as durable queues and state
- **Docker Compose** with a **sidecar ngrok** tunnel
- **Structured logging** with ISO timestamps (Israel TZ aware)

---

## 🚀 Quick start (local & production‑like)

```bash
# 1) Bootstrap env
cp .env.sample .env

# 2) Fill the required vars (see table below)

# 3) Bring up the stack (webhook + poller + ngrok sidecar + redis)
docker compose up -d --build

# 4) Copy your reserved domain to Meta Webhook config
#    Example: https://lawbot.ngrok.app/webhook
```

### Containers

| Service | Role | Notes |
|---|---|---|
| `webhook` | Express server for Meta webhooks + GPT orchestration | responds fast; offloads heavy work |
| `poller` | Background worker sending the consolidated Drive link + appending logs | idempotent; driven by Redis ZSET |
| `redis` | Durable queue/state | AOF enabled; password protected |
| `ngrok` | Public HTTPS tunnel into `webhook:8197` | uses **your reserved domain** |

---

## 🔧 Environment configuration

| Variable | Purpose | Example |
|---|---|---|
| `PERMANENT_WABA_TOKEN` | WhatsApp long‑lived token | `EAAG…` |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number id for Graph API | `123456789012345` |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verify challenge | `my-verify-secret` |
| `GRAPH_VERSION` | Graph API version | `v23.0` |
| `OPENAI_API_KEY` | OpenAI key for GPT‑4o | `sk-…` |
| `SHEETS_ID` | Google Sheet id of the Clients registry | `1Abc…XYZ` |
| `SHEET_NAME` | Sheet tab name | `Clients` |
| `DRIVE_ROOT_ID` | Parent Drive folder (My Drive) for client cases | `1F0l…abc` |
| `PERMANENT_WABA_TOKEN` | WhatsApp media download/send | `EAAG…` |
| `LOG_TZ` | Logger timezone | `Asia/Jerusalem` |
| `DEBUG_LEVEL` | 0/1/2/3 (silent/errors/info/debug) | `2` |
| `REDIS_PASS` | Redis password | strong string |
| `NGROK_AUTHTOKEN` | Your ngrok auth token | `2QH…` |
| `NGROK_DOMAIN` | **Reserved** ngrok domain | `lawbot.ngrok.app` |
| `NGROK_REGION` | Tunnel region | `eu` |
| `WHATSAPP_APP_SECRET` | Meta App secret — enables `X-Hub-Signature-256` webhook verification (recommended) | `a1b2c3…` |
| `ADMIN_USER` / `ADMIN_PASS` | HTTP Basic credentials guarding the `/admin` dashboard. If unset, dashboard is open (dev only) | `admin` / `strong-pass` |
| `MAX_TOOL_TURNS` | Safety cap on GPT tool-call loop per message | `8` |
| `HISTORY_WINDOW` | Max chat-history messages kept in the GPT context | `40` |
| `CHAT_LOG_MAX` / `CHAT_LOG_TTL_SEC` | Dashboard message buffer size / retention | `1000` / `5184000` |

---

## 🖥️ Operator dashboard — live chats

A built-in web UI exposes every WhatsApp conversation for the legal team — no extra service to deploy.

- **URL:** `https://<your-domain>/admin` (served by the `webhook` container on port `8197`)
- **What you get:** WhatsApp-style RTL Hebrew interface — conversation list sorted by recency, unread badges, full message thread (inbound + outbound + media markers), the client's Drive folder link, and a **reply box** so an operator can message the client directly (sent through the same WhatsApp Graph API and logged back into the thread).
- **Storage:** messages are mirrored into Redis (`chatlog:{phone}`, `chatmeta:{phone}`, `chats:index`) independently of the GPT tool-calling history, so the dashboard survives history windowing/compaction.
- **Auth:** set `ADMIN_USER` + `ADMIN_PASS` for HTTP Basic protection (constant-time compare). Leave unset only for local development.

REST API (same auth): `GET /api/conversations`, `GET /api/conversations/:phone`, `POST /api/conversations/:phone/reply`, `POST /api/conversations/:phone/read`.

---

## ⚙️ Settings UI & service health

The dashboard's ⚙️ button opens **`/admin/settings.html`** — a single screen to configure the system and verify every integration without touching the shell.

- **Edit configuration in the browser:** every setting from the env table (grouped by WhatsApp / OpenAI / Google / Redis / App) is editable. Secrets are masked (`••••`) and never sent back to the client; submitting an unchanged mask leaves the secret intact.
- **Layered config (`src/config.js`):** runtime overrides → `process.env` → schema default. Edits persist to `config/runtime.json` (git-ignored) and are mirrored into `process.env`, so request-time values (WhatsApp token, OpenAI key/model, Graph version, Sheet/Drive IDs) take effect **live**. Infra keys (Redis host/port, HTTP port) are flagged *“requires restart.”*
- **Live health panel:** a status lamp per service (Redis / WhatsApp / OpenAI / Google) with latency and detail, backed by `GET /api/health/services`.

Config REST API (same auth): `GET /api/config`, `PUT /api/config`, `GET /api/health/services`.

---

## 🩺 Diagnostics & tests

```bash
npm run doctor   # check every external service (exit 1 if any fail) — great for CI/healthchecks
npm test         # full suite: config, validators, history repair, conversation store,
                 # WhatsApp send (mocked Graph), diagnostics, dashboard API
```

- **`src/diagnostics.js`** holds the shared checks used by the CLI, the API and the settings UI — one source of truth for “is service X reachable?”.
- The test suite (Node's built-in `node:test`) mocks the external HTTP boundaries (Graph / OpenAI) via `GRAPH_BASE` / `OPENAI_BASE`, and runs Redis-backed tests against a local server (`pretest` starts one automatically). No real credentials required.

> **Google auth mode:** this build uses a **Service Account** that owns files in *My Drive*. Put `service-account.json` at the project root and set `GOOGLE_APPLICATION_CREDENTIALS=/app/service-account.json` (already done in Docker).

---

## ☁️ Deployment with Docker Compose + ngrok

**docker-compose.yml** (excerpt)
```yaml
services:
  webhook:
    environment:
      - LOG_TZ=Asia/Jerusalem
      - DEBUG_LEVEL=2
      - GOOGLE_APPLICATION_CREDENTIALS=/app/service-account.json

  ngrok:
    image: ngrok/ngrok:latest
    env_file: .env
    environment:
      - NGROK_AUTHTOKEN=${NGROK_AUTHTOKEN}
    command: >
      http --domain=${NGROK_DOMAIN}
           --region=${NGROK_REGION:-eu}
           --log=stdout --log-format=logfmt
           webhook:8197
    ports: ["4040:4040"]
```

**Dockerfile** (excerpt)
```dockerfile
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tzdata
ENV TZ=Asia/Jerusalem
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone
ENV NODE_ENV=production
COPY --from=base /app/node_modules ./node_modules
COPY . .
CMD ["node", "src/index.js"]
```

**Why ngrok as a sidecar?**
- Keeps your local machine out of the loop — reproducible prod‑like URL in CI/dev.
- Uses your **reserved domain** so the webhook URL is stable across restarts.

---

## 📝 Logging & time zone

The tiny logger prints ISO timestamps. Set `LOG_TZ=Asia/Jerusalem` (env on both `webhook` and `poller`) so operational logs align with Israel local time. The Docker image also installs `tzdata` and sets `TZ=Asia/Jerusalem` for system tools.

```js
// src/logger.js
const LEVEL = Number(process.env.DEBUG_LEVEL || 1);
const ts = () => new Date().toLocaleString('sv-SE', { timeZone: process.env.LOG_TZ || 'UTC' }).replace(' ', 'T');
export const log = { /* error/info/debug/step … */ };
```

---

## 🔒 Security & privacy

- WhatsApp token never logged; only error codes & request ids.
- Service Account limits access to a single Workspace; files stay under **My Drive**.
- Redis protected by password and AOF persistence. Mount a volume for durability.
- Minimal scopes on Google APIs: Drive file ops + Sheets values.

---

## 💡 Why it matters (problem → solution → impact)

- **Problem:** Lawyer intake on WhatsApp is chaotic — files scatter, follow‑ups are manual, and context gets lost.
- **Solution:** Treat messaging as events. Stream every artifact to Drive, capture state in Redis, and let GPT summarise the narrative after quiet periods.
- **Impact:** Paralegals stop hunting screenshots; attorneys open one folder with `chat.txt` + `summary.txt` and jump straight to action.

> Result: faster triage, fewer back‑and‑forths, and auditable case history.

---

## 🗺️ Roadmap

- LLM‑based document classification + OCR summary
- BigQuery + Looker Studio intake KPIs
- Vault‑mode encryption on uploads (Tink/KMS)
- Next.js lawyer dashboard with live timeline
- Helm chart & GitHub Actions for one‑click deploy

---

## 👋 About the author

I architect, code, and ship **production‑grade** systems bridging real‑time messaging, AI inference, and cloud APIs — comfortable across Linux containers, Redis internals, OAuth 2.0 flows, and GPT‑4o prompt/tool design.

> Let’s build the next delightful workflow together.

---

© 2025 Neora — MIT License
