const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  module._compile(result.outputText, filename);
};
const { validateGuestMessage } = require('../miniprogram/utils/validate.ts');
const {
  createMockGuestbookService,
} = require('../miniprogram/services/mock-guestbook.ts');
const {
  createGuestbookHandler,
} = require('../cloudfunctions/weddingApi/guestbook');

const valid = {
  signature: '小高',
  message: '祝你们每天都很开心。',
  consent: true,
};
function repository() {
  const rows = new Map();
  return {
    rows,
    async get(id) {
      return rows.get(id) || null;
    },
    async put(id, data) {
      rows.set(id, { _id: id, ...data });
    },
    async remove(id) {
      rows.delete(id);
    },
    async list(cursor) {
      return [...rows.values()].filter((row) => row._id > cursor).slice(0, 50);
    },
    async summary() {
      return { messages: rows.size };
    },
  };
}
test('私密祝福校验署名、正文和隐私同意', () => {
  assert.equal(validateGuestMessage(valid), '');
  assert.match(
    validateGuestMessage({ ...valid, signature: 'x'.repeat(31) }),
    /署名/,
  );
  assert.match(validateGuestMessage({ ...valid, message: '' }), /祝福/);
  assert.match(validateGuestMessage({ ...valid, consent: false }), /隐私/);
});
test('同一账号只更新一条祝福，并可自行删除', async () => {
  const storage = {
    value: null,
    read() {
      return this.value;
    },
    write(value) {
      this.value = value;
    },
    remove() {
      this.value = null;
    },
  };
  const service = createMockGuestbookService(storage, () => true);
  await service.save(valid);
  await service.save({ ...valid, message: '更新后的祝福。' });
  assert.equal((await service.dashboard()).summary.messages, 1);
  assert.equal((await service.getMine()).message, '更新后的祝福。');
  await service.removeMine();
  assert.equal(await service.getMine(), null);
});
test('云函数对非管理员拒绝汇总，响应不泄露 OpenID', async () => {
  const repo = repository();
  let openid = 'guest-a';
  const handler = createGuestbookHandler({
    repository: repo,
    getOpenId: () => openid,
    getAdmins: () => ['owner'],
    now: () => '2026-09-28T03:58:00.000Z',
  });
  const saved = await handler({ action: 'guestbookSave', payload: valid });
  assert.equal(saved.ok, true);
  assert.equal(
    JSON.stringify(saved),
    JSON.stringify(saved).replace(/openid/g, ''),
  );
  const forbidden = await handler({
    action: 'guestbookDashboard',
    payload: {},
  });
  assert.equal(forbidden.code, 'FORBIDDEN');
  openid = 'owner';
  const dashboard = await handler({
    action: 'guestbookDashboard',
    payload: {},
  });
  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.data.summary.messages, 1);
  assert.equal(dashboard.data.records[0].message, valid.message);
  assert.ok(!('openid' in dashboard.data.records[0]));
});
