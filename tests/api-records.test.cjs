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
    async readComplete(householdId) {
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

async function setup() {
  const expenses = memoryRecords('e');
  const todos = memoryRecords('t');
  const dishes = memoryRecords('d');
  const wishes = memoryRecords('w');
  const dates = memoryRecords('n');
  const route = createRouter({
    households: memoryHouseholds(),
    archive: {},
    expenses,
    todos,
    dishes,
    wishes,
    dates,
    now: () => NOW,
  });
  const call = (openid, action, payload) => route({ action, payload }, openid);
  const created = await call('A', 'household.create', { name: '超凡' });
  await call('B', 'household.join', {
    name: '佳益',
    code: created.data.inviteCode,
  });
  await call('X', 'household.create', { name: '别人家' });
  return { call, expenses, todos, dishes, wishes, dates };
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
