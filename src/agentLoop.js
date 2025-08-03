// ────────────────────────────────────────────────────────────────
//  src/agentLoop.js   ·   GPT worker  (v2025-08-03, prod)
// ────────────────────────────────────────────────────────────────
import fs          from 'node:fs';
import { OpenAI }   from 'openai';
import redis        from './redis.js';
import fns          from './functionsImpl.js';
import {
  repairHistory,
  ensureSystemPrompt,
  sanitizeForOpenAI
}                   from './chatHistory.js';
import {
  queueInboundMedia,
  popNextMedia,
  scheduleFolderLink
}                   from './linkScheduler.js';
import { bump as idleBump } from './idleManager.js';
import { log }      from './logger.js';

/* ─────────────── Short-hands ─────────────── */
const {
  lookupClient,
  createFolder,
  saveMedia,
  sendWhatsApp,          // raw (single attempt)
  saveChatBundleUpdate
} = fns;

/* ─────────────── OpenAI ─────────────── */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ─────────────── Helper: retry w/ backoff ─────────────── */
async function sendWhatsAppSafe (args) {
  const DELAYS = [0, 500, 1000, 2000];          // ms; 1st = immediate
  for (let i = 0; i < DELAYS.length; i++) {
    if (DELAYS[i]) await new Promise(r => setTimeout(r, DELAYS[i]));
    const res = await sendWhatsApp(args);
    if (res.ok) return res;

    log.error('sendWhatsAppSafe', 'retry_attempt', {
      to     : args.to,
      attempt: i,
      err    : res.error
    });
    /* break early on non-network errors */
    if (!['ETIMEDOUT', 'ENETUNREACH', 'token_expired'].includes(res.error)) break;
  }
  log.error('sendWhatsAppSafe', 'retry_giveup', { to: args.to });
  return { ok:false, error:'give_up' };
}

/* ─────────────── GPT settings ─────────────── */
const TOOLS        = JSON.parse(fs.readFileSync('config/functions.json', 'utf8'));
const FALLBACK_MSG = 'מצטערים, נתקלנו בתקלה טכנית זמנית. אנא נסו שוב.';

const SYSTEM_PROMPT = `
אתה Legal‑Intake‑Agent במשרד עורכת‑הדין עדן חגג.
תחומי התמחות: נזיקין (ביטוח לאומי, נכויות, תאונות עבודה/דרכים, תביעות ביטוח וסיעוד)
וליטיגציה אזרחית (חוזים, כספיות, לשון הרע, דיני עבודה, מסחרי וחברות).

כללים:
1. בדיקה בגיליון "Clients" לפי תעודת זהות (lookupClient).
2. אם קיים ➜ צור תיקייה רק אם folderId ריק (createFolder).
3. אם לא קיים ➜ בקש פרטים, צור תיקייה, עדכן גיליון.
4. בקש והעלה מסמכים חסרים (saveMedia לכל קובץ).
5. אין לשלוח קישור Drive פרטני. קישור מרוכז יישלח אוטומטית לאחר שהמערכת זיהתה שהעלאות הסתיימו.
6. בסיום הפעל saveChatLog בפורמט "[bot] … / [user] …" (שמירת לוג היום מתקיימת ע״י השרת).
7. אם הועלה הקובץ האחרון או חלפו 6 דקות ללא פעילות – השרת ישמור לוג אוטומטית; אין צורך לקרוא ידנית.
כל התשובות בעברית רשמית ותמציתית.
`;


/* ───────────────────────── Main handler ───────────────────────── */
export async function agentHandle (waMsg) {
  await queueInboundMedia(waMsg);

  const convKey = `conv:${waMsg.from}`;
  log.step('agentHandle', 'start', { from: waMsg.from, type: waMsg.type });

  /* build history */
  let history = JSON.parse((await redis.get(convKey)) || '[]');
  history     = ensureSystemPrompt(history, SYSTEM_PROMPT);
  history.push({ role:'user', content: waMsg.text?.body ?? `[${waMsg.type}]` });

  /* GPT loop */
  while (true) {
    const { history: safe } = repairHistory(history);
    const messages          = sanitizeForOpenAI(safe);

    let oa;
    try {
      oa = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools: TOOLS,
        tool_choice: 'auto'
      });
    } catch (err) {
      log.error('agentHandle', 'openai_failed', err);
      await sendWhatsAppSafe({ to: waMsg.from, text: FALLBACK_MSG });
      return;
    }

    const msg = oa.choices[0].message;

    /* ---------- Tool-calls ---------- */
    if (msg.tool_calls) {
      history.push({ ...msg, content: msg.content ?? '' });

      const toolReplies      = [];
      let   hadError         = false,
            tokenExpired     = false;
      const sentTexts        = new Set();      // ← dedup key

      for (const tc of msg.tool_calls) {
        const argsIn = JSON.parse(tc.function.arguments || '{}');
        let   result;

        try {
          switch (tc.function.name) {
            case 'lookupClient':  result = await lookupClient(argsIn);  break;

            case 'createFolder':
              result = await createFolder(argsIn);
              if (result.ok) idleBump(waMsg.from, result.folderId);
              break;

            case 'saveMedia': {
              let { folderId, mediaId, mediaType } = argsIn;

              if (!mediaId || !mediaType || !/^\d+$/.test(mediaId)) {
                const next = await popNextMedia(waMsg.from);
                if (next) ({ id: mediaId, type: mediaType } = next);
              }

              if (!mediaId || !mediaType) {
                result = { ok:false, error:'no_media_in_queue' };
              } else {
                result = await saveMedia({ folderId, mediaId, mediaType });
                if (result.ok) {
                  await scheduleFolderLink(waMsg.from, folderId);
                  idleBump(waMsg.from, folderId);
                  result = { ok:true };
                }
              }
              break;
            }

            case 'sendWhatsApp': {
              const dedupKey = argsIn.text ?? `tpl:${argsIn.templateName}`;
              if (sentTexts.has(dedupKey)) {
                log.debug('agentHandle', 'dedup_skip', { to: waMsg.from, key: dedupKey });
                result = { ok:true, skipped:true };
              } else {
                sentTexts.add(dedupKey);
                result = await sendWhatsAppSafe({ ...argsIn, to: waMsg.from });
              }
              break;
            }

            case 'saveChatLog':   // legacy
              result = await saveChatBundleUpdate(argsIn);
              break;

            default:
              result = { ok:false, error:'unknown_tool' };
          }
        } catch (err) {
          log.error('agentHandle', `tool_${tc.function.name}_failed`, err);
          result = { ok:false, error: err.message || 'tool_failed' };
        }

        if (!result.ok) {
          hadError = true;
          if (result.error === 'token_expired') tokenExpired = true;
        }

        toolReplies.push({
          role:'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        });
      }

      history.push(...toolReplies);

      if (hadError) {
        const txt = tokenExpired
          ? 'הטוקן שלנו לוואטסאפ פג תוקף – אנו מעדכנים וחוזרים אליך.'
          : FALLBACK_MSG;
        await sendWhatsAppSafe({ to: waMsg.from, text: txt });
        history.push({ role:'assistant', content: txt });
        break;
      }

      continue;   // back to GPT
    }

    /* ---------- Assistant plain-text ---------- */
    if (msg.content) {
      await sendWhatsAppSafe({ to: waMsg.from, text: msg.content });
      history.push({ role:'assistant', content: msg.content });
    }
    break;
  }

  /* persist */
  await redis.set(convKey, JSON.stringify(history), 'EX', 60 * 60 * 24 * 3);
  log.step('agentHandle', 'end', { convKey });
}
