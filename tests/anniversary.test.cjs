const test = require('node:test');
const assert = require('node:assert/strict');
const { countdown, together } = require('../cloudfunctions/api/anniversary');

test('每年重复：今天当天为 0 天，已过则顺延到明年', () => {
  assert.deepEqual(countdown('2020-10-20', true, '2026-10-20'), {
    nextDate: '2026-10-20',
    days: 0,
    passed: false,
    years: 6,
  });
  assert.deepEqual(countdown('2020-10-19', true, '2026-10-20'), {
    nextDate: '2027-10-19',
    days: 364,
    passed: false,
    years: 7,
  });
  assert.equal(countdown('2020-12-31', true, '2026-12-31').days, 0);
  assert.equal(
    countdown('2020-01-01', true, '2026-12-31').nextDate,
    '2027-01-01',
  );
});

test('每年重复：未来首次日期从当年起算，第 0 周年', () => {
  assert.deepEqual(countdown('2027-03-01', true, '2026-10-20'), {
    nextDate: '2027-03-01',
    days: 132,
    passed: false,
    years: 0,
  });
});

test('2 月 29 日在平年记为 2 月 28 日，闰年照常', () => {
  assert.equal(
    countdown('2024-02-29', true, '2026-10-20').nextDate,
    '2027-02-28',
  );
  assert.equal(
    countdown('2024-02-29', true, '2027-03-01').nextDate,
    '2028-02-29',
  );
});

test('不重复：未到为倒数，已过为已经过去的天数', () => {
  assert.deepEqual(countdown('2026-10-25', false, '2026-10-20'), {
    nextDate: '2026-10-25',
    days: 5,
    passed: false,
    years: 0,
  });
  assert.deepEqual(countdown('2026-09-28', false, '2026-10-20'), {
    nextDate: '2026-09-28',
    days: 22,
    passed: true,
    years: 0,
  });
});

test('在一起：起点当天算第 1 天，里程碑含今天，起点未到没有第几天', () => {
  assert.deepEqual(together('2026-10-20', '2026-10-20'), {
    day: 1,
    milestone: { day: 100, date: '2027-01-27', days: 99 },
  });
  // 第 100 天正好是今天
  assert.deepEqual(together('2026-10-20', '2027-01-27'), {
    day: 100,
    milestone: { day: 100, date: '2027-01-27', days: 0 },
  });
  assert.equal(together('2026-10-20', '2027-01-28').milestone.day, 200);
  assert.equal(together('2026-10-20', '2027-04-01').milestone.day, 200);
  // 5000 天之后每 1000 天一个
  assert.equal(together('2000-01-01', '2026-10-20').milestone.day, 10000);
  assert.deepEqual(together('2026-11-01', '2026-10-20'), {
    day: 0,
    milestone: null,
  });
});
