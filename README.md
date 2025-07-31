# 📁  Law‑Bot

Conversational intake assistant for a boutique Israeli law firm – built as a **cloud‑native, event‑driven micro‑service** that fuses **WhatsApp Business Cloud API**, **OpenAI GPT‑4o**, and **Google Workspace** into one seamless workflow.

---

## ✨  What it Does

1. **On‑boarding over WhatsApp** – verifies a client by national‑ID and walks them through a structured intake.
2. **Auto‑provisioning** – spins up a dedicated Google Drive folder and Sheets row per client.
3. **Zero‑loss media capture** – *every* document / image / video sent on WhatsApp is streamed into Drive (FIFO queue with dedup).
4. **Smart summarisation** – GPT‑4o triages the chat and stores a clean transcript in the case folder.
5. **Single “done” link** – once uploads pause for 5 min, the bot sends one consolidated Drive link instead of spamming per‑file links.

> Result: paralegals receive a tidy folder tree instead of a messy WhatsApp thread – and the client feels they’re talking to a human.

---

## 🏗  High‑Level Architecture

```
WhatsApp ↔️ Meta Webhook  →  webhookServer  ─┐
                                           │  saveMedia
                                           │
                                           ├─ queue (Redis)  ⇄  linkPoller  →  sendWhatsApp (Drive link)
                                           │
                                           └─ agentLoop (GPT‑4o orchestration) ↔️ OpenAI
                                                  │
                                                  └─ Google Drive + Sheets
```

* **webhookServer** – stateless Express handler, validates Meta signature, pushes media into Redis, delegates to `agentLoop`.
* **agentLoop** – reasoning loop with GPT‑4o; drives the function‑tool DSL, schedules the folder‑link.
* **linkPoller** – tiny worker that wakes every 10 sec, checks Redis ZSET for due phones, sends the single Drive link.
* **Redis** – central broker (streams, dedup sets, ZSET scheduler).
* **Google Drive API** – file storage via Service Account (domain‑wide delegated).
* **NGROK** – secure tunnel → webhook URL for Meta in dev & PoC.

> The stack is *Kubernetes‑friendly*: each worker is 100 % stateless, image‑based, health‑checked, and horizontally scalable.

---

## 🚀  Quick Start (local)

```bash
cp .env.sample .env      # fill tokens, IDs, secrets
ngrok http 8197          # expose Webhook – copy https://… to Meta portal
docker compose up -d --build
```

* `RUN_ROLE=webhook` container receives webhooks on port 8197.
* `RUN_ROLE=poller` container dispatches Drive links.
* `redis` lives inside the compose stack with AOF persistence.

### Environment knobs

| variable                         | what for                               |
| -------------------------------- | -------------------------------------- |
| `PERMANENT_WABA_TOKEN`           | WhatsApp Business token (long‑lived)   |
| `GOOGLE_APPLICATION_CREDENTIALS` | path to Service‑Account JSON           |
| `WHATSAPP_VERIFY_TOKEN`          | webhook verify echo                    |
| `DRIVE_ROOT_ID`                  | master client‑folders directory        |
| `REDIS_PASS`                     | redis‑auth (secure even in dev)        |
| `REDIS_NS`                       | optional namespace – great for staging |

---

## 🛠  Under the Hood

* **Node 22 (ES Modules)** with modern `fetch` & native stream primitives.
* **OpenAI Functions** – runtime tool‑calling between GPT‑4o and bespoke business logic.
* **Idempotent media ingestion** – SHA‑negligible hash via Redis SET prevents duplicates.
* **Sorted‑set scheduler** – O(log n) redis ZSET drives the “send link after X ms of silence” rule.
* **Observability** – structured `log.step()` breadcrumbs in every async hop.
* **12‑factor ready** – config via env‑vars, disposable containers, stateless code, concurrency friendly.

---

## 🔭  Roadmap & Stretch Ideas

| Area           | Next step                                                 | Impact                                            |
| -------------- | --------------------------------------------------------- | ------------------------------------------------- |
| **AI**         | LLM‑powered document classification & auto‑OCR summary    | “deposit slip” → instantly filed under *Receipts* |
| **Frontend**   | Lawyer dashboard (Next.js + tRPC) with live case timeline | removes e‑mail‑ping‑pong                          |
| **Compliance** | Vault‑mode encryption (Tink, KMS) on Drive uploads        | GDPR / HIPAA readiness                            |
| **Ops**        | Helm chart & GitHub Actions CI/CD                         | one‑click deploy to GKE / EKS                     |
| **Analytics**  | BigQuery + Looker Studio for intake funnel KPIs           | data‑driven staffing                              |

---



I architect, code, and ship *production‑grade* systems that bridge **real‑time messaging, AI inference, and cloud APIs**.  Comfortable across the stack – from Linux containers, Redis internals and OAuth 2.0 flows to prompt‑engineering on GPT‑4o.

Always keen to discuss **LLM agent design, event‑sourcing, serverless pipelines, and developer‑experience tooling**.

> *Let’s build the next delightful workflow together.*

---

© 2025 Neora – MIT License
