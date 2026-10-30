import type { Anniversary, Household } from '../../models';
import { peekHousehold, requireHousehold } from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { dateService } from '../../services/collections';
import { markLoaded, needsReload } from '../../services/snapshot';
import { applyTheme, themeData } from '../../services/theme';
import { togetherView, type TogetherRow } from '../../utils/together';

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
        ? `${item.years} 周年`
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
    together: null as TogetherRow | null,
    /** 已经加载过纪念日：没有「在一起」起点时才提示设置。 */
    datesReady: false,
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
    this.setData({
      next,
      dates: next ? rows.slice(1) : rows,
      together: togetherView(dates.find((item) => item.together)),
      datesReady: true,
    });
  },
  addDate() {
    wx.navigateTo({ url: '/pages/date-edit/index' });
  },
  setTogether() {
    wx.navigateTo({ url: '/pages/date-edit/index?together=1' });
  },
  /** 分享「在一起第 N 天」给 TA 或朋友。 */
  onShareAppMessage() {
    const day = this.data.together?.day;
    return {
      title: day ? `我们在一起第 ${day} 天` : '喵喵记一笔',
      path: '/pages/home/index',
    };
  },
  openDate(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/date-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
});
