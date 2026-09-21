const test = require('node:test');
const assert = require('node:assert/strict');
const { filterStorageState, isAllowedStorageKey } = require('../libs/storage_filter');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('libs/storage_filter.js - origin com localStorage não-array é tratado como vazio (sem passthrough)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const out = filterStorageState({
      cookies: [{ name: 'xman_us_t', value: 'v' }],
      origins: [
        { origin: 'https://x.com', localStorage: 'isso-nao-e-array' },
        { origin: 'https://y.com', localStorage: [{ name: 'APLUS_S_CORE', value: 'tel' }] }
      ]
    });
    assert.deepStrictEqual(out.origins[0].localStorage, [], 'deve virar array vazio');
    assert.deepStrictEqual(out.origins[1].localStorage, [], 'telemetria filtrada');
    assert.deepStrictEqual(out.cookies, [{ name: 'xman_us_t', value: 'v' }], 'cookies preservados');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/storage_filter.js - allowlist preserva chaves permitidas', () => {
  assert.strictEqual(isAllowedStorageKey('login_token'), true);
  assert.strictEqual(isAllowedStorageKey('APLUS_S_CORE'), false);
});
