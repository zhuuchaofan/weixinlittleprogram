const test = require('node:test');
const assert = require('node:assert/strict');
const { ledgerCsv } = require('../miniprogram/utils/csv.ts');

test('导出本月 CSV：BOM、按日期排、金额两位小数、特殊字符和公式开头都安全', () => {
  const csv = ledgerCsv(
    [
      {
        date: '2026-10-12',
        flow: 'out',
        cat: '吃饭',
        amount: 12850,
        note: '寿司, "滨寿司"',
        payer: 'b',
        splitText: '',
      },
      {
        date: '2026-10-03',
        flow: 'in',
        cat: '其他',
        amount: 5,
        note: '=1+1',
        payer: 'a',
        splitText: '收入',
        src: { app: 'wechat', merchant: '某店' },
      },
    ],
    { a: '佳益', b: '小猪' },
    (app) => (app === 'wechat' ? '微信' : app),
  );
  assert.ok(
    csv.startsWith('﻿日期,收支,分类,金额（元）,备注,付款人,怎么分,来源\r\n'),
  );
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(
    lines[1],
    "2026-10-03,收入,其他,0.05,'=1+1,佳益,收入,微信导入 · 某店",
  );
  assert.equal(
    lines[2],
    '2026-10-12,支出,吃饭,128.50,"寿司, ""滨寿司""",小猪,,',
  );
});
