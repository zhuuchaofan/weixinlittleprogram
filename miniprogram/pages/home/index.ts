import type { Photo } from '../../models';
import {
  getPublishedPhotos,
  photoArrangementSignature,
} from '../../services/photos';
import { uiCopy } from '../../config/ui-copy';
import {
  appConfig,
  coverPhoto,
  navigation,
  catPhotos,
} from '../../services/content';
import { isMock } from '../../services/rsvp';
import { previewPhotos } from '../../utils/preview';

let homeRefreshVersion = 0;

function createCatColumns(
  photos: Photo[],
): Array<{ id: string; photos: Photo[] }> {
  const columns = [
    { id: 'cat-column-0', photos: [] as Photo[] },
    { id: 'cat-column-1', photos: [] as Photo[] },
  ];
  photos.forEach((photo, index) =>
    columns[index % columns.length].photos.push(photo),
  );
  return columns;
}

function homePhotoState(photos: Array<Photo & { slot?: string }> | null) {
  if (!photos) return { cover: coverPhoto, cats: catPhotos };
  return {
    cover: photos.find((photo) => photo.slot === 'cover') || {
      ...coverPhoto,
      thumbnail: '',
      original: '',
      placeholder: true,
    },
    cats: catPhotos.flatMap<Photo>((cat) => {
      const published = photos.filter((photo) => photo.slot === cat.id);
      return published.length
        ? published
        : [{ ...cat, thumbnail: '', original: '', placeholder: true }];
    }),
  };
}

Page({
  data: {
    copy: uiCopy.home,
    appConfig,
    coverPhoto,
    catPhotos,
    catColumns: createCatColumns(catPhotos),
    navigation,
    isMock,
    reduceMotion: true,
    catVisible: false,
    photoContentReady: false,
    photoSignature: '',
  },
  async onShow() {
    const reduceMotion = wx.getStorageSync('two-cats:motion') !== 'on';
    if (this.data.reduceMotion !== reduceMotion) this.setData({ reduceMotion });
    const refreshVersion = ++homeRefreshVersion;
    const result = await getPublishedPhotos();
    if (refreshVersion !== homeRefreshVersion) return;

    if (result.state === 'unavailable' && this.data.photoContentReady) return;
    const state = homePhotoState(
      result.state === 'published' ? result.photos : null,
    );
    const photoSignature = photoArrangementSignature([
      state.cover,
      ...state.cats,
    ]);
    if (
      !this.data.photoContentReady ||
      this.data.photoSignature !== photoSignature
    )
      this.setData({
        coverPhoto: state.cover,
        catPhotos: state.cats,
        catColumns: createCatColumns(state.cats),
        photoContentReady: true,
        photoSignature,
      });
  },
  preview() {
    previewPhotos([this.data.coverPhoto], 0);
  },
  previewCat(event: WechatMiniprogram.CustomEvent) {
    const selected = this.data.catPhotos.find(
      (photo) => photo.id === event.currentTarget.dataset.id,
    );
    const available = this.data.catPhotos.filter(
      (photo) => !photo.placeholder && !!(photo.original || photo.thumbnail),
    );
    if (!selected || !available.includes(selected)) return;
    void previewPhotos(available, available.indexOf(selected));
  },
  enter() {
    wx.navigateTo({ url: '/pages/gallery/index' });
  },
  cat() {
    this.setData({ catVisible: !this.data.catVisible });
  },
  onShareAppMessage() {
    return { title: appConfig.brand, path: '/pages/home/index' };
  },
});
