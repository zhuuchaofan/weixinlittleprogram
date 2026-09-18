import {
  getPublishedPhotos,
  photoArrangementSignature,
} from '../../services/photos';
import { uiCopy } from '../../config/ui-copy';
import { appConfig, albums } from '../../services/content';
import { previewPhotos } from '../../utils/preview';
import { prewarmPhotoUrls } from '../../services/photo-url';
import type { Photo } from '../../models';

let galleryRefreshVersion = 0;

function columns(photos: Photo[]) {
  return [
    { id: 'left', photos: photos.filter((_, index) => index % 2 === 0) },
    { id: 'right', photos: photos.filter((_, index) => index % 2 !== 0) },
  ];
}

function galleryPhotoState(photos: Array<Photo & { slot?: string }> | null) {
  const items = photos
    ? photos.filter((photo) => photo.slot === 'album')
    : albums[0]?.photos || [];
  return {
    albums: [{ ...albums[0], photos: items }],
    columns: columns(items),
    total: items.length,
  };
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
    photoContentReady: false,
    photoSignature: '',
  },
  async onShow() {
    const refreshVersion = ++galleryRefreshVersion;
    const result = await getPublishedPhotos();
    if (refreshVersion !== galleryRefreshVersion) return;
    if (result.state === 'unavailable' && this.data.photoContentReady) return;

    const state = galleryPhotoState(
      result.state === 'published' ? result.photos : null,
    );
    const photoSignature = photoArrangementSignature(state.albums[0].photos);
    if (
      !this.data.photoContentReady ||
      this.data.photoSignature !== photoSignature
    ) {
      void prewarmPhotoUrls(
        state.albums[0].photos.map((photo) => photo.thumbnail),
      );
      this.setData({
        albums: state.albums,
        active: 0,
        description: state.albums[0].description,
        columns: state.columns,
        total: state.total,
        photoContentReady: true,
        photoSignature,
      });
    }
  },
  select(event: WechatMiniprogram.TouchEvent) {
    const active = Number(event.currentTarget.dataset.index);
    const album = this.data.albums[active];
    if (album)
      this.setData({
        active,
        description: album.description,
        columns: columns(album.photos),
        total: album.photos.length,
      });
  },
  preview(event: WechatMiniprogram.CustomEvent) {
    const album = this.data.albums[this.data.active];
    if (!album) return;
    const index = album.photos.findIndex(
      (photo) => photo.id === event.currentTarget.dataset.id,
    );
    previewPhotos(album.photos, index);
  },
});
