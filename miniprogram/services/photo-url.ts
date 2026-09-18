import {
  clearCloudFileUrlCache,
  invalidateCloudFileUrl,
  prewarmCloudFileUrls,
  resolveCloudFileUrl,
  type CloudFileRendition,
} from './cloud-file-url';

/** 将云存储 File ID 转成当前会话的展示链接；缩略图自动使用低流量实时处理。 */
export function resolvePhotoUrl(
  source: string,
  rendition: CloudFileRendition = 'thumbnail',
): Promise<string> {
  return resolveCloudFileUrl(source, rendition);
}

export function prewarmPhotoUrls(
  sources: ReadonlyArray<string>,
): Promise<void> {
  return prewarmCloudFileUrls(sources, 'thumbnail');
}

export function clearPhotoUrlCache(): void {
  clearCloudFileUrlCache();
}

/** 仅在用户主动重试单张云图时丢弃该图的全部临时链接变体。 */
export function invalidatePhotoUrl(source: string): void {
  invalidateCloudFileUrl(source);
}
