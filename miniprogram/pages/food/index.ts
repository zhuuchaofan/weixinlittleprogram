import type { Dish, DishTag } from '../../models';
import { requireHousehold } from '../../services/household';
import { dishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { markLoaded, needsReload } from '../../services/snapshot';
import { DISH_TAG_OPTIONS, LENGTHS, dishTagLabel } from '../../config/options';
import { daysBetween, todayKey } from '../../utils/date';
import { applyTheme, themeData } from '../../services/theme';

type Row = Dish & { ateText: string; ateDays: number; ateToday: boolean };
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

let loadVersion = 0;

function toRow(dish: Dish, today: string): Row {
  const days = dish.ateOn ? daysBetween(dish.ateOn, today) : -1;
  let ateText = '';
  if (days === 0) ateText = '今天吃过';
  else if (days === 1) ateText = '昨天吃过';
  else if (days > 1) ateText = `${days} 天前吃过`;
  return { ...dish, ateText, ateDays: days, ateToday: days === 0 };
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
    visible: [] as Row[],
    groups: [] as Group[],
    picked: null as Row | null,
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
    this.setData({ dishes: dishes.map((dish) => toRow(dish, today)) });
    this.applyFilter();
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
      const dishes = await dishService.list();
      if (version !== loadVersion) return;
      this.showDishes(dishes);
      markLoaded('dishes');
    } catch (error) {
      if (version === loadVersion) this.setData({ error: errorMessage(error) });
    } finally {
      if (version === loadVersion) this.setData({ loading: false });
    }
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
    // 避开最近吃过的和上一次抽到的；都排除光了就不避了。
    const fresh = pool.filter(
      (dish) =>
        (dish.ateDays < 0 || dish.ateDays >= RECENT_DAYS) &&
        dish.id !== this.data.picked?.id,
    );
    const others = pool.filter((dish) => dish.id !== this.data.picked?.id);
    const candidates = fresh.length ? fresh : others.length ? others : pool;
    this.setData({
      error: '',
      picked: candidates[Math.floor(Math.random() * candidates.length)],
    });
  },
  /** 就吃这个：记下今天吃过，之后几天不会再抽到。 */
  async eat() {
    const picked = this.data.picked;
    if (!picked || picked.ateToday || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const dish = await dishService.update(picked.id, { ateOn: todayKey() });
      const row = toRow(dish, todayKey());
      this.setData({
        picked: row,
        dishes: this.data.dishes.map((item) =>
          item.id === row.id ? row : item,
        ),
      });
      this.applyFilter();
      wx.showToast({ title: '记下了', icon: 'success' });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
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
