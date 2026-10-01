const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// 独立进程运行正式入口及真实 SDK，拦截 HTTP；不使用真实云凭据。
async function probe() {
  const assert = require('node:assert/strict');
  const { createRequire } = require('node:module');
  const req = createRequire(
    require('node:path').resolve('cloudfunctions/weddingApi/index.js'),
  );
  const { EJSON } = createRequire(req.resolve('@cloudbase/js-sdk'))('bson');
  const photo = {
    id: 'one',
    slot: 'album',
    caption: '回忆',
    ratio: 'portrait',
    original: 'cloud://test/one.jpg',
    thumbnail: 'cloud://test/one.jpg',
    category: 'daily',
    visibility: 'public',
  };
  const docs = { 'photo_content/published': { photos: [photo] } };
  let requests = 0;
  global.fetch = async (url, options = {}) => {
    if (String(url).startsWith('http://metadata.'))
      return new Response('', { status: 404 });
    requests++;
    assert.equal(new URL(url).pathname, '/admin');
    assert.equal(
      new URL(url).hostname,
      'test-env.ap-shanghai.tcb-api.tencentcloudapi.com',
    );
    assert.match(
      options.headers.Authorization,
      /^TC3-HMAC-SHA256 Credential=TEST_ID\//,
    );
    assert.match(options.headers.Authorization, /SignedParams=.*sessiontoken/);
    assert.ok(options.headers['X-Timestamp']);
    const body = JSON.parse(options.body);
    assert.equal(body.sessionToken, 'TEST_TOKEN');
    const query = body.query ? EJSON.parse(body.query) : {};
    const key = body.collectionName + '/' + query._id;
    let data;
    if (body.action === 'database.getDocument') {
      data = { list: docs[key] ? [EJSON.stringify(docs[key])] : [] };
    } else if (body.action === 'database.modifyDocument') {
      docs[key] = EJSON.parse(body.data);
      assert.equal(
        Object.hasOwn(docs[key], 'data'),
        false,
        '文档不能被多包一层 data',
      );
      data = { updated: 1, matched: 1 };
    } else if (body.action === 'database.calculateDocument') {
      data = { total: 1 };
    } else if (body.action === 'database.aggregateDocuments') {
      data = { list: [EJSON.stringify({ total: 3 })] };
    } else if (body.action === 'storage.getUploadMetadata') {
      data = {
        url: 'https://test.invalid',
        authorization: 'dummy',
        token: 'dummy',
        fileId: 'cloud://test/upload.jpg',
        cosFileId: 'dummy',
      };
    } else {
      throw new Error('unexpected action: ' + body.action);
    }
    return new Response(JSON.stringify({ data, requestId: 'mock' }), {
      status: 200,
    });
  };
  const { main } = require('./cloudfunctions/weddingApi/index');
  const context = (openid) => ({
    environment: JSON.stringify({ TCB_ENV: 'test-env', WX_OPENID: openid }),
  });
  const read = await main({ action: 'getMediaLibrary' }, context('visitor'));
  assert.equal(read.ok, true);
  assert.equal(read.data.photos[0].id, 'one');
  const denied = await main(
    {
      action: 'publishPhotos',
      payload: { photos: [] },
      userInfo: { openid: 'owner' },
    },
    context('visitor'),
  );
  assert.equal(denied.code, 'FORBIDDEN');
  const privatePhoto = {
    ...photo,
    id: 'secret',
    original: 'cloud://test/secret.jpg',
    thumbnail: 'cloud://test/secret.jpg',
    visibility: 'private',
  };
  assert.equal(
    (
      await main(
        { action: 'publishPhotos', payload: { photos: [photo, privatePhoto] } },
        context('owner'),
      )
    ).ok,
    true,
  );
  assert.equal(docs['photo_content/draft'].photos.length, 2);
  assert.equal(docs['photo_content/published'].photos.length, 1);
  assert.equal(
    (await main({ action: 'getMediaLibrary' }, context('visitor'))).data.photos
      .length,
    1,
  );
  const dashboard = await main({ action: 'dashboard' }, context('owner'));
  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.data.summary.guests, 3);
  const cloud = req('@cloudbase/js-sdk').init(
    require('./cloudfunctions/weddingApi/invocation').cloudConfigForInvocation(
      'test-env',
    ),
  );
  assert.equal(
    (await cloud.getUploadMetadata({ cloudPath: 'wedding/managed/test.jpg' }))
      .data.token,
    'dummy',
  );
  assert.ok(requests >= 8);
}

test('正式云函数通过真实 SDK 使用 /admin 签名读取、发布和统计，保留身份隔离', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `(${probe.toString()})().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); })`,
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
        ADMIN_OPENIDS: 'owner',
      },
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  assert.equal(
    result.status,
    0,
    result.stderr || result.error?.message || result.stdout,
  );
});
