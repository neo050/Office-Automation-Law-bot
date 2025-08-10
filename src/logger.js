// src/logger.js
/**
 * Minimal structured logger with levels and local timezone timestamps.
 *
 * ENV:
 *   - DEBUG_LEVEL: 0/1/2/3  → 0=silent, 1=errors, 2=info, 3=debug (default: 2)
 *   - LOG_TZ: IANA timezone name to format timestamps in (default: Asia/Jerusalem)
 *             Falls back to process.env.TZ if LOG_TZ is not set.
 *
 * Notes:
 *   - Do NOT use Date.toISOString() if you want local time; it's always UTC (Z).
 *   - This file formats timestamps via Intl.DateTimeFormat with an explicit timeZone.
 *   - On Alpine images, ensure tzdata is installed if you set TZ/LOG_TZ to a specific zone.
 *     (e.g., in Dockerfile: `apk add --no-cache tzdata`)
 */

const LEVEL = Number(process.env.DEBUG_LEVEL ?? 2);
const ZONE  = process.env.LOG_TZ || process.env.TZ || 'Asia/Jerusalem';

/** Build a human-readable timestamp in the configured timezone.
 *  Format: "YYYY-MM-DD HH:mm:ss.SSS"
 *  If the timezone is not available, falls back to ISO UTC. */
function ts() {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-IL', {
      timeZone : ZONE,
      year     : 'numeric',
      month    : '2-digit',
      day      : '2-digit',
      hour     : '2-digit',
      minute   : '2-digit',
      second   : '2-digit',
      hour12   : false
    });
    const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
    const ms    = String(now.getMilliseconds()).padStart(3, '0');
    // YYYY-MM-DD HH:mm:ss.SSS
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${ms}`;
  } catch {
    // Fallback: UTC ISO string if Intl/zone unavailable
    return new Date().toISOString();
  }
}

/** Render a single log line with consistent shape. */
function line(level, scope, msg, extra) {
  const suffix =
    extra === undefined
      ? ''
      : (typeof extra === 'string' ? ` ${extra}` : ` ${JSON.stringify(extra)}`);
  // Include the zone tag so readers know this is local IL time
  return `[${ts()} ${ZONE}] ${level.padEnd(5)} ${scope}: ${msg}${suffix}`;
}

/** Public logging API */
export const log = {
  error(scope, msg, extra) { if (LEVEL >= 1) console.error(line('ERROR', scope, msg, extra)); },
  info (scope, msg, extra) { if (LEVEL >= 2) console.log  (line('INFO',  scope, msg, extra)); },
  debug(scope, msg, extra) { if (LEVEL >= 3) console.log  (line('DEBUG', scope, msg, extra)); },
  step (scope, action, extra) {
    if (LEVEL >= 2) console.log(line('STEP', `${scope} -> ${action}`, extra));
  }
};
