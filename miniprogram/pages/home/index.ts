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
  onShow() {
    this.setData({
      reduceMotion: wx.getStorageSync('two-cats:motion') !== 'on',
    });
  },
  preview() {
    previewPhotos([coverPhoto], 0);
  },
  previewCat(event: WechatMiniprogram.CustomEvent) {
    const selected = catPhotos.find(
      (photo) => photo.id === event.currentTarget.dataset.id,
    );
    const available = catPhotos.filter(
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
