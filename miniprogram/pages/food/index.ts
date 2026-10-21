import type { AiFoodItem, Dish, DishTag } from '../../models';
import { requireHousehold } from '../../services/household';
import { dishService } from '../../services/collections';
import { aiAvailable, aiSuggest } from '../../services/ai';
import { errorMessage } from '../../services/cloud';
import { DISH_TAGS, LENGTHS } from '../../config/options';

let loadVersion = 0;

Page({
  data: {
    limits: LENGTHS,
    tags: DISH_TAGS,
    filter: '' as DishTag | '',
    dishes: [] as Dish[],
    visible: [] as Dish[],
    picked: null as Dish | null,
    name: '',
    tag: '在家做' as DishTag,
    city: '',
    aiEnabled: false,
    aiText: '',
    aiItems: [] as AiFoodItem[],
    aiBusy: false,
    loading: true,
    busy: false,
    error: '',
  },
  onLoad() {
    void aiAvailable('food').then((aiEnabled) => this.setData({ aiEnabled }));
  },
  onShow() {
    void this.load();
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
      this.setData({ dishes, city: household.city });
      this.applyFilter();
    } catch (error) {
      if (version === loadVersion) this.setData({ error: errorMessage(error) });
    } finally {
      if (version === loadVersion) this.setData({ loading: false });
    }
  },
  applyFilter() {
    const filter = this.data.filter;
    this.setData({
      visible: filter
        ? this.data.dishes.filter((dish) => dish.tag === filter)
        : this.data.dishes,
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
      this.setData({ error: '菜单里还没有可以抽的，先加几道吧。' });
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
  chooseTag(event: WechatMiniprogram.TouchEvent) {
    this.setData({ tag: event.currentTarget.dataset.value as DishTag });
  },
  async add() {
    if (this.data.busy) return;
    const name = this.data.name.trim();
    if (!name) {
      this.setData({ error: '请先写菜名。' });
      return;
    }
    await this.save(name, this.data.tag);
    this.setData({ name: '' });
  },
  async save(name: string, tag: DishTag) {
    this.setData({ busy: true, error: '' });
    try {
      await dishService.add({ name, tag });
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
  inputAi(event: WechatMiniprogram.Input) {
    this.setData({ aiText: event.detail.value });
  },
  async askAi() {
    if (this.data.aiBusy) return;
    this.setData({ aiBusy: true, error: '', aiItems: [] });
    try {
      const result = await aiSuggest<AiFoodItem>('food', {
        text: this.data.aiText.trim(),
        city: this.data.city,
        dishes: this.data.dishes.map((dish) => dish.name),
      });
      if (result.disabled) this.setData({ aiEnabled: false });
      else this.setData({ aiItems: result.items });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ aiBusy: false });
    }
  },
  async keepAi(event: WechatMiniprogram.TouchEvent) {
    const item = this.data.aiItems[Number(event.currentTarget.dataset.index)];
    if (item && !this.data.busy) await this.save(item.name, item.tag);
  },
});
