const test = require('node:test');
const assert = require('node:assert/strict');
const { trackWebhook, flushWebhooks, pendingWebhooksCount } = require('../libs/webhooks');

test('libs/webhooks.js - trackWebhook e flushWebhooks aguardam promessas em voo', async () => {
  let resolved = false;
  const pending = new Promise((resolve) => {
    setTimeout(() => {
      resolved = true;
      resolve('ok');
    }, 60);
  });

  trackWebhook(pending);
  assert.strictEqual(pendingWebhooksCount(), 1, 'deve registrar a promessa em voo');

  await flushWebhooks(1000);
  assert.strictEqual(resolved, true, 'flushWebhooks deve aguardar a promessa');

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.strictEqual(pendingWebhooksCount(), 0, 'promessa liquidada deve sair do set');
});

test('libs/webhooks.js - flushWebhooks respeita o teto de tempo', async () => {
  const never = new Promise(() => {});
  trackWebhook(never);

  const t0 = Date.now();
  await flushWebhooks(100);
  const elapsed = Date.now() - t0;

  assert.ok(elapsed >= 80, `deve aguardar o teto (~100ms), levou ${elapsed}ms`);
  assert.ok(elapsed < 2000, `não pode travar indefinidamente, levou ${elapsed}ms`);
});

test('libs/webhooks.js - módulo leve não carrega Playwright', () => {
  // Garante que o require de exit.js não puxa o heavy graph do navegador
  const loaded = Object.keys(require.cache).some((p) => /playwright[\\/]/.test(p));
  assert.strictEqual(loaded, false, 'libs/webhooks.js não deve carregar playwright');
});
