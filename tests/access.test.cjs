const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  module._compile(result.outputText, filename);
};

test('管理员展示结果五分钟缓存并合并并发请求，过期后再读取', async () => {
  const { localConfig } = require('../miniprogram/config/local.ts');
  const { createAccessChecker } = require('../miniprogram/services/access.ts');
  const previousMode = localConfig.mode;
  let currentTime = 0;
  let calls = 0;
  localConfig.mode = 'cloud';
  try {
    const checker = createAccessChecker({
      now: () => currentTime,
      request: async () => {
        calls += 1;
        return true;
      },
    });
    assert.deepEqual(
      await Promise.all([checker.checkAdmin(), checker.checkAdmin()]),
      [true, true],
    );
    assert.equal(calls, 1);
    currentTime = 5 * 60 * 1000 - 1;
    assert.equal(await checker.checkAdmin(), true);
    assert.equal(calls, 1);
    currentTime += 1;
    assert.equal(await checker.checkAdmin(), true);
    assert.equal(calls, 2);
  } finally {
    localConfig.mode = previousMode;
  }
});
