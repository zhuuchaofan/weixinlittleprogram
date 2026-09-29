import { normalizeMediaData } from './media';
import type { Photo } from '../models';
import { albums, coverPhoto, catPhotos, storyItems } from '../config/content';
import { localConfig } from '../config/local';
import { callCloud, CloudActionError } from './cloud';
export interface ManagedPhoto extends Photo {
  slot?: string;
  coverSelected?: boolean;
  storySelected?: boolean;
  qiuqiuSelected?: boolean;
  budingSelected?: boolean;
}
export type MediaPlacement = 'cover' | 'story' | 'qiuqiu' | 'buding';
const placementOrder: MediaPlacement[] = ['cover', 'story', 'qiuqiu', 'buding'];
const isMissingMediaLibraryAction = (error: unknown) =>
  error instanceof CloudActionError && error.code === 'NOT_FOUND';
async function writeMediaLibrary(action: string, photos: ManagedPhoto[]) {
  try {
    await callCloud(action, { photos });
  } catch (error) {
    if (isMissingMediaLibraryAction(error))
      throw new Error('请先部署新版 weddingApi 云函数，再保存或发布照片库。');
    throw error;
  }
}

/** 旧版用多条 slot 记录复用文件；新版按原文件合并为一条媒体记录。 */
export function normalizeMediaLibrary(value: unknown): ManagedPhoto[] {
  const raw = Array.isArray(value)
    ? value
    : (value as { photos?: unknown } | null)?.photos;
  const entries = normalizeMediaData(raw);
  const groups = new Map<
    string,
    Array<{ photo: ManagedPhoto; index: number }>
  >();
  entries.forEach((photo, index) => {
    const key = photo.original
      ? (photo.type === 'video' ? 'video:' : 'image:') + photo.original
      : 'empty:' + photo.id + ':' + index;
    const group = groups.get(key) || [];
    group.push({ photo, index });
    groups.set(key, group);
  });
  return [...groups.values()]
    .sort(
      (a, b) =>
        (a.find((entry) => entry.photo.slot === 'album')?.index ?? a[0].index) -
        (b.find((entry) => entry.photo.slot === 'album')?.index ?? b[0].index),
    )
    .map((group) => {
      const preferred =
        group.find((entry) => entry.photo.slot === 'album')?.photo ||
        group[0].photo;
      const placements = new Set<MediaPlacement>();
      group.forEach(({ photo }) => {
        if (photo.type === 'video') return;
        (photo.placements || []).forEach((placement) => {
          if (placementOrder.includes(placement)) placements.add(placement);
        });
        if (placementOrder.includes(photo.slot as MediaPlacement))
          placements.add(photo.slot as MediaPlacement);
      });
      const albumCategory = group
        .filter(({ photo }) => photo.slot === 'album')
        .map(({ photo }) => photo.category)
        .find((candidate) => candidate && candidate !== 'pending');
      const pendingAlbum = group.some(
        ({ photo }) => photo.slot === 'album' && photo.category === 'pending',
      );
      const otherCategory = group
        .map(({ photo }) => photo.category)
        .find((candidate) => candidate && candidate !== 'pending');
      const category =
        preferred.type === 'video'
          ? undefined
          : placements.has('qiuqiu') || placements.has('buding')
            ? 'daily'
            : albumCategory ||
              (pendingAlbum ? 'pending' : otherCategory) ||
              'pending';
      const base = { ...preferred };
      delete base.slot;
      return {
        ...base,
        ...(category ? { category } : { category: undefined }),
        visibility: group.some(({ photo }) => photo.visibility === 'private')
          ? 'private'
          : 'public',
        placements: placementOrder.filter((placement) =>
          placements.has(placement),
        ),
        coverSelected: placements.has('cover'),
        storySelected: placements.has('story'),
        qiuqiuSelected: placements.has('qiuqiu'),
        budingSelected: placements.has('buding'),
      };
    });
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
      (photo.placements || []).join(','),
      photo.id,
      photo.thumbnail,
      photo.original,
      photo.caption,
      photo.placeholder,
      photo.ratio,
      photo.type,
      photo.category,
      photo.visibility,
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
    a.photos.map((p) => ({ ...p, category: 'wedding', slot: 'album' })),
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
export function initialMediaLibrary(): ManagedPhoto[] {
  return normalizeMediaLibrary(initialPhotos());
}
export async function getPublishedPhotos(): Promise<PublishedPhotosResult> {
  const publicPhotos = (value: unknown) =>
    normalizeMediaData(value).filter((photo) => photo.visibility !== 'private');
  try {
    if (String(localConfig.mode) === 'mock') {
      const photos = wx.getStorageSync('photos:published') as unknown;
      if (photos === null || photos === undefined) return { state: 'missing' };
      return Array.isArray(photos)
        ? { state: 'published', photos: publicPhotos(photos) }
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
      photos: publicPhotos((result as { photos: ManagedPhoto[] }).photos),
    };
  } catch {
    return { state: 'unavailable' };
  }
}
export const photoService = {
  async draft() {
    if (String(localConfig.mode) === 'mock')
      return normalizeMediaLibrary(
        wx.getStorageSync('photos:draft') || initialMediaLibrary(),
      );
    let result: { photos: ManagedPhoto[] } | null;
    try {
      result = await callCloud<{ photos: ManagedPhoto[] } | null>(
        'getMediaLibraryDraft',
      );
    } catch (error) {
      if (!isMissingMediaLibraryAction(error)) throw error;
      result = await callCloud<{ photos: ManagedPhoto[] } | null>(
        'getPhotoDraft',
      );
    }
    return normalizeMediaLibrary(result?.photos ?? initialMediaLibrary());
  },
  save(photos: ManagedPhoto[]) {
    if (String(localConfig.mode) === 'mock') {
      wx.setStorageSync('photos:draft', { schemaVersion: 2, photos });
      return Promise.resolve();
    }
    return writeMediaLibrary('saveMediaLibraryDraft', photos);
  },
  publish(photos: ManagedPhoto[]) {
    if (String(localConfig.mode) === 'mock') {
      const historic = new Set(
        normalizeMediaLibrary(wx.getStorageSync('photos:published')).map(
          (photo) => photo.original,
        ),
      );
      if (
        photos.some(
          (photo) =>
            photo.type !== 'video' &&
            photo.category === 'pending' &&
            !historic.has(photo.original),
        )
      )
        return Promise.reject(new Error('请先为新增照片选择分类再更新展示'));
      wx.setStorageSync('photos:published', {
        schemaVersion: 2,
        photos: photos.filter((photo) => photo.visibility !== 'private'),
      });
      wx.setStorageSync('photos:draft', { schemaVersion: 2, photos });
      return Promise.resolve();
    }
    return writeMediaLibrary('publishMediaLibrary', photos);
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

export async function getPublishedMediaLibrary(): Promise<PublishedPhotosResult> {
  try {
    if (String(localConfig.mode) === 'mock') {
      const value = wx.getStorageSync('photos:published') as unknown;
      if (value === null || value === undefined) return { state: 'missing' };
      if (
        !Array.isArray(value) &&
        !Array.isArray((value as { photos?: unknown })?.photos)
      )
        return { state: 'unavailable' };
      return {
        state: 'published',
        photos: normalizeMediaLibrary(value).filter(
          (photo) => photo.visibility !== 'private',
        ),
      };
    }
    let result: { photos: ManagedPhoto[] } | null;
    try {
      result = await callCloud<{ photos: ManagedPhoto[] } | null>(
        'getMediaLibrary',
      );
    } catch (error) {
      if (!isMissingMediaLibraryAction(error)) throw error;
      result = await callCloud<{ photos: ManagedPhoto[] } | null>('getPhotos');
    }
    if (result === null) return { state: 'missing' };
    if (!Array.isArray(result?.photos)) return { state: 'unavailable' };
    return {
      state: 'published',
      photos: normalizeMediaLibrary(result.photos).filter(
        (photo) => photo.visibility !== 'private',
      ),
    };
  } catch {
    return { state: 'unavailable' };
  }
}
