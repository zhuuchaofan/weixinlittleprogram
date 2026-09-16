import { uiCopy } from '../config/ui-copy';
import type { Photo } from '../models';
import { resolvePhotoUrl } from '../services/photo-url';
export async function previewPhotos(
  photos: Photo[],
  current: number,
): Promise<void> {
  const sources = photos.map(
    (p) => p.original || p.thumbnail || `/assets/placeholder-${p.ratio}.png`,
  );
  let urls: string[];
  try {
    urls = await Promise.all(sources.map(resolvePhotoUrl));
  } catch {
    wx.showToast({ title: uiCopy.preview.text01, icon: 'none' });
    return;
  }
  if (!urls.length) return;
  wx.previewImage({
    urls,
    current: urls[current] || urls[0],
    fail: () => {
      wx.showToast({ title: uiCopy.preview.text01, icon: 'none' });
    },
  });
}
