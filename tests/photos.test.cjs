const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhotoHandler } = require('../cloudfunctions/weddingApi/photos');
function fixture() {
  let identity = 'owner',
    uploads = 0,
    reads = 0;
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
      set: async ({ data }) => {
        docs[id] = structuredClone(data);
      },
    }),
  };
  const handle = createPhotoHandler({
    cloud: {
      getWXContext: () => ({ OPENID: identity }),
      uploadFile: async () => {
        uploads++;
        return { fileID: 'cloud://env/path.jpg' };
      },
    },
    db: { collection: () => collection },
    getAdmins: () => ['owner'],
  });
  return {
    handle,
    docs,
    setIdentity: (v) => (identity = v),
    stats: () => ({ uploads, reads }),
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
  assert.deepEqual(f.stats(), { uploads: 0, reads: 0 });
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
