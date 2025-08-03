# 📁  Office-Automation-Law-bot – August 2025 Edition

Conversational intake assistant for a boutique Israeli law firm – built as a **cloud‑native, event‑driven micro‑service** that fuses **WhatsApp Business Cloud API**, **OpenAI GPT‑4o**, and **Google Workspace** into one seamless workflow.

---

## ✨  What it Does – v2

| #     | Flow element                                                                                                                                                                                           | New in v2? | Outcome                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------- |
| **1** | **On‑boarding over WhatsApp** – verifies a client by national‑ID and walks them through a structured intake                                                                                            |            | friction‑free first contact                        |
| **2** | **Auto‑provisioning** – spins up a dedicated Google Drive folder **and updates a Sheets row** per client                                                                                               |            | single source of truth                             |
| **3** | **Zero‑loss media capture** – every document / image / video is streamed into Drive (FIFO queue with dedup)                                                                                            |            | nothing slips through                              |
| **4** | **Smart summarisation ▸❯** – *after each quiet period* GPT‑4o appends a dated summary to `summary.txt` and the raw transcript to `chat.txt` inside the case folder (**no files are ever overwritten**) | **✔**      | paralegal skims one file instead of scrolling chat |
| **5** | **Single “done” link** – once uploads pause for 5 min the bot sends one consolidated Drive link instead of spamming per‑file links                                                                     |            | keeps client UX tidy                               |

> **Δ Upgrade note:** summaries are now cumulative – each session is time‑stamped and appended, giving lawyers a living chronology of the case.

---

## 🏗  High‑Level Architecture

```
WhatsApp ↔ Meta Webhook → webhookServer ─┐
                                         │ saveMedia (FIFO)
                                         │
                                         ├─ queue (Redis)
                                         │     ├─ idleManager   – summarise + append after 6 min idle
                                         │     └─ linkPoller    – sends Drive link after 5 min idle
                                         │
                                         └─ agentLoop (GPT‑4o orchestration)
                                                │
                                                ├─ OpenAI (tool‑calls)
                                                └─ Google Drive + Sheets
```

* **idleManager** – brand‑new worker that fires after 6 min inactivity, runs **summarise → append** cycle and keeps Redis clean.

---

## 🚀  Quick Start (local)

```bash
cp .env.sample .env           # fill tokens, IDs, secrets
ngrok http 8197               # expose Webhook – copy https://… to Meta portal
docker compose up -d --build  # builds webhook + poller + idleManager
```

| Container | Role                           | Health‑check         |
| --------- | ------------------------------ | -------------------- |
| `webhook` | receive & route Meta webhooks  | `/healthz` (express) |
| `poller`  | send consolidated Drive links  | `/live` (heartbeat)  |
| `idle`    | create summaries + append logs | `/ready`             |

### Environment knobs

| variable                         | purpose                                          | default       |
| -------------------------------- | ------------------------------------------------ | ------------- |
| `PERMANENT_WABA_TOKEN`           | WhatsApp Business token (long‑lived)             |               |
| `GOOGLE_APPLICATION_CREDENTIALS` | path to Service‑Account JSON                     |               |
| `WHATSAPP_VERIFY_TOKEN`          | webhook verify echo                              |               |
| `DRIVE_ROOT_ID`                  | master client‑folders directory                  |               |
| `SUMMARY_MODEL`                  | OpenAI model for summaries (`gpt-4o-mini`, etc.) | `gpt-4o-mini` |
| `POLL_EVERY_MS`                  | frequency of linkPoller tick                     | `10000`       |

---

## 🛠  Under the Hood

* **Node 22 (ES Modules)** with native stream primitives.
* **OpenAI Functions** – runtime tool‑calling between GPT‑4o and bespoke business logic.
* **Idempotent media ingestion** – SHA‑negligible hash via Redis SET prevents duplicates.
* **Two idle strategies**
  • **linkPoller** – sends Drive link after *5 min silence*
  • **idleManager** – appends summary & raw log after *6 min silence*
* **Sorted‑set scheduler** – O(log n) redis ZSET drives both idle workers.
* **Append‑update Drive pattern** – keeps single `chat.txt` / `summary.txt` per client, grows chronologically.
* **Observability** – structured `log.step()` breadcrumbs in every async hop.
* **12‑factor ready** – config via env‑vars, disposable containers, stateless code, concurrency friendly.

---

## 🔭  Roadmap & Stretch Ideas

| Area           | Next step                                                 | Impact                                            |
| -------------- | --------------------------------------------------------- | ------------------------------------------------- |
| **AI**         | LLM‑powered document classification & auto‑OCR summary    | “deposit slip” → instantly filed under *Receipts* |
| **Compliance** | Vault‑mode encryption (Tink, KMS) on Drive uploads        | GDPR / HIPAA readiness                            |
| **Frontend**   | Lawyer dashboard (Next.js + tRPC) with live case timeline | removes e‑mail‑ping‑pong                          |
| **Ops**        | Helm chart & GitHub Actions CI/CD                         | one‑click deploy to GKE / EKS                     |
| **Analytics**  | BigQuery + Looker Studio for intake funnel KPIs           | data‑driven staffing                              |

---

I architect, code, and ship *production‑grade* systems that bridge **real‑time messaging, AI inference, and cloud APIs**.  Comfortable across the stack – from Linux containers, Redis internals and OAuth 2.0 flows to prompt‑engineering on GPT‑4o.

Always keen to discuss **LLM agent design, event‑sourcing, serverless pipelines, and developer‑experience tooling**.

> *Let’s build the next delightful workflow together.*

---

© 2025 Neora – MIT License
