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
    })),
    mealsText: meals.count ? `一起吃了 ${meals.count} 顿「就吃这个」` : '',
    mealsTop: meals.top
      ? `吃得最多的是${meals.top.title}，${meals.top.count} 次`
      : '',
    todosText: todos.count ? `做完了 ${todos.count} 件待办` : '',
    todosSplit: todos.count
      ? split(todos.byRole, names, pair, (n) => `${n} 件`)
      : '',
    wishes: recap.wishes,
    savedText: saved.total ? `一起攒了 ${formatYuan(saved.total)}` : '',
    savedSplit: saved.total
      ? split(saved.byRole, names, pair, (n) => formatYuan(n))
      : '',
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
    top: [] as Array<{ cat: string; color: string; amountText: string }>,
    mealsText: '',
    mealsTop: '',
    todosText: '',
    todosSplit: '',
    wishes: [] as string[],
    savedText: '',
    savedSplit: '',
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
