import { initializeCloud } from './cloud';

const cloudFilePrefix = 'cloud://';
const urlCache = new Map<string, Promise<string>>();

/** 将云存储 file ID 转成当次会话可展示的 HTTPS 地址；普通本地/HTTPS 图片原样返回。 */
export async function resolvePhotoUrl(source: string): Promise<string> {
  if (!source || !source.startsWith(cloudFilePrefix)) return source;

  const cached = urlCache.get(source);
  if (cached) return await cached;

  const resolving = (async () => {
    initializeCloud();
    const result = await wx.cloud.getTempFileURL({ fileList: [source] });
    const item = result.fileList[0];
    if (!item?.tempFileURL) throw new Error('云端照片链接暂时不可用');
    return item.tempFileURL;
  })();

  urlCache.set(source, resolving);
  try {
    return await resolving;
  } catch (error) {
    urlCache.delete(source);
    throw error;
  }
}

export function clearPhotoUrlCache(): void {
  urlCache.clear();
}

/** 仅在用户主动重试单张云图时丢弃它的临时地址。 */
export function invalidatePhotoUrl(source: string): void {
  if (source.startsWith(cloudFilePrefix)) urlCache.delete(source);
}
