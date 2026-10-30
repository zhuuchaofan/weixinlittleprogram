import type {
  Anniversary,
  Goal,
  Household,
  LedgerMonth,
  Todo,
} from '../../models';
import { inviteShare, peekHousehold } from '../../services/household';
import { listMonth, peekMonth } from '../../services/ledger';
import {
  dateService,
  goalService,
  todoService,
} from '../../services/collections';
import { goalView, type GoalRow } from '../../utils/goal';
import { chooseBillImport } from '../../services/bills';
import { needsReload } from '../../services/snapshot';
import { createLoader } from '../../services/page-load';
import { todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';
import { applyTheme, themeData } from '../../services/theme';
import { togetherView, type TogetherRow } from '../../utils/together';

const loader = createLoader();

/** 主页：一进来就是本月花了多少、下一个纪念日，各功能从这里点进去。 */
Page({
  data: {
    ...themeData(),
    loading: true,
    error: '',
    household: null as Household | null,
    next: null as Anniversary | null,
    nextHint: '',
    together: null as TogetherRow | null,
    monthText: `${Number(todayKey().slice(5, 7))}月`,
    spentText: '',
    countText: '',
    todoText: '',
    /** 最要紧的一个攒钱目标（没攒完、截止最早），没有时为 null。 */
    goal: null as GoalRow | null,
    goalsReady: false,
  },
  onShow() {
    applyTheme(this);
    if (!this.data.household) this.showSnapshot();
    // 还在等对方加入时每次都读，邀请码和成员才能及时更新。
    if (needsReload('home') || this.data.household?.inviteCode)
      void this.load();
  },
  /** 冷启动：先显示上次存在本机的内容，云端读完再替换。 */
  showSnapshot() {
    const household = peekHousehold();
    if (!household) return;
    this.setData({ household });
    const month = peekMonth(todayKey().slice(0, 7));
    if (month) this.showMonth(month);
    const todos = todoService.peek();
    if (todos) this.showTodos(todos);
    const dates = dateService.peek();
    if (dates) this.showDates(dates);
    const goals = goalService.peek();
    if (goals) this.showGoals(goals);
  },
  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  load(force = false) {
    return loader(this, {
      key: 'home',
      force,
      fetch: (household) => {
        this.setData({ household });
        return Promise.all([
          listMonth(todayKey().slice(0, 7)),
          todoService.list(),
          dateService.list(),
          // 攒钱读不到（如 api 还没部署新版）时主页其他部分照常显示。
          goalService.list().catch(() => null),
        ]);
      },
      show: ([month, todos, dates, goals]) => {
        this.showMonth(month);
        this.showTodos(todos);
        this.showDates(dates);
        if (goals) this.showGoals(goals);
      },
    });
  },
  showMonth({ records, summary }: LedgerMonth) {
    // 和记账页一致：开了两人分摊看共同支出，没开看全部支出。
    const splitting = this.data.household?.splitting === true;
    const total = splitting ? summary.sharedTotal : summary.spending.total;
    this.setData({
      spentText: formatYuan(total),
      countText: records.length ? `记了 ${records.length} 笔` : '还没有记账',
    });
  },
  showTodos(todos: Todo[]) {
    const open = todos.filter((todo) => !todo.done).length;
    this.setData({ todoText: open ? `${open} 件没做完` : '都做完了' });
  },
  showDates(dates: Anniversary[]) {
    // 云端已按「未过的在前、天数从近到远」排好，第一个就是下一个纪念日。
    const next = dates[0] && !dates[0].passed ? dates[0] : null;
    this.setData({
      next,
      // 在一起第 N 天占了右边大数字后，近一个月内的纪念日改成一行小字。
      nextHint:
        next && next.days <= 30
          ? next.days === 0
            ? `今天是${next.title}`
            : `${next.title}还有 ${next.days} 天`
          : '',
      together: togetherView(dates.find((item) => item.together)),
    });
  },
  showGoals(goals: Goal[]) {
    // 云端已按「没攒完的在前、截止早的在前」排好。
    this.setData({
      goal: goals[0] ? goalView(goals[0]) : null,
      goalsReady: true,
    });
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/${event.currentTarget.dataset.page}/index` });
  },
  addExpense() {
    wx.navigateTo({ url: '/pages/expense-edit/index' });
  },
  importBill() {
    void chooseBillImport();
  },
  /** 微信卡片邀请：对方点开直接进加入页，邀请码已填好。 */
  onShareAppMessage() {
    const code = this.data.household?.inviteCode;
    const day = this.data.together?.day;
    // 已经两个人了，分享出去的是「在一起第 N 天」，不再是邀请。
    if (!code && day)
      return { title: `我们在一起第 ${day} 天`, path: '/pages/home/index' };
    return inviteShare(code);
  },
  copyCode() {
    const code = this.data.household?.inviteCode;
    if (code) wx.setClipboardData({ data: code });
  },
});
