import type { MemberRole, Wish } from '../../models';
import { getHousehold, peekHousehold } from '../../services/household';
import { photoUrls } from '../../services/photos';
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
  thumb: string;
};

const loader = createLoader();
let myRole: MemberRole | '' = '';
const thumbs: Record<string, string> = {};

/** 没去过：显示备注第一行；去过：显示哪天去的。 */
function toRow(wish: Wish): Row {
  const other = myRole === 'a' ? 'b' : 'a';
  const base = {
    ...wish,
    mine: myRole !== '' && wish.wants?.[myRole] === true,
    theirs: myRole !== '' && wish.wants?.[other] === true,
    thumb: wish.photos?.length ? thumbs[wish.photos[0]] || '' : '',
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
    showDone: false,
    title: '',
    // 正在保存「去过了」的条目；各条互不阻塞。
    pending: {} as Record<string, boolean>,
    loading: true,
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
    myRole = peekHousehold()?.myRole || myRole;
    if (!this.data.wishes.length) this.showWishes(wishService.peek() || []);
    if (needsReload('wishes')) void this.load();
  },
  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  load(force = false) {
    return loader(this, {
      key: 'wishes',
      force,
      fetch: () => wishService.list(),
      show: (wishes) => this.showWishes(wishes),
    });
  },
  showWishes(wishes: Wish[]) {
    void this.loadThumbs(wishes);
    this.setData(this.rowsFor(wishes));
  },
  /** 去过的第一张照片当缩略图；取到后重画一次。 */
  async loadThumbs(wishes: Wish[]) {
    if (!myRole)
      try {
        myRole = (await getHousehold())?.myRole || '';
      } catch {
        // 取不到身份就不显示「想去」标记。
      }
    const ids = wishes
      .filter((wish) => wish.done && wish.photos?.length)
      .map((wish) => (wish.photos as string[])[0])
      .filter((id) => !thumbs[id])
      .slice(0, 30);
    if (!ids.length && !myRole) return;
    const urls = await photoUrls(ids);
    Object.assign(thumbs, urls);
    if (this.data.wishes.length === wishes.length)
      this.setData({ ...this.rowsFor(wishes) });
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
  footprints() {
    wx.navigateTo({ url: '/pages/footprints/index' });
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
