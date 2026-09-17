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
const { getBanquetStatus } = require('../miniprogram/utils/event-phase.ts');

test('答谢宴状态按中国本地日期切换，跨年时也用日历日计算', () => {
  assert.deepEqual(
    getBanquetStatus('2026-09-28', new Date('2026-09-27T15:59:59.000Z')),
    { phase: 'before', daysUntil: 1 },
  );
  assert.deepEqual(
    getBanquetStatus('2026-09-28', new Date('2026-09-27T16:00:00.000Z')),
    { phase: 'today', daysUntil: 0 },
  );
  assert.deepEqual(
    getBanquetStatus('2026-09-28', new Date('2026-09-28T16:00:00.000Z')),
    { phase: 'after', daysUntil: 0 },
  );
  assert.deepEqual(
    getBanquetStatus('2027-01-01', new Date('2026-12-30T16:00:00.000Z')),
    { phase: 'before', daysUntil: 1 },
  );
});
