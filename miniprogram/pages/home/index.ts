import type {
  ActivityItem,
  Anniversary,
  FootprintPage,
  Goal,
  Household,
  LedgerMonth,
  Reaction,
  Todo,
} from '../../models';
import { inviteShare, peekHousehold } from '../../services/household';
import { peekMonth } from '../../services/ledger';
import { loadHome } from '../../services/home';
import {
  activityService,
  dateService,
  goalService,
  todoService,
} from '../../services/collections';
import { goalView, type GoalRow } from '../../utils/goal';
import { chooseBillImport } from '../../services/bills';
import { photoUrls } from '../../services/photos';
import { needsReload } from '../../services/snapshot';
import { createLoader } from '../../services/page-load';
import { todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';
import { applyTheme, themeData } from '../../services/theme';
import { togetherView, type TogetherRow } from '../../utils/together';
import { REACTIONS, REACTION_PHRASES } from '../../config/options';
import { errorMessage } from '../../services/cloud';
import { daysBetween } from '../../utils/date';

const loader = createLoader();
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

/** TA 回应了我做的事、我还没看过的，最近的在前。 */
function nudgesOf(
  items: ActivityItem[],
  myRole: string,
  partner: string,
): Nudge[] {
  const seen = new Set(seenNudges());
  const result: Nudge[] = [];
  for (const item of items) {
    if (item.byRole && item.byRole !== myRole) continue;
    const theirs = item.reactions[myRole === 'a' ? 'b' : 'a'];
    if (!theirs) continue;
    const key = `${item.id}:${theirs}`;
    if (seen.has(key)) continue;
    result.push({
      key,
      text: `${partner}${REACTION_PHRASES[theirs]}`,
      sub: `因为你${DONE_TEXT[item.type]}「${item.title}」`,
    });
  }
  return result;
}

/** 主页「TA 最近」里的一行。 */
interface FeedRow {
  id: string;
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

/** 最近的动态里挑出要给 TA 看的：对方做的（可回应）、对方回应了我做的。 */
function feedRows(
  items: ActivityItem[],
  myRole: string,
  partner: string,
): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const item of items) {
    const verb = DONE_TEXT[item.type];
    const when = whenText(item.date);
    if (item.byRole && item.byRole !== myRole) {
      rows.push({
        id: item.id,
        text: `${partner}${verb}「${item.title}」`,
        when,
        canReact: true,
        mine: item.reactions[myRole as 'a' | 'b'] || '',
      });
    }
  }
  return rows.slice(0, 4);
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
    reactions: REACTIONS,
    /** TA 近一天记了几笔账。 */
    partnerSpent: '',
    /** 最要紧的一个攒钱目标（没攒完、截止最早），没有时为 null。 */
    goal: null as GoalRow | null,
    goalsReady: false,
    /** 足迹卡片：最近几张照片的缩略图和一句话。 */
    footprint: { thumbs: [] as string[], text: '去过的地方，点这里补记' },
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
        return loadHome(todayKey().slice(0, 7));
      },
      show: ({ month, todos, dates, goals, recent, footprints }) => {
        this.showMonth(month);
        this.showTodos(todos);
        this.showDates(dates);
        if (goals) this.showGoals(goals);
        if (recent) this.showFeed(recent);
        if (footprints) void this.showFootprints(footprints);
      },
    });
  },
  showMonth({ records, summary }: LedgerMonth) {
    // 和记账页一致：开了两人分摊看共同支出，没开看全部支出。
    const splitting = this.data.household?.splitting === true;
    const total = splitting ? summary.sharedTotal : summary.spending.total;
    const household = this.data.household;
    const partnerRecords = household
      ? records.filter(
          (record) =>
            record.byRole &&
            record.byRole !== household.myRole &&
            Date.now() - record.ts < DAY_MS,
        ).length
      : 0;
    this.setData({
      spentText: formatYuan(total),
      countText: records.length ? `记了 ${records.length} 笔` : '还没有记账',
      partnerSpent:
        partnerRecords && household
          ? `${partnerName(household)}最近记了 ${partnerRecords} 笔账`
          : '',
    });
  },
  showFeed(items: ActivityItem[]) {
    const household = this.data.household;
    if (!household || household.members.length < 2) return;
    this.setData({
      feed: feedRows(items, household.myRole, partnerName(household)),
    });
    const nudges = nudgesOf(items, household.myRole, partnerName(household));
    this.setData({
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
  /** 点一个回应；再点同一个收回。 */
  async react(event: WechatMiniprogram.TouchEvent) {
    const { id, reaction } = event.currentTarget.dataset as {
      id: string;
      reaction: Reaction;
    };
    const row = this.data.feed.find((item) => item.id === id);
    if (!row) return;
    const next = row.mine === reaction ? '' : reaction;
    const index = this.data.feed.indexOf(row);
    this.setData({ [`feed[${index}].mine`]: next });
    try {
      await activityService.react(id, next);
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
  /** 足迹卡片：总个数、最近一个地方，和最近三条里有照片的缩略图。 */
  async showFootprints(page: FootprintPage) {
    const household = this.data.household;
    const places = page.total.places;
    const latest = page.items[0];
    const together = (household?.members.length || 0) > 1;
    this.setData({
      'footprint.text': places
        ? `${together ? '一起去过' : '去过'} ${places} 个地方${latest ? ' · 最近：' + latest.title : ''}`
        : '去过的地方，点这里补记',
    });
    const ids = page.items
      .filter((item) => item.photos.length)
      .slice(0, 3)
      .map((item) => item.photos[0]);
    const urls = ids.length ? await photoUrls(ids) : {};
    this.setData({
      'footprint.thumbs': ids.map((id) => urls[id]).filter(Boolean),
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
