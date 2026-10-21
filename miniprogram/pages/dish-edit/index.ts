import type { DishKind, DishTag } from '../../models';
import { dishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import {
  DISH_KINDS,
  DISH_TAGS,
  LENGTHS,
  tagsForKind,
} from '../../config/options';
import { confirmAction } from '../../utils/confirm';

Page({
  data: {
    limits: LENGTHS,
    id: '',
    kinds: DISH_KINDS,
    tags: DISH_TAGS,
    name: '',
    kind: 'dish' as DishKind,
    tag: '在家做' as DishTag,
    busy: false,
    error: '',
  },
  async onLoad(options: Record<string, string | undefined>) {
    if (!options.id) {
      this.setData({ error: '没有找到这一条，请返回刷新后重试。' });
      return;
    }
    try {
      const dish = await dishService.get(options.id);
      this.setData({
        id: dish.id,
        name: dish.name,
        kind: dish.kind,
        tag: dish.tag,
        tags: tagsForKind(dish.kind),
      });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    }
  },
  inputName(event: WechatMiniprogram.Input) {
    this.setData({ name: event.detail.value });
  },
  chooseKind(event: WechatMiniprogram.TouchEvent) {
    const kind = event.currentTarget.dataset.value as DishKind;
    const tags = tagsForKind(kind);
    // 店家没有「在家做」，切过去时改成外食。
    this.setData({
      kind,
      tags,
      tag: tags.includes(this.data.tag) ? this.data.tag : tags[0],
    });
  },
  chooseTag(event: WechatMiniprogram.TouchEvent) {
    this.setData({ tag: event.currentTarget.dataset.value as DishTag });
  },
  async save() {
    if (this.data.busy || !this.data.id) return;
    if (!this.data.name.trim()) {
      this.setData({ error: '名称不能为空。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      await dishService.update(this.data.id, {
        name: this.data.name.trim(),
        kind: this.data.kind,
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
