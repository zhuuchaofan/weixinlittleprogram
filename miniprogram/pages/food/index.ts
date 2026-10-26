import type { Dish, DishKind, DishTag } from '../../models';
import { requireHousehold } from '../../services/household';
import { dishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { markLoaded, needsReload } from '../../services/snapshot';
import {
  DISH_KINDS,
  LENGTHS,
  kindLabel,
  tagsForKind,
} from '../../config/options';

type Row = Dish & { kindText: string };

let loadVersion = 0;

Page({
  data: {
    limits: LENGTHS,
    kinds: DISH_KINDS,
    // 顶部筛选：先选菜品 / 店家，再选标签；空字符串表示全部。
    kindFilter: '' as DishKind | '',
    filterTags: tagsForKind(''),
    filter: '' as DishTag | '',
    scopeText: '全部',
    dishes: [] as Row[],
    visible: [] as Row[],
    picked: null as Row | null,
    // 下方新增表单
    name: '',
    kind: 'dish' as DishKind,
    tags: tagsForKind('dish'),
    tag: '在家做' as DishTag,
    loading: true,
    busy: false,
    error: '',
  },
  onShow() {
    if (!this.data.dishes.length) {
      const saved = dishService.peek();
      if (saved) this.showDishes(saved);
    }
    if (needsReload('dishes')) void this.load();
  },
  showDishes(dishes: Dish[]) {
    this.setData({
      dishes: dishes.map((dish): Row => ({
        ...dish,
        kindText: kindLabel(dish.kind),
      })),
    });
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
    const { kindFilter, filter } = this.data;
    const scope = [kindFilter && kindLabel(kindFilter), filter].filter(Boolean);
    this.setData({
      scopeText: scope.join(' · ') || '全部',
      visible: this.data.dishes.filter(
        (dish) =>
          (!kindFilter || dish.kind === kindFilter) &&
          (!filter || dish.tag === filter),
      ),
    });
  },
  chooseKindFilter(event: WechatMiniprogram.TouchEvent) {
    const kindFilter = event.currentTarget.dataset.value as DishKind | '';
    const filterTags = tagsForKind(kindFilter);
    this.setData({
      kindFilter,
      filterTags,
      // 切到店家时，「在家做」这个标签筛选已经没有意义。
      filter: filterTags.includes(this.data.filter as DishTag)
        ? this.data.filter
        : '',
      picked: null,
    });
    // 新增表单跟着当前筛选走，省得再选一遍。
    if (kindFilter) this.setKind(kindFilter);
    this.applyFilter();
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
    // 尽量不和上一次抽到的重复。
    const candidates =
      pool.length > 1
        ? pool.filter((dish) => dish.id !== this.data.picked?.id)
        : pool;
    this.setData({
      error: '',
      picked: candidates[Math.floor(Math.random() * candidates.length)],
    });
  },
  inputName(event: WechatMiniprogram.Input) {
    this.setData({ name: event.detail.value });
  },
  setKind(kind: DishKind) {
    const tags = tagsForKind(kind);
    // 店家没有「在家做」，切过去时改成外食。
    this.setData({
      kind,
      tags,
      tag: tags.includes(this.data.tag) ? this.data.tag : tags[0],
    });
  },
  chooseKind(event: WechatMiniprogram.TouchEvent) {
    this.setKind(event.currentTarget.dataset.value as DishKind);
  },
  chooseTag(event: WechatMiniprogram.TouchEvent) {
    this.setData({ tag: event.currentTarget.dataset.value as DishTag });
  },
  async add() {
    if (this.data.busy) return;
    const name = this.data.name.trim();
    if (!name) {
      this.setData({
        error: this.data.kind === 'shop' ? '请先写店名。' : '请先写菜名。',
      });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      await dishService.add({ name, kind: this.data.kind, tag: this.data.tag });
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
