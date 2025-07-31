// src/index.js
import 'dotenv/config';

const role = process.env.RUN_ROLE || 'webhook';
console.log('▶ starting role:', role);

try {
  if (role === 'webhook') {
    await import('./webhookServer.js');
  } else if (role === 'poller') {
    await import('./linkPoller.js');
  } else {
    throw new Error(`Unknown RUN_ROLE "${role}"`);
  }
} catch (err) {
  console.error('[boot] fatal:', err.message);
  process.exit(1);
}
