import type { Anniversary, Household } from '../../models';
import { peekHousehold, requireHousehold } from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { dateService } from '../../services/collections';
import { markLoaded, needsReload } from '../../services/snapshot';
import { shortDate } from '../../utils/date';

Page({
  data: {
    loading: true,
    error: '',
    household: null as Household | null,
    dates: [] as Array<Anniversary & { dateText: string }>,
    datesError: '',
  },
  onShow() {
    if (!this.data.household) {
      const household = peekHousehold();
      const dates = dateService.peek();
      if (household) this.setData({ household });
      if (dates) this.showDates(dates);
    }
    // 还在等对方加入时每次都读，邀请码和成员才能及时更新。
    if (needsReload('memory') || this.data.household?.inviteCode)
      void this.load();
  },
  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  async load(force = false) {
    this.setData({ loading: true, error: '' });
    try {
      const household = await requireHousehold(force === true);
      if (household) {
        this.setData({ household });
        await this.loadDates();
      }
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  async loadDates() {
    try {
      this.showDates(await dateService.list());
      this.setData({ datesError: '' });
      markLoaded('memory');
    } catch (error) {
      this.setData({ datesError: errorMessage(error) });
    }
  },
  showDates(dates: Anniversary[]) {
    this.setData({
      dates: dates.map((item) => ({
        ...item,
        dateText: shortDate(item.nextDate),
      })),
    });
  },
  addDate() {
    wx.navigateTo({ url: '/pages/date-edit/index' });
  },
  openDate(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/date-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },
  copyCode() {
    const code = this.data.household?.inviteCode;
    if (code) wx.setClipboardData({ data: code });
  },
});
