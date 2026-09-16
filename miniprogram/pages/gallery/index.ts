import { uiCopy } from '../../config/ui-copy';
import { appConfig, albums } from '../../services/content';
import { previewPhotos } from '../../utils/preview';
import type { Photo } from '../../models';
function columns(photos: Photo[]) {
  return [
    { id: 'left', photos: photos.filter((_, i) => i % 2 === 0) },
    { id: 'right', photos: photos.filter((_, i) => i % 2 !== 0) },
  ];
}
Page({
  data: {
    copy: uiCopy.gallery,
    appConfig,
    albums,
    active: 0,
    description: albums[0]?.description || '',
    columns: columns(albums[0]?.photos || []),
    total: albums[0]?.photos.length || 0,
  },
  select(event: WechatMiniprogram.TouchEvent) {
    const active = Number(event.currentTarget.dataset.index);
    const album = albums[active];
    if (album)
      this.setData({
        active,
        description: album.description,
        columns: columns(album.photos),
        total: album.photos.length,
      });
  },
  preview(event: WechatMiniprogram.CustomEvent) {
    const album = albums[this.data.active];
    if (!album) return;
    const index = album.photos.findIndex(
      (p) => p.id === event.currentTarget.dataset.id,
    );
    previewPhotos(album.photos, index);
  },
});
