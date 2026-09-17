import { appConfig } from '../config/content';
import { uiCopy } from '../config/ui-copy';

export function openVenueLocation(): void {
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
    fail: () => wx.showToast({ title: uiCopy.invitation.text12, icon: 'none' }),
  });
}
