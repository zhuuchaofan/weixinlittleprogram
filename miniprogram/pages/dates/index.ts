import type { Anniversary, Household } from '../../models';
import { peekHousehold, requireHousehold } from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { dateService } from '../../services/collections';
import { markLoaded, needsReload } from '../../services/snapshot';
import { applyTheme, themeData } from '../../services/theme';

type Row = Anniversary & { dateText: string; yearText: string };

/** 每年重复的显示下一次的月.日，一次性的显示完整日期。 */
function toRow(item: Anniversary): Row {
  const dotted = item.nextDate.replace(/-/g, '.');
  return {
    ...item,
    dateText: item.yearly ? dotted.slice(5) : dotted,
    yearText: !item.yearly
      ? ''
      : item.years > 0
        ? `第 ${item.years} 年`
        : '每年',
  };
}

Page({
  data: {
    ...themeData(),
    loading: true,
    error: '',
    household: null as Household | null,
    // 最近的一个（还没过的）放在顶部大卡片，其余在列表里。
    next: null as Row | null,
    dates: [] as Row[],
    datesError: '',
  },
  onShow() {
    applyTheme(this);
    if (!this.data.household) {
      const household = peekHousehold();
      const dates = dateService.peek();
      if (household) this.setData({ household });
      if (dates) this.showDates(dates);
    }
    if (needsReload('dates')) void this.load();
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
      markLoaded('dates');
    } catch (error) {
      this.setData({ datesError: errorMessage(error) });
    }
  },
  showDates(dates: Anniversary[]) {
    // 云端已按「未过的在前、天数从近到远」排好。
    const rows = dates.map(toRow);
    const next = rows[0] && !rows[0].passed ? rows[0] : null;
    this.setData({ next, dates: next ? rows.slice(1) : rows });
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
