import { uiCopy } from '../config/ui-copy';
import type { Photo } from '../models';
import { resolvePhotoUrl } from '../services/photo-url';

export async function previewPhotos(
  photos: Photo[],
  current: number,
): Promise<void> {
  const selected = photos[current];
  // CSS 占位只提示“尚未加入”，不是可放大的图片资源。
  if (
    !selected ||
    selected.type === 'video' ||
    !(selected.original || selected.thumbnail)
  ) {
    wx.showToast({ title: uiCopy.photoFrame.previewHint, icon: 'none' });
    return;
  }
  const available = photos.filter(
    (photo) => photo.type !== 'video' && (photo.original || photo.thumbnail),
  );
  let urls: string[];
  try {
    urls = await Promise.all(
      available.map((photo) =>
        resolvePhotoUrl(photo.original || photo.thumbnail, 'original'),
      ),
    );
  } catch {
    wx.showToast({ title: uiCopy.preview.text01, icon: 'none' });
    return;
  }
  if (!urls.length) return;
  const selectedIndex = available.indexOf(selected);
  wx.previewImage({
    urls,
    current: urls[selectedIndex] || urls[0],
    fail: () => {
      wx.showToast({ title: uiCopy.preview.text01, icon: 'none' });
    },
  });
}
