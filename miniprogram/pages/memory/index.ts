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
    if (needsReload('memory')) void this.load();
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
});
