const test = require('node:test');
const assert = require('node:assert/strict');

test('没有全局 fetch 时用 node-fetch 补上（定时触发器连数据库要用）', () => {
  const saved = globalThis.fetch;
  delete globalThis.fetch;
  try {
    const path = require.resolve('../cloudfunctions/api/fetch-polyfill');
    delete require.cache[path];
    require(path);
    assert.equal(typeof globalThis.fetch, 'function');
    assert.equal(
      globalThis.fetch,
      require('../cloudfunctions/api/node_modules/node-fetch'),
    );
  } finally {
    globalThis.fetch = saved;
  }
});
