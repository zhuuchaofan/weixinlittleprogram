const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
// 与真实 service 使用同一 TypeScript 源码，编译至内存，无单独复制实现。
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  module._compile(result.outputText, filename);
};
const { createMockService } = require('../miniprogram/services/mock-rsvp.ts');
const { validateRsvp } = require('../miniprogram/utils/validate.ts');
const { createHandler } = require('../cloudfunctions/weddingApi/core');
const valid = {
  guestName: '  亲友甲  ',
  attending: true,
  partySize: 2,
  note: '',
  consent: true,
};
test('云端适配器缺环境、断网、拒绝响应均报错，不写本地缓存', async () => {
  const { localConfig } = require('../miniprogram/config/local.ts');
  const previousEnv = localConfig.cloudEnvId;
  const { callCloud } = require('../miniprogram/services/cloud.ts');
  let localWrites = 0;
  global.wx = {
    cloud: {
      init() {},
      async callFunction() {
        throw new Error('offline');
      },
    },
    setStorageSync() {
      localWrites++;
    },
  };
  try {
    localConfig.cloudEnvId = '';
    await assert.rejects(callCloud('save', valid), /尚未配置/);
    localConfig.cloudEnvId = 'test-env';
    await assert.rejects(callCloud('save', valid), /暂时不可用/);
    global.wx.cloud.callFunction = async () => ({
      result: { ok: false, message: '权限不足' },
    });
    await assert.rejects(callCloud('dashboard'), /权限不足/);
    global.wx.cloud.callFunction = async () => ({
      result: { ok: true, data: { id: 'own' } },
    });
    assert.deepEqual(await callCloud('getMine'), { id: 'own' });
    assert.equal(localWrites, 0);
  } finally {
    localConfig.cloudEnvId = previousEnv;
    delete global.wx;
  }
});
test('云图 file ID 在显示前换为短期 HTTPS 地址并缓存，普通本地图片不请求云端', async () => {
  const { localConfig } = require('../miniprogram/config/local.ts');
  const {
    clearPhotoUrlCache,
    resolvePhotoUrl,
  } = require('../miniprogram/services/photo-url.ts');
  const previousEnv = localConfig.cloudEnvId;
  let calls = 0;
  global.wx = {
    cloud: {
      init() {},
      async getTempFileURL({ fileList }) {
        calls++;
        return {
          fileList: [
            {
              fileID: fileList[0],
              tempFileURL: 'https://temporary.example/photo.jpg',
            },
          ],
        };
      },
    },
  };
  try {
    localConfig.cloudEnvId = 'test-env';
    clearPhotoUrlCache();
    assert.equal(
      await resolvePhotoUrl('/assets/cover.jpg'),
      '/assets/cover.jpg',
    );
    assert.equal(calls, 0);
    assert.equal(
      await resolvePhotoUrl('cloud://test-env.bucket/wedding/cover.jpg'),
      'https://temporary.example/photo.jpg',
    );
    assert.equal(
      await resolvePhotoUrl('cloud://test-env.bucket/wedding/cover.jpg'),
      'https://temporary.example/photo.jpg',
    );
    assert.equal(calls, 1);
  } finally {
    clearPhotoUrlCache();
    localConfig.cloudEnvId = previousEnv;
    delete global.wx;
  }
});
test('mock 保存、重开、修改去重、未到场、统计和删除', async () => {
  let value;
  const service = createMockService(
    {
      read: () => value,
      write: (v) => {
        value = v;
      },
      remove: () => {
        value = undefined;
      },
    },
    () => true,
  );
  assert.equal(await service.getMine(), null);
  const first = await service.save(valid);
  assert.equal(first.guestName, '亲友甲');
  await service.save({ ...valid, partySize: 4 });
  assert.equal((await service.getMine()).id, first.id);
  assert.deepEqual((await service.dashboard()).summary, {
    responses: 1,
    attending: 1,
    guests: 4,
    declined: 0,
  });
  await service.save({ ...valid, attending: false, partySize: 0 });
  assert.equal((await service.dashboard()).summary.guests, 0);
  await service.removeMine();
  assert.equal(await service.getMine(), null);
});
test('mock 未授权不能读取统计，存储损坏及写入失败不会伪报成功', async () => {
  const service = createMockService(
    {
      read: () => null,
      write: () => {
        throw new Error('disk full');
      },
      remove() {},
    },
    () => false,
  );
  await assert.rejects(service.dashboard(), /未开启/);
  await assert.rejects(service.save(valid), /disk full/);
  const corrupt = createMockService(
    { read: () => ({}), write() {}, remove() {} },
    () => true,
  );
  await assert.rejects(corrupt.getMine(), /损坏/);
});
test('客户端与服务器拒绝越界人数、伪造状态、无同意、超长备注', async () => {
  for (const patch of [
    { guestName: ' ' },
    { guestName: '甲'.repeat(31) },
    { partySize: 0 },
    { partySize: 11 },
    { partySize: 1.5 },
    { attending: 'yes' },
    { attending: false, partySize: 1 },
    { consent: false },
    { note: 'a'.repeat(201) },
  ]) {
    assert.ok(validateRsvp({ ...valid, ...patch }));
    const handler = createHandler({
      repository: {},
      getOpenId: () => 'user-a',
      getAdmins: () => [],
    });
    assert.equal(
      (await handler({ action: 'save', payload: { ...valid, ...patch } })).ok,
      false,
    );
  }
});
function backend() {
  const rows = new Map();
  let identity = 'guest-a';
  let listReads = 0;
  const repository = {
    get: async (id) => rows.get(id) || null,
    put: async (id, record) => rows.set(id, { ...record, _id: id }),
    remove: async (id) => rows.delete(id),
    list: async () => {
      listReads++;
      return [...rows.values()];
    },
    summary: async () => ({
      responses: rows.size,
      attending: [...rows.values()].filter((r) => r.attending).length,
      guests: [...rows.values()].reduce((n, r) => n + r.partySize, 0),
      declined: 0,
    }),
  };
  return {
    rows,
    setIdentity: (id) => {
      identity = id;
    },
    reads: () => listReads,
    handler: createHandler({
      repository,
      getOpenId: () => identity,
      getAdmins: () => ['owner'],
    }),
  };
}
test('云端按真实 OpenID 去重，忽略伪造身份，不返回 OpenID', async () => {
  const { handler, rows, setIdentity } = backend();
  await Promise.all(
    Array.from({ length: 8 }, () =>
      handler({
        action: 'save',
        payload: { ...valid, openid: 'owner', id: 'victim' },
      }),
    ),
  );
  assert.equal(rows.size, 1);
  const mine = await handler({ action: 'getMine' });
  assert.equal('openid' in mine.data, false);
  setIdentity('guest-b');
  assert.equal(
    (await handler({ action: 'getMine', payload: { openid: 'guest-a' } })).data,
    null,
  );
  await handler({ action: 'removeMine', payload: { id: mine.data.id } });
  assert.equal(rows.size, 1);
});
test('直接调用云函数也需管理员鉴权，空身份拒绝，未授权不查询数据库列表', async () => {
  const ctx = backend();
  await ctx.handler({ action: 'save', payload: valid });
  const denied = await ctx.handler({
    action: 'dashboard',
    payload: { isAdmin: true, openid: 'owner' },
  });
  assert.equal(denied.code, 'FORBIDDEN');
  assert.equal(ctx.reads(), 0);
  ctx.setIdentity('owner');
  const allowed = await ctx.handler({ action: 'dashboard' });
  assert.equal(allowed.data.records.length, 1);
  assert.equal('openid' in allowed.data.records[0], false);
  assert.equal(
    (await ctx.handler({ action: 'dashboard', payload: { cursor: 'bad' } }))
      .code,
    'VALIDATION',
  );
  ctx.setIdentity('');
  assert.equal(
    (await ctx.handler({ action: 'getMine' })).code,
    'UNAUTHENTICATED',
  );
});
test('后端故障返回失败且不泄露内部信息', async () => {
  const handler = createHandler({
    repository: {
      get() {
        throw new Error('private details');
      },
    },
    getOpenId: () => 'guest',
    getAdmins: () => [],
  });
  const result = await handler({ action: 'getMine' });
  assert.equal(result.ok, false);
  assert.equal(result.message.includes('private'), false);
});
