import type {
  ActivityItem,
  Anniversary,
  Expense,
  FootprintPage,
  Goal,
  Household,
  LedgerMonth,
  Reaction,
  Todo,
} from '../../models';
import { inviteShare, peekHousehold } from '../../services/household';
import { peekMonth, reactExpense } from '../../services/ledger';
import { loadHome } from '../../services/home';
import {
  activityService,
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
import { LENGTHS, REACTIONS } from '../../config/options';
import { errorMessage } from '../../services/cloud';
import {
  feedRows,
  nudgesOf,
  partnerName,
  rememberSeen,
  type FeedRow,
  type Nudge,
} from '../../utils/home-feed';
import {
  dismissStartCard,
  freeHintOf,
  quickHintOf,
  rememberFreeHint,
  startDismissed,
  type FreeHint,
} from '../../utils/home-hints';

const loader = createLoader();
// 最近一次读到的本月账目和动态，「TA 最近」要两份合起来排。
let records_: Expense[] = [];
let activity_: ActivityItem[] = [];

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
    feed: [] as FeedRow[],
    /** 顶部气泡显示的第一条，和后面还有几条没看。 */
    nudge: null as Nudge | null,
    nudgeMore: 0,
    nudgeKeys: [] as string[],
    /** 限时免费快结束的提示，不用提示时为 null。 */
    freeHint: null as FreeHint | null,
    reactions: REACTIONS,
    limits: LENGTHS,
    /** 首屏一句话记账输入框里的字，和下面那行小字。 */
    /** 第一次来的引导卡片：这个月还没记账、也没点过「先不用」时显示。 */
    showStart: false,
    quickText: '',
    quickHint: '可以一句说好几笔',
    /** 最要紧的一个攒钱目标（没攒完、截止最早），没有时为 null。 */
    goal: null as GoalRow | null,
    /** 「我们的」里足迹那一行的小字。 */
    footprint: { text: '去过的地方，点这里补记' },
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
    this.setData({ household, freeHint: freeHintOf(household) });
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
        this.setData({ household, freeHint: freeHintOf(household) });
        return loadHome(todayKey().slice(0, 7));
      },
      show: ({ month, todos, dates, goals, recent, footprints }) => {
        this.showMonth(month);
        this.showTodos(todos);
        this.showDates(dates);
        if (goals) this.showGoals(goals);
        if (recent) this.showFeed(recent);
        if (footprints) this.showFootprints(footprints);
      },
    });
  },
  showMonth({ records, summary }: LedgerMonth) {
    // 和记账页一致：开了两人分摊看共同支出，没开看全部支出。
    const splitting = this.data.household?.splitting === true;
    const total = splitting ? summary.sharedTotal : summary.spending.total;
    records_ = records;
    this.setData({
      spentText: formatYuan(total),
      countText: records.length ? `记了 ${records.length} 笔` : '还没有记账',
      showStart: !records.length && !startDismissed(),
      quickHint: quickHintOf(records, this.data.household?.myRole || ''),
    });
    this.showFeed();
  },
  /** 「TA 最近」和顶部小气泡：做过的事加上这几天记的账。哪边先读到都能显示，后到的再补上。 */
  showFeed(items?: ActivityItem[]) {
    if (items) activity_ = items;
    const household = this.data.household;
    if (!household || household.members.length < 2) return;
    const partner = partnerName(household);
    const nudges = nudgesOf(activity_, records_, household.myRole, partner);
    this.setData({
      feed: feedRows(activity_, records_, household.myRole, partner),
      nudge: nudges[0] || null,
      nudgeMore: Math.max(0, nudges.length - 1),
      nudgeKeys: nudges.map((item) => item.key),
    });
  },
  /** 「收到啦」：这几条都算看过，气泡收起。 */
  dismissNudge() {
    rememberSeen(this.data.nudgeKeys);
    this.setData({ nudge: null, nudgeMore: 0, nudgeKeys: [] });
  },
  /** 「知道了」：这一阶段不再提示（最后两天会再提示一次）。 */
  dismissFreeHint() {
    const key = this.data.freeHint?.key;
    this.setData({ freeHint: null });
    if (key) rememberFreeHint(key);
  },
  openVip() {
    wx.navigateTo({ url: '/pages/vip/index' });
  },
  /** 点一个回应；再点同一个收回。 */
  async react(event: WechatMiniprogram.TouchEvent) {
    const { id, kind, reaction } = event.currentTarget.dataset as {
      id: string;
      kind: FeedRow['kind'];
      reaction: Reaction;
    };
    const row = this.data.feed.find((item) => item.id === id);
    if (!row) return;
    const next = row.mine === reaction ? '' : reaction;
    const index = this.data.feed.indexOf(row);
    this.setData({ [`feed[${index}].mine`]: next });
    try {
      if (kind === 'expense') {
        const saved = await reactExpense(id, next);
        records_ = records_.map((item) => (item.id === id ? saved : item));
      } else await activityService.react(id, next);
    } catch (error) {
      this.setData({ [`feed[${index}].mine`]: row.mine });
      wx.showToast({ title: errorMessage(error), icon: 'none' });
    }
  },
  showTodos(todos: Todo[]) {
    const today = todayKey();
    // 重复任务还没到日子的先不算。
    const open = todos.filter(
      (todo) => !todo.done && (!todo.dueOn || todo.dueOn <= today),
    );
    const mine = this.data.household?.myRole;
    // TA 指定给我的（不含「一起」和我自己加的）。
    const assigned = open.filter(
      (todo) => todo.who === mine && todo.byRole && todo.byRole !== mine,
    ).length;
    this.setData({
      todoText: open.length
        ? assigned
          ? `TA 派了 ${assigned} 件给你`
          : `${open.length} 件没做完`
        : '都做完了',
    });
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
  /** 「我们的」里足迹那一行：总个数和最近一个地方。 */
  showFootprints(page: FootprintPage) {
    const places = page.total.places;
    const latest = page.items[0];
    const together = (this.data.household?.members.length || 0) > 1;
    this.setData({
      'footprint.text': places
        ? `${together ? '一起去过' : '去过'} ${places} 个地方${latest ? ' · 最近：' + latest.title : ''}`
        : '去过的地方，点这里补记',
    });
  },
  showGoals(goals: Goal[]) {
    // 云端已按「没攒完的在前、截止早的在前」排好。
    this.setData({
      goal: goals[0] ? goalView(goals[0]) : null,
    });
  },
  open(event: WechatMiniprogram.TouchEvent) {
    // data-query：打开时带的参数，例如「我们的」里足迹是想去页的「去过」一栏。
    const { page, query } = event.currentTarget.dataset as {
      page: string;
      query?: string;
    };
    wx.navigateTo({ url: `/pages/${page}/index${query ? '?' + query : ''}` });
  },
  /** 引导卡片的「导入账单」：直接去选微信账单文件，点过就不再显示。 */
  startImport() {
    this.dismissStart();
    void chooseBillImport();
  },
  dismissStart() {
    this.setData({ showStart: false });
    dismissStartCard();
  },
  inputQuick(event: WechatMiniprogram.Input) {
    this.setData({ quickText: event.detail.value });
  },
  /** 首屏「记」：写了字就交给一句话记账去拆，没写就打开手动记一笔。 */
  quickAdd() {
    const text = this.data.quickText.trim();
    if (!text) {
      this.addExpense();
      return;
    }
    this.setData({ quickText: '' });
    wx.navigateTo({
      url: `/pages/quick-add/index?text=${encodeURIComponent(text)}`,
    });
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
