import { imageDisplay } from '../config/image';
import { initializeCloud } from './cloud';

export type CloudFileRendition =
  'original' | 'thumbnail' | 'thumbnail-compatible';

const cloudFilePrefix = 'cloud://';
const batchSize = 50;
const fallbackCacheMs = 5 * 60 * 1000;
interface CachedUrl {
  value: Promise<string>;
  expiresAt: number;
}
const urlCache = new Map<string, CachedUrl>();

function cacheLifetime(maxAge: number | undefined): number {
  if (!Number.isFinite(maxAge) || !maxAge || maxAge <= 0)
    return fallbackCacheMs;
  // 小程序文档示例的 maxAge 为毫秒；按毫秒并留 10% 余量，
  // 即使某端返回秒数也只会提前刷新，且最长仅缓存五分钟。
  return Math.min(fallbackCacheMs, Math.floor(maxAge * 0.9));
}

function cachedUrl(key: string): CachedUrl | undefined {
  const cached = urlCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  urlCache.delete(key);
  return undefined;
}

function cacheKey(source: string, rendition: CloudFileRendition): string {
  return rendition + '\u0000' + source;
}

function withRendition(url: string, rendition: CloudFileRendition): string {
  if (rendition === 'original' || !/^https?:\/\//i.test(url)) return url;
  const rule =
    rendition === 'thumbnail'
      ? imageDisplay.thumbnail
      : imageDisplay.compatible;
  return url + (url.includes('?') ? '&' : '?') + rule;
}

function isCloudFile(source: string): boolean {
  return source.startsWith(cloudFilePrefix);
}

async function fetchCloudFileUrl(
  source: string,
): Promise<{ url: string; maxAge: number | undefined }> {
  initializeCloud();
  const result = await wx.cloud.getTempFileURL({ fileList: [source] });
  const file = result.fileList[0];
  const url = file?.tempFileURL;
  if (!url) throw new Error('云端文件链接暂时不可用');
  return { url, maxAge: file.maxAge };
}

/** 解析云存储 File ID。缩略图只在 HTTPS 临时链接上追加实时处理规则。 */
export async function resolveCloudFileUrl(
  source: string,
  rendition: CloudFileRendition = 'original',
): Promise<string> {
  if (!source || !isCloudFile(source)) return source;
  const key = cacheKey(source, rendition);
  const cached = cachedUrl(key);
  if (cached) return await cached.value;

  const requestedAt = Date.now();
  const entry: CachedUrl = { value: Promise.resolve(''), expiresAt: Infinity };
  entry.value = fetchCloudFileUrl(source).then(({ url, maxAge }) => {
    if (urlCache.get(key) === entry)
      entry.expiresAt = requestedAt + cacheLifetime(maxAge);
    return withRendition(url, rendition);
  });
  urlCache.set(key, entry);
  try {
    return await entry.value;
  } catch (error) {
    if (urlCache.get(key) === entry) urlCache.delete(key);
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
    (source) => !cachedUrl(cacheKey(source, rendition)),
  );
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    try {
      initializeCloud();
      const requestedAt = Date.now();
      const result = await wx.cloud.getTempFileURL({ fileList: batch });
      const files = new Map(
        result.fileList
          .filter((item) => !!item.tempFileURL)
          .map((item) => [item.fileID, item]),
      );
      batch.forEach((source) => {
        const key = cacheKey(source, rendition);
        const file = files.get(source);
        if (file && !cachedUrl(key))
          urlCache.set(key, {
            value: Promise.resolve(withRendition(file.tempFileURL, rendition)),
            expiresAt: requestedAt + cacheLifetime(file.maxAge),
          });
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
