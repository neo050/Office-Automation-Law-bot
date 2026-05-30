import { summarizeTranscript, saveChatBundleUpdate } from './functionsImpl.js';
import { buildLogFromRedis } from './chatHistory.js';
import { claimSummarySlot } from './linkScheduler.js';
import { log } from './logger.js';

const IDLE_MS = Number(process.env.IDLE_MS) || 6 * 60 * 1000; // 6 minutes
const timers  = new Map();

export function bump(phone, folderId) {
  if (!folderId) return;
  clearTimeout(timers.get(phone));
  timers.set(phone, setTimeout(() => fire(phone, folderId), IDLE_MS));
}

async function fire(phone, folderId) {
  log.step('idleManager','timeout',{ phone });
  try {
    // Skip if linkPoller (or a prior idle fire) just summarised this folder.
    if (!(await claimSummarySlot(folderId))) {
      log.info('idleManager', 'skip_recent_summary', { phone, folderId });
      return;
    }
    const raw = await buildLogFromRedis(`conv:${phone}`);
    const { summary } = (await summarizeTranscript(raw)) || {};
    await saveChatBundleUpdate({ folderId, raw, summary: summary || '' });
  } catch (e) {
    log.error('idleManager','failed',{ phone, err:e });
  } finally {
    timers.delete(phone);
  }
}
