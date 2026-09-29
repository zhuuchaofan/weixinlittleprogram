const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createEventProgramHandler,
  validateEventProgram,
} = require('../cloudfunctions/weddingApi/event-program');

function program() {
  return {
    title: '今日流程',
    lead: '以现场为准',
    items: [
      {
        id: 'opening',
        title: '主持暖场',
        time: '11:58',
        description: '',
        visible: true,
      },
    ],
    photoBooth: {
      enabled: true,
      title: '门口 Photo Booth',
      time: '',
      description: '欢迎合影',
    },
  };
}
function fixture() {
  const docs = {};
  let identity = 'visitor';
  const collection = {
    doc(id) {
      return {
        async get() {
          if (!docs[id]) throw new Error('not found');
          return { data: docs[id] };
        },
        async set({ data }) {
          docs[id] = structuredClone(data);
        },
      };
    },
  };
  return {
    docs,
    setIdentity: (value) => (identity = value),
    handle: createEventProgramHandler({
      db: { collection: () => collection },
      getAdmins: () => ['owner'],
      getOpenId: () => identity,
    }),
  };
}
test('当天流程校验时间、字段长度和编号', () => {
  assert.equal(validateEventProgram(program()).items[0].time, '11:58');
  assert.throws(
    () =>
      validateEventProgram({
        ...program(),
        items: [{ ...program().items[0], time: '25:00' }],
      }),
    /HH:mm/,
  );
  assert.throws(
    () =>
      validateEventProgram({
        ...program(),
        items: Array.from({ length: 21 }, () => program().items[0]),
      }),
    /最多/,
  );
});
test('流程草稿仅主人可读写，发布后访客只读取已发布版本', async () => {
  const f = fixture();
  const visitorDraft = await f.handle({
    action: 'getEventProgramDraft',
    userInfo: { openid: 'owner' },
  });
  assert.equal(visitorDraft.code, 'FORBIDDEN');
  f.setIdentity('owner');
  await f.handle({
    action: 'saveEventProgramDraft',
    payload: { program: program() },
  });
  assert.equal((await f.handle({ action: 'getEventProgram' })).data, null);
  await f.handle({
    action: 'publishEventProgram',
    payload: { program: program() },
  });
  f.setIdentity('visitor');
  const visible = await f.handle({
    action: 'getEventProgram',
  });
  assert.equal(visible.data.items[0].title, '主持暖场');
  assert.equal(visible.data.photoBooth.title, '门口 Photo Booth');
  assert.equal(visible.data.openid, undefined);
});
