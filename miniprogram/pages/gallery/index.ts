import {
  getPublishedMediaLibrary,
  initialMediaLibrary,
  photoArrangementSignature,
} from '../../services/photos';
import { uiCopy } from '../../config/ui-copy';
import { appConfig } from '../../services/content';
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

function galleryPhotoState(photos: Photo[] | null) {
  const items = photos || initialMediaLibrary();
  return {
    images: items.filter((photo) => photo.type !== 'video'),
    videos: items.filter((photo) => photo.type === 'video'),
  };
}

const categories = [
  { key: 'wedding', label: '婚纱照' },
  { key: 'daily', label: '日常照' },
  { key: 'baoji_0927', label: '927 宝鸡答谢宴' },
  { key: 'lintong_0928', label: '928 临潼答谢宴' },
];
const directoryEntries = [
  ...categories.map((item, index) => ({
    ...item,
    view: 'photos',
    category: item.key,
    indexLabel: `0${index + 1} / ALBUM`,
    unit: '张照片',
  })),
  {
    key: 'videos',
    label: '视频',
    view: 'videos',
    category: 'all',
    indexLabel: '05 / FILMS',
    unit: '段影像',
  },
  {
    key: 'all',
    label: '全部照片',
    view: 'photos',
    category: 'all',
    indexLabel: '06 / ALL',
    unit: '张照片',
  },
];

function sectionTitle(view: string, category: string): string {
  return view === 'videos'
    ? '视频'
    : category === 'all'
      ? '全部照片'
      : categories.find((item) => item.key === category)?.label || '全部照片';
}

Page({
  data: {
    copy: uiCopy.gallery,
    appConfig,
    view: 'overview' as 'overview' | 'photos' | 'videos',
    category: 'all',
    sectionTitle: '全部照片',
    directoryCards: directoryEntries.map((item) => ({ ...item, count: 0 })),
    images: [] as Photo[],
    videos: [] as Photo[],
    visiblePhotos: [] as Photo[],
    columns: columns([]),
    total: 0,
    contentError: false,
    photoContentReady: false,
    photoSignature: '',
  },
  onLoad(options: Record<string, string | undefined> = {}) {
    if (options.view === 'videos') {
      this.setData({ view: 'videos', sectionTitle: '视频' });
      return;
    }
    const category = options.category;
    if (
      category &&
      (category === 'all' || categories.some((item) => item.key === category))
    )
      this.setData({
        view: 'photos',
        category,
        sectionTitle: sectionTitle('photos', category),
      });
  },
  async onShow() {
    const refreshVersion = ++galleryRefreshVersion;
    const result = await getPublishedMediaLibrary();
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
        directoryCards: directoryEntries.map((item) => ({
          ...item,
          count:
            item.view === 'videos'
              ? state.videos.length
              : item.category === 'all'
                ? state.images.length
                : state.images.filter(
                    (photo) => photo.category === item.category,
                  ).length,
        })),
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
    const category = String(event.currentTarget.dataset.category || 'all');
    if (
      view === 'photos' &&
      category !== 'all' &&
      !categories.some((item) => item.key === category)
    )
      return;
    this.setData({
      view,
      category,
      sectionTitle: sectionTitle(view, category),
    });
    this.refreshView();
  },
  backToOverview() {
    this.setData({ view: 'overview' });
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
