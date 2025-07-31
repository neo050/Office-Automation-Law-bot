// ─────────────────────────────────────────────────────────────────────────────
// agentLoop.js   ·   GPT worker  (31‑Jul‑25)
// ─────────────────────────────────────────────────────────────────────────────
import fs           from 'node:fs';
import { OpenAI }   from 'openai';
import redis        from './redis.js';
import fns          from './functionsImpl.js';
import {
  repairHistory,
  ensureSystemPrompt,
  sanitizeForOpenAI
} from './chatHistory.js';
import {
  queueInboundMedia,
  popNextMedia,
  scheduleFolderLink
} from './linkScheduler.js';
import { log }      from './logger.js';

/* ─────────────── Short‑hands ─────────────── */
const {
  lookupClient,
  createFolder,
  saveMedia,
  sendWhatsApp,
  saveChatLog
} = fns;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ─────────────── GPT settings ─────────────── */
const TOOLS = JSON.parse(fs.readFileSync('config/functions.json','utf8'));
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
6. בסיום הפעל saveChatLog בפורמט "[bot] … / [user] …".
כל התשובות בעברית רשמית ותמציתית.
`;

/* ───────────────────────── Main handler ───────────────────────── */
export async function agentHandle(waMsg) {
  /* ① שומר מדיה בתור (כולל דדופ שכבר נמצא ב‑linkScheduler) */
  await queueInboundMedia(waMsg);

  const convKey = `conv:${waMsg.from}`;
  log.step('agentHandle','start',{ from:waMsg.from, type:waMsg.type });

  let history = JSON.parse((await redis.get(convKey)) || '[]');
  history     = ensureSystemPrompt(history, SYSTEM_PROMPT);
  history.push({ role:'user', content: waMsg.text?.body ?? `[${waMsg.type}]` });

  /* ② לולאת GPT • tool‑calls */
  while (true) {
    const { history: safe } = repairHistory(history);
    const messages = sanitizeForOpenAI(safe);

    let oa;
    try {
      oa = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools: TOOLS,
        tool_choice: 'auto'
      });
    } catch (err) {
      log.error('agentHandle','OpenAI error', err);
      await sendWhatsApp({ to: waMsg.from, text: FALLBACK_MSG });
      return;
    }

    const msg = oa.choices[0].message;

    /* ---------- Tool calls ---------- */
    if (msg.tool_calls) {
      history.push({ ...msg, content: msg.content ?? '' });

      const toolReplies = [];
      let hadError = false, tokenExpired = false;

      for (const tc of msg.tool_calls) {
        const argsIn = JSON.parse(tc.function.arguments || '{}');
        let result;

        try {
          switch (tc.function.name) {
            case 'lookupClient':{
              result = await lookupClient(argsIn);
              break;
            }

            case 'createFolder':{
              result = await createFolder(argsIn);
              break;
            }

            case 'saveMedia': {
              const { folderId } = argsIn;
              let   { mediaId, mediaType } = argsIn;

              if (!mediaId || !mediaType || !/^\d+$/.test(mediaId)) {
                const next = await popNextMedia(waMsg.from);
                if (next) ({ id: mediaId, type: mediaType } = next);
              }

              if (!mediaId || !mediaType) {
                result = { ok:false, error:'no_media_in_queue' };
              } else {
                /* actual upload */
                result = await saveMedia({ folderId, mediaId, mediaType });
                if (result.ok) {
                  /* ③ קבע תזמון לינק */
                  await scheduleFolderLink(waMsg.from, folderId);
                  /* אל תדליף URL ל‑GPT */
                  result = { ok:true };
                }
              }
              break;
            }

            case 'sendWhatsApp':{
              await sendWhatsApp({ ...argsIn, to: waMsg.from });
              result = { ok:true };
              break;
            }

            case 'saveChatLog':{
              result = await saveChatLog(argsIn);
              break;
            }

            default:
              result = { ok:false, error:'unknown_tool' };
          }
        } catch (err) {
          log.error('agentHandle',`tool ${tc.function.name} failed`,err);
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
          ? 'הטוקן שלנו לוואטסאפ פג תוקף, אנו מעדכנים וחוזרים אליך.'
          : FALLBACK_MSG;
        await sendWhatsApp({ to: waMsg.from, text: txt });
        history.push({ role:'assistant', content: txt });
        break;
      }

      /* ↻ back to GPT */
      continue;
    }

    /* ---------- Assistant message ---------- */
    if (msg.content) {
      await sendWhatsApp({ to: waMsg.from, text: msg.content });
      history.push({ role:'assistant', content: msg.content });
    }
    break;
  }

  /* persist */
  await redis.set(convKey, JSON.stringify(history), 'EX', 60*60*24*3);
  log.step('agentHandle','end',{ convKey });
}
