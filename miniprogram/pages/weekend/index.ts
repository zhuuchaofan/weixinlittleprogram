import type { Wish } from '../../models';
import { requireHousehold } from '../../services/household';
import { wishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { markLoaded, needsReload } from '../../services/snapshot';
import { LENGTHS } from '../../config/options';
import { todayKey } from '../../utils/date';

type Row = Wish & { subText: string };

let loadVersion = 0;

/** 没去过：显示备注第一行；去过：显示哪天去的。 */
function toRow(wish: Wish): Row {
  if (wish.done)
    return {
      ...wish,
      subText: wish.doneOn
        ? `${wish.doneOn.replace(/-/g, '.')} 去的`
        : '去过了',
    };
  const note = [wish.why, wish.plan].filter(Boolean).join(' ');
  return { ...wish, subText: note.split('\n')[0] };
}

Page({
  data: {
    limits: LENGTHS,
    wishes: [] as Row[],
    open: [] as Row[],
    done: [] as Row[],
    showDone: false,
    title: '',
    // 正在保存「去过了」的条目；各条互不阻塞。
    pending: {} as Record<string, boolean>,
    loading: true,
    busy: false,
    error: '',
  },
  onShow() {
    if (!this.data.wishes.length) this.showWishes(wishService.peek() || []);
    if (needsReload('wishes')) void this.load();
  },
  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  async load(force = false) {
    const version = ++loadVersion;
    this.setData({ loading: true, error: '' });
    try {
      const household = await requireHousehold(force === true);
      if (!household) return;
      const wishes = await wishService.list();
      if (version !== loadVersion) return;
      this.showWishes(wishes);
      markLoaded('wishes');
    } catch (error) {
      if (version === loadVersion) this.setData({ error: errorMessage(error) });
    } finally {
      if (version === loadVersion) this.setData({ loading: false });
    }
  },
  showWishes(wishes: Wish[]) {
    const rows = wishes.map(toRow);
    this.setData({
      wishes: rows,
      open: rows.filter((wish) => !wish.done),
      // 最近去的在前。
      done: rows
        .filter((wish) => wish.done)
        .sort((a, b) => (b.doneOn || '').localeCompare(a.doneOn || '')),
    });
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
      this.setData({ error: '请写下想去的地方或想做的事。' });
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
      if (done) wx.showToast({ title: '去过啦', icon: 'success' });
    } catch (error) {
      this.replace(current);
      this.setData({
        error: `「${current.title}」没有保存：${errorMessage(error)}`,
      });
    } finally {
      this.setData({ [`pending.${id}`]: false });
    }
  },
  toggleDone() {
    this.setData({ showDone: !this.data.showDone });
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/wish-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
});
