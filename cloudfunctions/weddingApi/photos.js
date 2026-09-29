const { handleImageUpload, ImageUploadError } = require('./image-upload');
const {
  MediaLibraryError,
  normalizeLibrary,
  validateLibrary,
  projectLegacyLibrary,
} = require('./media-library');
const { createHash, randomUUID } = require('node:crypto');
class PhotoInputError extends Error {}
const categories = [
  'pending',
  'wedding',
  'daily',
  'baoji_0927',
  'lintong_0928',
];
function fileReferences(photo) {
  return [
    photo?.original,
    photo?.thumbnail,
    photo?.url,
    photo?.coverUrl,
  ].filter(
    (value) => typeof value === 'string' && value.startsWith('cloud://'),
  );
}
function validatePhotos(value, previous = []) {
  if (!Array.isArray(value) || value.length > 60)
    throw new PhotoInputError('最多保存 60 张照片');
  const ids = new Set();
  const historic = previous.filter((p) => p && typeof p === 'object');
  const knownById = new Map(historic.map((p) => [p.id, p]));
  const privateFiles = new Set(
    historic.filter((p) => p.visibility === 'private').flatMap(fileReferences),
  );
  const photos = value.map((p) => {
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
      !(
        p.thumbnail.startsWith('cloud://') ||
        (p.type === 'video' && p.thumbnail === '')
      ) ||
      p.thumbnail.length > 1024
    )
      throw new PhotoInputError('照片信息无效');
    if (p.type && !['image', 'video'].includes(p.type))
      throw new PhotoInputError('媒体类型无效');
    if (p.category !== undefined && !categories.includes(p.category))
      throw new PhotoInputError('照片分类无效');
    if (p.type === 'video' && p.category !== undefined)
      throw new PhotoInputError('视频不能设置照片分类');
    if (
      p.visibility !== undefined &&
      !['public', 'private'].includes(p.visibility)
    )
      throw new PhotoInputError('媒体可见性无效');
    if (
      p.type === 'video' &&
      (p.slot !== 'album' ||
        !Number.isFinite(p.duration) ||
        p.duration <= 0 ||
        p.duration > 60 ||
        !Number.isFinite(p.size) ||
        p.size <= 0 ||
        p.size > 30 * 1024 * 1024 ||
        !Number.isFinite(p.width) ||
        p.width <= 0 ||
        !Number.isFinite(p.height) ||
        p.height <= 0 ||
        (p.coverUrl &&
          (typeof p.coverUrl !== 'string' ||
            !p.coverUrl.startsWith('cloud://') ||
            p.coverUrl.length > 1024)))
    )
      throw new PhotoInputError('视频仅用于相册，需在 60 秒、30 MB 以内');
    const old = knownById.get(p.id);
    const sameItem = old?.original === p.original;
    const category =
      p.slot === 'album' && p.type !== 'video'
        ? (p.category ?? (sameItem ? old.category : undefined))
        : undefined;
    const visibility =
      p.visibility ||
      (sameItem && old.visibility) ||
      (fileReferences(p).some((file) => privateFiles.has(file))
        ? 'private'
        : 'public');
    return {
      ...(p.type ? { type: p.type, url: p.original } : {}),
      ...(category ? { category } : {}),
      visibility,
      ...(p.type === 'video'
        ? {
            coverUrl: p.coverUrl || '',
            duration: p.duration,
            width: p.width,
            height: p.height,
            size: p.size,
          }
        : {}),
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
  const visibilityByFile = new Map();
  for (const photo of photos)
    for (const fileID of fileReferences(photo)) {
      const known = visibilityByFile.get(fileID);
      if (known && known !== photo.visibility)
        throw new PhotoInputError('同一云文件不能同时设置公开和私密');
      visibilityByFile.set(fileID, photo.visibility);
    }
  return photos;
}
function validateManagedFileID(value) {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    !/^cloud:\/\/[^/]+\/wedding\/managed\/[a-zA-Z0-9_-]+\.(?:jpg|png|webp|mp4)$/.test(
      value,
    )
  )
    throw new PhotoInputError(
      '只能清理由小程序上传的 wedding/managed/ JPG、PNG、WebP 或 MP4 文件。',
    );
  return value;
}
function photoReferenceCount(document, fileID) {
  if (!Array.isArray(document?.photos)) return 0;
  return document.photos.filter(
    (photo) =>
      photo === fileID ||
      photo?.imageUrl === fileID ||
      photo?.thumbnail === fileID ||
      photo?.original === fileID ||
      photo?.coverUrl === fileID ||
      photo?.url === fileID,
  ).length;
}
function createPhotoHandler({ cloud, db, getAdmins, getOpenId, storage }) {
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
        'getMediaLibrary',
        'getMediaLibraryDraft',
        'saveMediaLibraryDraft',
        'publishMediaLibrary',
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
      ].includes(action)
    )
      return null;
    try {
      const openid = getOpenId();
      const isAdmin = !!openid && getAdmins().includes(openid);
      if (action === 'getAccess') return { ok: true, data: { isAdmin } };
      if (action === 'getPhotos') {
        const published = await get('published');
        const privateOriginals = new Set(
          normalizeLibrary(published?.photos)
            .filter((photo) => photo.visibility === 'private')
            .map((photo) => photo.original),
        );
        return {
          ok: true,
          data: published
            ? {
                photos: Array.isArray(published.photos)
                  ? (published.schemaVersion === 2
                      ? projectLegacyLibrary(published.photos)
                      : published.photos
                    ).filter((photo) => {
                      const original =
                        typeof photo === 'string'
                          ? photo
                          : photo?.original ||
                            photo?.url ||
                            photo?.imageUrl ||
                            photo?.thumbnail;
                      return (
                        photo?.visibility !== 'private' &&
                        !privateOriginals.has(original)
                      );
                    })
                  : published.photos,
              }
            : null,
        };
      }
      if (action === 'getMediaLibrary') {
        const published = await get('published');
        return {
          ok: true,
          data: published
            ? {
                photos: normalizeLibrary(published.photos).filter(
                  (photo) => photo.visibility !== 'private',
                ),
              }
            : null,
        };
      }
      if (!isAdmin)
        return {
          ok: false,
          code: 'FORBIDDEN',
          message: '仅主人可以管理照片。',
        };
      if (action === 'prepareImageUpload' || action === 'verifyImageUpload') {
        return await handleImageUpload({
          action,
          payload: event.payload || {},
          openid,
          storage,
          cloud,
        });
      }
      if (action === 'getPhotoDraft') {
        const draft = (await get('draft')) || (await get('published'));
        return {
          ok: true,
          data: draft
            ? {
                photos:
                  draft.schemaVersion === 2
                    ? projectLegacyLibrary(draft.photos)
                    : draft.photos,
              }
            : null,
        };
      }
      if (action === 'getMediaLibraryDraft') {
        const draft = (await get('draft')) || (await get('published'));
        return {
          ok: true,
          data: draft ? { photos: normalizeLibrary(draft.photos) } : null,
        };
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
        const deleted = await cloud.deleteFile({ fileList: [fileID] });
        if (
          deleted?.fileList?.some(
            (file) => file.status !== 0 && file.status !== undefined,
          )
        )
          throw new PhotoInputError('云端文件未能删除，请稍后重新检查并重试');
        return { ok: true, data: { fileID, deleted: true } };
      }
      if (action === 'prepareVideoUpload' || action === 'verifyVideoUpload') {
        const payload = event.payload || {};
        if (!/^[a-zA-Z0-9_-]{8,80}$/.test(payload.requestId || ''))
          throw new PhotoInputError('上传编号无效，请重新选择视频');
        if (
          !Number.isFinite(payload.size) ||
          payload.size <= 0 ||
          payload.size > 30 * 1024 * 1024 ||
          !Number.isFinite(payload.duration) ||
          payload.duration <= 0 ||
          payload.duration > 60 ||
          !Number.isFinite(payload.width) ||
          payload.width <= 0 ||
          !Number.isFinite(payload.height) ||
          payload.height <= 0
        )
          throw new PhotoInputError('视频需在 60 秒、30 MB 以内，且尺寸有效');
        const key = createHash('sha256')
          .update(openid + ':' + payload.requestId)
          .digest('hex');
        const cloudPath = 'wedding/managed/' + key + '.mp4';
        const metadata = await storage.getUploadMetadata({
          cloudPath,
          method: 'post',
        });
        const m = metadata.data;
        if (
          !m?.fileId ||
          !m.url ||
          !m.authorization ||
          !m.token ||
          !m.cosFileId
        )
          throw new Error('无法取得上传凭据');
        if (action === 'verifyVideoUpload') {
          const { fileContent } = await cloud.downloadFile({
            fileID: m.fileId,
          });
          // 验证实际上传内容及大小，避免只信任客户端扩展名和大小。
          if (
            !Buffer.isBuffer(fileContent) ||
            fileContent.length !== payload.size ||
            fileContent.length > 30 * 1024 * 1024 ||
            fileContent.subarray(4, 8).toString() !== 'ftyp'
          )
            throw new PhotoInputError(
              '视频文件校验失败，请选择有效的 MP4 或 MOV 视频',
            );
          return { ok: true, data: { fileID: m.fileId } };
        }
        return {
          ok: true,
          data: {
            cloudPath,
            url: m.url,
            fileID: m.fileId,
            authorization: m.authorization,
            token: m.token,
            cosFileID: m.cosFileId,
          },
        };
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
            'wedding/managed/' +
            (event.payload?.requestId &&
            /^[a-zA-Z0-9_-]{8,80}$/.test(event.payload.requestId)
              ? createHash('sha256')
                  .update(openid + ':' + event.payload.requestId)
                  .digest('hex')
              : randomUUID()) +
            (jpg ? '.jpg' : '.png'),
          fileContent,
        });
        return { ok: true, data: { fileID: result.fileID } };
      }
      const [draft, published] = await Promise.all([
        get('draft'),
        get('published'),
      ]);
      if (
        action === 'saveMediaLibraryDraft' ||
        action === 'publishMediaLibrary'
      ) {
        const photos = validateLibrary(
          event.payload?.photos,
          published?.photos || [],
          action === 'publishMediaLibrary',
        );
        await collection.doc('draft').set({
          data: {
            schemaVersion: 2,
            photos,
            updatedAt: new Date().toISOString(),
          },
        });
        if (action === 'publishMediaLibrary')
          await collection.doc('published').set({
            data: {
              schemaVersion: 2,
              photos: photos.filter((photo) => photo.visibility !== 'private'),
              updatedAt: new Date().toISOString(),
            },
          });
        return { ok: true, data: { photos } };
      }
      if (draft?.schemaVersion === 2 || published?.schemaVersion === 2)
        return {
          ok: false,
          code: 'UPGRADE_REQUIRED',
          message: '照片库已更新，请升级小程序后再管理照片。',
        };
      const photos = validatePhotos(event.payload?.photos, [
        ...(published?.photos || []),
        ...(draft?.photos || []),
      ]);
      if (photos.filter((p) => p.slot === 'cover').length > 1)
        throw new PhotoInputError('首页只能设置一张封面');
      if (
        action === 'publishPhotos' &&
        photos.some(
          (p) =>
            p.slot === 'album' &&
            p.type !== 'video' &&
            p.category === 'pending',
        )
      )
        throw new PhotoInputError('请先为新增照片选择分类再更新展示');
      await collection
        .doc('draft')
        .set({ data: { photos, updatedAt: new Date().toISOString() } });
      if (action === 'publishPhotos')
        await collection.doc('published').set({
          data: {
            photos: photos.filter((p) => p.visibility !== 'private'),
            updatedAt: new Date().toISOString(),
          },
        });
      return { ok: true, data: { photos } };
    } catch (error) {
      return {
        ok: false,
        code: 'PHOTO_ERROR',
        message:
          error instanceof PhotoInputError ||
          error instanceof MediaLibraryError ||
          error instanceof ImageUploadError
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
