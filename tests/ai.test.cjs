const test = require('node:test');
const assert = require('node:assert/strict');
const { createAi, FEATURES, costOf } = require('../cloudfunctions/api/ai');
const { periodKey, fieldOf } = require('../cloudfunctions/api/quota');
const { ai: QUOTAS } = require('../cloudfunctions/api/contract.json');

// 限时免费期间所有小家都算会员；这里测的是免费 / 会员各自的行为，所以先关掉。
process.env.VIP_FREE_UNTIL = 'off';

// 2026-10-25 12:00 UTC+8
const NOW = Date.parse('2026-10-25T04:00:00Z');

function memoryUsage() {
  const days = new Map();
  return {
    days,
    async get(day) {
      return days.get(day) || null;
    },
    async add(day, feature, entry) {
      const doc = days.get(day) || { cost: 0, calls: 0, features: {} };
      doc.cost += entry.cost;
      doc.calls += entry.calls;
      const row = doc.features[feature] || { calls: 0, failed: 0 };
      row.calls += entry.calls;
      row.failed += entry.failed;
      doc.features[feature] = row;
      days.set(day, doc);
    },
  };
}

function fakeClient(
  reply = { text: '喵', usage: { input: 1000, output: 200 } },
) {
  const calls = [];
  return {
    calls,
    async chat(content, options) {
      calls.push({ content, options });
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

const quiet = () => {};

test('AI 入口：每个功能都登记了模型和额度，两边一一对应', () => {
  assert.deepEqual(Object.keys(FEATURES).sort(), Object.keys(QUOTAS).sort());
  for (const [name, feature] of Object.entries(FEATURES)) {
    assert.ok(['organize', 'write'].includes(feature.tier), name);
    assert.equal(typeof feature.model({}), 'string', name);
  }
  for (const [name, quota] of Object.entries(QUOTAS)) {
    assert.ok(['day', 'month'].includes(quota.per), name);
    assert.ok(quota.vip >= quota.free, name);
    for (const key of ['name', 'verb', 'unit', 'what'])
      assert.equal(typeof quota[key], 'string', `${name}.${key}`);
  }
  assert.equal(createAi({ client: null }), null);
});

test('AI 入口：按功能选模型和参数，记下用量和费用，日志里没有内容', async () => {
  const client = fakeClient();
  const usage = memoryUsage();
  const lines = [];
  const ai = createAi({
    client,
    usage,
    env: { SUMMARY_MODEL: 'qwen-flash' },
    now: () => NOW,
    log: (line) => lines.push(line),
  });
  assert.equal(await ai.write('summary', '这个月花了 3980 元'), '喵');
  assert.equal(client.calls[0].options.model, 'qwen-flash');
  assert.equal(client.calls[0].options.maxTokens, 300);
  assert.equal(client.calls[0].options.temperature, 0.3);
  const day = usage.days.get('2026-10-25');
  assert.equal(day.calls, 1);
  assert.equal(day.features.summary.calls, 1);
  assert.equal(day.cost, costOf('qwen-flash', { input: 1000, output: 200 }));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes('3980'), false, '日志不带提示词');
  assert.match(lines[0], /"feature":"summary"/);
  await assert.rejects(ai.write('nope', 'x'), /没有登记/);
});

test('AI 入口：调用失败也记一次，错误原样抛出', async () => {
  const usage = memoryUsage();
  const failure = Object.assign(new Error('连不上'), { code: 'UNAVAILABLE' });
  const ai = createAi({
    client: fakeClient(failure),
    usage,
    now: () => NOW,
    log: quiet,
  });
  await assert.rejects(ai.read('billImage', 'https://img/1', '读'), {
    code: 'UNAVAILABLE',
  });
  assert.equal(usage.days.get('2026-10-25').features.billImage.failed, 1);
});

test('全站每日费用上限：写文字的先停（80%），整理类到 100% 才停', async () => {
  const usage = memoryUsage();
  const ai = createAi({
    client: fakeClient(),
    usage,
    env: { AI_DAILY_BUDGET: '10' },
    now: () => NOW,
    log: quiet,
  });
  await ai.ensure('summary');
  usage.days.set('2026-10-25', { cost: 8, calls: 0, features: {} });
  await assert.rejects(ai.ensure('summary'), {
    code: 'UNAVAILABLE',
    message: /明天再来/,
  });
  await ai.ensure('billImage');
  usage.days.set('2026-10-25', { cost: 10, calls: 0, features: {} });
  await assert.rejects(ai.ensure('billImage'), { code: 'UNAVAILABLE' });
  // 第二天重新算
  const tomorrow = createAi({
    client: fakeClient(),
    usage,
    env: { AI_DAILY_BUDGET: '10' },
    now: () => NOW + 24 * 60 * 60 * 1000,
    log: quiet,
  });
  await tomorrow.ensure('summary');
});

test('总开关 AI_WRITE_OFF=1：只关写文字的功能；用量读不出来时不挡', async () => {
  const ai = createAi({
    client: fakeClient(),
    usage: {
      async get() {
        throw new Error('collection not exists');
      },
      async add() {
        throw new Error('collection not exists');
      },
    },
    env: { AI_WRITE_OFF: '1' },
    now: () => NOW,
    log: quiet,
  });
  await assert.rejects(ai.ensure('summary'), { message: /暂时关闭/ });
  await ai.ensure('billImage');
  assert.equal(await ai.read('billImage', 'https://img/1', '读'), '喵');
});

test('额度周期：按天用北京时间的日期，按月用年月；老功能沿用原字段名', () => {
  // UTC 10-25 17:00 已经是北京时间 10-26
  const late = Date.parse('2026-10-25T17:00:00Z');
  assert.equal(periodKey('day', late), '2026-10-26');
  assert.equal(periodKey('month', late), '2026-10');
  assert.equal(fieldOf('billImage'), 'billQuota');
  assert.equal(fieldOf('summary'), 'summaryQuota');
  assert.equal(fieldOf('oneLine'), 'oneLineQuota');
});
