import { openExpenseWith } from '../../utils/expense-link';
import type { MemberRole, Wish } from '../../models';
import { getHousehold, peekHousehold } from '../../services/household';
import { wishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { needsReload } from '../../services/snapshot';
import { createLoader } from '../../services/page-load';
import { LENGTHS } from '../../config/options';
import { todayKey } from '../../utils/date';
import { applyTheme, themeData } from '../../services/theme';

type Row = Wish & {
  subText: string;
  /** 我想去 / TA 也想去；done 的不显示。 */
  mine: boolean;
  theirs: boolean;
};

const loader = createLoader();
let myRole: MemberRole | '' = '';

/** 没去过：显示备注第一行；去过：显示哪天去的。 */
function toRow(wish: Wish): Row {
  const other = myRole === 'a' ? 'b' : 'a';
  const base = {
    ...wish,
    mine: myRole !== '' && wish.wants?.[myRole] === true,
    theirs: myRole !== '' && wish.wants?.[other] === true,
  };
  if (wish.done) {
    const when = wish.doneOn
      ? `${wish.doneOn.replace(/-/g, '.')} 去的`
      : '去过了';
    return {
      ...base,
      subText: wish.memo ? `${when} · ${wish.memo}` : when,
    };
  }
  const note = [wish.why, wish.plan].filter(Boolean).join(' ');
  return { ...base, subText: note.split('\n')[0] };
}

Page({
  data: {
    ...themeData(),
    limits: LENGTHS,
    wishes: [] as Row[],
    open: [] as Row[],
    done: [] as Row[],
    /** 顶上两栏：想去（清单）/ 去过（足迹相册）。 */
    tab: 'open' as 'open' | 'done',
    title: '',
    // 正在保存「去过了」的条目；各条互不阻塞。
    pending: {} as Record<string, boolean>,
    loading: true,
    busy: false,
    error: '',
  },
  onLoad(query: Record<string, string | undefined>) {
    if (query.tab === 'done') this.setData({ tab: 'done' });
  },
  onShow() {
    applyTheme(this);
    myRole = peekHousehold()?.myRole || myRole;
    if (!this.data.wishes.length) this.showWishes(wishService.peek() || []);
    if (needsReload('wishes')) void this.load();
    // 从回忆页、补记回来：相册重新读一次。
    void this.wall()?.reload();
  },
  onPullDownRefresh() {
    void Promise.all([this.load(true), this.wall()?.reload()]).finally(() =>
      wx.stopPullDownRefresh(),
    );
  },
  onReachBottom() {
    this.wall()?.reachBottom();
  },
  wall() {
    return this.selectComponent('#wall') as
      | (WechatMiniprogram.Component.TrivialInstance & {
          reload(): Promise<void>;
          reachBottom(): void;
        })
      | null;
  },
  chooseTab(event: WechatMiniprogram.TouchEvent) {
    const tab = event.currentTarget.dataset.tab as 'open' | 'done';
    if (tab !== this.data.tab) this.setData({ tab });
  },
  load(force = false) {
    return loader(this, {
      key: 'wishes',
      force,
      fetch: () => wishService.list(),
      show: (wishes) => this.showWishes(wishes),
    });
  },
  async showWishes(wishes: Wish[]) {
    this.setData(this.rowsFor(wishes));
    if (myRole) return;
    // 冷启动直接进这页时还不知道我是谁：问到了再画一次「我想去 / TA 也想去」。
    try {
      myRole = (await getHousehold())?.myRole || '';
    } catch {
      // 取不到身份就不显示「想去」标记。
    }
    if (myRole && this.data.wishes.length === wishes.length)
      this.setData(this.rowsFor(wishes));
  },
  rowsFor(wishes: Wish[]) {
    const rows = wishes.map(toRow);
    return {
      wishes: rows,
      open: rows.filter((wish) => !wish.done),
      done: rows
        .filter((wish) => wish.done)
        .sort((a, b) => (b.doneOn || '').localeCompare(a.doneOn || '')),
    };
  },
  async want(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    const current = this.data.wishes.find((wish) => wish.id === id);
    if (!current || !myRole || this.data.pending[id]) return;
    const want = !current.mine;
    this.setData({ [`pending.${id}`]: true, error: '' });
    this.replace({ ...current, wants: { ...current.wants, [myRole]: want } });
    try {
      this.replace(await wishService.want(id, want));
    } catch (error) {
      this.replace(current);
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ [`pending.${id}`]: false });
    }
  },
  replace(row: Wish) {
    this.showWishes(
      this.data.wishes.map((item) => (item.id === row.id ? row : item)),
    );
  },
  inputTitle(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value });
  },
  async add() {
    if (this.data.busy) return;
    const title = this.data.title.trim();
    if (!title) {
      this.setData({ error: '写一个想去的地方或想做的事吧。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const wish = await wishService.add({ title, why: '', plan: '' });
      this.setData({ title: '' });
      this.showWishes([wish, ...this.data.wishes]);
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  /** 打勾 = 去过了，记下今天；再点一下取消。 */
  async toggle(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    const current = this.data.wishes.find((wish) => wish.id === id);
    if (!current || this.data.pending[id]) return;
    const done = !current.done;
    const doneOn = done ? todayKey() : '';
    this.setData({ [`pending.${id}`]: true, error: '' });
    this.replace({ ...current, done, doneOn });
    try {
      this.replace(await wishService.update(id, { done, doneOn }));
      if (done) {
        // 去过了顺手记花销：足迹里会带上那天花了多少。
        const { confirm } = await wx.showModal({
          title: '去过啦',
          content: `「${current.title}」这次花了多少？顺手记一笔，足迹里会带上那天的花销。`,
          confirmText: '记一笔',
          cancelText: '先不记',
        });
        if (confirm)
          openExpenseWith({ cat: '娱乐', note: current.title, date: doneOn });
      }
    } catch (error) {
      this.replace(current);
      this.setData({
        error: `「${current.title}」没有保存：${errorMessage(error)}`,
      });
    } finally {
      this.setData({ [`pending.${id}`]: false });
    }
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/wish-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
});
