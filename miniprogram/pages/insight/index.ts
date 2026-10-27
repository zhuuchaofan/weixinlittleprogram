import type { InsightSummary, MonthInsight } from '../../models';
import { getInsight, writeSummary } from '../../services/insight';
import { ApiError, errorMessage } from '../../services/cloud';
import { createLoader } from '../../services/page-load';
import { categoryLook } from '../../config/options';
import { monthLabel, shiftMonth, shortDate, todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';
import { formatTimestamp } from '../../utils/date';
import { applyTheme, themeData } from '../../services/theme';

/**
 * 和上月比：多了、少了、持平；上月这类没有时写「新增」。
 * 上月整月都没记账（刚开始用或没记）时不比，什么都不写。
 */
function change(
  amount: number,
  prev: number,
  compare: boolean,
): { text: string; tone: string } {
  if (!compare) return { text: '', tone: '' };
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

function summaryView(summary: InsightSummary | null) {
  return {
    summaryText: summary?.text || '',
    summaryTs: summary?.ts || 0,
    summaryNote: summary
      ? summary.stale
        ? '生成之后这个月的账有变动，可以重新生成'
        : `${formatTimestamp(summary.ts)} 生成`
      : '',
  };
}

function view(insight: MonthInsight) {
  const top = Math.max(1, ...insight.byCategory.map((row) => row.amount));
  const peak = Math.max(1, ...insight.trend.map((row) => row.total));
  return {
    ...summaryView(insight.summary),
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
      ...change(row.amount, row.prev, insight.prevTotal > 0),
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// 小结写得慢时，小程序这头可能先断开，云端其实还在写、写完也会存下来。
// 断开后每隔几秒取一次，取到新的就当成功。
const RECOVER_TRIES = 8;
const RECOVER_GAP_MS = 4000;

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
      summary: null,
    }),
    writing: false,
    summaryError: '',
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
        this.setData({
          ...view(insight),
          count: insight.count,
          ready: true,
          // 取到了新的小结，之前那次的报错就不用再显示了。
          ...(insight.summary && insight.summary.ts !== this.data.summaryTs
            ? { summaryError: '' }
            : {}),
        }),
    });
  },
  changeMonth(event: WechatMiniprogram.TouchEvent) {
    const delta = Number(event.currentTarget.dataset.delta);
    if (delta > 0 && this.data.isCurrentMonth) return;
    this.setMonth(shiftMonth(this.data.month, delta));
    this.setData({ ready: false, summaryText: '', summaryError: '' });
    void this.load();
  },
  async writeSummary() {
    if (this.data.writing) return;
    const month = this.data.month;
    const before = this.data.summaryTs;
    this.setData({ writing: true, summaryError: '' });
    try {
      const summary = await writeSummary(month);
      this.setData(summaryView(summary));
    } catch (error) {
      const summary =
        error instanceof ApiError && error.code === 'NETWORK'
          ? await this.recoverSummary(month, before)
          : null;
      if (this.data.month !== month) return;
      this.setData(
        summary ? summaryView(summary) : { summaryError: errorMessage(error) },
      );
    } finally {
      this.setData({ writing: false });
    }
  },
  /** 断开之后看云端有没有写完：有比 before 新的小结就返回它。 */
  async recoverSummary(month: string, before: number) {
    for (let i = 0; i < RECOVER_TRIES; i++) {
      if (this.data.month !== month) return null;
      try {
        const { summary } = await getInsight(month);
        if (summary && summary.ts !== before) return summary;
      } catch {
        // 这次也没连上，等一会再取
      }
      await wait(RECOVER_GAP_MS);
    }
    return null;
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/expense-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
});
