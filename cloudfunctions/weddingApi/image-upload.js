const { createHash } = require('node:crypto');
const IMAGE_SIZE_LIMIT = 30 * 1024 * 1024;
class ImageUploadError extends Error {}
function imageFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png';
  if (
    buffer.subarray(0, 4).toString() === 'RIFF' &&
    buffer.subarray(8, 12).toString() === 'WEBP'
  )
    return 'webp';
  return null;
}
// 仅由 photos.js 完成真实管理员鉴权后调用；路径完全由服务端生成。
async function handleImageUpload({ action, payload, openid, storage, cloud }) {
  if (
    !/^[a-zA-Z0-9_-]{8,80}$/.test(payload.requestId || '') ||
    !Number.isSafeInteger(payload.size) ||
    payload.size <= 0 ||
    payload.size > IMAGE_SIZE_LIMIT ||
    !['jpg', 'png', 'webp'].includes(payload.format)
  )
    throw new ImageUploadError(
      '图片上传信息无效，支持 30 MB 以内的 JPG、PNG 或 WebP。',
    );
  const key = createHash('sha256')
    .update(openid + ':image-v2:' + payload.requestId)
    .digest('hex');
  const cloudPath = 'wedding/managed/' + key + '.' + payload.format;
  const { data: m } = await storage.getUploadMetadata({ cloudPath });
  if (!m?.fileId || !m.url || !m.authorization || !m.token || !m.cosFileId)
    throw new Error('无法取得上传凭据');
  if (action === 'verifyImageUpload') {
    const { fileContent } = await cloud.downloadFile({ fileID: m.fileId });
    if (
      !Buffer.isBuffer(fileContent) ||
      fileContent.length !== payload.size ||
      fileContent.length > IMAGE_SIZE_LIMIT ||
      imageFormat(fileContent) !== payload.format
    )
      throw new ImageUploadError(
        '图片实际内容或大小校验失败，请重新选择有效图片。',
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
module.exports = { handleImageUpload, ImageUploadError, imageFormat };
