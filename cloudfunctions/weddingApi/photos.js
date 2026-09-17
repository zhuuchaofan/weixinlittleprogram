const { randomUUID } = require('node:crypto');
class PhotoInputError extends Error {}
function validatePhotos(value) {
  if (!Array.isArray(value) || value.length > 60)
    throw new PhotoInputError('最多保存 60 张照片');
  const ids = new Set();
  return value.map((p) => {
    if (
      !p ||
      typeof p.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) ||
      ids.has(p.id)
    )
      throw new PhotoInputError('照片编号无效或重复');
    ids.add(p.id);
    if (
      typeof p.caption !== 'string' ||
      p.caption.length > 80 ||
      !['album', 'cover', 'story', 'qiuqiu', 'buding'].includes(p.slot) ||
      typeof p.original !== 'string' ||
      !p.original.startsWith('cloud://') ||
      p.original.length > 1024 ||
      typeof p.thumbnail !== 'string' ||
      !p.thumbnail.startsWith('cloud://') ||
      p.thumbnail.length > 1024
    )
      throw new PhotoInputError('照片信息无效');
    return {
      id: p.id,
      caption: p.caption,
      slot: p.slot,
      original: p.original,
      thumbnail: p.thumbnail,
      ratio: ['portrait', 'landscape', 'square'].includes(p.ratio)
        ? p.ratio
        : 'portrait',
      placeholder: false,
    };
  });
}
function validateManagedFileID(value) {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    !/^cloud:\/\/[^/]+\/wedding\/managed\/[a-zA-Z0-9_-]+\.(?:jpg|png)$/.test(
      value,
    )
  )
    throw new PhotoInputError(
      '只能清理由小程序上传的 wedding/managed/ JPG 或 PNG 文件。',
    );
  return value;
}
function photoReferenceCount(document, fileID) {
  if (!Array.isArray(document?.photos)) return 0;
  return document.photos.filter(
    (photo) => photo?.thumbnail === fileID || photo?.original === fileID,
  ).length;
}
function createPhotoHandler({ cloud, db, getAdmins }) {
  const collection = db.collection('photo_content');
  const get = async (key) =>
    (await collection.where({ _id: key }).limit(1).get()).data[0] || null;
  const referencesFor = async (fileID) => {
    const [draft, published] = await Promise.all([
      get('draft'),
      get('published'),
    ]);
    return {
      draft: photoReferenceCount(draft, fileID),
      published: photoReferenceCount(published, fileID),
    };
  };
  return async (event) => {
    const action = event?.action;
    if (
      ![
        'getAccess',
        'getPhotos',
        'getPhotoDraft',
        'savePhotoDraft',
        'publishPhotos',
        'uploadPhoto',
        'inspectManagedPhotoFile',
        'deleteManagedPhotoFile',
      ].includes(action)
    )
      return null;
    try {
      const openid = cloud.getWXContext().OPENID;
      const isAdmin = !!openid && getAdmins().includes(openid);
      if (action === 'getAccess') return { ok: true, data: { isAdmin } };
      if (action === 'getPhotos') {
        const published = await get('published');
        return {
          ok: true,
          data: published ? { photos: published.photos } : null,
        };
      }
      if (!isAdmin)
        return {
          ok: false,
          code: 'FORBIDDEN',
          message: '仅主人可以管理照片。',
        };
      if (action === 'getPhotoDraft') {
        const draft = (await get('draft')) || (await get('published'));
        return { ok: true, data: draft ? { photos: draft.photos } : null };
      }
      if (
        action === 'inspectManagedPhotoFile' ||
        action === 'deleteManagedPhotoFile'
      ) {
        const fileID = validateManagedFileID(event.payload?.fileID);
        const references = await referencesFor(fileID);
        const deletable = references.draft === 0 && references.published === 0;
        if (action === 'inspectManagedPhotoFile')
          return { ok: true, data: { fileID, references, deletable } };
        if (!deletable)
          throw new PhotoInputError(
            '这张照片仍被草稿或已发布内容使用。请先移除展示、保存草稿并更新展示。',
          );
        await cloud.deleteFile({ fileList: [fileID] });
        return { ok: true, data: { fileID, deleted: true } };
      }
      if (action === 'uploadPhoto') {
        const base64 = event.payload?.base64;
        if (
          typeof base64 !== 'string' ||
          base64.length > 700000 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
        )
          throw new PhotoInputError(
            '图片过大，请选择压缩后小于 500 KB 的 JPG 或 PNG',
          );
        const fileContent = Buffer.from(base64, 'base64');
        const jpg =
          fileContent[0] === 255 &&
          fileContent[1] === 216 &&
          fileContent[2] === 255;
        const png = fileContent
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        if (!jpg && !png) throw new PhotoInputError('仅支持 JPG 或 PNG 图片');
        const result = await cloud.uploadFile({
          cloudPath:
            'wedding/managed/' + randomUUID() + (jpg ? '.jpg' : '.png'),
          fileContent,
        });
        return { ok: true, data: { fileID: result.fileID } };
      }
      const photos = validatePhotos(event.payload?.photos);
      if (photos.filter((p) => p.slot === 'cover').length > 1)
        throw new PhotoInputError('首页只能设置一张封面');
      await collection
        .doc('draft')
        .set({ data: { photos, updatedAt: new Date().toISOString() } });
      if (action === 'publishPhotos')
        await collection
          .doc('published')
          .set({ data: { photos, updatedAt: new Date().toISOString() } });
      return { ok: true, data: { photos } };
    } catch (error) {
      return {
        ok: false,
        code: 'PHOTO_ERROR',
        message:
          error instanceof PhotoInputError
            ? error.message
            : '照片操作失败，请检查云函数和 photo_content 集合配置后重试',
      };
    }
  };
}
module.exports = {
  createPhotoHandler,
  validateManagedFileID,
  validatePhotos,
};
