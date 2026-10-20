const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/api/router');

function memoryHouseholds() {
  const docs = new Map();
  let seq = 0;
  return {
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
    async listMonth(householdId, month) {
      return own(householdId)
        .filter((d) => d.date.slice(0, 7) === month)
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
    async update(householdId, id, fields) {
      const d = docs.get(id);
      if (d && d.householdId === householdId) docs.set(id, { ...d, ...fields });
    },
    async remove(householdId, id) {
      const d = docs.get(id);
      if (d && d.householdId === householdId) docs.delete(id);
    },
  };
}

// 2026-10-20 12:00 UTC+8
const NOW = Date.parse('2026-10-20T04:00:00Z');

async function setup() {
  const expenses = memoryRecords('e');
  const todos = memoryRecords('t');
  const route = createRouter({
    households: memoryHouseholds(),
    archive: {},
    expenses,
    todos,
    now: () => NOW,
  });
  const call = (openid, action, payload) => route({ action, payload }, openid);
  const created = await call('A', 'household.create', { name: '超凡' });
  await call('B', 'household.join', {
    name: '佳益',
    code: created.data.inviteCode,
  });
  await call('X', 'household.create', { name: '别人家' });
  return { call, expenses, todos };
}

const expense = (overrides = {}) => ({
  amount: 1200,
  note: '超市',
  cat: '食费',
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
  assert.deepEqual(
    parsed.household.members.map((m) => m.name),
    ['超凡', '佳益'],
  );
  assert.deepEqual(Object.keys(parsed.expenses[0]).sort(), [
    'amount',
    'byRole',
    'cat',
    'date',
    'id',
    'note',
    'payer',
    'split',
    'ts',
  ]);
  const other = await call('X', 'data.export');
  assert.equal(other.data.expenses.length, 0);
});
