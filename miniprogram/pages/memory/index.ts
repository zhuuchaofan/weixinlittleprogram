import type { Anniversary, Household } from '../../models';
import { requireHousehold } from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { dateService } from '../../services/collections';
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
      const dates = await dateService.list();
      this.setData({
        datesError: '',
        dates: dates.map((item) => ({
          ...item,
          dateText: shortDate(item.nextDate),
        })),
      });
    } catch (error) {
      this.setData({ datesError: errorMessage(error) });
    }
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
