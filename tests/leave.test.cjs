const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/api/router');

// 限时免费期间所有小家都算会员；这里测的是免费 / 会员各自的行为，所以先关掉。
process.env.VIP_FREE_UNTIL = 'off';

function memoryHouseholds() {
  const docs = new Map();
  let seq = 0;
  const has = (d, openid) => d.members.some((m) => m.openid === openid);
  return {
    docs,
    // 测试用：在 leave 的条件更新前插一手，模拟对方同时退出。
    beforeLeave: null,
    async findByMember(openid) {
      return [...docs.values()].find((d) => has(d, openid)) || null;
    },
    async findByCode(code) {
      return [...docs.values()].find((d) => d.inviteCode === code) || null;
    },
    async findById(id) {
      return docs.get(id) || null;
    },
    async findDeparted(openid) {
      return [...docs.values()].filter((d) =>
        (d.departed || []).some((e) => e.openid === openid),
      );
    },
    async insert(doc) {
      const id = 'h' + ++seq;
      docs.set(id, { ...doc, _id: id });
      return id;
    },
    async insertWithId(id, doc) {
      if (docs.has(id)) return false;
      docs.set(id, { ...doc, _id: id });
      return true;
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
    async leave(id, openid, { members, memberCount, inviteCode, entry }) {
      if (this.beforeLeave) await this.beforeLeave();
      const d = docs.get(id);
      if (!d || d.memberCount !== 2 || !has(d, openid)) return false;
      docs.set(id, {
        ...d,
        members,
        memberCount,
        inviteCode,
        departed: [...(d.departed || []), entry],
      });
      return true;
    },
    async withdraw(id, openid, { members, inviteCode, by }) {
      const d = docs.get(id);
      if (!d || d.memberCount !== 2 || !has(d, openid)) return false;
      docs.set(id, { ...d, members, memberCount: 1, inviteCode, by });
      return true;
    },
    async vacate(id, openid) {
      const d = docs.get(id);
      if (!d || d.memberCount !== 1 || !has(d, openid)) return false;
      docs.set(id, {
        ...d,
        members: [],
        memberCount: 0,
        inviteCode: '',
        copy: null,
        purge: true,
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
  const match = (d, householdId, notBy) =>
    d.householdId === householdId && (!notBy || d.by !== notBy);
  return {
    docs,
    // 测试用：第几次插入时失败，模拟复制到一半网络断了。
    failAt: 0,
    inserts: 0,
    async listAll(householdId) {
      return own(householdId).map((d) => ({ ...d }));
    },
    async listMonth(householdId, month) {
      return own(householdId).filter((d) => d.date.slice(0, 7) === month);
    },
    async listRange() {
      return [];
    },
    async listAfter(householdId, cursor, limit) {
      return own(householdId)
        .filter((d) => !cursor || d._id > cursor)
        .sort((a, b) => (a._id < b._id ? -1 : 1))
        .slice(0, limit)
        .map((d) => ({ ...d }));
    },
    async get(householdId, id) {
      const d = docs.get(id);
      return d && d.householdId === householdId ? { ...d } : null;
    },
    async insert(doc) {
      const id = prefix + String(++seq).padStart(4, '0');
      docs.set(id, { ...doc, _id: id });
      return id;
    },
    async insertWithId(id, doc) {
      this.inserts++;
      if (this.failAt && this.inserts === this.failAt)
        throw new Error('network');
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
    async count(householdId, notBy) {
      return [...docs.values()].filter((d) => match(d, householdId, notBy))
        .length;
    },
    async anonymize(householdId, openid) {
      let changed = 0;
      for (const [id, d] of docs)
        for (const field of ['by', 'editedBy'])
          if (d.householdId === householdId && d[field] === openid) {
            docs.set(id, { ...docs.get(id), [field]: '' });
            changed++;
          }
      return changed;
    },
    async removeAll(householdId, notBy) {
      let removed = 0;
      for (const [id, d] of docs)
        if (match(d, householdId, notBy)) {
          docs.delete(id);
          removed++;
        }
      return removed;
    },
  };
}

const NOW = Date.parse('2026-10-20T04:00:00Z');

async function setup() {
  const households = memoryHouseholds();
  const repos = {
    expenses: memoryRecords('e'),
    todos: memoryRecords('t'),
    dishes: memoryRecords('d'),
    wishes: memoryRecords('w'),
    dates: memoryRecords('n'),
    insights: memoryRecords('i'),
    goals: memoryRecords('g'),
    activity: memoryRecords('a'),
  };
  repos.goals.deposit = async (householdId, id, entry) => {
    const d = repos.goals.docs.get(id);
    repos.goals.docs.set(id, {
      ...d,
      saved: (d.saved || 0) + entry.amount,
      log: [...(d.log || []), entry],
    });
  };
  let clock = NOW;
  const route = createRouter({
    households,
    archive: {},
    ...repos,
    now: () => clock,
  });
  const call = async (openid, action, payload) => {
    clock += 1;
    return route({ action, payload }, openid);
  };
  const created = await call('A', 'household.create', { name: '超凡' });
  await call('B', 'household.join', {
    name: '佳益',
    code: created.data.inviteCode,
  });
  return { households, repos, call, oldId: created.data.id };
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

/** 两人各记一些：A 记一笔 A 付的，B 记一笔 B 付的、一条指派给 A 的待办、一个目标并各存一笔、一次「就吃这个」。 */
async function fill(call) {
  await call('A', 'expense.add', expense({ payer: 'a', amount: 100 }));
  const byB = await call(
    'B',
    'expense.add',
    expense({ payer: 'b', amount: 200 }),
  );
  await call('A', 'expense.update', {
    id: byB.data.id,
    ...expense({ payer: 'b', amount: 250 }),
  });
  await call('B', 'todo.add', { text: '买猫粮', kind: 'shop', who: 'a' });
  const goal = await call('B', 'goal.add', {
    title: '旅行',
    target: 10000,
    deadline: '2027-01',
  });
  await call('A', 'goal.deposit', { id: goal.data.id, amount: 300 });
  await call('B', 'goal.deposit', { id: goal.data.id, amount: 500 });
  const dish = await call('B', 'dish.add', { name: '咖喱', tag: '在家做' });
  await call('A', 'dish.update', { id: dish.data.id, ateOn: '2026-10-19' });
  await call('B', 'dish.vote', { id: dish.data.id, vote: 'want' });
  await call('B', 'dish.rate', { id: dish.data.id, rating: 'good' });
  await call('A', 'dish.rate', { id: dish.data.id, rating: 'bad' });
}

/** 想去：A 记了一条带回忆和照片、A 点了「我也想去」。 */
async function fillWish(call) {
  const householdId = (await call('A', 'household.get')).data.id;
  const wish = await call('A', 'wish.add', { title: '镰仓' });
  await call('A', 'wish.update', {
    id: wish.data.id,
    memo: '看了海',
    photos: [`cloud://env.x/wish-photos/${householdId}/a.jpg`],
  });
  await call('A', 'wish.want', { id: wish.data.id, want: true });
}

/** 清空、只剩自己时退出：先替对方复制完（waiting），再真正执行。 */
async function untilDone(call, openid, action, payload) {
  for (let i = 0; i < 50; i++) {
    const result = await call(openid, action, payload);
    if (!result.ok || !result.data.waiting) return result;
  }
  throw new Error('一直在等');
}

async function copyAll(call, openid) {
  for (let i = 0; i < 50; i++) {
    const result = await call(openid, 'household.copy');
    if (!result.ok) return result;
    if (result.data.done) return result;
  }
  throw new Error('复制没有结束');
}

test('B 退出并带走副本：新小家里 B 是创建者，付款人、负责人、存入人跟着换', async () => {
  const { households, repos, call, oldId } = await setup();
  await fill(call);
  await fillWish(call);
  const left = await call('B', 'household.leave', {});
  assert.equal(left.ok, true);

  const mine = await call('B', 'household.get');
  assert.notEqual(mine.data.id, oldId);
  assert.equal(mine.data.myRole, 'a');
  assert.equal(mine.data.members.length, 1);
  assert.equal(mine.data.vip.active, false);
  assert.equal(mine.data.copying, true);

  const done = await copyAll(call, 'B');
  assert.equal(done.data.done, true);
  assert.equal((await call('B', 'household.get')).data.copying, false);

  const list = (await call('B', 'expense.list', { month: '2026-10' })).data
    .records;
  // 原来 B 付的 250 现在记在 a（B 自己）名下；A 付的 100 变成 b。
  assert.deepEqual(
    list.map((r) => [r.amount, r.payer]).sort((x, y) => x[0] - y[0]),
    [
      [100, 'b'],
      [250, 'a'],
    ],
  );
  // B 记的还是「我」记的；A 记的、A 改过的，不带 A 的身份。
  const mineRecord = list.find((r) => r.amount === 250);
  assert.equal(mineRecord.byRole, 'a');
  assert.equal(mineRecord.editedByRole, undefined);
  assert.equal(list.find((r) => r.amount === 100).byRole, '');
  for (const doc of Object.values(repos).flatMap((r) => [...r.docs.values()]))
    if (doc.householdId === mine.data.id) {
      assert.notEqual(doc.by, 'A');
      assert.notEqual(doc.editedBy, 'A');
    }

  const todos = (await call('B', 'todo.list')).data;
  assert.equal(todos[0].who, 'b');
  const goal = (await call('B', 'goal.list')).data[0];
  assert.equal(goal.saved, 800);
  assert.deepEqual(
    goal.log.map((e) => [e.amount, e.role]),
    [
      [500, 'a'],
      [300, 'b'],
    ],
  );
  // 「就吃这个」的回顾记录指向副本里的菜。
  const dish = (await call('B', 'dish.list')).data[0];
  // 评价跟着换角色，今天的投票不带走。
  assert.deepEqual(dish.ratings, { a: 'good', b: 'bad' });
  assert.deepEqual(dish.votes, {});
  // 想去：回忆一句话带走，照片留在旧小家（文件在旧小家的文件夹里）；「我也想去」跟着换角色。
  const wish = (await call('B', 'wish.list')).data[0];
  assert.deepEqual(
    [wish.memo, wish.photos, wish.wants],
    ['看了海', [], { b: true }],
  );
  const act = [...repos.activity.docs.values()].find(
    (d) => d.householdId === mine.data.id,
  );
  assert.equal(act.refId, dish.id);
  assert.equal(act._id, `dish_${dish.id}_2026-10-19`);

  // 留下的 A：小家原样，邀请码重新生效，会员和记录都在。
  const stay = await call('A', 'household.get');
  assert.equal(stay.data.id, oldId);
  assert.equal(stay.data.members.length, 1);
  assert.match(stay.data.inviteCode, /^[A-Z2-9]{6}$/);
  assert.equal(
    (await call('A', 'expense.list', { month: '2026-10' })).data.records.length,
    2,
  );
  assert.equal(households.docs.get(oldId).members[0].openid, 'A');
});

test('复制中途失败可以重试，不会重复；退出之后对方新记的不带走', async () => {
  const { repos, call } = await setup();
  for (let i = 0; i < 130; i++)
    await call('A', 'expense.add', expense({ amount: i + 1 }));
  await call('B', 'household.leave', {});
  await call('A', 'expense.add', expense({ amount: 9999 }));
  repos.expenses.failAt = repos.expenses.inserts + 30;
  const failed = await call('B', 'household.copy');
  assert.equal(failed.ok, false);
  const done = await copyAll(call, 'B');
  assert.equal(done.data.done, true);
  const records = (await call('B', 'expense.list', { month: '2026-10' })).data
    .records;
  assert.equal(records.length, 130);
  assert.equal(new Set(records.map((r) => r.amount)).size, 130);
  assert.equal(
    records.some((r) => r.amount === 9999),
    false,
  );
});

test('不带副本：新小家从空开始，旧小家不动', async () => {
  const { call } = await setup();
  await fill(call);
  await call('A', 'household.leave', { copy: false });
  const mine = await call('A', 'household.get');
  assert.equal(mine.data.copying, false);
  assert.equal(mine.data.myRole, 'a');
  assert.equal(
    (await call('A', 'expense.list', { month: '2026-10' })).data.records.length,
    0,
  );
  assert.equal(
    (await call('B', 'expense.list', { month: '2026-10' })).data.records.length,
    2,
  );
});

test('创建者退出后，新加入的人补上 a 的位置', async () => {
  const { call } = await setup();
  await call('A', 'household.leave', { copy: false });
  const stay = await call('B', 'household.get');
  assert.equal(stay.data.myRole, 'b');
  const joined = await call('C', 'household.join', {
    name: '新人',
    code: stay.data.inviteCode,
  });
  assert.equal(joined.data.myRole, 'a');
});

test('两人同时退出：后到的提示对方已经退出', async () => {
  const { households, call } = await setup();
  households.beforeLeave = async () => {
    households.beforeLeave = null;
    await call('A', 'household.leave', { copy: false });
  };
  const late = await call('B', 'household.leave', {});
  assert.equal(late.code, 'PARTNER_LEFT');
  assert.equal((await call('B', 'household.get')).data.members.length, 1);
});

test('退出到一半新小家没建成：再打开时补建', async () => {
  const { households, call } = await setup();
  const insert = households.insertWithId;
  households.insertWithId = async () => {
    throw new Error('network');
  };
  assert.equal((await call('B', 'household.leave', {})).ok, false);
  households.insertWithId = insert;
  const mine = await call('B', 'household.get');
  assert.equal(mine.data.myRole, 'a');
  assert.equal(mine.data.copying, true);
});

test('只剩一个人时退出：清空全部记录，回到创建 / 加入', async () => {
  const { households, repos, call, oldId } = await setup();
  await fill(call);
  await call('B', 'household.leave', { copy: false });
  const result = await untilDone(call, 'A', 'household.leave', {});
  assert.equal(result.ok, true);
  assert.equal((await call('A', 'household.get')).data, null);
  for (const repo of Object.values(repos))
    assert.equal(await repo.count(oldId), 0);
  assert.equal(households.docs.get(oldId).purge, false);
  // 还能重新创建
  assert.equal(
    (await call('A', 'household.create', { name: '超凡' })).ok,
    true,
  );
});

test('清空：两个人时不能清；只剩自己时只清对方记的，或全部清空', async () => {
  const { repos, call, oldId } = await setup();
  await fill(call);
  assert.equal((await call('A', 'household.clearCount')).code, 'VALIDATION');
  assert.equal(
    (await call('A', 'household.clear', { scope: 'all' })).code,
    'VALIDATION',
  );
  await call('B', 'household.leave', {});
  const counts = (await call('A', 'household.clearCount')).data;
  // B 记的：一笔账、一条待办、一个目标、一道菜；A 记的：一笔账、一条回顾。
  assert.deepEqual(counts, { all: 6, others: 4 });
  assert.equal(
    (await call('A', 'household.clear', { scope: 'nope' })).code,
    'VALIDATION',
  );
  // B 还没复制完：A 清空时先替 B 复制完，B 的副本完整。
  const first = await call('A', 'household.clear', { scope: 'others' });
  assert.equal(first.data.waiting, true);
  const others = await untilDone(call, 'A', 'household.clear', {
    scope: 'others',
  });
  assert.equal(others.data.removed, 4);
  assert.equal((await call('B', 'household.get')).data.copying, false);
  const left = (await call('A', 'expense.list', { month: '2026-10' })).data
    .records;
  assert.deepEqual(
    left.map((r) => r.amount),
    [100],
  );
  // B 带走的副本不受影响。
  await copyAll(call, 'B');
  assert.equal(
    (await call('B', 'expense.list', { month: '2026-10' })).data.records.length,
    2,
  );
  await untilDone(call, 'A', 'household.clear', { scope: 'all' });
  for (const repo of Object.values(repos))
    assert.equal(await repo.count(oldId), 0);
});

test('清空「对方记的」：我建的目标里对方存的几笔一起去掉', async () => {
  const { call } = await setup();
  const goal = await call('A', 'goal.add', {
    title: '买房',
    target: 100000,
    deadline: '2030-01',
  });
  await call('A', 'goal.deposit', { id: goal.data.id, amount: 300 });
  await call('B', 'goal.deposit', { id: goal.data.id, amount: 500 });
  await call('B', 'household.leave', { copy: false });
  assert.deepEqual((await call('A', 'household.clearCount')).data, {
    all: 1,
    others: 1,
  });
  await call('A', 'household.clear', { scope: 'others' });
  const kept = (await call('A', 'goal.list')).data[0];
  assert.equal(kept.saved, 300);
  assert.equal(kept.log.length, 1);
});

test('旧账没复制完时不能清空', async () => {
  const { call } = await setup();
  await fill(call);
  await call('B', 'household.leave', {});
  assert.equal((await call('B', 'household.clearCount')).code, 'BUSY');
});

test('B 刚退出还没复制，A 只剩自己就退出：先替 B 复制完再删', async () => {
  const { call } = await setup();
  await fill(call);
  await call('B', 'household.leave', {});
  const first = await call('A', 'household.leave', {});
  assert.equal(first.data.waiting, true);
  assert.equal((await untilDone(call, 'A', 'household.leave', {})).ok, true);
  assert.equal((await call('B', 'household.get')).data.copying, false);
  assert.equal(
    (await call('B', 'expense.list', { month: '2026-10' })).data.records.length,
    2,
  );
});

const everyone = (repos) =>
  Object.values(repos).flatMap((repo) => [...repo.docs.values()]);

test('注销需要确认', async () => {
  const { call } = await setup();
  const result = await call('B', 'account.delete', {});
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION');
  assert.equal((await call('B', 'household.get')).data.members.length, 2);
});

test('两人时注销：B 退出，共同账本留给 A，B 的身份从记录里抹掉', async () => {
  const { households, repos, call, oldId } = await setup();
  await fill(call);
  const before = await repos.expenses.count(oldId);
  const result = await call('B', 'account.delete', { confirm: true });
  assert.deepEqual(result.data, { deleted: true });
  assert.equal((await call('B', 'household.get')).data, null);
  const home = households.docs.get(oldId);
  assert.equal(home.memberCount, 1);
  assert.deepEqual(
    home.members.map((member) => member.openid),
    ['A'],
  );
  assert.ok(home.inviteCode);
  // 账本一条没少；B 记的、改的只剩「不是 A」
  assert.equal(await repos.expenses.count(oldId), before);
  const rows = everyone(repos).filter((d) => d.householdId === oldId);
  assert.ok(rows.length > 0);
  assert.equal(
    rows.some((d) => d.by === 'B' || d.editedBy === 'B'),
    false,
  );
  assert.equal(
    rows.some((d) => d.by === 'A'),
    true,
  );
  assert.equal(JSON.stringify(home).includes('佳益'), false);
  // A 能继续用、邀请新人
  assert.equal((await call('A', 'household.get')).data.members.length, 1);
});

test('只剩自己时注销：清空整个小家，会员作废，回到创建 / 加入', async () => {
  const { households, repos, call, oldId } = await setup();
  await fill(call);
  await call('B', 'household.leave', { copy: false });
  const result = await untilDone(call, 'A', 'account.delete', {
    confirm: true,
  });
  assert.deepEqual(result.data, { deleted: true });
  assert.equal((await call('A', 'household.get')).data, null);
  for (const repo of Object.values(repos))
    assert.equal(await repo.count(oldId), 0);
  const home = households.docs.get(oldId);
  assert.equal(home.purge, false);
  assert.deepEqual(home.members, []);
  assert.equal(JSON.stringify(home).includes('A'), false);
  // 之后可以用同一个微信重新开始
  assert.equal(
    (await call('A', 'household.create', { name: '超凡' })).ok,
    true,
  );
});

test('注销：退出过的小家里留着的我的称呼和 openid 被抹掉，对方的副本不受影响', async () => {
  const { households, repos, call, oldId } = await setup();
  await fill(call);
  await call('B', 'household.leave', {});
  await copyAll(call, 'B');
  const newId = (await households.findByMember('B'))._id;
  const copied = await repos.expenses.count(newId);
  assert.ok(copied > 0);
  assert.equal((await call('B', 'account.delete', { confirm: true })).ok, true);
  // B 的新小家：只有 B，注销后记录全删
  assert.equal(await repos.expenses.count(newId), 0);
  // A 的小家：账本还在，退出记录里没有 B 的身份
  const home = households.docs.get(oldId);
  assert.equal((await repos.expenses.count(oldId)) > 0, true);
  assert.equal(home.departed.length, 1);
  assert.equal(home.departed[0].openid, '');
  assert.equal(home.departed[0].name, '');
  assert.equal((await call('A', 'household.get')).data.members.length, 1);
});

test('A 先注销、B 刚退出还没复制：先替 B 复制完再删，B 的副本完整', async () => {
  const { call, households, repos } = await setup();
  await fill(call);
  await call('B', 'household.leave', {});
  const first = await call('A', 'account.delete', { confirm: true });
  assert.equal(first.data.waiting, true);
  assert.equal(
    (await untilDone(call, 'A', 'account.delete', { confirm: true })).ok,
    true,
  );
  const mine = await households.findByMember('B');
  assert.equal(mine.copy.done, true);
  assert.equal(await repos.expenses.count(mine._id), 2);
});

test('没有小家也能注销；重复注销没有副作用', async () => {
  const { call } = await setup();
  await call('B', 'account.delete', { confirm: true });
  const again = await call('B', 'account.delete', { confirm: true });
  assert.deepEqual(again.data, { deleted: true });
});
