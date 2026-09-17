// 保守的应用上限，不代表微信所有版本的传输上限。Base64 请求只含 ASCII。
export const PHOTO_REQUEST_LIMIT = 180000;
export function photoRequestSize(base64: string): number {
  return JSON.stringify({ action: 'uploadPhoto', payload: { base64 } }).length;
}
export function fitsPhotoRequest(base64: string): boolean {
  return photoRequestSize(base64) <= PHOTO_REQUEST_LIMIT;
}
function readBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) =>
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (r) => resolve(r.data as string),
      fail: reject,
    }),
  );
}
export async function preparePhotoUpload(
  source: string,
): Promise<{ path: string; base64: string }> {
  let path = source;
  let base64 = await readBase64(path);
  if (fitsPhotoRequest(base64)) return { path, base64 };
  const info = await wx.getImageInfo({ src: source });
  // 每次从原文件生成展示副本，避免反复压缩同一副本；不放大小图。
  for (const [longEdge, quality] of [
    [1600, 70],
    [1280, 60],
    [1024, 55],
    [800, 50],
    [640, 45],
    [480, 40],
  ]) {
    const scale = Math.min(1, longEdge / Math.max(info.width, info.height));
    path = (
      await wx.compressImage({
        src: source,
        quality,
        compressedWidth: Math.max(1, Math.round(info.width * scale)),
        compressedHeight: Math.max(1, Math.round(info.height * scale)),
      })
    ).tempFilePath;
    base64 = await readBase64(path);
    if (fitsPhotoRequest(base64)) return { path, base64 };
  }
  throw new Error(
    '这张照片压缩后仍超过上传限制，尚未发送。可通过云存储上传原图，再用文件 ID 导入。',
  );
}
