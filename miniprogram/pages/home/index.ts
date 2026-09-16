import { uiCopy } from '../../config/ui-copy';
import { appConfig, coverPhoto, navigation } from '../../services/content';
import { isMock } from '../../services/rsvp';
import { previewPhotos } from '../../utils/preview';
Page({
  data: {
    copy: uiCopy.home,
    appConfig,
    coverPhoto,
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
