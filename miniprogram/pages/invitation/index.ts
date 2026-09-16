import { uiCopy } from '../../config/ui-copy';
import { appConfig } from '../../services/content';
Page({
  data: { copy: uiCopy.invitation, appConfig },
  map() {
    const point = appConfig.location;
    if (
      !appConfig.confirmed ||
      !point ||
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude) ||
      Math.abs(point.latitude) > 90 ||
      Math.abs(point.longitude) > 180
    ) {
      wx.showToast({ title: uiCopy.invitation.text11, icon: 'none' });
      return;
    }
    wx.openLocation({
      ...point,
      name: appConfig.venue,
      address: appConfig.address,
      scale: 16,
      fail: () =>
        wx.showToast({ title: uiCopy.invitation.text12, icon: 'none' }),
    });
  },
  copy() {
    wx.setClipboardData({
      data: `${appConfig.venue} ${appConfig.hall} ${appConfig.address}`,
      fail: () =>
        wx.showToast({ title: uiCopy.invitation.text13, icon: 'none' }),
    });
  },
  onShareAppMessage() {
    return {
      title: `${appConfig.brand} · ${uiCopy.invitation.shareTitle}`,
      path: '/pages/invitation/index',
    };
  },
});
