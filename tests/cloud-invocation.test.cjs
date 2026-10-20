const test = require('node:test');
const assert = require('node:assert/strict');
const {
  invocationFromContext,
  cloudConfigForInvocation,
} = require('../cloudfunctions/api/invocation');

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

test('每次调用使用当前临时凭据，不沿用上一轮密钥', () => {
  const first = cloudConfigForInvocation('env', {
    TENCENTCLOUD_REGION: 'ap-shanghai',
    TENCENTCLOUD_SECRETID: 'first-id',
    TENCENTCLOUD_SECRETKEY: 'first-key',
    TENCENTCLOUD_SESSIONTOKEN: 'first-token',
  });
  const second = cloudConfigForInvocation('env', {
    TENCENTCLOUD_REGION: 'ap-shanghai',
    TENCENTCLOUD_SECRETID: 'second-id',
    TENCENTCLOUD_SECRETKEY: 'second-key',
    TENCENTCLOUD_SESSIONTOKEN: 'second-token',
  });
  assert.deepEqual(first, {
    env: 'env',
    endPointMode: 'CLOUD_API',
    region: 'ap-shanghai',
    auth: {
      secretId: 'first-id',
      secretKey: 'first-key',
      sessionToken: 'first-token',
      secretType: 'SESSION_SECRET',
    },
  });
  assert.equal(second.auth.secretId, 'second-id');
  assert.equal(second.auth.sessionToken, 'second-token');
  assert.equal(first.auth.secretId, 'first-id');
  assert.deepEqual(cloudConfigForInvocation('env', {}), {
    env: 'env',
    endPointMode: 'CLOUD_API',
  });
});
