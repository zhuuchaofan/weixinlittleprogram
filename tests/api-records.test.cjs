const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/api/router');

// 限时免费期间所有小家都算会员；这里测的是免费 / 会员各自的行为，所以先关掉。
process.env.VIP_FREE_UNTIL = 'off';

function memoryHouseholds() {
  const docs = new Map();
  let seq = 0;
  return {
    docs,
    async findByMember(openid) {
      return (
        [...docs.values()].find((d) =>
          d.members.some((m) => m.openid === openid),
        ) || null
      );
    },
    async findByCode(code) {
      return [...docs.values()].find((d) => d.inviteCode === code) || null;
    },
    async insert(doc) {
      const id = 'h' + ++seq;
      docs.set(id, { ...doc, _id: id });
      return id;
    },
    async addMember(id, code, member) {
      const d = docs.get(id);
      if (!d || d.inviteCode !== code || d.memberCount !== 1) return false;
      docs.set(id, {
        ...d,
        members: [...d.members, member],
        memberCount: 2,
        inviteCode: '',
      });
      return true;
    },
    async update(id, fields) {
      docs.set(id, { ...docs.get(id), ...fields });
    },
    async takeQuota(id, field, day, limit) {
      const d = docs.get(id);
      const used = d[field]?.day === day ? d[field].count : 0;
      if (used >= limit) return false;
      docs.set(id, { ...d, [field]: { day, count: used + 1 } });
      return true;
    },
  };
}

function memoryRecords(prefix) {
  const docs = new Map();
  let seq = 0;
  const own = (householdId) =>
    [...docs.values()].filter((d) => d.householdId === householdId);
  return {
    docs,
    async listAll(householdId) {
      return own(householdId).map((d) => ({ ...d }));
    },
    async readComplete(householdId) {
      return own(householdId).map((d) => ({ ...d }));
    },
    async listMonth(householdId, month) {
      return own(householdId)
        .filter((d) => d.date.slice(0, 7) === month)
        .map((d) => ({ ...d }));
    },
    async listRange(householdId, fromMonth, toMonth) {
      return own(householdId)
        .filter((d) => {
          const month = d.date.slice(0, 7);
          return month >= fromMonth && month <= toMonth;
        })
        .map((d) => ({ ...d }));
    },
    async get(householdId, id) {
      const d = docs.get(id);
      return d && d.householdId === householdId ? { ...d } : null;
    },
    async insert(doc) {
      const id = prefix + ++seq;
      docs.set(id, { ...doc, _id: id });
      return id;
    },
    async insertWithId(id, doc) {
      if (docs.has(id)) return false;
      docs.set(id, { ...doc, _id: id });
      return true;
    },
    async update(householdId, id, fields) {
      const d = docs.get(id);
      if (d && d.householdId === householdId) docs.set(id, { ...d, ...fields });
    },
    async remove(householdId, id) {
      const d = docs.get(id);
      if (d && d.householdId === householdId) docs.delete(id);
    },
    async removeWhere(householdId, where) {
      let removed = 0;
      for (const [id, d] of docs)
        if (
          d.householdId === householdId &&
          Object.entries(where).every(([key, value]) => d[key] === value)
        ) {
          docs.delete(id);
          removed++;
        }
      return removed;
    },
  };
}

// 2026-10-20 12:00 UTC+8
const NOW = Date.parse('2026-10-20T04:00:00Z');

async function setup({ vision = null } = {}) {
  const activity = memoryRecords('a');
  const expenses = memoryRecords('e');
  const insights = memoryRecords('i');
  const goals = memoryRecords('g');
  goals.deposit = async (householdId, id, entry) => {
    const d = goals.docs.get(id);
    if (d && d.householdId === householdId)
      goals.docs.set(id, {
        ...d,
        saved: (d.saved || 0) + entry.amount,
        log: [...(d.log || []), entry],
      });
  };
  const todos = memoryRecords('t');
  const dishes = memoryRecords('d');
  const wishes = memoryRecords('w');
  const dates = memoryRecords('n');
  const households = memoryHouseholds();
  // 云存储：记下被删的文件，换地址时原样加个前缀
  const storage = {
    removed: [],
    async remove(ids) {
      storage.removed.push(...ids);
    },
    async tempUrls(ids) {
      return Object.fromEntries(ids.map((id) => [id, `https://tmp/${id}`]));
    },
  };
  const route = createRouter({
    households,
    storage,
    archive: {},
    expenses,
    todos,
    dishes,
    wishes,
    dates,
    insights,
    goals,
    activity,
    ai: vision,
    now: () => NOW,
  });
  const call = (openid, action, payload) => route({ action, payload }, openid);
  const created = await call('A', 'household.create', { name: '超凡' });
  await call('B', 'household.join', {
    name: '佳益',
    code: created.data.inviteCode,
  });
  await call('X', 'household.create', { name: '别人家' });
  return {
    call,
    expenses,
    todos,
    dishes,
    wishes,
    dates,
    insights,
    goals,
    activity,
    households,
    storage,
  };
}

const expense = (overrides = {}) => ({
  amount: 1200,
  note: '超市',
  cat: '吃饭',
  date: '2026-10-05',
  payer: 'a',
  split: 'half',
  ...overrides,
});

test('记一笔：校验整数日元、分类、日期、付款人与分摊', async () => {
  const { call, expenses } = await setup();
  for (const bad of [
    { amount: 12.5 },
    { amount: 0 },
    { amount: '1200' },
    { cat: '结算' },
    { cat: '奢侈品' },
    { date: '2026-02-30' },
    { payer: 'c' },
    { split: 'all' },
    { split: 'ratio' },
    { split: 'ratio', ratio: 60.5 },
    { split: 'ratio', ratio: '60' },
    { split: 'ratio', ratio: -1 },
    { split: 'ratio', ratio: 101 },
    { note: 'x'.repeat(41) },
  ])
    assert.equal(
      (await call('A', 'expense.add', expense(bad))).code,
      'VALIDATION',
      JSON.stringify(bad),
    );
  const added = await call('A', 'expense.add', expense());
  assert.equal(added.ok, true);
  assert.equal(added.data.byRole, 'a');
  assert.equal(JSON.stringify(added).includes('"A"'), false);
  const stored = expenses.docs.get(added.data.id);
  assert.equal(stored.by, 'A');
  assert.equal(stored.ts, NOW);
  assert.equal(typeof stored.householdId, 'string');
});

test('两人各记 5 笔：B 能读到 A 的记录，月度汇总与结算与手算一致', async () => {
  const { call } = await setup();
  const rows = [
    ['A', { amount: 3000, payer: 'a' }],
    ['A', { amount: 1200, payer: 'a', date: '2026-10-06' }],
    ['A', { amount: 801, payer: 'a', date: '2026-10-07' }],
    ['A', { amount: 5000, payer: 'a', split: 'self' }],
    ['A', { amount: 2000, payer: 'a', split: 'other' }],
    ['B', { amount: 4000, payer: 'b' }],
    ['B', { amount: 999, payer: 'b' }],
    ['B', { amount: 600, payer: 'b', split: 'other' }],
    ['B', { amount: 1500, payer: 'b', split: 'self' }],
    ['B', { amount: 8000, payer: 'b', cat: '房租' }],
    ['B', { amount: 777, payer: 'b', date: '2026-09-30' }], // 上个月，不计入
  ];
  for (const [who, fields] of rows)
    assert.equal((await call(who, 'expense.add', expense(fields))).ok, true);
  const list = await call('B', 'expense.list', { month: '2026-10' });
  assert.equal(list.data.records.length, 10);
  assert.equal(list.data.records[0].date, '2026-10-07');
  // net = 1500 + 600 + 400.5 + 2000 - 2000 - 499.5 - 600 - 4000 = -2599
  assert.equal(list.data.summary.net, -2599);
  assert.deepEqual(list.data.summary.suggestion, {
    from: 'a',
    to: 'b',
    amount: 2599,
  });
  assert.equal(list.data.summary.sharedTotal, 7001 + 13599);

  const settled = await call('A', 'expense.settle', { month: '2026-10' });
  assert.equal(settled.data.summary.settled, true);
  const settlement = settled.data.records.find((r) => r.cat === '结算');
  assert.deepEqual(
    [
      settlement.amount,
      settlement.payer,
      settlement.split,
      settlement.note,
      settlement.date,
    ],
    [2599, 'a', 'other', '结算', '2026-10-20'],
  );
  assert.equal(
    (await call('A', 'expense.settle', { month: '2026-10' })).code,
    'ALREADY_SETTLED',
  );
  assert.equal(
    (await call('A', 'expense.update', { ...expense(), id: settlement.id }))
      .code,
    'VALIDATION',
  );
  // 删除结算记录 = 撤销结算
  assert.equal(
    (await call('B', 'expense.remove', { id: settlement.id })).ok,
    true,
  );
  const again = await call('A', 'expense.list', { month: '2026-10' });
  assert.equal(again.data.summary.settled, false);

  // 过去月份结算落在该月最后一天
  const sept = await call('A', 'expense.settle', { month: '2026-09' });
  assert.equal(
    sept.data.records.find((r) => r.cat === '结算').date,
    '2026-09-30',
  );
});

test('结算并发：两人同时结算只产生一条结算记录，撤销后可重新结算', async () => {
  const { call, expenses } = await setup();
  await call('A', 'expense.add', expense({ amount: 3000 }));
  await call('B', 'expense.add', expense({ amount: 1000, payer: 'b' }));
  const settlements = () =>
    [...expenses.docs.values()].filter((d) => d.cat === '结算');

  const [first, second] = await Promise.all([
    call('A', 'expense.settle', { month: '2026-10' }),
    call('B', 'expense.settle', { month: '2026-10' }),
  ]);
  assert.deepEqual(
    [first.ok, second.ok, second.code].sort(),
    [false, true, 'ALREADY_SETTLED'].sort(),
  );
  assert.equal(settlements().length, 1);
  const list = await call('A', 'expense.list', { month: '2026-10' });
  assert.equal(list.data.summary.settled, true);

  // 撤销后两人再同时结算，仍只有一条，_id 与第一次相同
  const id = settlements()[0]._id;
  assert.match(id, /^settle_2026-10_[0-9a-f]{24}$/);
  await call('B', 'expense.remove', { id });
  const again = await Promise.all([
    call('B', 'expense.settle', { month: '2026-10' }),
    call('A', 'expense.settle', { month: '2026-10' }),
  ]);
  assert.equal(again.filter((r) => r.ok).length, 1);
  assert.equal(settlements().length, 1);
  assert.equal(settlements()[0]._id, id);

  // 结算后又记一笔，账目变了，可以再结算一次
  await call('A', 'expense.add', expense({ amount: 500 }));
  assert.equal(
    (await call('A', 'expense.settle', { month: '2026-10' })).ok,
    true,
  );
  assert.equal(settlements().length, 2);
});

test('编辑与删除：只能操作本小家的记录', async () => {
  const { call } = await setup();
  const { data } = await call('A', 'expense.add', expense());
  const updated = await call(
    'B',
    'expense.update',
    expense({ id: data.id, amount: 1500, payer: 'b' }),
  );
  assert.equal(updated.data.amount, 1500);
  assert.equal(updated.data.payer, 'b');
  assert.equal(updated.data.byRole, 'a', '记录人不随编辑改变');
  assert.equal(
    (await call('X', 'expense.update', expense({ id: data.id }))).code,
    'NOT_FOUND',
  );
  assert.equal(
    (await call('X', 'expense.remove', { id: data.id })).code,
    'NOT_FOUND',
  );
  assert.equal(
    (await call('X', 'expense.list', { month: '2026-10' })).data.records.length,
    0,
  );
  assert.equal((await call('A', 'expense.remove', { id: data.id })).ok, true);
  assert.equal(
    (await call('A', 'expense.remove', { id: data.id })).code,
    'NOT_FOUND',
  );
  assert.equal(
    (await call('A', 'expense.list', { month: '2026-13' })).code,
    'VALIDATION',
  );
  assert.equal(
    (await call('C', 'expense.list', { month: '2026-10' })).code,
    'NO_HOUSEHOLD',
  );
});

test('清单：添加、指派、勾选、编辑、删除，未完成在前', async () => {
  const { call } = await setup();
  assert.equal(
    (await call('A', 'todo.add', { text: ' ', kind: 'shop', who: 'a' })).code,
    'VALIDATION',
  );
  assert.equal(
    (await call('A', 'todo.add', { text: '牛奶', kind: 'food', who: 'a' }))
      .code,
    'VALIDATION',
  );
  assert.equal(
    (await call('A', 'todo.add', { text: '牛奶', kind: 'shop', who: 'c' }))
      .code,
    'VALIDATION',
  );
  const milk = await call('A', 'todo.add', {
    text: '牛奶',
    kind: 'shop',
    who: 'both',
    done: true,
  });
  assert.equal(milk.data.done, false, '新条目总是未完成');
  const trash = await call('B', 'todo.add', {
    text: '倒垃圾',
    kind: 'chore',
    who: 'b',
  });
  const done = await call('B', 'todo.update', { id: milk.data.id, done: true });
  assert.equal(done.data.done, true);
  assert.equal(done.data.text, '牛奶', '只改勾选时保留其他字段');
  const edited = await call('A', 'todo.update', {
    id: trash.data.id,
    text: '倒可燃垃圾',
    who: 'a',
  });
  assert.deepEqual(
    [edited.data.text, edited.data.who, edited.data.kind],
    ['倒可燃垃圾', 'a', 'chore'],
  );
  const list = await call('B', 'todo.list');
  assert.deepEqual(
    list.data.map((t) => [t.text, t.done]),
    [
      ['倒可燃垃圾', false],
      ['牛奶', true],
    ],
  );
  assert.equal(
    (await call('X', 'todo.update', { id: milk.data.id, done: false })).code,
    'NOT_FOUND',
  );
  assert.equal((await call('A', 'todo.remove', { id: milk.data.id })).ok, true);
  assert.equal((await call('A', 'todo.list')).data.length, 1);
});

test('导出：JSON 文本能完整解析回全部记录，且不含 openid', async () => {
  const { call } = await setup();
  await call('A', 'expense.add', expense());
  await call(
    'B',
    'expense.add',
    expense({ amount: 300, payer: 'b', date: '2026-09-01' }),
  );
  await call('A', 'todo.add', { text: '牛奶', kind: 'shop', who: 'both' });
  const result = await call('B', 'data.export');
  const text = JSON.stringify(result.data, null, 2);
  assert.equal(/"[AB]"/.test(text), false, '不能包含 openid');
  const parsed = JSON.parse(text);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.expenses.length, 2);
  assert.equal(parsed.todos.length, 1);
  assert.deepEqual(parsed.counts, {
    expenses: 2,
    todos: 1,
    dishes: 0,
    wishes: 0,
    dates: 0,
  });
  assert.deepEqual(
    parsed.household.members.map((m) => m.name),
    ['超凡', '佳益'],
  );
  assert.deepEqual(Object.keys(parsed.expenses[0]).sort(), [
    'amount',
    'byRole',
    'cat',
    'date',
    'flow',
    'id',
    'note',
    'payer',
    'split',
    'ts',
  ]);
  const other = await call('X', 'data.export');
  assert.equal(other.data.expenses.length, 0);
});

test('吃啥：菜单增删改，标签只能是在家做 / 外食 / 外卖', async () => {
  const { call } = await setup();
  assert.equal(
    (await call('A', 'dish.add', { name: '拉面', tag: '夜宵' })).code,
    'VALIDATION',
  );
  assert.equal(
    (await call('A', 'dish.add', { name: '', tag: '外食' })).code,
    'VALIDATION',
  );
  const ramen = await call('A', 'dish.add', { name: '拉面', tag: '外食' });
  await call('B', 'dish.add', { name: '咖喱饭', tag: '在家做' });
  const edited = await call('B', 'dish.update', {
    id: ramen.data.id,
    tag: '外卖',
  });
  assert.deepEqual([edited.data.name, edited.data.tag], ['拉面', '外卖']);
  assert.equal((await call('A', 'dish.list')).data.length, 2);
  assert.equal(
    (await call('X', 'dish.remove', { id: ramen.data.id })).code,
    'NOT_FOUND',
  );
  assert.equal(
    (await call('A', 'dish.remove', { id: ramen.data.id })).ok,
    true,
  );
  assert.deepEqual(
    (await call('B', 'dish.list')).data.map((d) => d.name),
    ['咖喱饭'],
  );
});

test('周末：收藏想去的地方，可编辑与删除', async () => {
  const { call } = await setup();
  const wish = await call('A', 'wish.add', {
    title: '镰仓',
    why: '看海',
    plan: '',
  });
  assert.equal(wish.ok, true);
  const edited = await call('B', 'wish.update', {
    id: wish.data.id,
    plan: '江之电一日券',
  });
  assert.deepEqual(
    [edited.data.title, edited.data.why, edited.data.plan],
    ['镰仓', '看海', '江之电一日券'],
  );
  assert.equal(
    (await call('A', 'wish.add', { title: 'x'.repeat(31) })).code,
    'VALIDATION',
  );
  assert.equal((await call('B', 'wish.list')).data.length, 1);
  assert.equal((await call('B', 'wish.remove', { id: wish.data.id })).ok, true);
});

test('想去：打勾「去过了」记下日期，取消时清空，改备注不影响', async () => {
  const { call } = await setup();
  const wish = await call('A', 'wish.add', { title: '箱根' });
  assert.deepEqual([wish.data.done, wish.data.doneOn], [false, '']);
  const went = await call('B', 'wish.update', {
    id: wish.data.id,
    done: true,
    doneOn: '2026-10-12',
  });
  assert.deepEqual([went.data.done, went.data.doneOn], [true, '2026-10-12']);
  const noted = await call('A', 'wish.update', {
    id: wish.data.id,
    plan: '住一晚',
  });
  assert.deepEqual(
    [noted.data.done, noted.data.doneOn, noted.data.plan],
    [true, '2026-10-12', '住一晚'],
  );
  const undone = await call('A', 'wish.update', {
    id: wish.data.id,
    done: false,
  });
  assert.deepEqual([undone.data.done, undone.data.doneOn], [false, '']);
  assert.equal(
    (
      await call('A', 'wish.update', {
        id: wish.data.id,
        done: true,
        doneOn: '昨天',
      })
    ).code,
    'VALIDATION',
  );
});

test('纪念日：列表带倒数，按剩余天数排序，已过的不重复日期放最后', async () => {
  const { call } = await setup();
  // 今天 2026-10-20（UTC+8）
  await call('A', 'date.add', {
    title: '结婚纪念日',
    date: '2025-11-03',
    yearly: true,
  });
  await call('A', 'date.add', {
    title: '答谢宴',
    date: '2026-09-28',
    yearly: false,
  });
  await call('B', 'date.add', {
    title: '生日',
    date: '1995-10-20',
    yearly: true,
  });
  await call('B', 'date.add', {
    title: '去北海道',
    date: '2027-01-10',
    yearly: false,
  });
  assert.equal(
    (await call('A', 'date.add', { title: '坏日期', date: '2026-02-30' })).code,
    'VALIDATION',
  );
  const list = (await call('A', 'date.list')).data;
  assert.deepEqual(
    list.map((d) => [d.title, d.days, d.passed, d.nextDate]),
    [
      ['生日', 0, false, '2026-10-20'],
      ['结婚纪念日', 14, false, '2026-11-03'],
      ['去北海道', 82, false, '2027-01-10'],
      ['答谢宴', 22, true, '2026-09-28'],
    ],
  );
  assert.equal(list[0].years, 31);
  assert.equal(list[1].years, 1);
});

test('每月小报：支出对比上月、两人各记几笔、吃了什么、做完什么、去过哪、存了多少', async () => {
  const { call, activity, dates } = await setup();
  assert.equal(
    (await call('A', 'recap.get', { month: '2026-11' })).code,
    'VALIDATION',
    '还没到的月份',
  );
  assert.equal(
    (await call('A', 'recap.get', { month: 'x' })).code,
    'VALIDATION',
  );
  assert.equal((await call('X', 'recap.get', {})).ok, true);

  // 默认是上个月（今天 2026-10-20 → 9 月）；上上个月（8 月）有账，9 月才有对比
  await call('A', 'expense.add', expense({ date: '2026-08-10', amount: 4000 }));
  await call('A', 'expense.add', expense({ date: '2026-09-02', amount: 3000 }));
  await call(
    'B',
    'expense.add',
    expense({ date: '2026-09-03', amount: 5000, cat: '日用', payer: 'b' }),
  );
  await call(
    'B',
    'expense.add',
    expense({ date: '2026-09-04', amount: 9000, flow: 'in' }),
  );
  const sept = (await call('A', 'recap.get', {})).data;
  assert.equal(sept.month, '2026-09');
  assert.equal(sept.spend.total, 8000);
  assert.equal(sept.spend.count, 2);
  assert.equal(sept.spend.prevTotal, 4000);
  assert.deepEqual(
    sept.spend.weeks.map((w) => [w.from, w.amount]),
    [
      [1, 8000],
      [8, 0],
      [15, 0],
      [22, 0],
      [29, 0],
    ],
  );
  assert.deepEqual(
    [sept.spend.biggest.amount, sept.spend.biggest.date],
    [5000, '2026-09-03'],
  );
  assert.deepEqual(sept.spend.peakDay, { day: 3, amount: 5000 });
  assert.equal(sept.spend.perDay, 267);
  assert.equal(sept.spend.freeDays, 28);
  assert.deepEqual(sept.spend.byRole, { a: 1, b: 1 });
  assert.deepEqual(
    sept.spend.top.map((row) => [row.cat, row.amount]),
    [
      ['日用', 5000],
      ['吃饭', 3000],
    ],
  );
  assert.equal(sept.meals.count, 0);
  assert.equal(sept.meals.top, null);
  assert.equal(sept.togetherDay, 0);
  // 8 月之前没有账：没有可比的上个月
  assert.equal(
    (await call('A', 'recap.get', { month: '2026-08' })).data.spend.prevTotal,
    null,
  );

  // 本月（10 月）做过的事
  const dish = await call('A', 'dish.add', { name: '拉面', tag: '外食' });
  await call('A', 'dish.update', { id: dish.data.id, ateOn: '2026-10-18' });
  await call('B', 'dish.update', { id: dish.data.id, ateOn: '2026-10-19' });
  const curry = await call('B', 'dish.add', { name: '咖喱', tag: '在家做' });
  await call('B', 'dish.update', { id: curry.data.id, ateOn: '2026-10-20' });
  const todo = await call('A', 'todo.add', {
    text: '洗碗',
    kind: 'todo',
    who: 'both',
  });
  await call('A', 'todo.update', { id: todo.data.id, done: true });
  const wish = await call('B', 'wish.add', { title: '镰仓' });
  await call('B', 'wish.update', {
    id: wish.data.id,
    done: true,
    doneOn: '2026-10-12',
  });
  const goal = await call('A', 'goal.add', {
    title: '旅行',
    target: 100000,
    deadline: '2027-05',
  });
  await call('A', 'goal.deposit', { id: goal.data.id, amount: 20000 });
  await call('B', 'goal.deposit', { id: goal.data.id, amount: 5000 });
  // 一个月前的活动不算进来
  activity.docs.set('old', {
    _id: 'old',
    householdId: [...activity.docs.values()][0].householdId,
    type: 'dish',
    title: '旧的',
    date: '2026-09-30',
    ts: 1,
    by: 'A',
  });

  const now = (await call('B', 'recap.get', { month: '2026-10' })).data;
  assert.deepEqual(now.meals, { count: 3, top: { title: '拉面', count: 2 } });
  assert.deepEqual(now.todos, { count: 1, byRole: { a: 1, b: 0 } });
  assert.deepEqual(now.wishes, ['镰仓']);
  assert.deepEqual(now.saved, { total: 25000, byRole: { a: 20000, b: 5000 } });
  assert.equal(now.togetherDay, 0, '没设「在一起」起点');
  // 设了起点（dates 里 together 的那条）：起点那天算第 1 天，数到今天；上个月的小报数到月底
  const householdId = (await call('A', 'household.get')).data.id;
  dates.docs.set('t', {
    _id: 't',
    householdId,
    title: '在一起',
    date: '2026-09-20',
    together: true,
    ts: 1,
  });
  assert.equal(
    (await call('A', 'recap.get', { month: '2026-10' })).data.togetherDay,
    31,
  );
  assert.equal((await call('A', 'recap.get', {})).data.togetherDay, 11);
});

test('纪念日：「在一起」起点全家只留一个，带第几天和下一个里程碑', async () => {
  const { call } = await setup();
  const first = await call('A', 'date.add', {
    title: '在一起',
    date: '2026-07-12',
    yearly: true,
    together: true,
  });
  assert.equal(first.data.together, true);
  // 2026-07-12 是第 1 天，到 2026-10-20 是第 101 天。
  assert.equal(first.data.togetherDay, 101);
  assert.deepEqual(first.data.milestone, {
    day: 200,
    date: '2027-01-27',
    days: 99,
  });
  const plain = await call('B', 'date.add', {
    title: '生日',
    date: '1995-10-20',
    yearly: true,
  });
  assert.equal(plain.data.together, false);
  assert.equal(plain.data.togetherDay, undefined);

  // 另一条设为起点后，原来的取消。
  const second = await call('B', 'date.add', {
    title: '领证',
    date: '2025-11-03',
    yearly: true,
    together: true,
  });
  assert.equal(second.data.together, true);
  let list = (await call('A', 'date.list')).data;
  assert.deepEqual(
    list.filter((item) => item.together).map((item) => item.title),
    ['领证'],
  );
  // 改成起点同样会取消别的；旧记录没有 together 字段时当作否。
  await call('A', 'date.update', { id: first.data.id, together: true });
  list = (await call('A', 'date.list')).data;
  assert.deepEqual(
    list.filter((item) => item.together).map((item) => item.title),
    ['在一起'],
  );
});

test('重复待办：勾完生成下一条（还没到时间），取消勾选收回；购物不重复', async () => {
  const { call, todos } = await setup();
  const bad = await call('A', 'todo.add', {
    text: '倒垃圾',
    kind: 'todo',
    who: 'both',
    repeat: 'yearly',
  });
  assert.equal(bad.code, 'VALIDATION');
  const shop = await call('A', 'todo.add', {
    text: '牛奶',
    kind: 'shop',
    who: 'both',
    repeat: 'daily',
  });
  assert.equal(shop.data.repeat, '');
  const added = await call('A', 'todo.add', {
    text: '倒垃圾',
    kind: 'todo',
    who: 'b',
    repeat: 'weekly',
    dueOn: '2020-01-01',
  });
  assert.equal(added.data.repeat, 'weekly');
  assert.equal(added.data.dueOn, '', 'dueOn 不接受传入');
  const id = added.data.id;

  // 今天 2026-10-20，每周重复：下一条是 10-27，做事的人和重复周期照旧。
  await call('B', 'todo.update', { id, done: true });
  let list = (await call('A', 'todo.list')).data.filter(
    (t) => t.text === '倒垃圾',
  );
  assert.equal(list.length, 2);
  const next = list.find((t) => !t.done);
  assert.deepEqual(
    [next.who, next.repeat, next.dueOn, next.done],
    ['b', 'weekly', '2026-10-27', false],
  );

  // 取消勾选：生成的下一条没动过就收回。
  await call('B', 'todo.update', { id, done: false });
  list = (await call('A', 'todo.list')).data.filter((t) => t.text === '倒垃圾');
  assert.equal(list.length, 1);
  assert.equal(list[0].dueOn, '');

  // 下一条已经做过就不删。
  await call('B', 'todo.update', { id, done: true });
  const spawned = (await call('A', 'todo.list')).data.find(
    (t) => t.text === '倒垃圾' && !t.done,
  );
  await call('A', 'todo.update', { id: spawned.id, done: true });
  await call('B', 'todo.update', { id, done: false });
  assert.equal(
    (await call('A', 'todo.list')).data.filter((t) => t.text === '倒垃圾')
      .length,
    3,
  );
  assert.equal(todos.docs.size >= 4, true);
});

test('下一次日期：每天 +1，每周 +7，每月同一天（没有就月底）', () => {
  const { nextOccurrence } = require('../cloudfunctions/api/dates');
  assert.equal(nextOccurrence('2026-10-31', 'daily'), '2026-11-01');
  assert.equal(nextOccurrence('2026-12-28', 'weekly'), '2027-01-04');
  assert.equal(nextOccurrence('2026-10-15', 'monthly'), '2026-11-15');
  assert.equal(nextOccurrence('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextOccurrence('2026-12-31', 'monthly'), '2027-01-31');
});

test('TA 最近：近 14 天的动态，只能回应对方做的，每人一个回应可改可收回', async () => {
  const { call, activity } = await setup();
  const todo = await call('A', 'todo.add', {
    text: '洗碗',
    kind: 'todo',
    who: 'both',
  });
  await call('A', 'todo.update', { id: todo.data.id, done: true });
  const dish = await call('B', 'dish.add', { name: '拉面', tag: '外食' });
  await call('B', 'dish.update', { id: dish.data.id, ateOn: '2026-10-20' });
  // 一个月前的不显示
  activity.docs.set('old', {
    _id: 'old',
    householdId: [...activity.docs.values()][0].householdId,
    type: 'dish',
    title: '很久以前',
    date: '2026-08-01',
    ts: NOW - 1000,
    by: 'A',
  });

  const feed = (await call('B', 'activity.recent')).data;
  assert.deepEqual(
    feed
      .map((item) => [item.title, item.byRole, item.reactions])
      .sort((x, y) => x[0].localeCompare(y[0], 'zh')),
    [
      ['拉面', 'b', {}],
      ['洗碗', 'a', {}],
    ],
  );
  const wash = feed.find((item) => item.title === '洗碗');
  assert.equal(
    (await call('A', 'activity.react', { id: wash.id, reaction: 'great' }))
      .code,
    'VALIDATION',
    '不能回应自己',
  );
  assert.equal(
    (await call('B', 'activity.react', { id: wash.id, reaction: 'lol' })).code,
    'VALIDATION',
  );
  assert.equal(
    (await call('X', 'activity.react', { id: wash.id, reaction: 'great' }))
      .code,
    'NOT_FOUND',
  );
  const reacted = await call('B', 'activity.react', {
    id: wash.id,
    reaction: 'thanks',
  });
  assert.deepEqual(reacted.data.reactions, { b: 'thanks' });
  await call('B', 'activity.react', { id: wash.id, reaction: 'great' });
  const seen = (await call('A', 'activity.recent')).data.find(
    (item) => item.id === wash.id,
  );
  assert.deepEqual(seen.reactions, { b: 'great' });
  const cleared = await call('B', 'activity.react', {
    id: wash.id,
    reaction: '',
  });
  assert.deepEqual(cleared.data.reactions, {});
  assert.equal((await call('X', 'activity.recent')).data.length, 0);
});

test('吃啥：两人各投各的票，隔天作废；评价长期保留，只能改自己的', async () => {
  const { call, dishes } = await setup();
  const added = await call('A', 'dish.add', { name: '拉面', tag: '外食' });
  const id = added.data.id;
  assert.deepEqual([added.data.votes, added.data.ratings], [{}, {}]);

  for (const bad of [{ vote: 'maybe' }, {}, { vote: null }])
    assert.equal(
      (await call('A', 'dish.vote', { id, ...bad })).code,
      'VALIDATION',
      JSON.stringify(bad),
    );
  assert.equal(
    (await call('X', 'dish.vote', { id, vote: 'want' })).code,
    'NOT_FOUND',
  );

  await call('A', 'dish.vote', { id, vote: 'want' });
  const both = await call('B', 'dish.vote', { id, vote: 'no' });
  assert.deepEqual(both.data.votes, { a: 'want', b: 'no' });
  // 再选同一个不会收回（收回传空），改选就是覆盖自己的
  const changed = await call('B', 'dish.vote', { id, vote: 'want' });
  assert.deepEqual(changed.data.votes, { a: 'want', b: 'want' });
  const cleared = await call('A', 'dish.vote', { id, vote: '' });
  assert.deepEqual(cleared.data.votes, { b: 'want' });

  // 改名等普通修改不动票和评价
  await call('A', 'dish.update', { id, name: '豚骨拉面' });
  assert.deepEqual((await call('B', 'dish.get', { id })).data.votes, {
    b: 'want',
  });

  // 投票那天过了，票就不算了
  dishes.docs.set(id, { ...dishes.docs.get(id), votesOn: '2026-10-19' });
  assert.deepEqual((await call('A', 'dish.get', { id })).data.votes, {});
  // 隔天第一次投票先清掉昨天的
  const fresh = await call('A', 'dish.vote', { id, vote: 'no' });
  assert.deepEqual(fresh.data.votes, { a: 'no' });

  assert.equal(
    (await call('A', 'dish.rate', { id, rating: 'great' })).code,
    'VALIDATION',
  );
  await call('A', 'dish.rate', { id, rating: 'bad' });
  const rated = await call('B', 'dish.rate', { id, rating: 'good' });
  assert.deepEqual(rated.data.ratings, { a: 'bad', b: 'good' });
  const reset = await call('A', 'dish.rate', { id, rating: '' });
  assert.deepEqual(reset.data.ratings, { b: 'good' });
  assert.deepEqual((await call('B', 'dish.list')).data[0].ratings, {
    b: 'good',
  });
});

test('想去的足迹：回忆和照片、普通 1 张会员 3 张、只能放自己小家的、删掉的照片从云存储删', async () => {
  const { call, wishes, households, storage } = await setup();
  const householdId = (await call('A', 'household.get')).data.id;
  const photo = (name) =>
    `cloud://env.x/wish-photos/${householdId}/${name}.jpg`;
  const wish = await call('A', 'wish.add', { title: '镰仓' });
  const id = wish.data.id;
  assert.deepEqual(
    [wish.data.photos, wish.data.memo, wish.data.wants],
    [[], '', {}],
  );

  for (const bad of [
    { photos: 'x' },
    { photos: ['file://a'] },
    { photos: [1] },
    { photos: ['a', 'b', 'c', 'd'].map(photo) },
    { memo: 'x'.repeat(101) },
  ])
    assert.equal(
      (await call('A', 'wish.update', { id, ...bad })).code,
      'VALIDATION',
      JSON.stringify(bad),
    );
  // 别人家的文件夹不行
  assert.equal(
    (
      await call('A', 'wish.update', {
        id,
        photos: ['cloud://env.x/wish-photos/other/a.jpg'],
      })
    ).code,
    'VALIDATION',
  );
  // 普通用户 1 张
  const over = await call('A', 'wish.update', {
    id,
    photos: [photo('a'), photo('b')],
  });
  assert.equal(over.code, 'VALIDATION');
  assert.match(over.message, /开通会员/);
  const one = await call('A', 'wish.update', {
    id,
    done: true,
    doneOn: '2026-10-12',
    memo: '看了海',
    photos: [photo('a')],
  });
  assert.deepEqual([one.data.photos, one.data.memo], [[photo('a')], '看了海']);

  // 会员 3 张；换掉的从云存储删
  households.docs.get(householdId).vip = { until: NOW + 86400000 };
  const three = await call('B', 'wish.update', {
    id,
    photos: [photo('b'), photo('c'), photo('d')],
  });
  assert.equal(three.data.photos.length, 3);
  assert.deepEqual(storage.removed, [photo('a')]);
  // 不传 photos 的修改不动照片
  const renamed = await call('A', 'wish.update', { id, title: '去镰仓' });
  assert.equal(renamed.data.photos.length, 3);
  assert.deepEqual(storage.removed, [photo('a')]);

  // 换临时地址：只给自己小家的
  const urls = await call('B', 'photo.urls', { ids: [photo('b')] });
  assert.deepEqual(urls.data, {
    urls: { [photo('b')]: `https://tmp/${photo('b')}` },
  });
  assert.equal(
    (
      await call('B', 'photo.urls', {
        ids: ['cloud://env.x/wish-photos/other/a.jpg'],
      })
    ).code,
    'VALIDATION',
  );

  // 足迹：去过的，带那天一起花了多少
  await call('A', 'expense.add', expense({ date: '2026-10-12', amount: 3000 }));
  await call(
    'B',
    'expense.add',
    expense({ date: '2026-10-12', amount: 2000, flow: 'in' }),
  );
  await call('B', 'expense.add', expense({ date: '2026-10-13', amount: 999 }));
  await call('A', 'wish.add', { title: '还没去' });
  const feed = await call('B', 'footprint.list');
  assert.deepEqual(feed.data, {
    year: '2026',
    years: [{ year: '2026', places: 1 }],
    total: { places: 1, photos: 3 },
    items: [
      {
        id,
        title: '去镰仓',
        doneOn: '2026-10-12',
        memo: '看了海',
        photos: [photo('b'), photo('c'), photo('d')],
        spent: 3000,
        both: false,
      },
    ],
  });
  assert.equal((await call('X', 'footprint.list')).data.items.length, 0);

  // 好几年：按年份取，默认最近一年；总数是全部年份的
  const old = await call('A', 'wish.add', { title: '去京都' });
  await call('A', 'wish.update', {
    id: old.data.id,
    title: '去京都',
    done: true,
    doneOn: '2024-04-02',
  });
  const both = await call('B', 'footprint.list');
  assert.deepEqual(both.data.years, [
    { year: '2026', places: 1 },
    { year: '2024', places: 1 },
  ]);
  assert.equal(both.data.total.places, 2);
  const past = await call('B', 'footprint.list', { year: '2024' });
  assert.deepEqual(
    past.data.items.map((item) => item.title),
    ['去京都'],
  );
  assert.equal(
    (await call('B', 'footprint.list', { year: '1999' })).data.year,
    '2026',
  );

  // 我也想去：各点各的，再点收回
  const open = await call('A', 'wish.add', { title: '北海道' });
  assert.deepEqual(
    (await call('B', 'wish.want', { id: open.data.id, want: true })).data.wants,
    { b: true },
  );
  assert.deepEqual(
    (await call('A', 'wish.want', { id: open.data.id, want: true })).data.wants,
    { a: true, b: true },
  );
  assert.deepEqual(
    (await call('B', 'wish.want', { id: open.data.id, want: false })).data
      .wants,
    { a: true },
  );
  assert.equal(
    (await call('B', 'wish.want', { id: open.data.id })).code,
    'VALIDATION',
  );

  // 删掉这一条，三张照片都从云存储删
  storage.removed.length = 0;
  await call('A', 'wish.remove', { id });
  assert.deepEqual(storage.removed.sort(), [
    photo('b'),
    photo('c'),
    photo('d'),
  ]);
  assert.equal(wishes.docs.has(id), false);
});

test('导出包含吃啥、周末、纪念日', async () => {
  const { call } = await setup();
  await call('A', 'dish.add', { name: '拉面', tag: '外食' });
  await call('A', 'wish.add', { title: '镰仓' });
  await call('A', 'date.add', {
    title: '结婚纪念日',
    date: '2025-11-03',
    yearly: true,
  });
  const parsed = JSON.parse(
    JSON.stringify((await call('B', 'data.export')).data),
  );
  assert.deepEqual(
    [parsed.dishes.length, parsed.wishes.length, parsed.dates.length],
    [1, 1, 1],
  );
  assert.deepEqual(Object.keys(parsed.dates[0]).sort(), [
    'byRole',
    'date',
    'id',
    'title',
    'together',
    'ts',
    'yearly',
  ]);
  assert.equal(/"[AB]"/.test(JSON.stringify(parsed)), false);
});

test('清除已完成：只删本小家、本类型、已完成的条目', async () => {
  const { call, todos } = await setup();
  const milk = await call('A', 'todo.add', {
    text: '牛奶',
    kind: 'shop',
    who: 'both',
  });
  const eggs = await call('A', 'todo.add', {
    text: '鸡蛋',
    kind: 'shop',
    who: 'both',
  });
  await call('A', 'todo.add', { text: '面包', kind: 'shop', who: 'both' });
  const trash = await call('B', 'todo.add', {
    text: '倒垃圾',
    kind: 'chore',
    who: 'b',
  });
  const other = await call('X', 'todo.add', {
    text: '别人家的',
    kind: 'shop',
    who: 'a',
  });
  for (const [who, item] of [
    ['A', milk],
    ['B', eggs],
    ['B', trash],
    ['X', other],
  ])
    await call(who, 'todo.update', { id: item.data.id, done: true });
  assert.equal(
    (await call('A', 'todo.clearDone', { kind: 'food' })).code,
    'VALIDATION',
  );
  const result = await call('B', 'todo.clearDone', { kind: 'shop' });
  assert.deepEqual(result.data, { removed: 2 });
  assert.deepEqual(
    (await call('A', 'todo.list')).data.map((t) => [t.text, t.done]),
    [
      ['面包', false],
      ['倒垃圾', true],
    ],
  );
  assert.equal(todos.docs.has(other.data.id), true, '其他小家的不受影响');
});

test('按 id 取单条：编辑页缓存未命中时使用，只能取本小家的记录', async () => {
  const { call } = await setup();
  const added = {
    expense: (await call('A', 'expense.add', expense())).data,
    todo: (
      await call('A', 'todo.add', { text: '买牛奶', kind: 'shop', who: 'a' })
    ).data,
    dish: (await call('A', 'dish.add', { name: '咖喱', tag: '在家做' })).data,
    wish: (await call('A', 'wish.add', { title: '镰仓', why: '', plan: '' }))
      .data,
    date: (
      await call('A', 'date.add', {
        title: '结婚纪念日',
        date: '2025-09-28',
        yearly: true,
      })
    ).data,
  };
  for (const [prefix, record] of Object.entries(added)) {
    const got = await call('B', `${prefix}.get`, { id: record.id });
    assert.equal(got.ok, true, prefix);
    assert.deepEqual(got.data, record, prefix);
    assert.equal(
      (await call('X', `${prefix}.get`, { id: record.id })).code,
      'NOT_FOUND',
      `${prefix}：别的小家取不到`,
    );
    assert.equal(
      (await call('B', `${prefix}.get`, { id: 'missing' })).code,
      'NOT_FOUND',
    );
  }
  assert.equal(added.date.days > 0, true, '纪念日单条也带倒数');
});

test('分类改名：旧记录的「食费」读出来是「吃饭」，旧版小程序提交「食费」也能保存', async () => {
  const { call, expenses } = await setup();
  const added = await call('A', 'expense.add', expense({ amount: 500 }));
  const hid = expenses.docs.get(added.data.id).householdId;
  // 数据库里改名前存下的记录
  const oldId = await expenses.insert({
    householdId: hid,
    amount: 1000,
    note: '',
    cat: '食费',
    date: '2026-10-06',
    payer: 'b',
    split: 'half',
    ts: NOW - 1000,
    by: 'B',
  });
  const month = await call('A', 'expense.list', { month: '2026-10' });
  assert.deepEqual(
    month.data.records.map((r) => r.cat),
    ['吃饭', '吃饭'],
  );
  assert.deepEqual(month.data.summary.byCategory, [
    { cat: '吃饭', amount: 1500 },
  ]);
  assert.equal(
    (await call('A', 'expense.get', { id: oldId })).data.cat,
    '吃饭',
  );

  // 编辑旧记录：页面带回「吃饭」；旧版小程序仍可能提交「食费」
  for (const cat of ['吃饭', '食费']) {
    const updated = await call(
      'A',
      'expense.update',
      expense({ id: oldId, amount: 1200, cat, payer: 'b' }),
    );
    assert.equal(updated.ok, true, updated.message);
    assert.equal(updated.data.cat, '吃饭');
    assert.equal(expenses.docs.get(oldId).cat, '吃饭', '保存后存成新名称');
  }
  assert.equal(
    (await call('A', 'expense.add', expense({ cat: '食费' }))).data.cat,
    '吃饭',
  );
  assert.equal(
    (await call('A', 'expense.add', expense({ cat: '饭' }))).code,
    'VALIDATION',
  );
  const exported = (await call('B', 'data.export')).data.expenses;
  assert.equal(
    exported.every((r) => r.cat === '吃饭'),
    true,
  );
});

test('修改记录：对方改了账目会留下谁、什么时候改的，没改过的不带', async () => {
  const { call, expenses } = await setup();
  const added = await call('A', 'expense.add', expense({ amount: 1000 }));
  assert.equal('editedAt' in added.data, false);
  assert.equal('editedByRole' in added.data, false);

  const edited = await call(
    'B',
    'expense.update',
    expense({ id: added.data.id, amount: 1500 }),
  );
  assert.equal(edited.ok, true, edited.message);
  assert.equal(edited.data.byRole, 'a', '记录人不变');
  assert.equal(edited.data.editedByRole, 'b');
  assert.equal(edited.data.editedAt, NOW);
  assert.equal(expenses.docs.get(added.data.id).editedBy, 'B');
  assert.equal(JSON.stringify(edited).includes('"B"'), false, '不暴露 openid');

  // 列表、单条、导出都带修改记录
  const month = await call('A', 'expense.list', { month: '2026-10' });
  assert.equal(month.data.records[0].editedByRole, 'b');
  assert.equal(
    (await call('A', 'expense.get', { id: added.data.id })).data.editedAt,
    NOW,
  );
  const exported = (await call('A', 'data.export')).data.expenses;
  assert.equal(exported[0].editedByRole, 'b');
  assert.equal(JSON.stringify(exported).includes('"B"'), false);

  // 再由 A 自己改一次，记录换成最后一次
  const again = await call(
    'A',
    'expense.update',
    expense({ id: added.data.id, amount: 1600 }),
  );
  assert.equal(again.data.editedByRole, 'a');

  // 另一条没改过的不受影响
  const other = await call('A', 'expense.add', expense());
  const list = (await call('B', 'expense.list', { month: '2026-10' })).data;
  assert.equal(
    list.records.find((r) => r.id === other.data.id).editedAt,
    undefined,
  );
});

test('吃啥：菜品与店家，店家没有「在家做」，旧记录当作菜品', async () => {
  const { call, dishes } = await setup();
  for (const bad of [
    { name: '一兰', kind: 'shop', tag: '在家做' },
    { name: '一兰', kind: 'restaurant', tag: '外食' },
    { name: '一兰', kind: 'shop', tag: '夜宵' },
  ])
    assert.equal(
      (await call('A', 'dish.add', bad)).code,
      'VALIDATION',
      JSON.stringify(bad),
    );

  // 不带 kind（旧版小程序）按菜品保存
  const legacyClient = await call('A', 'dish.add', {
    name: '咖喱饭',
    tag: '在家做',
  });
  assert.equal(legacyClient.data.kind, 'dish');
  const dish = await call('A', 'dish.add', {
    name: '寿喜烧',
    kind: 'dish',
    tag: '外食',
  });
  const shop = await call('B', 'dish.add', {
    name: '一兰拉面',
    kind: 'shop',
    tag: '外食',
  });
  assert.equal(shop.ok, true, shop.message);
  assert.equal(shop.data.kind, 'shop');

  // 数据库里已有、没有 kind 字段的旧记录
  const oldId = await dishes.insert({
    householdId: dishes.docs.get(shop.data.id).householdId,
    name: '拉面',
    tag: '外食',
    ts: NOW - 1000,
    by: 'A',
  });
  const list = (await call('A', 'dish.list')).data;
  assert.equal(list.length, 4);
  assert.deepEqual(Object.fromEntries(list.map((d) => [d.name, d.kind])), {
    咖喱饭: 'dish',
    寿喜烧: 'dish',
    一兰拉面: 'shop',
    拉面: 'dish',
  });
  assert.equal((await call('B', 'dish.get', { id: oldId })).data.kind, 'dish');

  // 只改标签时旧记录保持菜品；菜品改成店家，同时标签不能是在家做
  assert.equal(
    (await call('B', 'dish.update', { id: oldId, tag: '外卖' })).data.kind,
    'dish',
  );
  assert.equal(
    (await call('A', 'dish.update', { id: legacyClient.data.id, kind: 'shop' }))
      .code,
    'VALIDATION',
    '在家做的菜品不能直接变成店家',
  );
  const moved = await call('A', 'dish.update', {
    id: legacyClient.data.id,
    kind: 'shop',
    tag: '外卖',
  });
  assert.deepEqual([moved.data.kind, moved.data.tag], ['shop', '外卖']);

  // 导出里每条都有 kind
  const exported = (await call('B', 'data.export')).data.dishes;
  assert.equal(exported.length, 4);
  assert.deepEqual(exported.map((d) => d.kind).sort(), [
    'dish',
    'dish',
    'shop',
    'shop',
  ]);
  assert.equal(dish.ok, true);
});

test('吃啥：「就吃这个」记下日期，可清空，日期格式要对', async () => {
  const { call } = await setup();
  const added = await call('A', 'dish.add', { name: '咖喱饭', tag: '在家做' });
  assert.equal(added.data.ateOn, '');
  const ate = await call('B', 'dish.update', {
    id: added.data.id,
    ateOn: '2026-10-26',
  });
  assert.equal(ate.ok, true, ate.message);
  assert.equal(ate.data.ateOn, '2026-10-26');
  assert.equal(ate.data.name, '咖喱饭');
  assert.equal(
    (await call('A', 'dish.update', { id: added.data.id, ateOn: '10-26' }))
      .code,
    'VALIDATION',
  );
  const renamed = await call('A', 'dish.update', {
    id: added.data.id,
    name: '咖喱乌冬',
  });
  assert.equal(renamed.data.ateOn, '2026-10-26', '改名不丢吃过的日期');
});

test('按比例分摊：保存比例、参与结算，改回其他方式后不再带 ratio', async () => {
  const { call, expenses } = await setup();
  const added = await call(
    'A',
    'expense.add',
    expense({ amount: 1000, split: 'ratio', ratio: 60 }),
  );
  assert.equal(added.ok, true, added.message);
  assert.equal(added.data.ratio, 60);
  assert.equal(expenses.docs.get(added.data.id).ratio, 60);

  // 非比例分摊的 ratio 一律忽略
  const half = await call(
    'A',
    'expense.add',
    expense({ amount: 1000, split: 'half', ratio: 60 }),
  );
  assert.equal(half.ok, true);
  assert.equal('ratio' in half.data, false);
  assert.equal(expenses.docs.get(half.data.id).ratio, null);

  // A 付 1000 按 6:4（B 欠 400），A 付 1000 平摊（B 欠 500）
  const month = await call('B', 'expense.list', { month: '2026-10' });
  assert.equal(month.data.summary.net, 900);
  assert.deepEqual(month.data.summary.suggestion, {
    from: 'b',
    to: 'a',
    amount: 900,
  });
  assert.equal(
    month.data.records.find((r) => r.id === added.data.id).ratio,
    60,
  );

  // 编辑：改成 7:3，再改回平摊
  const edited = await call(
    'B',
    'expense.update',
    expense({ id: added.data.id, amount: 1000, split: 'ratio', ratio: 70 }),
  );
  assert.equal(edited.data.ratio, 70);
  assert.equal(
    (await call('A', 'expense.list', { month: '2026-10' })).data.summary.net,
    300 + 500,
  );
  const back = await call(
    'B',
    'expense.update',
    expense({ id: added.data.id, amount: 1000, split: 'half' }),
  );
  assert.equal('ratio' in back.data, false);
  assert.equal(expenses.docs.get(added.data.id).ratio, null);
  assert.equal(
    (await call('A', 'expense.list', { month: '2026-10' })).data.summary.net,
    1000,
  );

  // 结算后归零，导出里按比例的记录带 ratio，其余不带
  await call(
    'A',
    'expense.update',
    expense({ id: added.data.id, amount: 1000, split: 'ratio', ratio: 60 }),
  );
  const settled = await call('A', 'expense.settle', { month: '2026-10' });
  assert.equal(settled.data.summary.settled, true);
  const exported = (await call('A', 'data.export')).data.expenses;
  assert.equal(exported.find((r) => r.id === added.data.id).ratio, 60);
  assert.equal(exported.find((r) => r.id === half.data.id).ratio, undefined);
});

test('只记账：两人分摊默认关闭，可以打开；spending 统计所有支出，不含结算和收入', async () => {
  const { call } = await setup();
  assert.equal((await call('A', 'household.get')).data.splitting, false);
  assert.equal(
    (await call('A', 'household.update', { splitting: 'yes' })).code,
    'VALIDATION',
  );
  await call('A', 'expense.add', expense({ amount: 1000, split: 'half' }));
  await call(
    'B',
    'expense.add',
    expense({ amount: 300, payer: 'b', split: 'self', cat: '交通' }),
  );
  await call(
    'B',
    'expense.add',
    expense({ amount: 5000, payer: 'b', split: 'self', flow: 'in' }),
  );
  await call('A', 'expense.settle', { month: '2026-10' });
  const month = await call('A', 'expense.list', { month: '2026-10' });
  assert.deepEqual(month.data.summary.spending, {
    total: 1300,
    paid: { a: 1000, b: 300 },
    byCategory: [
      { cat: '吃饭', amount: 1000 },
      { cat: '交通', amount: 300 },
    ],
  });
  // 共同支出口径不变
  assert.equal(month.data.summary.sharedTotal, 1000);

  const on = await call('B', 'household.update', { splitting: true });
  assert.equal(on.data.splitting, true);
  assert.equal((await call('A', 'household.get')).data.splitting, true);
});

test('花销分析：和上月按分类比、大额单笔、近 6 个月，不含结算、收入和别人家', async () => {
  const { call } = await setup();
  const rows = [
    ['A', { amount: 300000, cat: '房租', date: '2026-10-01' }],
    ['A', { amount: 98000, cat: '旅行', note: '国庆机票', date: '2026-10-03' }],
    ['B', { amount: 2500, cat: '吃饭', date: '2026-10-04', payer: 'b' }],
    ['B', { amount: 3500, cat: '吃饭', date: '2026-10-08', payer: 'b' }],
    ['A', { amount: 1200, cat: '日用', date: '2026-10-09' }],
    ['A', { amount: 800, cat: '日用', date: '2026-10-10', split: 'self' }],
    [
      'A',
      {
        amount: 500000,
        cat: '其他',
        date: '2026-10-12',
        flow: 'in',
        split: 'self',
      },
    ],
    ['A', { amount: 300000, cat: '房租', date: '2026-09-01' }],
    ['A', { amount: 4000, cat: '吃饭', date: '2026-09-10' }],
    ['A', { amount: 1500, cat: '交通', date: '2026-09-11' }],
    ['A', { amount: 7000, cat: '吃饭', date: '2026-05-10' }],
    ['A', { amount: 9999, cat: '吃饭', date: '2026-04-30' }],
    ['X', { amount: 777700, cat: '旅行', date: '2026-10-05' }],
  ];
  for (const [who, row] of rows) {
    const added = await call(who, 'expense.add', expense(row));
    assert.equal(added.ok, true, JSON.stringify(row));
  }
  assert.equal(
    (await call('A', 'expense.settle', { month: '2026-10' })).ok,
    true,
  );
  assert.equal(
    (await call('A', 'insight.get', { month: '2026-13' })).code,
    'VALIDATION',
  );

  const { data } = await call('B', 'insight.get', { month: '2026-10' });
  assert.equal(data.prevMonth, '2026-09');
  assert.equal(data.total, 300000 + 98000 + 2500 + 3500 + 1200 + 800);
  assert.equal(data.count, 6);
  assert.equal(data.prevTotal, 305500);
  assert.equal(data.income, 500000);
  assert.deepEqual(data.byCategory, [
    { cat: '房租', amount: 300000, count: 1, prev: 300000, ref: 300000 },
    { cat: '旅行', amount: 98000, count: 1, prev: 0, ref: 0 },
    { cat: '吃饭', amount: 6000, count: 2, prev: 4000, ref: 4000 },
    { cat: '日用', amount: 2000, count: 2, prev: 0, ref: 0 },
    { cat: '交通', amount: 0, count: 0, prev: 1500, ref: 1500 },
  ]);
  assert.deepEqual(data.compare, {
    month: '2026-09',
    total: 305500,
    days: 30,
    fullDays: 30,
  });
  // 前 3 笔一定列出，之后只列 ¥500 及以上的。
  assert.deepEqual(
    data.big.map((row) => [row.cat, row.note, row.amount]),
    [
      ['房租', '超市', 300000],
      ['旅行', '国庆机票', 98000],
      ['吃饭', '超市', 3500],
    ],
  );
  assert.equal(typeof data.big[0].id, 'string');
  assert.deepEqual(data.trend, [
    { month: '2026-05', total: 7000 },
    { month: '2026-06', total: 0 },
    { month: '2026-07', total: 0 },
    { month: '2026-08', total: 0 },
    { month: '2026-09', total: 305500 },
    { month: '2026-10', total: data.total },
  ]);
});

test('花销分析：大额单笔最多 5 笔，没有备注时用截图商户名', async () => {
  const { analyze } = require('../cloudfunctions/api/insight');
  const records = [60000, 70000, 80000, 90000, 100000, 110000, 100].map(
    (amount, index) => ({
      _id: 'e' + index,
      amount,
      cat: '食费',
      note: index === 5 ? '' : 'n' + index,
      src: { merchant: '某某超市' },
      date: '2026-10-0' + (index + 1),
    }),
  );
  const result = analyze('2026-10', records);
  assert.deepEqual(
    result.big.map((row) => row.amount),
    [110000, 100000, 90000, 80000, 70000],
  );
  assert.equal(result.big[0].note, '某某超市');
  assert.equal(result.big[0].cat, '吃饭');
  assert.equal(result.prevTotal, 0);
});

test('小报寄语：只发汇总数字，存下来，数字变了提示重新写，每天最多 2 次', async () => {
  assert.equal(
    (await (await setup()).call('A', 'recap.write', {})).code,
    'UNAVAILABLE',
  );
  const prompts = [];
  const vision = {
    async ensure() {},
    async write(feature, prompt) {
      assert.equal(feature, 'recapNote');
      prompts.push(prompt);
      return '**你们**这个月很棒。\n\n\n下个月继续。';
    },
  };
  const { call, insights } = await setup({ vision });
  assert.equal(
    (await call('A', 'recap.write', { month: '2026-11' })).code,
    'VALIDATION',
  );
  await call(
    'A',
    'expense.add',
    expense({ date: '2026-09-02', amount: 300000 }),
  );
  const dish = await call('B', 'dish.add', { name: '拉面', tag: '外食' });
  await call('B', 'dish.update', { id: dish.data.id, ateOn: '2026-09-10' });

  assert.equal((await call('A', 'recap.get', {})).data.note, null);
  const written = await call('A', 'recap.write', {});
  assert.deepEqual(written.data, {
    text: '你们这个月很棒。\n下个月继续。',
    ts: NOW,
    stale: false,
  });
  const prompt = prompts[0];
  assert.match(prompt, /支出合计 3000 元，共 1 笔/);
  assert.match(prompt, /吃得最多的是「拉面」/);
  for (const secret of ['超凡', '佳益', '"A"', 'householdId'])
    assert.equal(prompt.includes(secret), false, secret);
  assert.equal(insights.docs.size, 1);
  assert.equal(
    [...insights.docs.keys()][0].includes('-recap-2026-09'),
    true,
    '和喵喵小结分开存',
  );

  assert.equal((await call('B', 'recap.get', {})).data.note.stale, false);
  await call('A', 'expense.add', expense({ date: '2026-09-05', amount: 500 }));
  assert.equal((await call('B', 'recap.get', {})).data.note.stale, true);
  assert.equal((await call('B', 'recap.write', {})).ok, true);
  assert.equal(insights.docs.size, 1, '每月只存一份');
  assert.equal((await call('B', 'recap.write', {})).code, 'LIMIT');
  assert.equal((await call('X', 'recap.get', {})).data.note, null);
});

test('AI 小结：只发汇总、存下来、账目变了提示重新生成、每天最多 5 次', async () => {
  assert.equal(
    (await (await setup()).call('A', 'insight.write', { month: '2026-10' }))
      .code,
    'UNAVAILABLE',
  );
  const prompts = [];
  const vision = {
    async ensure() {},
    async write(feature, prompt) {
      assert.equal(feature, 'summary');
      prompts.push(prompt);
      return '**这个月**花得最多的是房租。\n\n\n机票是一次性的。';
    },
  };
  const { call, insights } = await setup({ vision });
  assert.equal(
    (await call('A', 'insight.write', { month: '2026-10' })).code,
    'VALIDATION',
  );
  await call('A', 'expense.add', expense({ amount: 300000, cat: '房租' }));
  await call(
    'B',
    'expense.add',
    expense({
      amount: 98000,
      cat: '旅行',
      note: '国庆机票去大阪玩五天',
      payer: 'b',
    }),
  );
  await call('A', 'expense.add', expense({ amount: 4000, date: '2026-09-03' }));

  assert.equal(
    (await call('A', 'insight.get', { month: '2026-10' })).data.summary,
    null,
  );
  const written = await call('A', 'insight.write', { month: '2026-10' });
  assert.equal(written.ok, true);
  assert.deepEqual(written.data, {
    text: '这个月花得最多的是房租。\n机票是一次性的。',
    ts: NOW,
    stale: false,
  });
  const prompt = prompts[0];
  assert.match(prompt, /10月支出合计 3980 元，共 2 笔；上个月（9月）40 元/);
  assert.match(prompt, /- 旅行：980 \/ 0 \/ 1 笔/);
  assert.match(prompt, /10月5日 旅行 980 元「国庆机票去大阪玩五天」/);
  for (const secret of ['超凡', '佳益', '"A"', 'householdId'])
    assert.equal(prompt.includes(secret), false, secret);
  assert.equal(insights.docs.size, 1);

  const seen = await call('B', 'insight.get', { month: '2026-10' });
  assert.equal(seen.data.summary.text, written.data.text);
  assert.equal(seen.data.summary.stale, false);
  await call('A', 'expense.add', expense({ amount: 500 }));
  assert.equal(
    (await call('B', 'insight.get', { month: '2026-10' })).data.summary.stale,
    true,
  );

  for (let i = 2; i <= 5; i++)
    assert.equal(
      (await call('B', 'insight.write', { month: '2026-10' })).ok,
      true,
    );
  assert.equal(insights.docs.size, 1, '每月只存一份');
  assert.equal(
    (await call('B', 'insight.write', { month: '2026-10' })).code,
    'LIMIT',
  );
  assert.equal(prompts.length, 5);
});

test('AI 小结：备注截到 12 字', () => {
  const { summaryPrompt, analyze } = require('../cloudfunctions/api/insight');
  const prompt = summaryPrompt(
    analyze('2026-10', [
      {
        _id: 'e1',
        amount: 100,
        cat: '吃饭',
        note: '一二三四五六七八九十甲乙丙丁',
        date: '2026-10-01',
      },
    ]),
  );
  assert.match(prompt, /「一二三四五六七八九十甲乙」/);
});

test('AI 小结：拿哪个月比分三种情况', () => {
  const { summaryPrompt, analyze } = require('../cloudfunctions/api/insight');
  const row = (date, amount, cat = '吃饭') => ({
    _id: date + amount,
    amount,
    cat,
    date,
  });
  const october = [row('2026-10-01', 2000), row('2026-10-23', 369651, '娱乐')];

  // 刚开始用：不比
  const first = analyze('2026-10', october);
  assert.equal(first.compare, null);
  let prompt = summaryPrompt(first);
  assert.match(prompt, /这是开始记账的第一个月，没有更早的账可比/);
  assert.match(prompt, /不要说哪类变多、变少或新增/);
  assert.match(prompt, /- 娱乐：3696\.51 \/ 1 笔/);
  assert.equal(prompt.includes('每月支出'), false, '只有一个月时不列走势');

  // 上个月空着、更早有账：比最近有账的月份，并说上个月没记
  const skipped = analyze('2026-10', [
    ...october,
    row('2026-07-15', 1000),
    row('2026-08-01', 5000),
  ]);
  assert.deepEqual(skipped.compare, {
    month: '2026-08',
    total: 5000,
    days: 31,
    fullDays: 31,
  });
  assert.equal(skipped.prevTotal, 0);
  assert.equal(skipped.byCategory.find((r) => r.cat === '吃饭').ref, 5000);
  prompt = summaryPrompt(skipped);
  assert.match(
    prompt,
    /上个月（9月）没有记账（多半是忘了记，不是没花钱），拿最近有账的 8月 比：8月 50 元。/,
  );
  assert.match(prompt, /和8月比哪几类明显变多或变少/);
  assert.match(prompt, /要提一句9月没记账/);
  assert.match(prompt, /- 吃饭：20 \/ 50 \/ 1 笔/);

  // 上个月中途开始记：照比，写明只记了几天
  const partial = analyze('2026-10', [...october, row('2026-09-21', 5000)]);
  assert.deepEqual(partial.compare, {
    month: '2026-09',
    total: 5000,
    days: 10,
    fullDays: 30,
  });
  prompt = summaryPrompt(partial);
  assert.match(
    prompt,
    /上个月（9月）50 元，但9月是从 21 日才开始记的，只记了 10 天。/,
  );
  assert.match(prompt, /不要说「多了几倍」「新增」这类结论/);
});

test('攒钱目标：每月要存、存了一笔、本月还差、改正已存、别人家看不到', async () => {
  const { call, goals } = await setup();
  for (const bad of [
    { title: '', target: 100, deadline: '2027-05' },
    { title: '旅行', target: 0, deadline: '2027-05' },
    { title: '旅行', target: 12.5, deadline: '2027-05' },
    { title: '旅行', target: 100, deadline: '2027-5' },
    { title: '旅行', target: 100, deadline: '2027-05', saved: -1 },
    { title: 'x'.repeat(21), target: 100, deadline: '2027-05' },
  ])
    assert.equal(
      (await call('A', 'goal.add', bad)).code,
      'VALIDATION',
      JSON.stringify(bad),
    );
  // 现在是 2026-10，到 2027-05 含两头共 8 个月。
  const added = await call('A', 'goal.add', {
    title: '日本旅行',
    target: 2000000,
    deadline: '2027-05',
    saved: 400000,
  });
  assert.equal(added.ok, true);
  assert.equal(added.data.monthsLeft, 8);
  assert.equal(added.data.perMonth, 200000);
  assert.equal(added.data.behind, 200000);
  assert.equal(added.data.percent, 20);
  const id = added.data.id;

  assert.equal(
    (await call('B', 'goal.deposit', { id, amount: 0 })).code,
    'VALIDATION',
  );
  const deposited = await call('B', 'goal.deposit', { id, amount: 50000 });
  assert.equal(deposited.data.saved, 450000);
  assert.equal(deposited.data.thisMonth, 50000);
  assert.equal(deposited.data.perMonth, 200000, '本月存了之后每月要存不变');
  assert.equal(deposited.data.behind, 150000);
  assert.deepEqual(deposited.data.log, [
    { amount: 50000, date: '2026-10-20', role: 'b', ts: NOW },
  ]);
  assert.equal(JSON.stringify(goals.docs.get(id)).includes('"B"'), false);
  assert.deepEqual(deposited.data.savedBy, { a: 0, b: 50000 });
  assert.equal(deposited.data.doneOn, '');
  // 刚好攒够那一笔的日期；初始已存的 40 万也算在内。
  const nearly = await call('A', 'goal.add', {
    title: '小目标',
    target: 30000,
    deadline: '2027-05',
    saved: 10000,
  });
  await call('B', 'goal.deposit', { id: nearly.data.id, amount: 10000 });
  const reached = await call('A', 'goal.deposit', {
    id: nearly.data.id,
    amount: 20000,
  });
  assert.equal(reached.data.done, true);
  assert.equal(reached.data.doneOn, '2026-10-20');
  assert.deepEqual(reached.data.savedBy, { a: 20000, b: 10000 });

  // 只改名字不会动已存金额；改正已存金额要显式传。
  const renamed = await call('A', 'goal.update', { id, title: '大阪旅行' });
  assert.equal(renamed.data.saved, 450000);
  const corrected = await call('A', 'goal.update', { id, saved: 2000000 });
  assert.equal(corrected.data.done, true);
  assert.equal(corrected.data.behind, 0);
  assert.equal(corrected.data.percent, 100);

  await call('A', 'goal.add', {
    title: '过期的',
    target: 1000,
    deadline: '2026-01',
  });
  const list = (await call('B', 'goal.list')).data;
  assert.deepEqual(
    list.map((goal) => [goal.title, goal.monthsLeft, goal.perMonth]),
    [
      ['过期的', 0, 1000],
      ['大阪旅行', 8, 0],
      ['小目标', 8, 0],
    ],
  );
  assert.equal((await call('X', 'goal.list')).data.length, 0);
  assert.equal(
    (await call('X', 'goal.deposit', { id, amount: 100 })).code,
    'NOT_FOUND',
  );
});

test('攒钱建议：前 3 个整月、不含房租水电和收入，取月均最多的 3 类', async () => {
  const { call } = await setup();
  const rows = [
    { amount: 300000, cat: '房租', date: '2026-09-01' },
    { amount: 30000, cat: '吃饭', date: '2026-07-10' },
    { amount: 60000, cat: '吃饭', date: '2026-09-10' },
    { amount: 9000, cat: '娱乐', date: '2026-08-10' },
    { amount: 3000, cat: '日用', date: '2026-08-10' },
    { amount: 1500, cat: '交通', date: '2026-08-11' },
    { amount: 99900, cat: '旅行', date: '2026-06-30' },
    { amount: 99900, cat: '旅行', date: '2026-10-01' },
    {
      amount: 500000,
      cat: '其他',
      date: '2026-09-15',
      flow: 'in',
      split: 'self',
    },
  ];
  for (const row of rows)
    assert.equal((await call('A', 'expense.add', expense(row))).ok, true);
  assert.deepEqual((await call('B', 'goal.tips')).data, [
    { cat: '吃饭', average: 30000, save10: 3000, save20: 6000 },
    { cat: '娱乐', average: 3000, save10: 300, save20: 600 },
    { cat: '日用', average: 1000, save10: 100, save20: 200 },
  ]);
});

test('分类预算：整体替换、校验分类和金额，记账后返回本月用量', async () => {
  const { call } = await setup();
  for (const bad of [[], { 奢侈品: 100 }, { 吃饭: 12.5 }, { 吃饭: -1 }])
    assert.equal(
      (await call('A', 'household.update', { budgets: bad })).code,
      'VALIDATION',
      JSON.stringify(bad),
    );
  const set = await call('A', 'household.update', {
    budgets: { 吃饭: 10000, 日用: 0, 娱乐: 5000 },
  });
  assert.deepEqual(set.data.budgets, { 吃饭: 10000, 娱乐: 5000 });
  const replaced = await call('B', 'household.update', {
    budgets: { 吃饭: 10000 },
  });
  assert.deepEqual(replaced.data.budgets, { 吃饭: 10000 });
  assert.deepEqual((await call('A', 'household.get')).data.budgets, {
    吃饭: 10000,
  });

  const first = await call('A', 'expense.add', expense({ amount: 7000 }));
  assert.deepEqual(first.data.budget, {
    cat: '吃饭',
    limit: 10000,
    used: 7000,
    before: 0,
  });
  const second = await call(
    'B',
    'expense.add',
    expense({ amount: 2000, payer: 'b', split: 'self' }),
  );
  assert.deepEqual(second.data.budget, {
    cat: '吃饭',
    limit: 10000,
    used: 9000,
    before: 7000,
  });
  // 改一笔：before 是改之前的用量。
  const edited = await call('A', 'expense.update', {
    id: first.data.id,
    ...expense({ amount: 9000 }),
  });
  assert.deepEqual(edited.data.budget, {
    cat: '吃饭',
    limit: 10000,
    used: 11000,
    before: 9000,
  });
  // 改到别的分类：吃饭不再算它。
  const moved = await call('A', 'expense.update', {
    id: first.data.id,
    ...expense({ amount: 9000, cat: '日用' }),
  });
  assert.equal(moved.data.budget, undefined);
  // 收入、别的月份、没设预算的分类都不带。
  const income = await call(
    'A',
    'expense.add',
    expense({ amount: 100, flow: 'in', split: 'self' }),
  );
  assert.equal(income.data.budget, undefined);
  const september = await call(
    'A',
    'expense.add',
    expense({ amount: 500, date: '2026-09-30' }),
  );
  assert.deepEqual(september.data.budget, {
    cat: '吃饭',
    limit: 10000,
    used: 500,
    before: 0,
  });
});

test('年度回顾的记录：就吃这个、勾完待办、去过了都留一条，清除已完成后还在', async () => {
  const { call, activity } = await setup();
  const entries = () =>
    [...activity.docs.values()].map((d) => [d.type, d.title, d.date]).sort();

  const dish = await call('A', 'dish.add', { name: '火锅', tag: '外食' });
  await call('A', 'dish.update', { id: dish.data.id, ateOn: '2026-10-20' });
  // 同一天再点一次不重复，改名不影响
  await call('B', 'dish.update', { id: dish.data.id, ateOn: '2026-10-20' });
  await call('B', 'dish.update', { id: dish.data.id, name: '重庆火锅' });
  await call('A', 'dish.update', { id: dish.data.id, ateOn: '2026-10-22' });

  const todo = await call('A', 'todo.add', {
    text: '倒垃圾',
    kind: 'todo',
    who: 'b',
  });
  assert.equal(todo.data.doneOn, '');
  const done = await call('B', 'todo.update', { id: todo.data.id, done: true });
  assert.equal(done.data.doneOn, '2026-10-20');
  // 改文字不改完成日期
  const edited = await call('B', 'todo.update', {
    id: todo.data.id,
    text: '倒垃圾和纸箱',
  });
  assert.equal(edited.data.doneOn, '2026-10-20');

  const slip = await call('A', 'todo.add', {
    text: '买猫砂',
    kind: 'shop',
    who: 'a',
  });
  await call('A', 'todo.update', { id: slip.data.id, done: true });
  // 勾错了取消：那天的记录删掉，完成日期清空
  const undone = await call('A', 'todo.update', {
    id: slip.data.id,
    done: false,
  });
  assert.equal(undone.data.doneOn, '');

  const wish = await call('A', 'wish.add', {
    title: '大阪',
    why: '',
    plan: '',
  });
  await call('A', 'wish.update', {
    id: wish.data.id,
    done: true,
    doneOn: '2026-10-05',
  });

  await call('A', 'todo.clearDone', { kind: 'todo' });
  assert.deepEqual(entries(), [
    ['dish', '火锅', '2026-10-20'],
    ['dish', '重庆火锅', '2026-10-22'],
    ['todo', '倒垃圾', '2026-10-20'],
    ['wish', '大阪', '2026-10-05'],
  ]);
});

test('AI 小帮手：一句话拆清单只返回结果、不保存，坏内容丢掉', async () => {
  assert.equal(
    (await (await setup()).call('A', 'todo.split', { text: '猫砂和猫粮' }))
      .code,
    'UNAVAILABLE',
  );
  const prompts = [];
  const vision = {
    async ensure() {},
    async write(feature, prompt) {
      assert.equal(feature, 'todoSplit');
      prompts.push(prompt);
      return '```json\n{"items":[{"text":"猫砂","kind":"shop"},{"text":"**猫砂**","kind":"shop"},{"text":"","kind":"todo"},{"text":"预约疫苗","kind":"x"}]}\n```';
    },
  };
  const { call, todos } = await setup({ vision });
  assert.equal(
    (await call('A', 'todo.split', { text: '猫' })).code,
    'VALIDATION',
  );
  const result = await call('A', 'todo.split', { text: '买猫砂，预约疫苗' });
  assert.deepEqual(result.data.items, [
    { text: '猫砂', kind: 'shop' },
    { text: '预约疫苗', kind: 'todo' },
  ]);
  assert.ok(prompts[0].includes('买猫砂，预约疫苗'));
  assert.equal(todos.docs.size, 0);
  assert.equal(
    (await call('X', 'todo.split', { text: '买猫砂，预约疫苗' })).ok,
    true,
  );
});

test('AI 小帮手：吃啥只能挑菜单里有的，编号错了或重复的丢掉', async () => {
  let reply = '{"picks":[{"n":9,"reason":"没有这个"}]}';
  const vision = {
    async ensure() {},
    async write(feature, prompt) {
      assert.equal(feature, 'dishPick');
      assert.ok(prompt.includes('清淡'));
      return reply;
    },
  };
  const { call } = await setup({ vision });
  assert.equal(
    (await call('A', 'dish.pick', { want: '清淡' })).code,
    'VALIDATION',
  );
  await call('A', 'dish.add', { name: '拉面', tag: '外食' });
  await call('A', 'dish.add', { name: '咖喱饭', tag: '在家做' });
  await call('A', 'dish.add', { name: '炒青菜', tag: '在家做' });
  assert.equal(
    (await call('A', 'dish.pick', { want: '清淡' })).code,
    'UNAVAILABLE',
  );
  reply =
    '{"picks":[{"n":1,"reason":"**清淡**好消化"},{"n":1,"reason":"重复"},{"n":2,"reason":"简单"},{"n":9,"reason":"没有"}]}';
  const picked = await call('A', 'dish.pick', { want: '清淡' });
  assert.equal(picked.data.picks.length, 2);
  const names = ['拉面', '咖喱饭', '炒青菜'];
  for (const pick of picked.data.picks) {
    assert.ok(names.includes(pick.name));
    assert.ok(pick.id);
  }
  assert.equal(picked.data.picks[0].reason, '清淡好消化');
  assert.equal(
    (await call('A', 'dish.pick', { want: '清淡', tag: '夜宵' })).code,
    'VALIDATION',
  );
});

test('AI 小帮手：纪念日祝福只用自己家的纪念日，不存', async () => {
  const prompts = [];
  const vision = {
    async ensure() {},
    async write(feature, prompt) {
      assert.equal(feature, 'dateWish');
      prompts.push(prompt);
      return '{"wish":"**一起走过** 三年。","ideas":["散步","做顿饭","写张卡","多余的"]}';
    },
  };
  const { call, dates } = await setup({ vision });
  const added = await call('A', 'date.add', {
    title: '恋爱纪念日',
    date: '2023-10-25',
    yearly: true,
  });
  const id = added.data.id;
  const before = dates.docs.size;
  const result = await call('A', 'date.wish', { id, budget: 'low' });
  assert.equal(result.data.wish, '一起走过 三年。');
  assert.deepEqual(result.data.ideas, ['散步', '做顿饭', '写张卡']);
  assert.ok(prompts[0].includes('恋爱纪念日'));
  assert.ok(prompts[0].includes('预算几十元'));
  assert.equal(dates.docs.size, before);
  assert.equal(
    (await call('X', 'date.wish', { id, budget: 'low' })).code,
    'NOT_FOUND',
  );
});

test('主页汇总 home.get：一次请求读齐六样，和分开读的结果一样，小家只读一次', async () => {
  const { call, households } = await setup();
  await call('A', 'expense.add', expense());
  await call('B', 'todo.add', { text: '牛奶', kind: 'shop', who: 'both' });
  await call('A', 'date.add', {
    title: '结婚纪念日',
    date: '2025-11-03',
    yearly: true,
  });
  await call('A', 'goal.add', {
    title: '旅行',
    target: 100000,
    deadline: '2027-05',
  });
  await call('A', 'wish.add', {
    title: '箱根',
    done: true,
    doneOn: '2026-10-05',
  });
  const separate = {
    month: (await call('A', 'expense.list', { month: '2026-10' })).data,
    todos: (await call('A', 'todo.list', {})).data,
    dates: (await call('A', 'date.list', {})).data,
    goals: (await call('A', 'goal.list', {})).data,
    recent: (await call('A', 'activity.recent', {})).data,
  };

  let reads = 0;
  const find = households.findByMember;
  households.findByMember = async (openid) => {
    reads++;
    return find(openid);
  };
  const home = await call('A', 'home.get', { month: '2026-10' });
  households.findByMember = find;

  assert.equal(home.ok, true);
  assert.equal(reads, 1);
  assert.deepEqual(home.data.month, separate.month);
  assert.deepEqual(home.data.todos, separate.todos);
  assert.deepEqual(home.data.dates, separate.dates);
  assert.deepEqual(home.data.goals, separate.goals);
  assert.deepEqual(home.data.recent, separate.recent);
  assert.equal(home.data.footprints.total.places, 1);
  assert.equal(home.data.footprints.items[0].title, '箱根');
});

test('主页汇总 home.get：别的小家看不到；没有小家、月份不对都报错；攒钱等读不到只给 null', async () => {
  const { call, goals, activity, wishes } = await setup();
  await call('A', 'expense.add', expense({ note: '只有我家' }));
  const other = await call('X', 'home.get', { month: '2026-10' });
  assert.equal(other.ok, true);
  assert.equal(other.data.month.records.length, 0);
  assert.equal(
    (await call('Z', 'home.get', { month: '2026-10' })).code,
    'NO_HOUSEHOLD',
  );
  assert.equal(
    (await call('A', 'home.get', { month: '10月' })).code,
    'VALIDATION',
  );
  assert.equal((await call('A', 'home.get', {})).code, 'VALIDATION');

  goals.listAll = async () => {
    throw new Error('db down');
  };
  activity.listAll = async () => {
    throw new Error('db down');
  };
  wishes.listAll = async () => {
    throw new Error('db down');
  };
  const degraded = await call('A', 'home.get', { month: '2026-10' });
  assert.equal(degraded.ok, true);
  assert.equal(degraded.data.month.records.length, 1);
  assert.equal(degraded.data.goals, null);
  assert.equal(degraded.data.recent, null);
  assert.equal(degraded.data.footprints, null);
});

test('足迹轻量版：主页用的不去读当天的账，足迹页照旧算花了多少', async () => {
  const { call, expenses } = await setup();
  await call('A', 'expense.add', expense({ date: '2026-10-05', amount: 8800 }));
  await call('A', 'wish.add', {
    title: '箱根',
    done: true,
    doneOn: '2026-10-05',
  });
  let reads = 0;
  const listMonth = expenses.listMonth;
  expenses.listMonth = async (...args) => {
    reads++;
    return listMonth(...args);
  };
  const light = await call('A', 'footprint.list', { light: true });
  assert.equal(reads, 0);
  assert.equal(light.data.items[0].spent, 0);
  const full = await call('A', 'footprint.list', {});
  assert.equal(reads, 1);
  assert.equal(full.data.items[0].spent, 8800);
});

test('TA 最近：有按日期读的接口时只读近两周的，没有时读全部再筛，结果一样', async () => {
  const { call, activity } = await setup();
  await call('B', 'todo.add', { text: '牛奶', kind: 'shop', who: 'both' });
  const before = (await call('A', 'activity.recent', {})).data;
  let since = '';
  activity.listSince = async (householdId, from) => {
    since = from;
    return (await activity.listAll(householdId)).filter(
      (record) => record.date >= from,
    );
  };
  const after = (await call('A', 'activity.recent', {})).data;
  assert.equal(since, '2026-10-06');
  assert.deepEqual(after, before);
});
