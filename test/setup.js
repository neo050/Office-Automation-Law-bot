// Preloaded (via --import) before every test file's module graph is built.
// Ensures modules that read credentials / keys at import time can boot in CI.
import fs from 'node:fs';

if (!fs.existsSync('client_secret.json')) {
  fs.writeFileSync('client_secret.json', JSON.stringify({
    installed: { client_id: 'test', client_secret: 'test', redirect_uris: ['urn:ietf:wg:oauth:2.0:oob'] }
  }));
}
if (!fs.existsSync('token.json')) {
  fs.writeFileSync('token.json', JSON.stringify({ access_token: 'test', refresh_token: 'test' }));
}

process.env.OPENAI_API_KEY ||= 'sk-test';
process.env.DEBUG_LEVEL    ||= '0';                       // silence logs in tests
process.env.REDIS_NS       ||= 'test';                    // isolate test keys (incl. cfg:overrides)
