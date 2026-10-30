import type { Household, MonthRecap } from '../../models';
import { getRecap } from '../../services/recap';
import { memberNames } from '../../services/household';
import { createLoader } from '../../services/page-load';
import { categoryLook } from '../../config/options';
import { monthLabel, shiftMonth, todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';
import { applyTheme, themeData } from '../../services/theme';

const loader = createLoader();
const thisMonth = () => todayKey().slice(0, 7);

/** 「A 3 · B 2」：只有一个人在做时不拆。 */
function split(
  values: { a: number; b: number },
  names: { a: string; b: string },
  pair: boolean,
  show: (value: number) => string,
): string {
  return pair
    ? `${names.a} ${show(values.a)} · ${names.b} ${show(values.b)}`
    : '';
}

function view(recap: MonthRecap, household: Household) {
  const pair = household.members.length > 1;
  const names = memberNames(household);
  const { spend, meals, todos, saved } = recap;
  const diff = spend.prevTotal === null ? null : spend.total - spend.prevTotal;
  return {
    totalText: formatYuan(spend.total),
    changeText:
      diff === null
        ? ''
        : diff === 0
          ? '和上个月一样'
          : `比上个月${diff > 0 ? '多' : '少'} ${formatYuan(Math.abs(diff))}`,
    countText: spend.count
      ? `记了 ${spend.count} 笔${pair ? '：' + split(spend.byRole, names, pair, (n) => `${n} 笔`) : ''}`
      : '这个月还没有记账',
    togetherText: recap.togetherDay ? `在一起第 ${recap.togetherDay} 天` : '',
    top: spend.top.map((row) => ({
      cat: row.cat,
      color: categoryLook(row.cat).color,
      amountText: formatYuan(row.amount),
      percent: Math.max(4, Math.round((row.amount * 100) / spend.total)),
    })),
    weeks: spend.total
      ? spend.weeks.map((week, index) => {
          const max = Math.max(...spend.weeks.map((item) => item.amount));
          const end = spend.weeks[index + 1]
            ? spend.weeks[index + 1].from - 1
            : 31;
          return {
            label:
              week.from === end
                ? `${week.from} 日`
                : `${week.from}–${index === spend.weeks.length - 1 ? '月底' : end + ' 日'}`,
            amountText: week.amount ? formatYuan(week.amount) : '—',
            percent: week.amount
              ? Math.max(4, Math.round((week.amount * 100) / max))
              : 0,
          };
        })
      : [],
    facts: spend.count
      ? [
          { label: '平均每天', value: formatYuan(spend.perDay) },
          {
            label: '没花钱的日子',
            value: spend.freeDays ? `${spend.freeDays} 天` : '天天都有花销',
          },
          ...(spend.peakDay
            ? [
                {
                  label: '花得最多的一天',
                  value: `${Number(recap.month.slice(5))} 月 ${spend.peakDay.day} 日 · ${formatYuan(spend.peakDay.amount)}`,
                },
              ]
            : []),
          ...(spend.biggest
            ? [
                {
                  label: '最大的一笔',
                  value: `${spend.biggest.note || spend.biggest.cat} · ${formatYuan(spend.biggest.amount)}`,
                },
              ]
            : []),
        ]
      : [],
    // 一起做的事：四行都在，没有的写一句轻轻的提示。
    together: [
      {
        label: '一起吃',
        text: meals.count
          ? `${meals.count} 顿「就吃这个」${meals.top ? `，最多的是${meals.top.title}` : ''}`
          : '这个月还没有「就吃这个」',
        on: meals.count > 0,
      },
      {
        label: '一起做',
        text: todos.count
          ? `做完 ${todos.count} 件待办${split(todos.byRole, names, pair, (n) => `${n} 件`) ? '：' + split(todos.byRole, names, pair, (n) => `${n} 件`) : ''}`
          : '这个月还没有做完的待办',
        on: todos.count > 0,
      },
      {
        label: '去过',
        text: recap.wishes.length
          ? recap.wishes.join('、')
          : '这个月还没去哪儿',
        on: recap.wishes.length > 0,
      },
      {
        label: '一起攒',
        text: saved.total
          ? `攒了 ${formatYuan(saved.total)}${split(saved.byRole, names, pair, (n) => formatYuan(n)) ? '：' + split(saved.byRole, names, pair, (n) => formatYuan(n)) : ''}`
          : '这个月还没存钱',
        on: saved.total > 0,
      },
    ],
    quiet:
      !spend.count &&
      !meals.count &&
      !todos.count &&
      !recap.wishes.length &&
      !saved.total,
  };
}

Page({
  data: {
    ...themeData(),
    // 默认看上个月：月初来看最合适，本月也可以翻到。
    month: shiftMonth(thisMonth(), -1),
    monthText: monthLabel(shiftMonth(thisMonth(), -1)),
    isCurrentMonth: false,
    loading: true,
    error: '',
    ready: false,
    totalText: '',
    changeText: '',
    countText: '',
    togetherText: '',
    top: [] as Array<{
      cat: string;
      color: string;
      amountText: string;
      percent: number;
    }>,
    weeks: [] as Array<{ label: string; amountText: string; percent: number }>,
    facts: [] as Array<{ label: string; value: string }>,
    together: [] as Array<{ label: string; text: string; on: boolean }>,
    quiet: false,
  },
  onShow() {
    applyTheme(this);
    if (!this.data.ready) void this.load();
  },
  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  load(force = false) {
    return loader(this, {
      key: 'recap',
      force,
      fetch: () => getRecap(this.data.month),
      show: (recap, household) =>
        this.setData({ ...view(recap, household), ready: true }),
    });
  },
  changeMonth(event: WechatMiniprogram.TouchEvent) {
    const month = shiftMonth(
      this.data.month,
      Number(event.currentTarget.dataset.delta),
    );
    if (month > thisMonth()) return;
    this.setData({
      month,
      monthText: monthLabel(month),
      isCurrentMonth: month === thisMonth(),
      ready: false,
    });
    void this.load();
  },
  onShareAppMessage() {
    return {
      title: `我们 ${Number(this.data.month.slice(5))} 月的小报`,
      path: '/pages/home/index',
    };
  },
});
