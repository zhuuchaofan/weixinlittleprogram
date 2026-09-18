import { initializeCloud } from './cloud';

export type CloudFileRendition = 'original' | 'thumbnail';

const cloudFilePrefix = 'cloud://';
const thumbnailRule = 'imageMogr2/thumbnail/1080x1080';
const batchSize = 50;
const urlCache = new Map<string, Promise<string>>();

function cacheKey(source: string, rendition: CloudFileRendition): string {
  return rendition + '\u0000' + source;
}

function withRendition(url: string, rendition: CloudFileRendition): string {
  if (rendition !== 'thumbnail' || !/^https?:\/\//i.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + thumbnailRule;
}

function isCloudFile(source: string): boolean {
  return source.startsWith(cloudFilePrefix);
}

async function fetchCloudFileUrl(source: string): Promise<string> {
  initializeCloud();
  const result = await wx.cloud.getTempFileURL({ fileList: [source] });
  const url = result.fileList[0]?.tempFileURL;
  if (!url) throw new Error('云端文件链接暂时不可用');
  return url;
}

/** 解析云存储 File ID。缩略图只在 HTTPS 临时链接上追加实时处理规则。 */
export async function resolveCloudFileUrl(
  source: string,
  rendition: CloudFileRendition = 'original',
): Promise<string> {
  if (!source || !isCloudFile(source)) return source;
  const key = cacheKey(source, rendition);
  const cached = urlCache.get(key);
  if (cached) return await cached;

  const resolving = fetchCloudFileUrl(source).then((url) =>
    withRendition(url, rendition),
  );
  urlCache.set(key, resolving);
  try {
    return await resolving;
  } catch (error) {
    urlCache.delete(key);
    throw error;
  }
}

/**
 * 预热照片缩略图：按 CloudBase 单次上限分批请求，失败交由单张组件按原有方式重试。
 */
export async function prewarmCloudFileUrls(
  sources: ReadonlyArray<string>,
  rendition: CloudFileRendition = 'thumbnail',
): Promise<void> {
  const pending = [...new Set(sources.filter(isCloudFile))].filter(
    (source) => !urlCache.has(cacheKey(source, rendition)),
  );
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    try {
      initializeCloud();
      const result = await wx.cloud.getTempFileURL({ fileList: batch });
      const urls = new Map(
        result.fileList
          .filter((item) => !!item.tempFileURL)
          .map((item) => [item.fileID, item.tempFileURL as string]),
      );
      batch.forEach((source) => {
        const url = urls.get(source);
        if (url)
          urlCache.set(
            cacheKey(source, rendition),
            Promise.resolve(withRendition(url, rendition)),
          );
      });
    } catch {
      // 页面仍会用单张解析与失败重试兜底，预热不应阻塞展示。
    }
  }
}

export function invalidateCloudFileUrl(source: string): void {
  for (const key of urlCache.keys())
    if (key.endsWith('\u0000' + source)) urlCache.delete(key);
}

export function clearCloudFileUrlCache(): void {
  urlCache.clear();
}
