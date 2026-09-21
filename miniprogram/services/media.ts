import type { ManagedPhoto } from './photos';

export const MEDIA_LIMIT = 60;
export const VIDEO_SIZE_LIMIT = 30 * 1024 * 1024;
export const VIDEO_DURATION_LIMIT = 60;

/** 只在读取边界兼容旧字段，不改写历史数据库。 */
export function normalizeMediaData(value: unknown): ManagedPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const p = (
      typeof raw === 'string' ? { imageUrl: raw } : raw || {}
    ) as Partial<ManagedPhoto> & { imageUrl?: string };
    const type = p.type === 'video' ? 'video' : 'image';
    const original = p.original || p.url || p.imageUrl || p.thumbnail || '';
    return {
      ...p,
      id: p.id || 'legacy-' + index,
      type,
      url: original,
      original,
      thumbnail:
        type === 'video'
          ? p.coverUrl || p.thumbnail || ''
          : p.thumbnail || original,
      caption: p.caption || '',
      slot: p.slot || 'album',
      placeholder: p.placeholder ?? !original,
      ratio: p.ratio || 'portrait',
    };
  });
}

export function validateVideo(info: {
  size: number;
  duration: number;
  width: number;
  height: number;
}): void {
  if (
    !Number.isFinite(info.size) ||
    info.size <= 0 ||
    info.size > VIDEO_SIZE_LIMIT
  )
    throw new Error('视频需小于或等于 30 MB，请压缩或剪短后重试。');
  if (
    !Number.isFinite(info.duration) ||
    info.duration <= 0 ||
    info.duration > VIDEO_DURATION_LIMIT
  )
    throw new Error('请选择 60 秒以内的视频。');
  if (!(info.width > 0 && info.height > 0))
    throw new Error('无法读取视频尺寸，请换一个视频。');
}
