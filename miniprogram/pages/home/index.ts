import { getPublishedPhotos } from '../../services/photos';
import { uiCopy } from '../../config/ui-copy';
import {
  appConfig,
  coverPhoto,
  navigation,
  catPhotos,
} from '../../services/content';
import { isMock } from '../../services/rsvp';
import { previewPhotos } from '../../utils/preview';
Page({
  data: {
    copy: uiCopy.home,
    appConfig,
    coverPhoto,
    catPhotos,
    navigation,
    isMock,
    reduceMotion: true,
    catVisible: false,
  },
  async onShow() {
    this.setData({
      reduceMotion: wx.getStorageSync('two-cats:motion') !== 'on',
    });
    const photos = await getPublishedPhotos();
    if (photos !== null)
      this.setData({
        coverPhoto: photos.find((p) => p.slot === 'cover') || {
          ...coverPhoto,
          thumbnail: '',
          original: '',
          placeholder: true,
        },
        catPhotos: photos.filter(
          (p) => p.slot === 'qiuqiu' || p.slot === 'buding',
        ),
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
