const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhotoHandler } = require('../cloudfunctions/weddingApi/photos');
const {
  normalizeLibrary,
} = require('../cloudfunctions/weddingApi/media-library');
function fixture() {
  let identity = 'owner',
    uploads = 0,
    reads = 0,
    deletes = 0;
  const docs = {};
  const collection = {
    where: ({ _id }) => ({
      limit: () => ({
        get: async () => {
          reads++;
          return { data: docs[_id] ? [docs[_id]] : [] };
        },
      }),
    }),
    doc: (id) => ({
      set: async (data) => {
        docs[id] = structuredClone(data);
      },
    }),
  };
  const handle = createPhotoHandler({
    cloud: {
      uploadFile: async () => {
        uploads++;
        return { fileID: 'cloud://env/wedding/managed/uploaded.jpg' };
      },
      deleteFile: async () => {
        deletes++;
      },
    },
    db: { collection: () => collection },
    getAdmins: () => ['owner'],
    getOpenId: () => identity,
  });
  return {
    handle,
    docs,
    setIdentity: (v) => (identity = v),
    stats: () => ({ uploads, reads, deletes }),
  };
}
const photo = {
  id: 'one',
  slot: 'album',
  caption: '回忆',
  thumbnail: 'cloud://env/a.jpg',
  original: 'cloud://env/a.jpg',
  ratio: 'landscape',
};

test('照片读取失败时仅在云端记录脱敏诊断，访客响应不泄露细节', async () => {
  const secret = 's'.repeat(64);
  const originalError = console.error;
  const logged = [];
  console.error = (...items) => logged.push(items);
  try {
    const handle = createPhotoHandler({
      db: {
        collection: () => ({
          where: () => ({
            limit: () => ({
              get: async () => {
                const error = new Error(
                  `database failure cloud://env/private.jpg token=${secret}`,
                );
                error.code = 'DB_FAILURE';
                throw error;
              },
            }),
          }),
        }),
      },
      getAdmins: () => [],
      getOpenId: () => '',
    });
    const result = await handle({ action: 'getMediaLibrary' });
    assert.equal(result.code, 'PHOTO_ERROR');
    assert.doesNotMatch(JSON.stringify(result), /private|token|DB_FAILURE/);
    assert.equal(logged[0][1].code, 'DB_FAILURE');
    assert.doesNotMatch(JSON.stringify(logged), /private|ssssssss/);
  } finally {
    console.error = originalError;
  }
});
test('照片写入、草稿与上传均验证真实管理员，伪造身份无效', async () => {
  const f = fixture();
  f.setIdentity('visitor');
  assert.deepEqual((await f.handle({ action: 'getAccess' })).data, {
    isAdmin: false,
  });
  for (const action of [
    'getPhotoDraft',
    'savePhotoDraft',
    'publishPhotos',
    'uploadPhoto',
    'prepareImageUpload',
    'verifyImageUpload',
    'prepareVideoUpload',
    'verifyVideoUpload',
    'inspectManagedPhotoFile',
    'deleteManagedPhotoFile',
  ])
    assert.equal(
      (
        await f.handle({
          action,
          payload: { openid: 'owner', photos: [photo], base64: '/9j/AA==' },
        })
      ).code,
      'FORBIDDEN',
    );
  assert.deepEqual(f.stats(), { uploads: 0, reads: 0, deletes: 0 });
});
test('草稿不公开，发布后访客按保存顺序读取；发布空数组不会还原旧照片', async () => {
  const f = fixture();
  assert.equal((await f.handle({ action: 'getPhotos' })).data, null);
  await f.handle({ action: 'savePhotoDraft', payload: { photos: [photo] } });
  assert.equal((await f.handle({ action: 'getPhotos' })).data, null);
  const photos = [{ ...photo, id: 'two' }, photo];
  assert.equal(
    (await f.handle({ action: 'publishPhotos', payload: { photos } })).ok,
    true,
  );
  f.setIdentity('visitor');
  assert.deepEqual(
    (await f.handle({ action: 'getPhotos' })).data.photos.map((p) => p.id),
    ['two', 'one'],
  );
  f.setIdentity('owner');
  await f.handle({ action: 'publishPhotos', payload: { photos: [] } });
  assert.deepEqual((await f.handle({ action: 'getPhotos' })).data.photos, []);
  assert.deepEqual(
    (await f.handle({ action: 'getPhotoDraft' })).data.photos,
    [],
  );
});
test('拒绝重复编号、多封面、非法链接、超限照片和伪装图片', async () => {
  const f = fixture();
  for (const photos of [
    [photo, photo],
    [
      { ...photo, slot: 'cover' },
      { ...photo, id: 'two', slot: 'cover' },
    ],
    [{ ...photo, original: 'https://bad' }],
    Array(61).fill(photo),
  ])
    assert.equal(
      (await f.handle({ action: 'publishPhotos', payload: { photos } })).ok,
      false,
    );
  for (const base64 of ['hello', 'a'.repeat(700001)])
    assert.equal(
      (await f.handle({ action: 'uploadPhoto', payload: { base64 } })).ok,
      false,
    );
  assert.equal(f.stats().uploads, 0);
  assert.equal(f.docs.published, undefined);
  assert.equal(
    (await f.handle({ action: 'uploadPhoto', payload: { base64: '/9j/AA==' } }))
      .ok,
    true,
  );
});

const managedPhoto = {
  ...photo,
  id: 'managed',
  thumbnail: 'cloud://env/wedding/managed/safe-file.jpg',
  original: 'cloud://env/wedding/managed/safe-file.jpg',
};
test('管理员只能检查和删除未被草稿或已发布内容引用的小程序上传文件', async () => {
  const f = fixture();
  await f.handle({
    action: 'publishPhotos',
    payload: { photos: [managedPhoto] },
  });
  const referenced = await f.handle({
    action: 'inspectManagedPhotoFile',
    payload: { fileID: managedPhoto.original },
  });
  assert.deepEqual(referenced.data.references, { draft: 1, published: 1 });
  assert.equal(referenced.data.deletable, false);
  assert.equal(
    (
      await f.handle({
        action: 'deleteManagedPhotoFile',
        payload: { fileID: managedPhoto.original },
      })
    ).ok,
    false,
  );
  assert.equal(f.stats().deletes, 0);
  await f.handle({ action: 'publishPhotos', payload: { photos: [] } });
  assert.deepEqual(
    (
      await f.handle({
        action: 'inspectManagedPhotoFile',
        payload: { fileID: managedPhoto.original },
      })
    ).data,
    {
      fileID: managedPhoto.original,
      references: { draft: 0, published: 0 },
      deletable: true,
    },
  );
  assert.equal(
    (
      await f.handle({
        action: 'deleteManagedPhotoFile',
        payload: { fileID: managedPhoto.original },
      })
    ).ok,
    true,
  );
  assert.equal(f.stats().deletes, 1);
  assert.equal(
    (
      await f.handle({
        action: 'inspectManagedPhotoFile',
        payload: { fileID: 'cloud://env/wedding/original/keep.jpg' },
      })
    ).ok,
    false,
  );
});

test('签发视频凭据前鉴权、限制元数据、重试使用相同路径并验证真实文件头', async () => {
  let identity = 'owner';
  let content = Buffer.from([
    0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
  ]);
  const paths = [];
  const handle = createPhotoHandler({
    cloud: {
      downloadFile: async () => ({ fileContent: content }),
    },
    db: { collection: () => ({}) },
    getAdmins: () => ['owner'],
    getOpenId: () => identity,
    storage: {
      getUploadMetadata: async ({ cloudPath, method }) => {
        assert.equal(method, 'post');
        paths.push(cloudPath);
        return {
          data: {
            fileId: 'cloud://env/' + cloudPath,
            url: 'https://upload.example',
            token: 'token',
            authorization: 'signature',
            cosFileId: 'cos',
          },
        };
      },
    },
  });
  const payload = {
    requestId: 'video-12345678',
    size: 16,
    duration: 10,
    width: 100,
    height: 200,
  };
  identity = 'visitor';
  assert.equal(
    (await handle({ action: 'prepareVideoUpload', payload })).code,
    'FORBIDDEN',
  );
  assert.equal(paths.length, 0);
  identity = 'owner';
  assert.equal(
    (
      await handle({
        action: 'prepareVideoUpload',
        payload: { ...payload, size: 40 * 1024 * 1024 },
      })
    ).ok,
    false,
  );
  const a = await handle({ action: 'prepareVideoUpload', payload });
  const b = await handle({ action: 'prepareVideoUpload', payload });
  assert.equal(a.ok, true);
  assert.equal(a.data.cloudPath, b.data.cloudPath);
  assert.equal(
    (await handle({ action: 'verifyVideoUpload', payload })).ok,
    true,
  );
  content = Buffer.alloc(16);
  assert.equal(
    (await handle({ action: 'verifyVideoUpload', payload })).ok,
    false,
  );
});
test('视频元数据保存不丢失，封面和视频均受草稿/发布引用保护', async () => {
  const f = fixture();
  const video = {
    ...managedPhoto,
    type: 'video',
    url: 'cloud://env/wedding/managed/v.mp4',
    original: 'cloud://env/wedding/managed/v.mp4',
    coverUrl: managedPhoto.thumbnail,
    duration: 12,
    width: 1080,
    height: 1920,
    size: 1000,
  };
  assert.equal(
    (
      await f.handle({
        action: 'publishPhotos',
        payload: { photos: [photo, video] },
      })
    ).ok,
    true,
  );
  assert.equal(f.docs.published.photos[1].type, 'video');
  assert.equal(f.docs.published.photos[1].duration, 12);
  for (const fileID of [video.original, video.coverUrl])
    assert.equal(
      (
        await f.handle({
          action: 'inspectManagedPhotoFile',
          payload: { fileID },
        })
      ).data.deletable,
      false,
    );
  assert.equal(
    (
      await f.handle({
        action: 'savePhotoDraft',
        payload: { photos: [{ ...video, slot: 'cover' }] },
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await f.handle({
        action: 'savePhotoDraft',
        payload: { photos: [{ ...video, thumbnail: '', coverUrl: '' }] },
      })
    ).ok,
    true,
  );
  await f.handle({ action: 'publishPhotos', payload: { photos: [] } });
  assert.equal(
    (
      await f.handle({
        action: 'deleteManagedPhotoFile',
        payload: { fileID: video.original },
      })
    ).ok,
    true,
  );
});

test('WebP 原文件继续受草稿及发布引用保护，解除引用后可清理', async () => {
  const f = fixture();
  const fileID = 'cloud://env/wedding/managed/new-image.webp';
  const image = {
    ...photo,
    original: fileID,
    thumbnail: fileID,
    type: 'image',
  };
  assert.equal(
    (await f.handle({ action: 'publishPhotos', payload: { photos: [image] } }))
      .ok,
    true,
  );
  assert.deepEqual(
    (await f.handle({ action: 'inspectManagedPhotoFile', payload: { fileID } }))
      .data.references,
    { draft: 1, published: 1 },
  );
  assert.equal(
    (await f.handle({ action: 'deleteManagedPhotoFile', payload: { fileID } }))
      .ok,
    false,
  );
  assert.equal(f.stats().deletes, 0);
  await f.handle({ action: 'publishPhotos', payload: { photos: [] } });
  assert.equal(
    (await f.handle({ action: 'deleteManagedPhotoFile', payload: { fileID } }))
      .ok,
    true,
  );
  assert.equal(f.stats().deletes, 1);
});

test('历史照片继续公开；私密照片和视频只留草稿，访客接口不返回文件 ID', async () => {
  const f = fixture();
  const privatePhoto = {
    ...photo,
    id: 'secret',
    original: 'cloud://env/secret.jpg',
    thumbnail: 'cloud://env/secret.jpg',
    category: 'daily',
    visibility: 'private',
  };
  const privateVideo = {
    ...photo,
    id: 'secret-video',
    type: 'video',
    original: 'cloud://env/secret.mp4',
    thumbnail: '',
    coverUrl: '',
    duration: 12,
    width: 100,
    height: 100,
    size: 100,
    visibility: 'private',
  };
  const result = await f.handle({
    action: 'publishPhotos',
    payload: { photos: [photo, privatePhoto, privateVideo] },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    f.docs.draft.photos.map((p) => p.id),
    ['one', 'secret', 'secret-video'],
  );
  assert.deepEqual(
    f.docs.published.photos.map((p) => p.id),
    ['one'],
  );
  f.setIdentity('visitor');
  assert.deepEqual(
    (await f.handle({ action: 'getPhotos' })).data.photos.map((p) => p.id),
    ['one'],
  );
  f.docs.published.photos.push(privatePhoto);
  assert.deepEqual(
    (await f.handle({ action: 'getPhotos' })).data.photos.map((p) => p.id),
    ['one'],
  );
});

test('旧客户端遗漏新字段时保留分类和私密；同文件公私混用被拒绝', async () => {
  const f = fixture();
  const original = {
    ...photo,
    category: 'wedding',
    visibility: 'private',
  };
  assert.equal(
    (
      await f.handle({
        action: 'savePhotoDraft',
        payload: { photos: [original] },
      })
    ).ok,
    true,
  );
  assert.equal(
    (await f.handle({ action: 'publishPhotos', payload: { photos: [photo] } }))
      .ok,
    true,
  );
  assert.equal(f.docs.draft.photos[0].category, 'wedding');
  assert.equal(f.docs.draft.photos[0].visibility, 'private');
  assert.deepEqual(f.docs.published.photos, []);
  const duplicate = { ...photo, id: 'copy', visibility: 'public' };
  assert.equal(
    (
      await f.handle({
        action: 'publishPhotos',
        payload: { photos: [original, duplicate] },
      })
    ).ok,
    false,
  );
  assert.deepEqual(f.docs.published.photos, []);
});

test('新增照片待分类可存草稿但不能发布；历史缺失分类仍可发布', async () => {
  const f = fixture();
  const pending = { ...photo, id: 'new', category: 'pending' };
  assert.equal(
    (
      await f.handle({
        action: 'savePhotoDraft',
        payload: { photos: [pending] },
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await f.handle({
        action: 'publishPhotos',
        payload: { photos: [pending] },
      })
    ).ok,
    false,
  );
  assert.equal(
    (await f.handle({ action: 'publishPhotos', payload: { photos: [photo] } }))
      .ok,
    true,
  );
});

test('新版读取把同文件旧相册、封面、故事合为一条，私密冲突整体隐藏', async () => {
  const f = fixture();
  const legacy = [
    { ...photo, id: 'cover', slot: 'cover', caption: '封面' },
    { ...photo, id: 'album', category: 'wedding', caption: '相册' },
    { ...photo, id: 'story', slot: 'story', visibility: 'private' },
  ];
  f.docs.published = { photos: legacy };
  f.setIdentity('visitor');
  assert.deepEqual(
    (await f.handle({ action: 'getMediaLibrary' })).data.photos,
    [],
  );
  assert.deepEqual((await f.handle({ action: 'getPhotos' })).data.photos, []);
  const merged = normalizeLibrary(legacy);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'album');
  assert.equal(merged[0].caption, '相册');
  assert.deepEqual(merged[0].placements, ['cover', 'story']);
  assert.equal(
    normalizeLibrary([
      { ...photo, category: 'wedding' },
      { ...photo, id: 'cat', slot: 'qiuqiu' },
    ])[0].category,
    'daily',
  );
});

test('新版草稿和发布使用单条媒体，旧访客仍收到 slot 投影且旧管理写入受保护', async () => {
  const f = fixture();
  const item = {
    ...photo,
    slot: undefined,
    category: 'wedding',
    visibility: 'public',
    placements: ['cover', 'story'],
  };
  assert.equal(
    (
      await f.handle({
        action: 'saveMediaLibraryDraft',
        payload: { photos: [item] },
      })
    ).ok,
    true,
  );
  assert.equal(f.docs.published, undefined);
  assert.equal(f.docs.draft.schemaVersion, 2);
  assert.equal(
    (
      await f.handle({
        action: 'savePhotoDraft',
        payload: { photos: [photo] },
      })
    ).code,
    'UPGRADE_REQUIRED',
  );
  assert.equal(
    (
      await f.handle({
        action: 'publishMediaLibrary',
        payload: { photos: [item] },
      })
    ).ok,
    true,
  );
  f.setIdentity('visitor');
  assert.deepEqual(
    (await f.handle({ action: 'getMediaLibrary' })).data.photos.map(
      (p) => p.id,
    ),
    ['one'],
  );
  assert.deepEqual(
    (await f.handle({ action: 'getPhotos' })).data.photos.map((p) => p.slot),
    ['album', 'cover', 'story'],
  );
  f.setIdentity('owner');
  const oldWrite = await f.handle({
    action: 'publishPhotos',
    payload: { photos: [photo] },
  });
  assert.equal(oldWrite.code, 'UPGRADE_REQUIRED');
  assert.equal(f.docs.published.schemaVersion, 2);
});

test('新版拒绝重复文件、多封面及新增待分类；历史待分类可继续发布', async () => {
  const f = fixture();
  const base = {
    ...photo,
    slot: undefined,
    category: 'daily',
    visibility: 'public',
    placements: [],
  };
  for (const photos of [
    [base, { ...base, id: 'copy' }],
    [
      { ...base, placements: ['cover'] },
      {
        ...base,
        id: 'two',
        original: 'cloud://env/b.jpg',
        thumbnail: 'cloud://env/b.jpg',
        placements: ['cover'],
      },
    ],
    [{ ...base, category: 'wedding', placements: ['qiuqiu'] }],
  ]) {
    assert.equal(
      (await f.handle({ action: 'publishMediaLibrary', payload: { photos } }))
        .ok,
      false,
    );
  }
  assert.equal(
    (
      await f.handle({
        action: 'saveMediaLibraryDraft',
        payload: { photos: [{ ...base, category: 'pending' }] },
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await f.handle({
        action: 'publishMediaLibrary',
        payload: { photos: [{ ...base, category: 'pending' }] },
      })
    ).ok,
    false,
  );
  f.docs.published = { photos: [photo] };
  assert.equal(
    (
      await f.handle({
        action: 'publishMediaLibrary',
        payload: { photos: [{ ...base, category: 'pending' }] },
      })
    ).ok,
    true,
  );
});
