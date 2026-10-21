const test = require('node:test');
const assert = require('node:assert/strict');
const {
  summarize,
  settlementRecord,
  netOf,
} = require('../cloudfunctions/api/ledger');

const r = (payer, amount, split = 'half', cat = '食费') => ({
  payer,
  amount,
  split,
  cat,
  date: '2026-10-05',
});

test('平摊、自己的、全由对方承担按规则计算 net', () => {
  assert.equal(netOf([r('a', 1000)]), 500);
  assert.equal(netOf([r('b', 1000)]), -500);
  assert.equal(netOf([r('a', 1000, 'other')]), 1000);
  assert.equal(netOf([r('a', 1000, 'self')]), 0);
});

test('两人各记 5 笔：汇总与手算一致', () => {
  const records = [
    r('a', 3000), // +1500
    r('a', 1200), // +600
    r('a', 801), // +400.5
    r('a', 5000, 'self'), // 不计
    r('a', 2000, 'other'), // +2000
    r('b', 4000), // -2000
    r('b', 999), // -499.5
    r('b', 600, 'other'), // -600
    r('b', 1500, 'self'), // 不计
    r('b', 80000, 'half', '房租'), // -40000
  ];
  const summary = summarize(records);
  assert.equal(
    summary.net,
    1500 + 600 + 400.5 + 2000 - 2000 - 499.5 - 600 - 40000,
  );
  assert.equal(summary.net, -38599);
  assert.deepEqual(summary.paid, { a: 7001, b: 85599 });
  assert.equal(summary.sharedTotal, 92600);
  assert.equal(summary.settled, false);
  assert.deepEqual(summary.suggestion, { from: 'a', to: 'b', amount: 38599 });
});

test('记为已结算后 net 归零，结算记录不计入共同支出', () => {
  const records = [r('a', 3001), r('b', 1000, 'other')];
  // net = 1500.5 - 1000 = 500.5 → b 付给 a 501
  const settlement = settlementRecord(records, '2026-10-20');
  assert.deepEqual(settlement, {
    amount: 501,
    payer: 'b',
    split: 'other',
    cat: '结算',
    note: '结算',
    date: '2026-10-20',
  });
  const after = summarize([...records, settlement]);
  assert.equal(after.settled, true);
  assert.equal(after.suggestion, null);
  assert.equal(after.sharedTotal, 4001);
  assert.equal(settlementRecord([...records, settlement], '2026-10-20'), null);
});

test('绝对值小于 1 视为已结清', () => {
  assert.equal(summarize([r('a', 1)]).settled, true); // net 0.5
  assert.equal(summarize([r('a', 2)]).settled, false); // net 1
  assert.equal(summarize([]).settled, true);
});

test('分类统计：与共同支出同口径，排除结算和「自己的」，按金额从大到小', () => {
  const records = [
    r('a', 3000, 'half', '食费'),
    r('b', 1000, 'other', '食费'),
    r('a', 5000, 'half', '房租'),
    r('b', 800, 'self', '娱乐'), // 自己的，不计
    r('a', 500, 'half', '交通'),
    r('b', 500, 'half', '日用'), // 与交通同额，按分类顺序日用在前
  ];
  const summary = summarize(records);
  const settlement = settlementRecord(records, '2026-10-20');
  assert.deepEqual(summary.byCategory, [
    { cat: '房租', amount: 5000 },
    { cat: '食费', amount: 4000 },
    { cat: '日用', amount: 500 },
    { cat: '交通', amount: 500 },
  ]);
  assert.equal(
    summary.byCategory.reduce((sum, item) => sum + item.amount, 0),
    summary.sharedTotal,
  );
  assert.deepEqual(
    summarize([...records, settlement]).byCategory,
    summary.byCategory,
    '结算记录不计入分类',
  );
  assert.deepEqual(summarize([]).byCategory, []);
});
