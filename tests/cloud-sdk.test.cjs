const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// 独立进程运行正式入口 cloudfunctions/api 与真实 @cloudbase/js-sdk，拦截 HTTP，
// 用内存数据库回应；验证 api 实际发出的查询结构。不使用真实云凭据。
// 需要先安装云函数依赖：npm ci --prefix cloudfunctions/api
async function probe() {
  const assert = require('node:assert/strict');
  const { createRequire } = require('node:module');
  const req = createRequire(
    require('node:path').resolve('cloudfunctions/api/index.js'),
  );
  const { EJSON } = createRequire(req.resolve('@cloudbase/js-sdk'))('bson');

  const store = {};
  const requests = [];
  const parse = (value) =>
    typeof value === 'string'
      ? EJSON.parse(value, { relaxed: true })
      : EJSON.deserialize(value || {}, { relaxed: true });
  const valuesAt = (doc, key) =>
    key.split('.').reduce(
      (values, part) =>
        values.flatMap((v) => {
          const next = v == null ? undefined : v[part];
          return Array.isArray(next) ? next : [next];
        }),
      [doc],
    );
  const ops = {
    $eq: (v, x) => v === x,
    $gte: (v, x) => v >= x,
    $lte: (v, x) => v <= x,
    $gt: (v, x) => v > x,
    $lt: (v, x) => v < x,
  };
  function test(value, cond) {
    if (cond && typeof cond === 'object' && !Array.isArray(cond))
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$and') return arg.every((c) => test(value, c));
        if (!ops[op]) throw new Error('unsupported operator ' + op);
        return ops[op](value, arg);
      });
    return value === cond;
  }
  function matches(doc, query) {
    return Object.entries(query).every(([key, cond]) => {
      if (key === '$and') return cond.every((q) => matches(doc, q));
      return valuesAt(doc, key).some((value) => test(value, cond));
    });
  }
  const docs = (name) => (store[name] ||= []);
  let seq = 0;
  const fail = (code, message) => ({ code, message, requestId: 'mock' });

  global.fetch = async (url, options = {}) => {
    if (String(url).startsWith('http://metadata.'))
      return new Response('', { status: 404 });
    assert.equal(new URL(url).pathname, '/admin');
    assert.match(
      options.headers.Authorization,
      /^TC3-HMAC-SHA256 Credential=TEST_ID\//,
    );
    const body = JSON.parse(options.body);
    const query = parse(body.query);
    requests.push({ ...body, query });
    const rows = docs(body.collectionName);
    let result;
    if (body.action === 'database.getDocument') {
      const found = rows
        .filter((doc) => matches(doc, query))
        .sort((a, b) => (a._id < b._id ? -1 : 1))
        .slice(body.offset || 0, (body.offset || 0) + (body.limit || 100));
      result = { data: { list: found.map((doc) => EJSON.stringify(doc)) } };
    } else if (body.action === 'database.insertDocument') {
      const doc = parse(body.data[0]);
      doc._id ||= 'auto' + ++seq;
      // 与真实数据库一致：_id 冲突时整条插入失败
      if (rows.some((row) => row._id === doc._id))
        result = fail('DATABASE_DUPLICATE_WRITE', 'E11000 duplicate key');
      else {
        rows.push(doc);
        result = { data: { insertedIds: [doc._id] } };
      }
    } else if (body.action === 'database.modifyDocument') {
      const change = parse(body.data);
      let updated = 0;
      for (const doc of rows.filter((row) => matches(row, query))) {
        Object.assign(doc, change.$set || {});
        for (const [key, value] of Object.entries(change.$push || {}))
          doc[key] = [...(doc[key] || []), ...value.$each];
        for (const [key, value] of Object.entries(change.$inc || {}))
          doc[key] = (doc[key] || 0) + value;
        updated++;
      }
      result = { data: { updated, matched: updated } };
    } else if (body.action === 'database.deleteDocument') {
      const keep = rows.filter((row) => !matches(row, query));
      result = { data: { deleted: rows.length - keep.length } };
      store[body.collectionName] = keep;
    } else if (body.action === 'database.calculateDocument') {
      result = {
        data: { total: rows.filter((r) => matches(r, query)).length },
      };
    } else throw new Error('unexpected action: ' + body.action);
    return new Response(JSON.stringify({ requestId: 'mock', ...result }), {
      status: 200,
    });
  };

  const { main } = require('./cloudfunctions/api/index');
  const call = (openid, action, payload = {}) =>
    main(
      { action, payload },
      {
        environment: JSON.stringify({ TCB_ENV: 'test-env', WX_OPENID: openid }),
      },
    );
  const last = (action, collectionName) =>
    requests
      .filter((r) => r.action === action && r.collectionName === collectionName)
      .at(-1);

  // 小家：创建、加入（members.openid 数组查询、条件更新 + _.push）
  const created = await call('A', 'household.create', { name: '甲' });
  assert.equal(created.ok, true, created.message);
  const code = created.data.inviteCode;
  const joined = await call('B', 'household.join', { name: '乙', code });
  assert.equal(joined.ok, true, joined.message);
  assert.equal(joined.data.members.length, 2);
  const join = last('database.modifyDocument', 'households');
  assert.deepEqual(join.query, {
    _id: store.households[0]._id,
    inviteCode: code,
    memberCount: 1,
  });
  assert.deepEqual(Object.keys(parse(join.data)).sort(), ['$push', '$set']);
  const findB = requests.find(
    (r) =>
      r.action === 'database.getDocument' && r.query['members.openid'] === 'B',
  );
  assert.ok(findB, '按 members.openid 查询成员所在的小家');
  assert.equal(
    (await call('C', 'household.join', { name: '丙', code })).ok,
    false,
    '满员后邀请码失效',
  );
  assert.equal((await call('B', 'household.get')).data.members.length, 2);

  // 记账与结算：确定性 _id 插入，主键冲突只留一条
  const expense = (payer, amount) => ({
    amount,
    note: '',
    cat: '食费',
    date: '2026-10-05',
    payer,
    split: 'half',
  });
  assert.equal((await call('A', 'expense.add', expense('a', 3000))).ok, true);
  assert.equal((await call('B', 'expense.add', expense('b', 1000))).ok, true);
  const month = await call('A', 'expense.list', { month: '2026-10' });
  assert.equal(month.ok, true, month.message);
  assert.equal(month.data.records.length, 2);
  assert.equal(month.data.summary.net, 1000);

  const first = await call('A', 'expense.settle', { month: '2026-10' });
  assert.equal(first.ok, true, first.message);
  const insert = last('database.insertDocument', 'expenses');
  assert.match(parse(insert.data[0])._id, /^settle_2026-10_[0-9a-f]{24}$/);
  // 模拟两人基于同一份账目同时结算：第二人插入同一 _id
  store.expenses = store.expenses.filter((doc) => doc.cat !== '结算');
  const [x, y] = await Promise.all([
    call('A', 'expense.settle', { month: '2026-10' }),
    call('B', 'expense.settle', { month: '2026-10' }),
  ]);
  assert.deepEqual([x.ok, y.ok].sort(), [false, true], JSON.stringify([x, y]));
  assert.equal([x, y].find((r) => !r.ok).code, 'ALREADY_SETTLED');
  assert.equal(store.expenses.filter((d) => d.cat === '结算').length, 1);

  // 分类预算：对象字段整体替换（_.set），不和旧值合并成 budgets.吃饭 这样的路径
  assert.equal(
    (await call('A', 'household.update', { budgets: { 食费: 1 } })).ok,
    false,
    '旧分类名不能当预算分类',
  );
  const budgeted = await call('A', 'household.update', {
    budgets: { 吃饭: 5000, 日用: 800 },
  });
  assert.equal(budgeted.ok, true, budgeted.message);
  const replace = await call('B', 'household.update', {
    budgets: { 日用: 900 },
  });
  assert.equal(replace.ok, true, replace.message);
  assert.deepEqual(
    Object.keys(parse(last('database.modifyDocument', 'households').data).$set),
    ['budgets'],
  );
  assert.deepEqual(store.households[0].budgets, { 日用: 900 });

  // 攒钱：存了一笔用 _.inc + _.push，两人同时存不会丢
  const goal = await call('A', 'goal.add', {
    title: '旅行',
    target: 100000,
    deadline: '2030-12',
  });
  assert.equal(goal.ok, true, goal.message);
  await Promise.all([
    call('A', 'goal.deposit', { id: goal.data.id, amount: 300 }),
    call('B', 'goal.deposit', { id: goal.data.id, amount: 200 }),
  ]);
  const deposit = parse(last('database.modifyDocument', 'goals').data);
  assert.deepEqual(Object.keys(deposit).sort(), ['$inc', '$push']);
  assert.equal(store.goals[0].saved, 500);
  assert.equal(store.goals[0].log.length, 2);

  // 导出：count() 与分页读取一致
  const exported = await call('B', 'data.export');
  assert.equal(exported.ok, true, exported.message);
  assert.equal(exported.data.counts.expenses, 3);
  assert.equal(JSON.stringify(exported.data).includes('"A"'), false);
}

test('正式云函数通过真实 SDK：小家加入、结算插入与导出的查询结构', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `(${probe.toString()})().then(() => process.exit(0)).catch(e => { console.error(e.stack || e.message); process.exit(1); })`,
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        TENCENTCLOUD_SECRETID: 'TEST_ID',
        TENCENTCLOUD_SECRETKEY: 'TEST_KEY',
        TENCENTCLOUD_SESSIONTOKEN: 'TEST_TOKEN',
        TENCENTCLOUD_REGION: 'ap-shanghai',
        CLOUDBASE_APIKEY: '',
        TCB_CONTEXT_CNFG: '',
      },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  assert.equal(
    result.status,
    0,
    result.stderr || result.error?.message || result.stdout,
  );
});
