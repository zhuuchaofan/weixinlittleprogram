const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/api/router');
const {
  makeInviteCode,
  CODE_PATTERN,
} = require('../cloudfunctions/api/household');

function memoryHouseholds() {
  const docs = new Map();
  let seq = 0;
  return {
    docs,
    async findByMember(openid) {
      return (
        [...docs.values()].find((doc) =>
          doc.members.some((member) => member.openid === openid),
        ) || null
      );
    },
    async findByCode(code) {
      return [...docs.values()].find((doc) => doc.inviteCode === code) || null;
    },
    async insert(doc) {
      const id = 'h' + ++seq;
      docs.set(id, { ...doc, _id: id });
      return id;
    },
    async addMember(id, code, member) {
      const doc = docs.get(id);
      if (!doc || doc.inviteCode !== code || doc.memberCount !== 1)
        return false;
      docs.set(id, {
        ...doc,
        members: [...doc.members, member],
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

function setup(
  archive = { listRsvps: async () => [], listMessages: async () => [] },
) {
  const households = memoryHouseholds();
  const route = createRouter({ households, archive, now: () => 1000 });
  const call = (openid, action, payload) => route({ action, payload }, openid);
  return { households, call };
}

test('邀请码为 6 位且不含易混字符', () => {
  for (let i = 0; i < 200; i++) assert.match(makeInviteCode(), CODE_PATTERN);
});

test('未登录身份和未知操作被拒绝', async () => {
  const { call } = setup();
  assert.equal((await call('', 'household.get')).code, 'UNAUTHENTICATED');
  assert.equal((await call('A', 'nope')).code, 'NOT_FOUND');
  assert.equal((await call('A', 'toString')).code, 'NOT_FOUND');
});

test('创建小家：默认东京、人民币，创建者为 a，记录 ts 与 by', async () => {
  const { households, call } = setup();
  assert.equal((await call('A', 'household.get')).data, null);
  assert.equal(
    (await call('A', 'household.create', { name: '' })).code,
    'VALIDATION',
  );
  const created = await call('A', 'household.create', { name: '超凡' });
  assert.equal(created.ok, true);
  assert.equal(created.data.currency, 'CNY');
  assert.equal(created.data.myRole, 'a');
  assert.match(created.data.inviteCode, CODE_PATTERN);
  assert.deepEqual(created.data.members, [
    { role: 'a', name: '超凡', isMe: true },
  ]);
  const stored = households.docs.get(created.data.id);
  assert.equal(stored.ts, 1000);
  assert.equal(stored.by, 'A');
  assert.equal(
    JSON.stringify(created).includes('"A"'),
    false,
    '不能返回 openid',
  );
  assert.equal(
    (await call('A', 'household.create', { name: '超凡' })).code,
    'ALREADY_MEMBER',
  );
});

test('加入小家：邀请码校验、最多 2 人、满员后邀请码失效', async () => {
  const { call } = setup();
  const { data } = await call('A', 'household.create', { name: '超凡' });
  assert.equal(
    (await call('B', 'household.join', { name: '佳益', code: '12' })).code,
    'VALIDATION',
  );
  assert.equal(
    (await call('B', 'household.join', { name: '佳益', code: 'ZZZZZZ' })).code,
    'INVALID_CODE',
  );
  const joined = await call('B', 'household.join', {
    name: '佳益',
    code: data.inviteCode.toLowerCase(),
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.data.myRole, 'b');
  assert.equal(joined.data.inviteCode, '');
  assert.equal(joined.data.members.length, 2);
  assert.equal(
    (await call('C', 'household.join', { name: '路人', code: data.inviteCode }))
      .code,
    'INVALID_CODE',
  );
  const seenByA = await call('A', 'household.get');
  assert.equal(seenByA.data.inviteCode, '');
  assert.deepEqual(
    seenByA.data.members.map((m) => [m.role, m.name, m.isMe]),
    [
      ['a', '超凡', true],
      ['b', '佳益', false],
    ],
  );
});

test('A 修改称呼后 B 能读到；非成员不能修改', async () => {
  const { call } = setup();
  const { data } = await call('A', 'household.create', { name: '超凡' });
  await call('B', 'household.join', { name: '佳益', code: data.inviteCode });
  assert.equal(
    (await call('C', 'household.update', { name: '凡' })).code,
    'NO_HOUSEHOLD',
  );
  assert.equal(
    (await call('A', 'household.update', { name: ' ' })).code,
    'VALIDATION',
  );
  assert.equal((await call('A', 'household.update', {})).code, 'VALIDATION');
  assert.equal(
    (await call('A', 'household.update', { name: '凡' })).ok,
    true,
  );
  const seenByB = await call('B', 'household.get');
  assert.equal(seenByB.data.members[0].name, '凡');
  assert.equal(seenByB.data.members[1].name, '佳益');
});

test('归档：仅标记过的小家可读，去掉 openid 并汇总人数', async () => {
  const { call, households } = setup({
    listRsvps: async () => [
      {
        _id: 'x',
        openid: 'G1',
        guestName: '王',
        attending: true,
        partySize: 3,
        note: '',
        updatedAt: '2026-09-02T00:00:00Z',
      },
      {
        _id: 'y',
        openid: 'G2',
        guestName: '李',
        attending: false,
        partySize: 0,
        note: '遥祝',
        updatedAt: '2026-09-01T00:00:00Z',
      },
    ],
    listMessages: async () => [
      {
        _id: 'z',
        openid: 'G1',
        signature: '王',
        message: '百年好合',
        updatedAt: '2026-09-03T00:00:00Z',
      },
    ],
  });
  assert.equal((await call('A', 'archive.get')).code, 'NO_HOUSEHOLD');
  const mine = await call('A', 'household.create', { name: '超凡' });
  const friends = await call('F', 'household.create', { name: '朋友' });
  assert.equal(mine.data.archive, '');
  assert.equal(
    (await call('A', 'archive.get')).code,
    'FORBIDDEN',
    '未标记的小家不能读取',
  );
  // 主人在控制台给自己的小家加上 archive 字段
  await households.update(mine.data.id, { archive: 'wedding-2026' });
  assert.equal((await call('A', 'household.get')).data.archive, 'wedding-2026');
  assert.equal((await call('F', 'household.get')).data.archive, '');
  assert.equal(
    (await call('F', 'archive.get')).code,
    'FORBIDDEN',
    '朋友的小家看不到',
  );
  assert.equal(friends.ok, true);
  const result = await call('A', 'archive.get');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.summary, {
    responses: 2,
    attending: 1,
    declined: 1,
    guests: 3,
  });
  assert.deepEqual(
    result.data.rsvps.map((r) => r.guestName),
    ['李', '王'],
  );
  assert.equal(result.data.messages[0].message, '百年好合');
  assert.equal(JSON.stringify(result).includes('G1'), false, '不能返回 openid');
  assert.equal(JSON.stringify(result).includes('"_id"'), false);
});

test('内部异常只返回通用提示', async () => {
  const households = memoryHouseholds();
  households.findByMember = async () => {
    throw new Error('db down: secret detail');
  };
  const route = createRouter({ households, archive: {} });
  const result = await route({ action: 'household.get' }, 'A');
  assert.deepEqual(result, {
    ok: false,
    code: 'INTERNAL',
    message: '服务暂时不可用，请稍后重试。',
  });
});
