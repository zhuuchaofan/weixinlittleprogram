const test = require('node:test');
const assert = require('node:assert/strict');
const {
  invocationFromContext,
} = require('../cloudfunctions/weddingApi/invocation');

test('每次云函数调用仅从当次 context 取微信身份', () => {
  const parse = (context) => ({ environment: context.environment });
  const owner = invocationFromContext(
    { environment: { TCB_ENV: 'env', WX_OPENID: 'owner' } },
    parse,
  );
  const visitor = invocationFromContext(
    { environment: { TCB_ENV: 'env', WX_OPENID: 'visitor' } },
    parse,
  );
  const withoutIdentity = invocationFromContext(
    { environment: { TCB_ENV: 'env' }, userInfo: { openid: 'owner' } },
    parse,
  );
  assert.deepEqual(owner, { openid: 'owner', envId: 'env' });
  assert.deepEqual(visitor, { openid: 'visitor', envId: 'env' });
  assert.deepEqual(withoutIdentity, { openid: '', envId: 'env' });
  assert.deepEqual(
    invocationFromContext(
      null,
      () => {
        throw Error('bad');
      },
      'env',
    ),
    {
      openid: '',
      envId: 'env',
    },
  );
});
