import { normalizeMediaData } from './media';
import type { Photo } from '../models';
import { albums, coverPhoto, catPhotos, storyItems } from '../config/content';
import { localConfig } from '../config/local';
import { callCloud } from './cloud';
export interface ManagedPhoto extends Photo {
  slot: string;
}

export interface ManagedPhotoFileInspection {
  fileID: string;
  references: { draft: number; published: number };
  deletable: boolean;
}

export type PublishedPhotosResult =
  | { state: 'published'; photos: ManagedPhoto[] }
  | { state: 'missing' }
  | { state: 'unavailable' };

/**
 * 用于判断访客页的照片安排是否真的变化。只纳入会影响展示、顺序或预览的字段，
 * 避免页面 onShow 时因重新读取到相同内容而重设图片组件。
 */
export function photoArrangementSignature(
  photos: ReadonlyArray<Photo & { slot?: string }>,
): string {
  return JSON.stringify(
    photos.map((photo) => [
      photo.slot || '',
      photo.id,
      photo.thumbnail,
      photo.original,
      photo.caption,
      photo.placeholder,
      photo.ratio,
      photo.type,
      photo.url,
      photo.coverUrl,
      photo.duration,
      photo.width,
      photo.height,
      photo.size,
    ]),
  );
}

export function initialPhotos(): ManagedPhoto[] {
  const photos: ManagedPhoto[] = albums.flatMap((a) =>
    a.photos.map((p) => ({ ...p, slot: 'album' })),
  );
  photos.push({ ...coverPhoto, id: 'initial-cover', slot: 'cover' });
  storyItems.forEach((s, i) =>
    s.photos.forEach((p, j) =>
      photos.push({ ...p, id: 'story-' + i + '-' + j, slot: 'story' }),
    ),
  );
  catPhotos
    .filter((p) => !p.placeholder)
    .forEach((p) => photos.push({ ...p, slot: p.id }));
  return photos;
}
export async function getPublishedPhotos(): Promise<PublishedPhotosResult> {
  try {
    if (String(localConfig.mode) === 'mock') {
      const photos = wx.getStorageSync('photos:published') as unknown;
      if (photos === null || photos === undefined) return { state: 'missing' };
      return Array.isArray(photos)
        ? { state: 'published', photos: normalizeMediaData(photos) }
        : { state: 'unavailable' };
    }
    const result = await callCloud<unknown>('getPhotos');
    if (result === null) return { state: 'missing' };
    if (
      !result ||
      typeof result !== 'object' ||
      !Array.isArray((result as { photos?: unknown }).photos)
    )
      return { state: 'unavailable' };
    return {
      state: 'published',
      photos: normalizeMediaData((result as { photos: ManagedPhoto[] }).photos),
    };
  } catch {
    return { state: 'unavailable' };
  }
}
export const photoService = {
  async draft() {
    if (String(localConfig.mode) === 'mock')
      return normalizeMediaData(
        wx.getStorageSync('photos:draft') || initialPhotos(),
      );
    return normalizeMediaData(
      (await callCloud<{ photos: ManagedPhoto[] } | null>('getPhotoDraft'))
        ?.photos ?? initialPhotos(),
    );
  },
  save(photos: ManagedPhoto[]) {
    if (String(localConfig.mode) === 'mock') {
      wx.setStorageSync('photos:draft', photos);
      return Promise.resolve();
    }
    return callCloud('savePhotoDraft', { photos });
  },
  publish(photos: ManagedPhoto[]) {
    if (String(localConfig.mode) === 'mock') {
      wx.setStorageSync('photos:published', photos);
      wx.setStorageSync('photos:draft', photos);
      return Promise.resolve();
    }
    return callCloud('publishPhotos', { photos });
  },
  async inspectManagedFile(
    fileID: string,
  ): Promise<ManagedPhotoFileInspection> {
    if (String(localConfig.mode) === 'mock')
      throw new Error('本机演示没有云存储文件，无法执行永久删除。');
    return callCloud<ManagedPhotoFileInspection>('inspectManagedPhotoFile', {
      fileID,
    });
  },
  async deleteManagedFile(fileID: string): Promise<void> {
    if (String(localConfig.mode) === 'mock')
      throw new Error('本机演示没有云存储文件，无法执行永久删除。');
    await callCloud('deleteManagedPhotoFile', { fileID });
  },
};
