const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWeekly,
  isWeeklyTrigger,
  weekReport,
  lastWeekStart,
  yuanText,
  thing,
  bookName,
  TEMPLATE_ID,
  MAX_TIMES,
} = require('../cloudfunctions/api/weekly');
const { createSender } = require('../cloudfunctions/api/notify-send');
const { createRouter } = require('../cloudfunctions/api/router');

// 2026-11-16 周一 09:00 UTC+8
const MONDAY = Date.parse('2026-11-16T01:00:00Z');

function memorySubscriptions() {
  const docs = new Map();
  return {
    docs,
    async get(openid) {
      return docs.has(openid) ? { ...docs.get(openid) } : null;
    },
    async add(openid, max, at) {
      const doc = docs.get(openid) || { _id: openid, weekly: 0, week: '' };
      if (doc.weekly < max) doc.weekly += 1;
      doc.updatedAt = at;
      docs.set(openid, doc);
    },
    async clear(openid) {
      if (docs.has(openid)) docs.get(openid).weekly = 0;
    },
    async listDue(week, after, limit) {
      return [...docs.values()]
        .filter((d) => d.weekly > 0 && d.week !== week && d._id > after)
        .sort((x, y) => (x._id < y._id ? -1 : 1))
        .slice(0, limit)
        .map((d) => ({ ...d }));
    },
    async markWeek(openid, week) {
      docs.get(openid).week = week;
    },
    async claim(openid, week) {
      const d = docs.get(openid);
      if (!d || d.weekly <= 0 || d.week === week) return false;
      d.weekly -= 1;
      d.week = week;
      return true;
    },
    async giveBack(openid) {
      docs.get(openid).weekly += 1;
    },
    async remove(openid) {
      docs.delete(openid);
    },
  };
}

function setup({ records = [], reply = () => 0 } = {}) {
  const household = {
    _id: 'h1',
    members: [
      { openid: 'A', role: 'a', name: '佳益' },
      { openid: 'B', role: 'b', name: '小朱' },
    ],
  };
  const lonely = {
    _id: 'h2',
    members: [{ openid: 'C', role: 'a', name: '猫' }],
  };
  const all = [household, lonely];
  const households = {
    async findByMember(openid) {
      return (
        all.find((h) => h.members.some((m) => m.openid === openid)) || null
      );
    },
  };
  const reads = [];
  const expenses = {
    async listSince(householdId, since) {
      reads.push([householdId, since]);
      return records.filter(
        (r) => r.householdId === householdId && r.date >= since,
      );
    },
  };
  const sent = [];
  const sender = {
    async send(message) {
      sent.push(message);
      return reply(message);
    },
  };
  const subscriptions = memorySubscriptions();
  const logs = [];
  const weekly = createWeekly({
    subscriptions,
    households,
    expenses,
    sender,
    requireMembership: async (openid) => {
      const h = await households.findByMember(openid);
      if (!h) throw new Error('NO_HOUSEHOLD');
      return h;
    },
    now: () => MONDAY,
    log: (line) => logs.push(line),
  });
  return { weekly, subscriptions, sent, reads, logs, household };
}

const rec = (date, amount, extra = {}) => ({
  householdId: 'h1',
  date,
  amount,
  cat: '吃饭',
  ...extra,
});

test('上周一按中国时间算：周一早上、周日深夜都对', () => {
  assert.equal(lastWeekStart(MONDAY), '2026-11-09');
  // 2026-11-15 周日 23:30 UTC+8 → 上周是 11-02 那周
  assert.equal(lastWeekStart(Date.parse('2026-11-15T15:30:00Z')), '2026-11-02');
  // 周一 00:30 UTC+8（UTC 还是周日）
  assert.equal(lastWeekStart(Date.parse('2026-11-15T16:30:00Z')), '2026-11-09');
});

test('字段格式：金额、结余、thing 最多 20 字并去掉表情', () => {
  assert.equal(yuanText(1000), '10');
  assert.equal(yuanText(1050), '10.50');
  assert.equal(yuanText(-12345), '-123.45');
  assert.equal(thing('喵🐱喵'), '喵喵');
  assert.equal([...thing('一'.repeat(30))].length, 20);
  assert.equal(
    bookName({ members: [{ name: '佳益' }, { name: '小朱' }] }),
    '佳益和小朱的小账本',
  );
  assert.equal(
    bookName({
      members: [
        { name: '一二三四五六七八九十' },
        { name: '一二三四五六七八九十' },
      ],
    }),
    '我们的小账本',
  );
});

test('上周汇总：只算上周一到周日，结算不算，收入算进结余', () => {
  const household = { members: [{ name: '佳益' }, { name: '小朱' }] };
  const records = [
    rec('2026-11-08', 99999), // 前一周
    rec('2026-11-09', 3200),
    rec('2026-11-15', 1850, { cat: '交通' }),
    rec('2026-11-12', 50000, { flow: 'in', cat: '其他' }),
    rec('2026-11-13', 7000, { cat: '结算' }),
    rec('2026-11-16', 777), // 这周
  ];
  const report = weekReport(household, records, '2026-11-09');
  assert.equal(report.spend, 5050);
  assert.equal(report.income, 50000);
  assert.equal(report.count, 3);
  assert.deepEqual(report.data, {
    thing1: { value: '佳益和小朱的小账本' },
    time2: { value: '2026-11-09~2026-11-15' },
    amount3: { value: '¥50.50' },
    character_string8: { value: '449.50' },
    thing5: { value: '比前一周少花了949.49元，真棒' },
  });
  assert.equal(
    weekReport(household, [rec('2026-11-10', 100)], '2026-11-09').data.thing5
      .value,
    '记了1笔，吃饭花得最多',
  );
  assert.equal(
    weekReport(
      household,
      [rec('2026-11-13', 7000, { cat: '结算' })],
      '2026-11-09',
    ),
    null,
  );
});

test('订阅：点一次加一次，最多攒 MAX_TIMES 次；不要了清零', async () => {
  const { weekly } = setup();
  assert.deepEqual(await weekly.actions['weekly.get']('A'), { times: 0 });
  assert.deepEqual(await weekly.actions['weekly.subscribe']('A'), { times: 1 });
  assert.deepEqual(await weekly.actions['weekly.subscribe']('A'), { times: 2 });
  for (let i = 0; i < 20; i++) await weekly.actions['weekly.subscribe']('A');
  assert.deepEqual(await weekly.actions['weekly.get']('A'), {
    times: MAX_TIMES,
  });
  assert.deepEqual(await weekly.actions['weekly.cancel']('A'), { times: 0 });
  await assert.rejects(weekly.actions['weekly.subscribe']('Z'));
});

test('定时发送：只发给订了且上周有记账的人，一次扣一次，同一周不重发', async () => {
  const { weekly, subscriptions, sent, reads } = setup({
    records: [rec('2026-11-10', 3200)],
  });
  await weekly.actions['weekly.subscribe']('A');
  await weekly.actions['weekly.subscribe']('A');
  await weekly.actions['weekly.subscribe']('B');
  await weekly.actions['weekly.subscribe']('C'); // 上周没记账
  const first = await weekly.run();
  assert.deepEqual(first, {
    week: '2026-11-09',
    sent: 2,
    skipped: 1,
    failed: 0,
    more: false,
  });
  assert.deepEqual(
    sent.map((m) => m.openid),
    ['A', 'B'],
  );
  assert.equal(sent[0].templateId, TEMPLATE_ID);
  assert.equal(sent[0].page, 'pages/home/index');
  assert.equal(sent[0].data.amount3.value, '¥32');
  // 两人同一个小家只读一次账
  assert.equal(reads.filter(([id]) => id === 'h1').length, 1);
  assert.equal(subscriptions.docs.get('A').weekly, 1);
  assert.equal(subscriptions.docs.get('B').weekly, 0);
  // C 没发，次数留着
  assert.equal(subscriptions.docs.get('C').weekly, 1);
  // 再触发一次（9:20）：谁都不再发
  const again = await weekly.run();
  assert.equal(again.sent + again.skipped, 0);
  assert.equal(sent.length, 2);
});

test('没授权（43101）清零；其他失败把次数还回去、这周不再试', async () => {
  const { weekly, subscriptions, logs } = setup({
    records: [rec('2026-11-10', 3200)],
    reply: (m) => (m.openid === 'A' ? 43101 : 47003),
  });
  await weekly.actions['weekly.subscribe']('A');
  await weekly.actions['weekly.subscribe']('A');
  await weekly.actions['weekly.subscribe']('B');
  const result = await weekly.run();
  assert.equal(result.failed, 2);
  assert.equal(subscriptions.docs.get('A').weekly, 0);
  assert.equal(subscriptions.docs.get('B').weekly, 1);
  assert.equal((await weekly.run()).failed, 0);
  assert.ok(
    logs.every((line) => !line.includes('"A"') && !line.includes('B"')),
  );
});

test('只认我们的定时触发器，用户调用（有 openid）不算', () => {
  const timer = { Type: 'Timer', TriggerName: 'weeklyReport' };
  assert.equal(isWeeklyTrigger(timer, ''), true);
  assert.equal(isWeeklyTrigger(timer, 'A'), false);
  assert.equal(isWeeklyTrigger({ Type: 'Timer', TriggerName: 'x' }, ''), false);
  assert.equal(isWeeklyTrigger({ action: 'weekly.get' }, ''), false);
});

test('发送：换 access_token 后发到 subscribe/send，过期时换一次再发', async () => {
  assert.equal(createSender({}), null);
  const calls = [];
  let sends = 0;
  const sender = createSender(
    { WX_APPID: 'wx1', WX_APPSECRET: 's', WEEKLY_STATE: 'trial' },
    async (url, body) => {
      calls.push([url, body]);
      if (url.includes('stable_token'))
        return {
          text: JSON.stringify({
            access_token: `t${calls.length}`,
            expires_in: 7200,
          }),
        };
      sends += 1;
      return { text: JSON.stringify({ errcode: sends === 1 ? 40001 : 0 }) };
    },
  );
  const code = await sender.send({
    openid: 'A',
    templateId: TEMPLATE_ID,
    page: 'pages/home/index',
    data: { thing1: { value: 'x' } },
  });
  assert.equal(code, 0);
  const posts = calls.filter(([url]) => url.includes('subscribe/send'));
  assert.equal(posts.length, 2);
  const body = JSON.parse(posts[1][1]);
  assert.equal(body.touser, 'A');
  assert.equal(body.template_id, TEMPLATE_ID);
  assert.equal(body.miniprogram_state, 'trial');
  assert.ok(posts[1][0].includes('access_token=t3'));
});

test('路由：小报带上订阅次数；注销后订阅记录删掉', async () => {
  const subscriptions = memorySubscriptions();
  const docs = new Map();
  const households = {
    async findByMember(openid) {
      return (
        [...docs.values()].find((d) =>
          d.members.some((m) => m.openid === openid),
        ) || null
      );
    },
    async findByCode() {
      return null;
    },
    async insert(doc) {
      docs.set('h1', { ...doc, _id: 'h1' });
      return 'h1';
    },
    async findDeparted() {
      return [];
    },
    async vacate(id) {
      docs.delete(id);
      return true;
    },
    async update() {},
  };
  const empty = {
    listAll: async () => [],
    listMonth: async () => [],
    listSince: async () => [],
    removeAll: async () => 0,
    count: async () => 0,
  };
  const route = createRouter({
    households,
    archive: {},
    expenses: empty,
    todos: empty,
    dishes: empty,
    wishes: empty,
    dates: empty,
    goals: empty,
    activity: empty,
    insights: { get: async () => null, removeAll: async () => 0 },
    subscriptions,
    now: () => MONDAY,
  });
  const call = (action, payload) => route({ action, payload }, 'A');
  assert.equal((await call('household.create', { name: '佳益' })).ok, true);
  assert.deepEqual((await call('weekly.subscribe')).data, { times: 1 });
  assert.deepEqual(
    (await call('recap.get', { month: '2026-10' })).data.weekly,
    {
      times: 1,
    },
  );
  const deleted = await call('account.delete', { confirm: true });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal(subscriptions.docs.has('A'), false);
});
