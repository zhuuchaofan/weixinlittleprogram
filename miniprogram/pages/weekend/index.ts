import type { Wish } from '../../models';
import { requireHousehold } from '../../services/household';
import { wishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { markLoaded, needsReload } from '../../services/snapshot';

let loadVersion = 0;

Page({
  data: {
    wishes: [] as Wish[],
    loading: true,
    busy: false,
    error: '',
  },
  onShow() {
    if (!this.data.wishes.length)
      this.setData({ wishes: wishService.peek() || [] });
    if (needsReload('wishes')) void this.load();
  },
  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  async load(force = false) {
    const version = ++loadVersion;
    this.setData({ loading: true, error: '' });
    try {
      const household = await requireHousehold(force === true);
      if (!household) return;
      const wishes = await wishService.list();
      if (version !== loadVersion) return;
      this.setData({ wishes });
      markLoaded('wishes');
    } catch (error) {
      if (version === loadVersion) this.setData({ error: errorMessage(error) });
    } finally {
      if (version === loadVersion) this.setData({ loading: false });
    }
  },
  add() {
    wx.navigateTo({ url: '/pages/wish-edit/index' });
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/wish-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
});
