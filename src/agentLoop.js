// ────────────────────────────────────────────────────────────────
//  src/agentLoop.js   ·   GPT worker  (v2025-08-04, prod-hardened)
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
import { PHONE_RE, NAME_RE } from './validators.js';
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
  const DELAYS = [0, 500, 1000, 2000];          // ms
  for (let i = 0; i < DELAYS.length; i++) {
    if (DELAYS[i]) await new Promise(r => setTimeout(r, DELAYS[i]));
    const res = await sendWhatsApp(args);
    if (res.ok) return res;

    log.error('sendWhatsAppSafe', 'retry_attempt', { to: args.to, attempt: i, err: res.error });
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
  כל התשובות בעברית רשמית ותמציתית מנוסחת בלשון זכר ונקבה לדוגמה: תשלח/י את/ה
`;

/* ───────── helpers: client state ───────── */
const clientKey = phone => `client:${phone}`;
async function getClientState (phone) {
  return JSON.parse(await redis.get(clientKey(phone)) || '{}');
}
async function setClientState (phone, state, ttl = 60 * 60 * 24) {
  await redis.set(clientKey(phone), JSON.stringify(state), 'EX', ttl);
  log.debug('agentHandle', 'client_state_saved', { phone, state });
}

/* ───────────────────────── Main handler ───────────────────────── */
export async function agentHandle (waMsg) {
  await queueInboundMedia(waMsg);

  const derivedPhone = waMsg.from;        // E.164 w/o +
  const convKey      = `conv:${derivedPhone}`;
  log.step('agentHandle', 'start', { from: derivedPhone, type: waMsg.type });

  /* -------- ① PHONE CONFIRMATION LAYER -------- */
  let cState = await getClientState(derivedPhone);

  
  if (cState.awaitingPhone) {
    const body = waMsg.text?.body?.trim() || '';
    if (/^כן$/i.test(body)) {
      cState = { phoneConfirmed:true };
      await setClientState(derivedPhone, cState);
      await sendWhatsAppSafe({ to: derivedPhone, text: 'המספר אומת והוזן במערכת. נמשיך בתהליך.' });
      log.info('agentHandle', 'phone_confirmed', { phone: derivedPhone });
    } else if (PHONE_RE.test(body)) {
      cState = { phoneConfirmed:true, phoneOverride: body };
      await setClientState(derivedPhone, cState);
      await sendWhatsAppSafe({ to: derivedPhone, text: `המספר ${body} נשמר. נמשיך.` });
      log.info('agentHandle', 'phone_overridden', { phone: derivedPhone, override: body });
    } else {
      await sendWhatsAppSafe({ to: derivedPhone, text:'לא זוהה מספר תקין. אנא השב/י "כן" או הקלד/י מספר מלא בפורמט 972…' });
      log.debug('agentHandle', 'bad_phone_format', { from: derivedPhone, body });
      return; 
    }
  }

  
  if (!cState.phoneConfirmed) {
    await setClientState(derivedPhone, { awaitingPhone:true }, 60 * 10);
    await sendWhatsAppSafe({
      to  : derivedPhone,
      text: `האם לשמור את מספר ${derivedPhone} כמספר ליצירת קשר? השב/י "כן" או הקלד/י מספר אחר.`
    });
    log.step('agentHandle', 'await_phone_confirm', { phone: derivedPhone });
    return;
  }

  const phoneForSheet = cState.phoneOverride || derivedPhone;


  if (!cState.fullNameConfirmed) {
  // אם ממתינים לשם
  if (cState.awaitingFullName) {
    const body = waMsg.text?.body?.trim() || '';

    if (/^כן$/i.test(body) && cState.pendingName) {
      cState = { ...cState, fullNameConfirmed:true, fullName:cState.pendingName };
      delete cState.awaitingFullName;
      delete cState.pendingName;
      await setClientState(derivedPhone, cState);
      await sendWhatsAppSafe({ to: derivedPhone, text:`השם "${cState.fullName}" נשמר. נמשיך.` });
      log.info('agentHandle', 'fullName_confirmed', { phone: derivedPhone, fullName:cState.fullName });

    } else if (NAME_RE.test(body)) {
      // קיבלנו שם – מבקשים אישור
      cState = { ...cState, awaitingFullName:true, pendingName:body };
      await setClientState(derivedPhone, cState, 60*10);
      await sendWhatsAppSafe({
        to  : derivedPhone,
        text: `לאשר את השם "${body}"? השב/י "כן" או הקלד/י שם מתוקן.`
      });
      log.step('agentHandle', 'ask_fullName_confirm', { phone: derivedPhone, candidate: body });
    } else {
      await sendWhatsAppSafe({ to: derivedPhone, text:'נא להקליד שם מלא (לפחות שתי מילים).' });
      log.debug('agentHandle', 'bad_fullName_format', { phone: derivedPhone, body });
    }
    return;                // ממתינים, לא ממשיכים ל-GPT
  }

  // start dialog for the first time
  await setClientState(derivedPhone, { ...cState, awaitingFullName:true }, 60*10);
  await sendWhatsAppSafe({ to: derivedPhone, text:'נא להקליד את שמך המלא כפי שמופיע בת.ז.' });
  log.step('agentHandle', 'await_fullName', { phone: derivedPhone });
  return;
}

const fullNameForSheet = cState.fullName;

  /* -------- ② GPT FLOW -------- */
  let history = JSON.parse((await redis.get(convKey)) || '[]');
  history     = ensureSystemPrompt(history, SYSTEM_PROMPT);
  history.push({ role:'user', content: waMsg.text?.body ?? `[${waMsg.type}]` });

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
      await sendWhatsAppSafe({ to: derivedPhone, text: FALLBACK_MSG });
      return;
    }

    const msg = oa.choices[0].message;

    /* ---------- Tool-calls ---------- */
    if (msg.tool_calls) {
      history.push({ ...msg, content: msg.content ?? '' });

      const replies       = [];
      const sentTexts     = new Set();
      let   hadError      = false,
            tokenExpired  = false;

      for (const tc of msg.tool_calls) {
        const argsIn = JSON.parse(tc.function.arguments || '{}');
        let   result;

        try {
          switch (tc.function.name) {
            case 'lookupClient':{
                      result = await lookupClient({ ...argsIn,
                                      phone    : phoneForSheet,
                                      fullName : fullNameForSheet });

                      if (!result.ok) {
                        if (result.error === 'missing_fullName') {
                            log.error('lookupClient_missing_fullName',
                                    { phone: derivedPhone, fullName: fullNameForSheet }); 
                        } else if (result.error === 'missing_phone') {

                          log.error('lookupClient_missing_phone', { phone: derivedPhone });
                          }
                        }
                       break;
                    }
                    case 'createFolder': {
                      result = await createFolder({
                        ...argsIn,
                        phone: phoneForSheet,
                        fullName: fullNameForSheet
                      });

                      if (!result.ok) {
                        const logData = { phone: derivedPhone, err: result.error };
                        if (result.error === 'missing_phone') {
                          log.error('createFolder_missing_phone', logData);
                        } else if (result.error === 'missing_fullName') {
                          log.error('createFolder_missing_fullName', {
                            ...logData,
                            fullName: fullNameForSheet ?? null
                          });
                        } else {
                          log.error('createFolder_failed', logData);
                        }
                        // ⚠️ אין צורך ב-hadError כאן – הבלוק הכללי כבר מטפל
                      } else {
                        idleBump(derivedPhone, result.folderId);
                      }
                      break;
                    }


            case 'saveMedia': {
              let { folderId, mediaId, mediaType } = argsIn;
              if (!folderId) {
                result = { ok:false, error:'missing_folder' };
                log.error('agentHandle', 'schedule_missing_folder', { phone: derivedPhone });
                break;
              }
              if (!mediaId || !mediaType || !/^\d+$/.test(mediaId)) {
                const next = await popNextMedia(derivedPhone);
                if (next) ({ id: mediaId, type: mediaType } = next);
              }
              if (!mediaId || !mediaType) {
                result = { ok:false, error:'no_media_in_queue' };
              } else {
                result = await saveMedia({ folderId, mediaId, mediaType });
                if (result.ok) {
                  await scheduleFolderLink(derivedPhone, folderId);
                  idleBump(derivedPhone, folderId);
                  result = { ok:true };
                }
              }
              break;
            }

            case 'sendWhatsApp': {
              const dedupKey = argsIn.text ?? `tpl:${argsIn.templateName}`;
              if (sentTexts.has(dedupKey)) {
                log.debug('agentHandle', 'dedup_skip', { to: derivedPhone, key: dedupKey });
                result = { ok:true, skipped:true };
              } else {
                sentTexts.add(dedupKey);
                result = await sendWhatsAppSafe({ ...argsIn, to: derivedPhone });
              }
              break;
            }

            case 'saveChatLog':
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

        replies.push({ role:'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }

      history.push(...replies);

      if (hadError) {
        const txt = tokenExpired
          ? 'הטוקן שלנו לוואטסאפ פג תוקף – אנו מעדכנים וחוזרים אליך.'
          : FALLBACK_MSG;
        await sendWhatsAppSafe({ to: derivedPhone, text: txt });
        history.push({ role:'assistant', content: txt });
        break;
      }
      continue;                 // ↻ GPT 
    }

    /* ---------- Assistant plain-text ---------- */
    if (msg.content) {
      await sendWhatsAppSafe({ to: derivedPhone, text: msg.content });
      history.push({ role:'assistant', content: msg.content });
    }
    break;
  }

  /* -------- Persist -------- */
  await redis.set(convKey, JSON.stringify(history), 'EX', 60 * 60 * 24 * 3);
  log.step('agentHandle', 'end', { convKey });
}
