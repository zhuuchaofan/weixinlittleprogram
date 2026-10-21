import { wishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { confirmAction } from '../../utils/confirm';

Page({
  data: { id: '', title: '', why: '', plan: '', busy: false, error: '' },
  async onLoad(options: Record<string, string | undefined>) {
    if (!options.id) return;
    let wish;
    try {
      wish = await wishService.get(options.id);
    } catch (error) {
      this.setData({ error: errorMessage(error) });
      return;
    }
    this.setData({
      id: wish.id,
      title: wish.title,
      why: wish.why,
      plan: wish.plan,
    });
  },
  input(event: WechatMiniprogram.Input) {
    this.setData({
      [String(event.currentTarget.dataset.field)]: event.detail.value,
    });
  },
  async save() {
    if (this.data.busy) return;
    const input = {
      title: this.data.title.trim(),
      why: this.data.why.trim(),
      plan: this.data.plan.trim(),
    };
    if (!input.title) {
      this.setData({ error: '请写下想去的地方或想做的事。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      if (this.data.id) await wishService.update(this.data.id, input);
      else await wishService.add(input);
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async remove() {
    if (this.data.busy || !this.data.id) return;
    if (!(await confirmAction('删除这条收藏？', '删除后无法恢复。'))) return;
    this.setData({ busy: true, error: '' });
    try {
      await wishService.remove(this.data.id);
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
