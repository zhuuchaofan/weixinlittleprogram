import type { MonthInsight } from '../../models';
import { getInsight } from '../../services/insight';
import { createLoader } from '../../services/page-load';
import { categoryLook } from '../../config/options';
import { monthLabel, shiftMonth, shortDate, todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';
import { applyTheme, themeData } from '../../services/theme';

/** 和上月比：多了、少了、持平；上月没有时写「新增」。 */
function change(amount: number, prev: number): { text: string; tone: string } {
  const diff = amount - prev;
  if (!prev && amount) return { text: '新增', tone: 'up' };
  if (!diff) return { text: '持平', tone: '' };
  return diff > 0
    ? { text: `▲ ${formatYuan(diff)}`, tone: 'up' }
    : { text: `▼ ${formatYuan(-diff)}`, tone: 'down' };
}

/** 总额一行：比上月多/少多少、百分之几。上月没有记账时不比。 */
function totalChange(total: number, prev: number): string {
  if (!prev) return '上个月没有记账，下个月起可以对比';
  const diff = total - prev;
  if (!diff) return '和上个月一样';
  const percent = Math.round((Math.abs(diff) * 100) / prev);
  return `比上个月${diff > 0 ? '多' : '少'} ${formatYuan(Math.abs(diff))}（${percent}%）`;
}

function view(insight: MonthInsight) {
  const top = Math.max(1, ...insight.byCategory.map((row) => row.amount));
  const peak = Math.max(1, ...insight.trend.map((row) => row.total));
  return {
    totalText: formatYuan(insight.total),
    changeText: totalChange(insight.total, insight.prevTotal),
    incomeText: insight.income ? formatYuan(insight.income) : '',
    categories: insight.byCategory.map((row) => ({
      cat: row.cat,
      color: categoryLook(row.cat).color,
      amountText: formatYuan(row.amount),
      prevText: formatYuan(row.prev),
      countText: row.count ? `${row.count} 笔` : '',
      width: row.amount ? Math.max(2, Math.round((row.amount * 100) / top)) : 0,
      ...change(row.amount, row.prev),
    })),
    big: insight.big.map((row) => ({
      ...row,
      title: row.note || row.cat,
      sub: `${shortDate(row.date)} · ${row.cat}`,
      amountText: formatYuan(row.amount),
      icon: categoryLook(row.cat).icon,
      tint: categoryLook(row.cat).tint,
    })),
    trend: insight.trend.map((row) => ({
      month: row.month,
      label: `${Number(row.month.slice(5))}月`,
      // 柱子上只写整数元，6 列挤得下。
      totalText: row.total ? String(Math.round(row.total / 100)) : '',
      height: row.total ? Math.max(4, Math.round((row.total * 100) / peak)) : 0,
      current: row.month === insight.month,
    })),
  };
}

const loader = createLoader();

Page({
  data: {
    ...themeData(),
    month: todayKey().slice(0, 7),
    monthText: monthLabel(todayKey().slice(0, 7)),
    isCurrentMonth: true,
    loading: true,
    error: '',
    ready: false,
    count: 0,
    ...view({
      month: '',
      prevMonth: '',
      total: 0,
      prevTotal: 0,
      count: 0,
      income: 0,
      byCategory: [],
      big: [],
      trend: [],
    }),
  },
  onLoad(query: Record<string, string | undefined>) {
    const month = /^\d{4}-\d{2}$/.test(query.month || '')
      ? (query.month as string)
      : this.data.month;
    this.setMonth(month);
  },
  onShow() {
    applyTheme(this);
    void this.load();
  },
  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  setMonth(month: string) {
    this.setData({
      month,
      monthText: monthLabel(month),
      isCurrentMonth: month >= todayKey().slice(0, 7),
    });
  },
  load(force = false) {
    const month = this.data.month;
    return loader(this, {
      key: `insight:${month}`,
      force,
      fetch: () => getInsight(month),
      show: (insight) =>
        this.setData({ ...view(insight), count: insight.count, ready: true }),
    });
  },
  changeMonth(event: WechatMiniprogram.TouchEvent) {
    const delta = Number(event.currentTarget.dataset.delta);
    if (delta > 0 && this.data.isCurrentMonth) return;
    this.setMonth(shiftMonth(this.data.month, delta));
    this.setData({ ready: false });
    void this.load();
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/expense-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
});
