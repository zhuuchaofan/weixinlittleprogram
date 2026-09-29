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
    ? photos.filter(
        (photo) => photo.slot === 'album' && photo.visibility !== 'private',
      )
    : albums[0]?.photos || [];
  return {
    images: items.filter((photo) => photo.type !== 'video'),
    videos: items.filter((photo) => photo.type === 'video'),
  };
}

const categories = [
  { key: 'all', label: '全部照片' },
  { key: 'wedding', label: '婚纱照' },
  { key: 'daily', label: '日常照' },
  { key: 'baoji_0927', label: '927 宝鸡答谢宴' },
  { key: 'lintong_0928', label: '928 临潼答谢宴' },
];

Page({
  data: {
    copy: uiCopy.gallery,
    appConfig,
    view: 'overview' as 'overview' | 'photos' | 'videos',
    category: 'all',
    categories,
    images: [] as Photo[],
    videos: [] as Photo[],
    visiblePhotos: [] as Photo[],
    columns: columns([]),
    total: 0,
    contentError: false,
    photoContentReady: false,
    photoSignature: '',
  },
  async onShow() {
    const refreshVersion = ++galleryRefreshVersion;
    const result = await getPublishedPhotos();
    if (refreshVersion !== galleryRefreshVersion) return;
    if (result.state === 'unavailable' && this.data.photoContentReady) return;

    const state = galleryPhotoState(
      result.state === 'published'
        ? result.photos
        : result.state === 'missing'
          ? null
          : [],
    );
    const photoSignature = photoArrangementSignature([
      ...state.images,
      ...state.videos,
    ]);
    if (
      !this.data.photoContentReady ||
      this.data.contentError ||
      this.data.photoSignature !== photoSignature
    ) {
      void prewarmPhotoUrls(
        [...state.images, ...state.videos].map((photo) => photo.thumbnail),
      );
      this.setData({
        images: state.images,
        videos: state.videos,
        photoContentReady: true,
        photoSignature,
        contentError: result.state === 'unavailable',
      });
      this.refreshView();
    }
  },
  refreshView() {
    const visible =
      this.data.view === 'videos'
        ? this.data.videos
        : this.data.view === 'photos'
          ? this.data.images.filter(
              (photo) =>
                this.data.category === 'all' ||
                photo.category === this.data.category,
            )
          : [];
    this.setData({
      visiblePhotos: visible,
      columns: columns(visible),
      total: visible.length,
    });
  },
  openSection(event: WechatMiniprogram.TouchEvent) {
    const view = event.currentTarget.dataset.view;
    if (view !== 'photos' && view !== 'videos') return;
    this.setData({ view, category: 'all' });
    this.refreshView();
  },
  backToOverview() {
    this.setData({ view: 'overview' });
    this.refreshView();
  },
  selectCategory(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.category);
    if (!categories.some((entry) => entry.key === category)) return;
    this.setData({ category });
    this.refreshView();
  },
  retry() {
    void this.onShow();
  },
  preview(event: WechatMiniprogram.CustomEvent) {
    const index = this.data.visiblePhotos.findIndex(
      (photo) => photo.id === event.currentTarget.dataset.id,
    );
    void previewPhotos(this.data.visiblePhotos, index);
  },
});
