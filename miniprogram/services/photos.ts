import type { Photo } from '../models';
import { albums, coverPhoto, catPhotos, storyItems } from '../config/content';
import { localConfig } from '../config/local';
import { callCloud } from './cloud';
export interface ManagedPhoto extends Photo {
  slot: string;
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
export async function getPublishedPhotos(): Promise<ManagedPhoto[] | null> {
  if (String(localConfig.mode) === 'mock')
    return wx.getStorageSync('photos:published') || null;
  try {
    return (
      (await callCloud<{ photos: ManagedPhoto[] } | null>('getPhotos'))
        ?.photos ?? null
    );
  } catch {
    return null;
  }
}
export const photoService = {
  async draft() {
    if (String(localConfig.mode) === 'mock')
      return wx.getStorageSync('photos:draft') || initialPhotos();
    return (
      (await callCloud<{ photos: ManagedPhoto[] } | null>('getPhotoDraft'))
        ?.photos ?? initialPhotos()
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
};
