import type { DishTag } from '../../models';
import { dishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { DISH_TAGS } from '../../config/options';
import { confirmAction } from '../../utils/confirm';

Page({
  data: {
    id: '',
    tags: DISH_TAGS,
    name: '',
    tag: '在家做' as DishTag,
    busy: false,
    error: '',
  },
  onLoad(options: Record<string, string | undefined>) {
    const dish = options.id ? dishService.cached(options.id) : undefined;
    if (!dish) {
      this.setData({ error: '没有找到这道菜，请返回刷新后重试。' });
      return;
    }
    this.setData({ id: dish.id, name: dish.name, tag: dish.tag });
  },
  inputName(event: WechatMiniprogram.Input) {
    this.setData({ name: event.detail.value });
  },
  chooseTag(event: WechatMiniprogram.TouchEvent) {
    this.setData({ tag: event.currentTarget.dataset.value as DishTag });
  },
  async save() {
    if (this.data.busy || !this.data.id) return;
    if (!this.data.name.trim()) {
      this.setData({ error: '菜名不能为空。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      await dishService.update(this.data.id, {
        name: this.data.name.trim(),
        tag: this.data.tag,
      });
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async remove() {
    if (this.data.busy || !this.data.id) return;
    if (!(await confirmAction('从菜单删除？', '删除后无法恢复。'))) return;
    this.setData({ busy: true, error: '' });
    try {
      await dishService.remove(this.data.id);
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
