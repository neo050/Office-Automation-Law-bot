// ────────────────────────────────────────────────────────────────
//  src/doctor.js  ·  CLI health check for all services
//  Usage:  npm run doctor      (exits non-zero if any service fails)
// ────────────────────────────────────────────────────────────────
import 'dotenv/config';
import cfg            from './config.js';
import { checkAll }   from './diagnostics.js';

await cfg.load();

const ICON = { ok: '✅', fail: '❌', skip: '⚪' };

const { ok, checks } = await checkAll();

console.log('\n  Service health\n  ─────────────');
for (const c of checks) {
  const lat = c.latencyMs == null ? '' : `(${c.latencyMs}ms)`;
  console.log(`  ${ICON[c.status] || '?'}  ${c.service.padEnd(9)} ${c.status.padEnd(5)} ${c.detail} ${lat}`);
}
console.log('');

if (!ok) {
  console.error('  ✗ One or more services are unhealthy.\n');
  process.exit(1);
}
console.log('  ✓ All reachable services are healthy.\n');
// Allow open Redis handles to close.
process.exit(0);
