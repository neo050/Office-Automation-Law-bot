// src/index.js
import 'dotenv/config';
import cfg from './config.js';
import { log } from './logger.js';

// Apply runtime overrides (UI-edited settings, shared via Redis) into
// process.env before any service module reads its configuration.
await cfg.load();

const role = process.env.RUN_ROLE || 'webhook';
log.debug('▶ starting role:', role);

try {
  if (role === 'webhook') {
    await import('./webhookServer.js');
  } else if (role === 'poller') {
    await import('./linkPoller.js');
  } else {
    throw new Error(`Unknown RUN_ROLE "${role}"`);
  }
} catch (err) {
  log.error('[boot] fatal:', err.message);
  process.exit(1);
}
