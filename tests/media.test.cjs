const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
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
const {
  normalizeMediaData,
  validateVideo,
} = require('../miniprogram/services/media.ts');
const { localConfig } = require('../miniprogram/config/local.ts');
const {
  photoService,
  getPublishedPhotos,
} = require('../miniprogram/services/photos.ts');
const {
  setSharedVisibility,
} = require('../miniprogram/services/media-visibility.ts');
const uploads = require('../miniprogram/services/media-upload.ts');
const tap = (dataset = {}) => ({ currentTarget: { dataset } });

test('复用同一原图或视频封面时私密状态同步到全部关联条目', () => {
  const a = {
    id: 'a',
    original: 'cloud://env/a.jpg',
    thumbnail: 'cloud://env/a.jpg',
  };
  const b = {
    id: 'b',
    original: 'cloud://env/b.mp4',
    coverUrl: 'cloud://env/a.jpg',
  };
  const c = { id: 'c', original: 'cloud://env/b.mp4' };
  const result = setSharedVisibility([a, b, c], 0, 'private');
  assert.deepEqual(
    result.map((item) => item.visibility),
    ['private', 'private', 'private'],
  );
});

test('主人切换私密会同步复用条目；新增待分类照片不能直接发布', async () => {
  const { page } = setup();
  const original = 'cloud://env/shared.jpg';
  page.setData({
    photos: [
      { id: 'one', original, thumbnail: original, slot: 'album' },
      {
        id: 'two',
        original,
        thumbnail: original,
        slot: 'album',
        category: 'pending',
      },
    ],
  });
  page.visibility({
    currentTarget: { dataset: { index: 0 } },
    detail: { value: true },
  });
  assert.deepEqual(
    page.data.photos.map((item) => item.visibility),
    ['private', 'private'],
  );
  await page.publish();
  assert.match(page.data.error, /选择分类/);
});

test('mock 访客读取也过滤私密媒体，历史无字段条目保持公开', async () => {
  const { store } = setup();
  store.set('photos:published', [
    { id: 'old', original: 'cloud://env/old.jpg', slot: 'album' },
    {
      id: 'hidden',
      original: 'cloud://env/hidden.jpg',
      slot: 'album',
      visibility: 'private',
    },
  ]);
  const result = await getPublishedPhotos();
  assert.equal(result.state, 'published');
  assert.deepEqual(
    result.photos.map((item) => item.id),
    ['old'],
  );
});
function setup() {
  localConfig.mode = 'mock';
  const store = new Map();
  let uploadsCount = 0;
  let previews = 0;
  global.wx = {
    getStorageSync: (key) => store.get(key),
    setStorageSync: (key, value) => store.set(key, structuredClone(value)),
    enableAlertBeforeUnload() {},
    disableAlertBeforeUnload() {},
    requirePrivacyAuthorize: (o) => o.success(),
    showModal: async () => ({ confirm: true }),
    getImageInfo: async () => ({ width: 800, height: 600 }),
    previewImage: () => {
      previews++;
    },
    getFileSystemManager: () => ({
      getFileInfo: (o) => o.success({ size: 100 }),
      readFile: (o) =>
        o.filePath === 'bad'
          ? o.fail({ errMsg: 'network internal trace' })
          : o.success({ data: new Uint8Array([255, 216, 255, 0]).buffer }),
      saveFile: (o) => {
        uploadsCount++;
        o.success({ savedFilePath: 'saved/' + o.tempFilePath });
      },
    }),
  };
  let options;
  global.Page = (o) => {
    options = o;
  };
  delete require.cache[require.resolve('../miniprogram/pages/photos/index.ts')];
  require('../miniprogram/pages/photos/index.ts');
  const page = {
    ...options,
    data: structuredClone(options.data),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  for (const [key, value] of Object.entries(options))
    if (typeof value === 'function') page[key] = value.bind(page);
  page.data.authorized = true;
  page.savedSnapshot = '[]';
  return { page, store, stats: () => ({ uploadsCount, previews }) };
}
function pending(id, path = id) {
  return {
    id,
    type: 'image',
    path,
    coverPath: '',
    duration: 0,
    width: 0,
    height: 0,
    size: 100,
    status: 'pending',
    progress: 0,
    message: '',
  };
}

test('历史字符串、imageUrl、现有 Photo 与视频兼容，空发布列表仍为空', () => {
  const result = normalizeMediaData([
    'a.jpg',
    { imageUrl: 'b.jpg' },
    { id: 'c', original: 'c.jpg', thumbnail: 'small.jpg', caption: '旧照片' },
    { type: 'video', url: 'movie.mp4', coverUrl: 'cover.jpg', duration: 2 },
  ]);
  assert.deepEqual(
    result.map((p) => p.original),
    ['a.jpg', 'b.jpg', 'c.jpg', 'movie.mp4'],
  );
  assert.equal(result[2].thumbnail, 'small.jpg');
  assert.equal(result[2].caption, '旧照片');
  assert.equal(result[3].thumbnail, 'cover.jpg');
  assert.deepEqual(normalizeMediaData([]), []);
});
test('视频超时长、超大小和无尺寸被拒绝；iOS 容器描述不参与客户端拦截', () => {
  const valid = {
    size: 30 * 1024 * 1024,
    duration: 60,
    width: 1920,
    height: 1080,
  };
  validateVideo(valid);
  for (const change of [
    { size: valid.size + 1 },
    { duration: 61 },
    { width: 0 },
  ])
    assert.throws(() => validateVideo({ ...valid, ...change }));
  assert.doesNotThrow(() =>
    validateVideo({ ...valid, format: 'video/quicktime' }),
  );
});
test('多选动态剩余数量，预览、移除，上传成功后保存并可重读', async () => {
  const f = setup();
  f.page.data.photos = normalizeMediaData(
    Array.from({ length: 58 }, (_, i) => 'old-' + i),
  );
  global.wx.chooseMedia = async (options) => {
    assert.equal(options.count, 2);
    return {
      tempFiles: [
        { tempFilePath: 'a', size: 10 },
        { tempFilePath: 'b', size: 20 },
      ],
    };
  };
  await f.page.add(tap());
  assert.equal(f.page.data.pending.length, 2);
  f.page.pendingPreview(tap({ index: 0 }));
  assert.equal(f.stats().previews, 1);
  await f.page.removePending(tap({ index: 0 }));
  assert.equal(f.page.data.pending.length, 1);
  await f.page.uploadPending(tap());
  assert.equal(f.stats().uploadsCount, 1);
  assert.equal(f.page.data.pending.length, 0);
  assert.equal((await photoService.draft()).length, 59);
});
test('单项失败不影响其他图片；保存失败后重试不重新上传，快速点击只执行一次', async () => {
  const f = setup();
  f.page.data.pending = [
    pending('good'),
    pending('bad', 'bad'),
    pending('last'),
  ];
  await Promise.all([f.page.uploadPending(tap()), f.page.uploadPending(tap())]);
  assert.equal(f.stats().uploadsCount, 2);
  assert.equal(f.page.data.photos.length, 2);
  assert.equal(f.page.data.pending.length, 1);
  assert.equal(f.page.data.pending[0].status, 'failed');
  assert.doesNotMatch(f.page.data.pending[0].message, /trace/);
  f.page.data.pending = [pending('retry')];
  const save = photoService.save;
  let fail = true;
  photoService.save = (items) =>
    fail ? Promise.reject(new Error('db failure')) : save(items);
  try {
    await f.page.uploadPending(tap());
    assert.equal(f.stats().uploadsCount, 3);
    assert.equal(f.page.data.pending[0].status, 'uploaded');
    fail = false;
    await f.page.uploadPending(tap());
    assert.equal(f.stats().uploadsCount, 3);
    assert.equal(f.page.data.pending.length, 0);
    assert.equal((await photoService.draft()).length, 3);
  } finally {
    photoService.save = save;
  }
});
test('离页时保留已完成文件的恢复记录，暂停剩余项；取消选择不报错', async () => {
  const f = setup();
  f.page.data.pending = [pending('first'), pending('second')];
  let complete;
  global.wx.getFileSystemManager = () => ({
    getFileInfo: (o) => o.success({ size: 100 }),
    readFile: (o) =>
      o.success({ data: new Uint8Array([255, 216, 255, 0]).buffer }),
    saveFile: (o) => {
      complete = () => o.success({ savedFilePath: 'saved/first' });
    },
  });
  const running = f.page.uploadPending(tap());
  while (!complete) await new Promise((resolve) => setImmediate(resolve));
  f.page.onUnload();
  complete();
  await running;
  const restored = uploads.restoreUploads();
  assert.equal(restored[0].fileID, 'saved/first');
  assert.equal(restored[1].status, 'pending');
  assert.equal(f.page.data.photos.length, 0);
  const g = setup();
  global.wx.chooseMedia = async () => {
    throw { errMsg: 'chooseMedia:fail cancel' };
  };
  await g.page.add(tap());
  assert.equal(g.page.data.error, '');
  assert.equal(g.page.data.busy, false);
});
test('视频上传进度及保存失败恢复：已有文件只校验，不重复发起文件传输', async () => {
  setup();
  localConfig.mode = 'cloud';
  const oldEnv = localConfig.cloudEnvId;
  localConfig.cloudEnvId = 'test';
  let sends = 0;
  const actions = [];
  global.wx.cloud = {
    init() {},
    callFunction: async ({ data }) => {
      actions.push(data.action);
      return {
        result: {
          ok: true,
          data:
            data.action === 'prepareVideoUpload'
              ? {
                  url: 'https://upload.example',
                  fileID: 'cloud://env/video.mp4',
                  cloudPath: 'video.mp4',
                  authorization: 'signature',
                  token: 'token',
                  cosFileID: 'cos',
                }
              : { fileID: 'cloud://env/video.mp4' },
        },
      };
    },
  };
  global.wx.uploadFile = (options) => {
    sends++;
    queueMicrotask(() => options.success({ statusCode: 204, data: '' }));
    return {
      onProgressUpdate(fn) {
        fn({ progress: 70 });
      },
      abort() {},
    };
  };
  try {
    const item = {
      ...pending('video-test'),
      type: 'video',
      width: 100,
      height: 200,
      duration: 10,
    };
    const session = new uploads.MediaUploadSession();
    const progress = [];
    await uploads.uploadMedia(item, session, () =>
      progress.push(item.progress),
    );
    assert.equal(item.media.type, 'video');
    assert.ok(progress.includes(70));
    await uploads.uploadMedia(item, session, () => {});
    assert.equal(sends, 1);
    assert.deepEqual(actions, ['prepareVideoUpload', 'verifyVideoUpload']);
  } finally {
    localConfig.cloudEnvId = oldEnv;
    localConfig.mode = 'mock';
  }
});
test('播放器默认不播、显式点击播放、播放互斥、隐藏时停止、链接失败可重试', async () => {
  setup();
  let definition;
  let plays = 0;
  let stops = 0;
  global.Component = (o) => {
    definition = o;
  };
  global.wx.createVideoContext = () => ({
    play() {
      plays++;
    },
    stop() {
      stops++;
    },
  });
  require('../miniprogram/components/media-video/index.ts');
  function instance(src) {
    const c = {
      data: { ...structuredClone(definition.data), src },
      setData(patch, done) {
        Object.assign(this.data, patch);
        done?.();
      },
    };
    for (const [key, fn] of Object.entries(definition.methods))
      c[key] = fn.bind(c);
    return c;
  }
  const a = instance('local-a'),
    b = instance('local-b');
  assert.equal(plays, 0);
  await a.open();
  assert.equal(a.data.opened, true);
  await b.open();
  assert.equal(a.data.opened, false);
  assert.equal(b.data.opened, true);
  definition.pageLifetimes.hide.call(b);
  assert.equal(b.data.opened, false);
  assert.ok(stops >= 2);
  b.error();
  assert.equal(b.data.failed, true);
  await b.open();
  assert.equal(b.data.failed, false);
});

test('媒体选择保留 iOS 元数据优先级、失败隔离及原始顺序', async () => {
  setup();
  const {
    prepareSelectedMedia,
  } = require('../miniprogram/services/media-selection.ts');
  const calls = [];
  global.wx.getVideoInfo = async ({ src }) => {
    calls.push(src);
    if (src === 'ios') throw new Error('临时文件信息不可读');
    return { duration: 5, width: 640, height: 480 };
  };
  const files = [
    { tempFilePath: 'ios', size: 100, duration: 10, width: 1080, height: 1920 },
    { tempFilePath: 'invalid', size: 100, duration: 61 },
    { tempFilePath: 'fallback', size: 100 },
    { tempFilePath: 'clipped', size: 100 },
  ];
  const original = structuredClone(files);
  const result = await prepareSelectedMedia(files, 'video', 3);
  assert.deepEqual(calls, ['ios', 'invalid', 'fallback']);
  assert.deepEqual(
    result.chosen.map(({ path, duration, width, height }) => ({
      path,
      duration,
      width,
      height,
    })),
    [
      { path: 'ios', duration: 10, width: 1080, height: 1920 },
      { path: 'fallback', duration: 5, width: 640, height: 480 },
    ],
  );
  assert.deepEqual(result.failures, ['请选择 60 秒以内的视频。']);
  assert.deepEqual(files, original);
});

test('媒体信息读取期间离页不写入待上传列表或恢复记录', async () => {
  const f = setup();
  global.wx.chooseMedia = async () => ({
    tempFiles: [{ tempFilePath: 'video', size: 100 }],
  });
  let complete;
  global.wx.getVideoInfo = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const selecting = f.page.add(tap({ type: 'video' }));
  while (!complete) await new Promise((resolve) => setImmediate(resolve));
  f.page.onUnload();
  complete({ duration: 5, width: 640, height: 480 });
  await selecting;
  assert.deepEqual(f.page.data.pending, []);
  assert.equal(f.store.size, 0);
});
