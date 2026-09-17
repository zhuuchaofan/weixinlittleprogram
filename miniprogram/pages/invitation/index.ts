import { uiCopy } from '../../config/ui-copy';
import { appConfig } from '../../services/content';
import { openVenueLocation } from '../../services/venue-location';

Page({
  data: { copy: uiCopy.invitation, appConfig },
  map() {
    openVenueLocation();
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
