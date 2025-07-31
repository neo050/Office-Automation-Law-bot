/**
 * Tiny logger with levels. Set DEBUG_LEVEL=0/1/2/3
 * 0=silent, 1=errors, 2=info, 3=debug
 */
const LEVEL = Number(process.env.DEBUG_LEVEL || 1);
const ts = () => new Date().toISOString();

export const log = {
  error(scope, msg, extra) { if (LEVEL >= 1) console.error(`[${ts()}] ERROR  ${scope}: ${msg}`, extra ?? ''); },
  info(scope, msg, extra)  { if (LEVEL >= 2) console.log(`[${ts()}] INFO   ${scope}: ${msg}`,  extra ?? ''); },
  debug(scope, msg, extra) { if (LEVEL >= 3) console.log(`[${ts()}] DEBUG  ${scope}: ${msg}`, extra ?? ''); },
  step(scope, action, extra){ if (LEVEL >= 2) console.log(`[${ts()}] STEP   ${scope} -> ${action}`, extra ?? ''); }
};