const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    filename,
  );
const { localConfig } = require('../miniprogram/config/local.ts');
const {
  inspectImage,
  IMAGE_SIZE_LIMIT,
} = require('../miniprogram/services/image-upload.ts');
const {
  MediaUploadSession,
  uploadMedia,
  rememberUploads,
  restoreUploads,
} = require('../miniprogram/services/media-upload.ts');
const {
  clearPhotoUrlCache,
  resolvePhotoUrl,
} = require('../miniprogram/services/photo-url.ts');
const { createPhotoHandler } = require('../cloudfunctions/weddingApi/photos');
const { imageFormat } = require('../cloudfunctions/weddingApi/image-upload');
const jpg = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(64)]);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(64),
]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(32),
]);
function client(bytes = jpg) {
  localConfig.mode = 'cloud';
  localConfig.cloudEnvId = 'image-test';
  let verifies = 0;
  const actions = [],
    transfers = [],
    store = new Map();
  global.wx = {
    compressImage: () => assert.fail('原图不得重编码'),
    getImageInfo: async () => ({ width: 6000, height: 4000 }),
    getFileSystemManager: () => ({
      getFileInfo: (o) => o.success({ size: bytes.length }),
      readFile: (o) => {
        assert.equal(o.encoding, undefined);
        assert.equal(o.position, 0);
        assert.equal(o.length, 16);
        o.success({ data: Uint8Array.from(bytes.subarray(0, 16)).buffer });
      },
    }),
    setStorageSync: (key, value) => store.set(key, structuredClone(value)),
    getStorageSync: (key) => store.get(key),
    cloud: {
      init() {},
      callFunction: async ({ data }) => {
        actions.push(structuredClone(data));
        assert.equal(data.payload.base64, undefined);
        assert.ok(JSON.stringify(data).length < 500);
        if (data.action === 'verifyImageUpload' && ++verifies === 1)
          return { result: { ok: false, message: '模拟校验暂不可用' } };
        return {
          result: {
            ok: true,
            data:
              data.action === 'prepareImageUpload'
                ? {
                    url: 'https://upload.example',
                    fileID: 'cloud://env/wedding/managed/original.jpg',
                    cloudPath: 'wedding/managed/original.jpg',
                    authorization: 'test',
                    token: 'test',
                    cosFileID: 'test',
                  }
                : { fileID: 'cloud://env/wedding/managed/original.jpg' },
          },
        };
      },
      getTempFileURL: async ({ fileList }) => ({
        fileList: fileList.map((fileID) => ({
          fileID,
          tempFileURL: 'https://example.test/file?signature=test',
        })),
      }),
    },
    uploadFile: (o) => {
      transfers.push(o);
      queueMicrotask(() => o.success({ statusCode: 204, data: '' }));
      return { onProgressUpdate: (fn) => fn({ progress: 75 }), abort() {} };
    },
  };
  clearPhotoUrlCache();
  return { actions, transfers, store };
}
const item = () => ({
  id: 'image-request-001',
  type: 'image',
  path: 'original.jpg',
  coverPath: '',
  duration: 0,
  width: 0,
  height: 0,
  size: jpg.length,
  status: 'pending',
  progress: 0,
  message: '',
});

test('原图检查仅读 16 字节文件头，保留分辨率且支持 JPG/PNG/WebP', async () => {
  for (const [bytes, format] of [
    [jpg, 'jpg'],
    [png, 'png'],
    [webp, 'webp'],
  ]) {
    client(bytes);
    assert.deepEqual(await inspectImage('original'), {
      size: bytes.length,
      format,
      width: 6000,
      height: 4000,
    });
  }
  client(Buffer.from('not-an-image-file'));
  await assert.rejects(inspectImage('bad'), /JPG、PNG 或 WebP/);
  client();
  global.wx.getFileSystemManager = () => ({
    getFileInfo: (o) => o.success({ size: IMAGE_SIZE_LIMIT + 1 }),
  });
  await assert.rejects(inspectImage('large'), /30 MB/);
});

test('图片直传原路径、进度与恢复：校验失败保留 fileID，临时文件失效后只重试校验', async () => {
  const f = client();
  const p = item();
  await assert.rejects(
    uploadMedia(p, new MediaUploadSession(), () => rememberUploads([p])),
    /校验暂不可用/,
  );
  assert.equal(f.transfers.length, 1);
  assert.equal(f.transfers[0].filePath, 'original.jpg');
  assert.equal(p.progress, 75);
  assert.equal(p.media, undefined);
  assert.ok(p.fileID);
  const restored = restoreUploads()[0];
  global.wx.getFileSystemManager = () =>
    assert.fail('已上传文件重试不应重新读取本地文件');
  const media = await uploadMedia(restored, new MediaUploadSession(), () => {});
  assert.equal(media.original, p.fileID);
  assert.equal(media.thumbnail, p.fileID);
  assert.equal(restored.imageUpload.verified, true);
  assert.equal(f.transfers.length, 1);
  assert.deepEqual(
    f.actions.map((a) => a.action),
    ['prepareImageUpload', 'verifyImageUpload', 'verifyImageUpload'],
  );
});

test('图片上传取消会 abort，未成功文件不进入草稿；失败 HTTP 不触发校验', async () => {
  for (const cancel of [true, false]) {
    const f = client();
    let started,
      aborted = 0;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    global.wx.uploadFile = (o) => {
      started();
      if (!cancel)
        queueMicrotask(() =>
          o.success({ statusCode: 403, data: '<Error>denied</Error>' }),
        );
      return {
        onProgressUpdate() {},
        abort() {
          aborted++;
          o.fail({});
        },
      };
    };
    const p = item(),
      session = new MediaUploadSession();
    const promise = uploadMedia(p, session, () => {});
    await ready;
    if (cancel) session.cancel();
    await assert.rejects(promise, cancel ? /暂停/ : /未成功/);
    assert.equal(aborted, cancel ? 1 : 0);
    assert.equal(p.fileID, undefined);
    assert.equal(p.media, undefined);
    assert.equal(session.task, null);
    assert.deepEqual(
      f.actions.map((a) => a.action),
      ['prepareImageUpload'],
    );
  }
});

test('旧恢复记录复用已上传文件，视频封面使用同一图片直传链路', async () => {
  const f = client();
  const old = { ...item(), fileID: 'cloud://env/old.jpg' };
  await uploadMedia(old, new MediaUploadSession(), () => {});
  assert.equal(f.transfers.length, 0);
  const video = {
    ...item(),
    type: 'video',
    width: 800,
    height: 600,
    duration: 5,
    fileID: 'cloud://env/old.mp4',
    verified: true,
    coverPath: 'cover.jpg',
  };
  await assert.rejects(uploadMedia(video, new MediaUploadSession(), () => {}));
  assert.equal(f.transfers[0].filePath, 'cover.jpg');
  await uploadMedia(video, new MediaUploadSession(), () => {});
  assert.equal(video.media.coverUrl, video.coverID);
  assert.equal(f.actions[0].payload.requestId, video.id + '-cover');
  assert.equal(f.transfers.length, 1);
});

test('云端图片凭据仅向真实管理员签发，路径隔离、大小及真实文件头校验', async () => {
  let identity = 'owner',
    bytes = jpg;
  const paths = [];
  const handler = createPhotoHandler({
    cloud: {
      downloadFile: async () => ({ fileContent: bytes }),
    },
    db: { collection: () => ({}) },
    getAdmins: () => ['owner', 'second-owner'],
    getOpenId: () => identity,
    storage: {
      getUploadMetadata: async ({ cloudPath, method }) => {
        assert.equal(method, 'post');
        paths.push(cloudPath);
        return {
          data: {
            fileId: 'cloud://env/' + cloudPath,
            url: 'https://upload.example',
            authorization: 'test',
            token: 'test',
            cosFileId: 'test',
          },
        };
      },
    },
  });
  const payload = {
    requestId: 'image-request-001',
    size: jpg.length,
    format: 'jpg',
  };
  identity = 'visitor';
  for (const action of ['prepareImageUpload', 'verifyImageUpload'])
    assert.equal(
      (await handler({ action, payload: { ...payload, openid: 'owner' } }))
        .code,
      'FORBIDDEN',
    );
  assert.equal(paths.length, 0);
  identity = 'owner';
  const first = await handler({ action: 'prepareImageUpload', payload });
  const second = await handler({ action: 'prepareImageUpload', payload });
  assert.equal(first.data.fileID, second.data.fileID);
  assert.match(first.data.cloudPath, /^wedding\/managed\/[a-f0-9]{64}\.jpg$/);
  assert.equal(
    (await handler({ action: 'verifyImageUpload', payload })).ok,
    true,
  );
  identity = 'second-owner';
  assert.notEqual(
    (await handler({ action: 'prepareImageUpload', payload })).data.fileID,
    first.data.fileID,
  );
  for (const change of [
    { size: 0 },
    { size: IMAGE_SIZE_LIMIT + 1 },
    { format: 'heic' },
    { requestId: '../escape' },
  ])
    assert.equal(
      (
        await handler({
          action: 'prepareImageUpload',
          payload: { ...payload, ...change },
        })
      ).ok,
      false,
    );
  bytes = Buffer.alloc(jpg.length);
  assert.equal(
    (await handler({ action: 'verifyImageUpload', payload })).ok,
    false,
  );
  for (const [value, format] of [
    [png, 'png'],
    [webp, 'webp'],
  ]) {
    bytes = value;
    assert.equal(imageFormat(bytes), format);
    assert.equal(
      (
        await handler({
          action: 'verifyImageUpload',
          payload: { ...payload, size: bytes.length, format },
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await handler({
          action: 'verifyImageUpload',
          payload: { ...payload, size: bytes.length + 1, format },
        })
      ).ok,
      false,
    );
  }
});

function frame(source) {
  let definition;
  global.Component = (d) => {
    definition = d;
  };
  delete require.cache[
    require.resolve('../miniprogram/components/photo-frame/index.ts')
  ];
  require('../miniprogram/components/photo-frame/index.ts');
  const c = {
    data: { ...structuredClone(definition.data), src: source, adaptive: true },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  for (const [name, fn] of Object.entries(definition.methods))
    c[name] = fn.bind(c);
  return c;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
test('WebP → PNG → 原文件回退有限，忽略旧图片事件；原图预览不带处理参数', async () => {
  client();
  const src = 'cloud://env/new.webp',
    c = frame(src);
  await c.stage(src, false);
  const first = c.data.slotBUrl;
  assert.match(first, /format\/webp\/quality\/85$/);
  c.errorB({ currentTarget: { dataset: { url: first } } });
  await settle();
  assert.match(c.data.slotBUrl, /format\/png$/);
  const compatible = c.data.slotBUrl;
  c.errorB({ currentTarget: { dataset: { url: first } } });
  assert.equal(c.data.slotBUrl, compatible);
  c.loadB({
    currentTarget: { dataset: { url: first } },
    detail: { width: 1, height: 1 },
  });
  assert.equal(c.data.loaded, false);
  c.errorB({ currentTarget: { dataset: { url: compatible } } });
  await settle();
  assert.equal(c.data.slotBUrl, 'https://example.test/file?signature=test');
  c.errorB();
  await settle();
  assert.equal(c.data.failed, true);
  assert.equal(c.data.pendingSlot, '');
  assert.equal(
    await resolvePhotoUrl(src, 'original'),
    'https://example.test/file?signature=test',
  );
});

test('新源逐级加载失败仍保留已显示旧图；WebP 成功正常替换并保留尺寸', async () => {
  client();
  const src = 'cloud://env/new.jpg',
    c = frame(src);
  Object.assign(c.data, {
    currentSource: 'old',
    loaded: true,
    activeSlot: 'a',
    slotASource: 'old',
    slotAUrl: 'old-url',
  });
  await c.stage(src, false);
  for (let i = 0; i < 3; i++) {
    c.errorB();
    await settle();
  }
  assert.equal(c.data.currentSource, 'old');
  assert.equal(c.data.loaded, true);
  assert.equal(c.data.slotAUrl, 'old-url');
  await c.stage(src, true);
  c.loadB({ detail: { width: 1080, height: 720 } });
  assert.equal(c.data.currentSource, src);
  assert.equal(c.data.activeSlot, 'b');
  assert.equal(c.data.resolvedRatio, 'landscape');
});
