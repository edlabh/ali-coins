const test = require('node:test');
const assert = require('node:assert/strict');
const { isCoinCenterUrl } = require('../do_tasks');

test('do_tasks.js - isCoinCenterUrl reconhece a central de moedas mobile (reúso de página do check-in)', () => {
  assert.strictEqual(
    isCoinCenterUrl(
      'https://m.aliexpress.com/p/coin-index/index.html?_immersiveMode=true&from=pc302'
    ),
    true
  );
  assert.strictEqual(isCoinCenterUrl('https://m.aliexpress.com/p/coin-index/index.html'), true);
  assert.strictEqual(isCoinCenterUrl('https://m.aliexpress.com/p/login.html'), false);
  assert.strictEqual(isCoinCenterUrl(''), false);
  assert.strictEqual(isCoinCenterUrl(null), false);
  assert.strictEqual(isCoinCenterUrl(undefined), false);
  assert.strictEqual(isCoinCenterUrl(123), false);
});
