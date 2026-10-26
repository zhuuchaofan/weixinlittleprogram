import type { DishTag } from '../../models';
import { dishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { DISH_TAG_OPTIONS, LENGTHS } from '../../config/options';
import { confirmAction } from '../../utils/confirm';
import { applyTheme, themeData } from '../../services/theme';

Page({
  data: {
    ...themeData(),
    limits: LENGTHS,
    id: '',
    tags: DISH_TAG_OPTIONS,
    name: '',
    tag: '在家做' as DishTag,
    ateOn: '',
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
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
        tag: dish.tag,
        ateOn: dish.ateOn || '',
      });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    }
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
      this.setData({ error: '名称不能为空。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      await dishService.update(this.data.id, {
        name: this.data.name.trim(),
        // 界面不再区分菜品和店家，统一存成 dish（任何「怎么吃」都能选）。
        kind: 'dish',
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
