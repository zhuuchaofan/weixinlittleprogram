import type {
  Dish,
  DishRating,
  DishTag,
  DishVote,
  Household,
  MemberRole,
} from '../../models';
import { dishService } from '../../services/collections';
import { peekHousehold } from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { needsReload } from '../../services/snapshot';
import { createLoader } from '../../services/page-load';
import { DISH_TAG_OPTIONS, LENGTHS, dishTagLabel } from '../../config/options';
import { daysBetween, todayKey } from '../../utils/date';
import { applyTheme, themeData } from '../../services/theme';
import {
  agreedToAiText,
  pickDishes,
  type DishPick,
} from '../../services/assist';

type Row = Dish & {
  ateText: string;
  ateDays: number;
  ateToday: boolean;
  /** 菜单里这一行的小字：吃过多久、TA 今天想不想吃、两人的评价。 */
  subText: string;
  myVote: DishVote | '';
  myRating: DishRating | '';
  /** 今天有人不想吃，或有人觉得踩雷：不会被抽到。 */
  vetoed: boolean;
  /** 0 没人想吃，1 一个人想吃，2 两人都想吃；抽签先从高的里抽。 */
  want: number;
};
type Group = {
  tag: DishTag;
  label: string;
  tile: string;
  icon: string;
  items: Row[];
};

/** 抽签避开最近几天吃过的。 */
const RECENT_DAYS = 3;

const GROUP_LOOKS: Record<DishTag, { tile: string; icon: string }> = {
  在家做: { tile: 'tile-orange', icon: '/images/ui/home.svg' },
  外食: { tile: 'tile-yellow', icon: '/images/ui/shop.svg' },
  外卖: { tile: 'tile-blue', icon: '/images/cat-icons/food.svg' },
};

const loader = createLoader();

const RATING_TEXT: Record<DishRating, string> = {
  good: '好吃',
  ok: '一般',
  bad: '踩雷',
};

/** 当前小家里我是谁、TA 叫什么；只有一个人时 partner 为空。 */
function who(household: Household | null) {
  const me = household?.myRole || '';
  const other = household?.members.find((member) => member.role !== me);
  return {
    me: me as MemberRole | '',
    partner: other?.name || '',
    partnerRole: (other?.role || '') as MemberRole | '',
  };
}

function toRow(dish: Dish, today: string, household: Household | null): Row {
  const days = dish.ateOn ? daysBetween(dish.ateOn, today) : -1;
  let ateText = '';
  if (days === 0) ateText = '今天吃过';
  else if (days === 1) ateText = '昨天吃过';
  else if (days > 1) ateText = `${days} 天前吃过`;
  const { me, partner, partnerRole } = who(household);
  const votes = dish.votes || {};
  const ratings = dish.ratings || {};
  const theirVote = partnerRole ? votes[partnerRole] : undefined;
  const mine = me ? ratings[me] : undefined;
  const theirs = partnerRole ? ratings[partnerRole] : undefined;
  const subText = [
    ateText,
    theirVote && `${partner}${theirVote === 'want' ? '想吃' : '不想吃'}`,
    mine && `我觉得${RATING_TEXT[mine]}`,
    theirs && `${partner}觉得${RATING_TEXT[theirs]}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const all = [...Object.values(votes), ...Object.values(ratings)];
  return {
    ...dish,
    votes,
    ratings,
    ateText,
    ateDays: days,
    ateToday: days === 0,
    subText,
    myVote: (me && votes[me]) || '',
    myRating: (me && ratings[me]) || '',
    vetoed: all.includes('no') || all.includes('bad'),
    want: Object.values(votes).filter((vote) => vote === 'want').length,
  };
}

Page({
  data: {
    ...themeData(),
    limits: LENGTHS,
    tags: DISH_TAG_OPTIONS,
    // 「怎么吃」筛选；空字符串表示全部。新加的也存到这一类（全部时存「在家做」）。
    filter: '' as DishTag | '',
    filterText: '',
    addText: dishTagLabel('在家做'),
    dishes: [] as Row[],
    // 两个人都在：菜单每行可以点「想吃 / 不想」，吃完可以评价。
    pair: false,
    ratings: [
      { value: 'good', label: '好吃' },
      { value: 'ok', label: '一般' },
      { value: 'bad', label: '踩雷' },
    ],
    visible: [] as Row[],
    groups: [] as Group[],
    picked: null as Row | null,
    // 喵喵帮我挑
    want: '',
    asking: false,
    aiPicks: [] as DishPick[],
    name: '',
    loading: true,
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
    if (!this.data.dishes.length) {
      const saved = dishService.peek();
      if (saved) this.showDishes(saved);
    }
    if (needsReload('dishes')) void this.load();
  },
  showDishes(dishes: Dish[]) {
    const today = todayKey();
    const household = peekHousehold();
    this.setData({
      pair: (household?.members.length || 0) > 1,
      dishes: dishes.map((dish) => toRow(dish, today, household)),
    });
    this.applyFilter();
  },
  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  load(force = false) {
    return loader(this, {
      key: 'dishes',
      force,
      fetch: () => dishService.list(),
      show: (dishes) => this.showDishes(dishes),
    });
  },
  applyFilter() {
    const { filter } = this.data;
    const visible = this.data.dishes.filter(
      (dish) => !filter || dish.tag === filter,
    );
    const groups = DISH_TAG_OPTIONS.map(({ value, label }): Group => ({
      tag: value,
      label,
      ...GROUP_LOOKS[value],
      items: visible.filter((dish) => dish.tag === value),
    })).filter((group) => group.items.length);
    this.setData({
      visible,
      groups,
      filterText: filter ? dishTagLabel(filter) : '',
      addText: dishTagLabel(filter || '在家做'),
    });
  },
  chooseFilter(event: WechatMiniprogram.TouchEvent) {
    this.setData({
      filter: event.currentTarget.dataset.value as DishTag | '',
      picked: null,
    });
    this.applyFilter();
  },
  draw() {
    const pool = this.data.visible;
    if (!pool.length) {
      this.setData({ error: '这一类里还没有可以抽的，先加几个吧。' });
      return;
    }
    // 先去掉有人不想吃或踩雷的（都被否决了就不去了），
    // 再避开最近吃过的和上一次抽到的；都排除光了就不避了。
    const open = pool.filter((dish) => !dish.vetoed);
    const base = open.length ? open : pool;
    const fresh = base.filter(
      (dish) =>
        (dish.ateDays < 0 || dish.ateDays >= RECENT_DAYS) &&
        dish.id !== this.data.picked?.id,
    );
    const others = base.filter((dish) => dish.id !== this.data.picked?.id);
    const rest = fresh.length ? fresh : others.length ? others : base;
    // 有人点了「想吃」的优先，两人都想吃的最优先。
    const top = Math.max(...rest.map((dish) => dish.want));
    const candidates = rest.filter((dish) => dish.want === top);
    this.setData({
      error: '',
      picked: candidates[Math.floor(Math.random() * candidates.length)],
    });
  },
  inputWant(event: WechatMiniprogram.Input) {
    this.setData({ want: event.detail.value });
  },
  /** 说说想吃什么，让喵喵从菜单里挑 3 个。 */
  async ask() {
    if (this.data.asking) return;
    if (!(await agreedToAiText())) return;
    this.setData({ asking: true, error: '', aiPicks: [] });
    try {
      const { picks } = await pickDishes(
        this.data.want.trim(),
        this.data.filter,
      );
      this.setData({ aiPicks: picks });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ asking: false });
    }
  },
  /** 喵喵挑的某一个，放到上面的大卡片里，用「就吃这个」记下。 */
  choosePick(event: WechatMiniprogram.TouchEvent) {
    const dish = this.data.dishes.find(
      (item) => item.id === event.currentTarget.dataset.id,
    );
    if (dish) this.setData({ picked: dish });
  },
  /** 就吃这个：记下今天吃过，之后几天不会再抽到。 */
  async eat() {
    const picked = this.data.picked;
    if (!picked || picked.ateToday || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const dish = await dishService.update(picked.id, { ateOn: todayKey() });
      this.replaceDish(dish, true);
      wx.showToast({ title: '记下啦，喵', icon: 'success' });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  /** 换掉一行（投票、评价、吃过之后），大卡片里的也跟着换。 */
  replaceDish(dish: Dish, pick = false) {
    const row = toRow(dish, todayKey(), peekHousehold());
    this.setData({
      dishes: this.data.dishes.map((item) => (item.id === row.id ? row : item)),
      picked: pick || this.data.picked?.id === row.id ? row : this.data.picked,
    });
    this.applyFilter();
  },
  /** 想吃 / 不想吃；再点同一个收回。先改界面，失败再换回来。 */
  async vote(event: WechatMiniprogram.TouchEvent) {
    const { id, vote } = event.currentTarget.dataset as {
      id: string;
      vote: DishVote;
    };
    const current = this.data.dishes.find((dish) => dish.id === id);
    if (!current) return;
    const me = who(peekHousehold()).me;
    if (!me) return;
    const next = current.myVote === vote ? '' : vote;
    this.replaceDish({
      ...current,
      votes: { ...current.votes, [me]: next || undefined },
    });
    try {
      this.replaceDish(await dishService.vote(id, next));
    } catch (error) {
      this.replaceDish(current);
      this.setData({ error: errorMessage(error) });
    }
  },
  /** 吃完评价：好吃 / 一般 / 踩雷；踩雷的以后不会被抽到。 */
  async rate(event: WechatMiniprogram.TouchEvent) {
    const { id, rating } = event.currentTarget.dataset as {
      id: string;
      rating: DishRating;
    };
    const current = this.data.dishes.find((dish) => dish.id === id);
    if (!current) return;
    const next = current.myRating === rating ? '' : rating;
    try {
      this.replaceDish(await dishService.rate(id, next));
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    }
  },
  inputName(event: WechatMiniprogram.Input) {
    this.setData({ name: event.detail.value });
  },
  async add() {
    if (this.data.busy) return;
    const name = this.data.name.trim();
    if (!name) {
      this.setData({ error: '请先写名字，菜名或店名都行。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      await dishService.add({
        name,
        kind: 'dish',
        tag: this.data.filter || '在家做',
      });
      this.setData({ name: '' });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/dish-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
});
