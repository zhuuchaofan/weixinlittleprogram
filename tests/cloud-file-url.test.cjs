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

test('临时链接按返回有效期提前刷新，未过期时复用同一链接', async () => {
  const { localConfig } = require('../miniprogram/config/local.ts');
  const {
    clearCloudFileUrlCache,
    resolveCloudFileUrl,
  } = require('../miniprogram/services/cloud-file-url.ts');
  const previousEnv = localConfig.cloudEnvId;
  const originalNow = Date.now;
  let now = 1000;
  let calls = 0;
  Date.now = () => now;
  localConfig.cloudEnvId = 'test-env';
  global.wx = {
    cloud: {
      init() {},
      async getTempFileURL({ fileList }) {
        calls++;
        return {
          fileList: [
            {
              fileID: fileList[0],
              tempFileURL: `https://temporary.example/${calls}.jpg`,
              maxAge: 100000,
            },
          ],
        };
      },
    },
  };
  const fileID = 'cloud://test-env.bucket/photo.jpg';
  try {
    clearCloudFileUrlCache();
    assert.equal(
      await resolveCloudFileUrl(fileID),
      'https://temporary.example/1.jpg',
    );
    now += 89999;
    assert.equal(
      await resolveCloudFileUrl(fileID),
      'https://temporary.example/1.jpg',
    );
    assert.equal(calls, 1);
    now += 1;
    assert.equal(
      await resolveCloudFileUrl(fileID),
      'https://temporary.example/2.jpg',
    );
    assert.equal(calls, 2);
  } finally {
    clearCloudFileUrlCache();
    localConfig.cloudEnvId = previousEnv;
    Date.now = originalNow;
    delete global.wx;
  }
});

test('预热链接到期后重新获取；缺少有效期时短暂复用，失败后可重试', async () => {
  const { localConfig } = require('../miniprogram/config/local.ts');
  const {
    clearCloudFileUrlCache,
    prewarmCloudFileUrls,
    resolveCloudFileUrl,
  } = require('../miniprogram/services/cloud-file-url.ts');
  const previousEnv = localConfig.cloudEnvId;
  const originalNow = Date.now;
  let now = 1000;
  let calls = 0;
  let failNext = false;
  Date.now = () => now;
  localConfig.cloudEnvId = 'test-env';
  global.wx = {
    cloud: {
      init() {},
      async getTempFileURL({ fileList }) {
        calls++;
        if (failNext) {
          failNext = false;
          throw new Error('暂时断网');
        }
        return {
          fileList: fileList.map((fileID) => ({
            fileID,
            tempFileURL: `https://temporary.example/${calls}.jpg`,
          })),
        };
      },
    },
  };
  const fileID = 'cloud://test-env.bucket/photo.jpg';
  try {
    clearCloudFileUrlCache();
    await prewarmCloudFileUrls([fileID]);
    assert.equal(
      await resolveCloudFileUrl(fileID, 'thumbnail'),
      'https://temporary.example/1.jpg?imageMogr2/thumbnail/1080x1080/format/webp/quality/85',
    );
    assert.equal(calls, 1);
    now += 5 * 60 * 1000;
    await prewarmCloudFileUrls([fileID]);
    assert.equal(
      await resolveCloudFileUrl(fileID, 'thumbnail'),
      'https://temporary.example/2.jpg?imageMogr2/thumbnail/1080x1080/format/webp/quality/85',
    );
    now += 5 * 60 * 1000;
    failNext = true;
    await assert.rejects(resolveCloudFileUrl(fileID, 'thumbnail'), /暂时断网/);
    assert.equal(
      await resolveCloudFileUrl(fileID, 'thumbnail'),
      'https://temporary.example/4.jpg?imageMogr2/thumbnail/1080x1080/format/webp/quality/85',
    );
    assert.equal(calls, 4);
  } finally {
    clearCloudFileUrlCache();
    localConfig.cloudEnvId = previousEnv;
    Date.now = originalNow;
    delete global.wx;
  }
});
