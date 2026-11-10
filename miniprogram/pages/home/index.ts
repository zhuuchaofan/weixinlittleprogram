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
import { LENGTHS, REACTIONS, REACTION_PHRASES } from '../../config/options';
import { errorMessage } from '../../services/cloud';
import { daysBetween } from '../../utils/date';

const loader = createLoader();
// 最近一次读到的本月账目和动态，「TA 最近」要两份合起来排。
let records_: Expense[] = [];
let activity_: ActivityItem[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

function partnerName(household: Household): string {
  return (
    household.members.find((member) => member.role !== household.myRole)
      ?.name || 'TA'
  );
}

const DONE_TEXT = { todo: '完成了', dish: '吃了', wish: '去过了' };

/** 主页顶部的小气泡：TA 回应了我做的事。key 用来记「已经看过」。 */
interface Nudge {
  key: string;
  text: string;
  sub: string;
}

const SEEN_KEY = 'seenNudges';
// 只记最近这么多条，够覆盖两周的动态。
const SEEN_KEPT = 60;

function seenNudges(): string[] {
  try {
    const value = wx.getStorageSync(SEEN_KEY);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function rememberSeen(keys: string[]): void {
  try {
    const all = [...new Set([...keys, ...seenNudges()])].slice(0, SEEN_KEPT);
    wx.setStorageSync(SEEN_KEY, all);
  } catch {
    // 记不住就下次再显示一次，不影响别的。
  }
}

/** 「TA 最近」和小气泡里只看这几天记的账；导入的账单一次几十笔，不算。 */
const FEED_EXPENSE_DAYS = 3;

function feedExpenses(records: Expense[]): Expense[] {
  const since = Date.now() - FEED_EXPENSE_DAYS * DAY_MS;
  return records.filter(
    (record) => record.byRole && !record.src && record.ts >= since,
  );
}

/** 一笔账在动态里的叫法：有备注用备注，没有用分类。 */
function expenseTitle(record: Expense): string {
  return record.note || record.cat;
}

/** TA 回应了我做的事或我记的账、我还没看过的，最近的在前。 */
function nudgesOf(
  items: ActivityItem[],
  records: Expense[],
  myRole: string,
  partner: string,
): Nudge[] {
  const seen = new Set(seenNudges());
  const other = myRole === 'a' ? 'b' : 'a';
  const found: Array<Nudge & { ts: number }> = [];
  for (const item of items) {
    if (item.byRole && item.byRole !== myRole) continue;
    const theirs = item.reactions[other];
    if (!theirs) continue;
    found.push({
      ts: item.ts,
      key: `${item.id}:${theirs}`,
      text: `${partner}${REACTION_PHRASES[theirs]}`,
      sub: `因为你${DONE_TEXT[item.type]}「${item.title}」`,
    });
  }
  for (const record of feedExpenses(records)) {
    if (record.byRole !== myRole) continue;
    const theirs = record.reactions?.[other];
    if (!theirs) continue;
    found.push({
      ts: record.ts,
      key: `${record.id}:${theirs}`,
      text: `${partner}${REACTION_PHRASES[theirs]}`,
      sub: `因为你记了「${expenseTitle(record)}」`,
    });
  }
  return found
    .filter((item) => !seen.has(item.key))
    .sort((a, b) => b.ts - a.ts)
    .map(({ key, text, sub }) => ({ key, text, sub }));
}

/** 主页「TA 最近」里的一行。 */
interface FeedRow {
  id: string;
  /** 做过的事（activity）还是一笔账（expense），回应时走不同的接口。 */
  kind: 'activity' | 'expense';
  /** 一句话：TA 做了什么。 */
  text: string;
  when: string;
  /** 对方做的事才能点回应。 */
  canReact: boolean;
  mine: Reaction | '';
}

function whenText(date: string): string {
  const days = daysBetween(date, todayKey());
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
}

/** 限时免费快结束时主页顶部的提示。key 用来记「已经点过知道了」。 */
interface FreeHint {
  key: string;
  text: string;
  sub: string;
}

// 晚上这个点之后，今天自己还一笔没记，就在输入框下面轻轻提一句。
const EVENING_HOUR = 18;

function quickHintOf(records: Expense[], myRole: string): string {
  const today = todayKey();
  const mine = records.some(
    (record) =>
      record.byRole === myRole &&
      (record.date === today || todayKey(record.ts) === today),
  );
  if (mine) return '今天记过啦，还有的话接着说';
  return new Date().getHours() >= EVENING_HOUR
    ? '今天的账还没记，说一句就好'
    : '可以一句说好几笔';
}

const START_KEY = 'startDismissed';

function startDismissed(): boolean {
  try {
    return Boolean(wx.getStorageSync(START_KEY));
  } catch {
    return false;
  }
}

const FREE_HINT_KEY = 'freeHintSeen';
// 结束前这么多天开始提示；最后两天（含当天）点过「知道了」也会再提示一次。
const FREE_HINT_DAYS = 7;
const FREE_HINT_LAST = 1;

/** 限免还剩 7 天以内、又没真正开通会员时给一句提示；不用提示返回 null。 */
function freeHintOf(household: Household): FreeHint | null {
  const { free, active } = household.vip || { free: 0, active: false };
  if (!free || active) return null;
  const end = todayKey(free);
  const left = daysBetween(todayKey(), end);
  if (left < 0 || left > FREE_HINT_DAYS) return null;
  const key = `${end}:${left <= FREE_HINT_LAST ? 'last' : 'week'}`;
  try {
    if (wx.getStorageSync(FREE_HINT_KEY) === key) return null;
  } catch {
    // 读不到就照常提示。
  }
  const day = `${Number(end.slice(5, 7))} 月 ${Number(end.slice(8))} 日`;
  return {
    key,
    text:
      left === 0
        ? '限时免费今天结束'
        : left === 1
          ? '限时免费明天结束'
          : `限时免费还有 ${left} 天`,
    sub: `${day}之后记账照常免费，喵喵 AI 的次数和照片张数会变少`,
  };
}

const FEED_SHOWN = 4;

/** 「TA 最近」：对方做的事和对方这几天记的账，混在一起按时间排，都可以回应。 */
function feedRows(
  items: ActivityItem[],
  records: Expense[],
  myRole: string,
  partner: string,
): FeedRow[] {
  const rows: Array<FeedRow & { ts: number }> = [];
  for (const item of items) {
    if (!item.byRole || item.byRole === myRole) continue;
    rows.push({
      ts: item.ts,
      id: item.id,
      kind: 'activity',
      text: `${partner}${DONE_TEXT[item.type]}「${item.title}」`,
      when: whenText(item.date),
      canReact: true,
      mine: item.reactions[myRole as 'a' | 'b'] || '',
    });
  }
  for (const record of feedExpenses(records)) {
    if (record.byRole === myRole) continue;
    rows.push({
      ts: record.ts,
      id: record.id,
      kind: 'expense',
      text: `${partner}记了「${expenseTitle(record)}」${record.flow === 'in' ? '收入 ' : ''}${formatYuan(record.amount)}`,
      when: whenText(record.date),
      canReact: true,
      mine: record.reactions?.[myRole as 'a' | 'b'] || '',
    });
  }
  return rows
    .sort((a, b) => b.ts - a.ts)
    .slice(0, FEED_SHOWN)
    .map((row): FeedRow => {
      const { id, kind, text, when, canReact, mine } = row;
      return { id, kind, text, when, canReact, mine };
    });
}

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
    try {
      if (key) wx.setStorageSync(FREE_HINT_KEY, key);
    } catch {
      // 记不住就下次再提示一次，不影响别的。
    }
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
    try {
      wx.setStorageSync(START_KEY, 1);
    } catch {
      // 记不住就下次再显示一次，不影响别的。
    }
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
