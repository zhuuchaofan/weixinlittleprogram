import { wishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { confirmAction } from '../../utils/confirm';
import { LENGTHS } from '../../config/options';
import { todayKey } from '../../utils/date';
import { applyTheme, themeData } from '../../services/theme';

Page({
  data: {
    ...themeData(),
    limits: LENGTHS,
    id: '',
    title: '',
    // 旧数据的「为什么想去」和「怎么安排」合在一起显示，保存时都存进 plan。
    note: '',
    done: false,
    doneOn: '',
    today: todayKey(),
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
  },
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
      note: [wish.why, wish.plan].filter(Boolean).join('\n'),
      done: wish.done === true,
      doneOn: wish.doneOn || todayKey(),
    });
  },
  input(event: WechatMiniprogram.Input) {
    this.setData({
      [String(event.currentTarget.dataset.field)]: event.detail.value,
    });
  },
  toggleDone(event: WechatMiniprogram.SwitchChange) {
    this.setData({ done: event.detail.value });
  },
  pickDate(event: WechatMiniprogram.PickerChange) {
    this.setData({ doneOn: String(event.detail.value) });
  },
  async save() {
    if (this.data.busy) return;
    const { done } = this.data;
    const input = {
      title: this.data.title.trim(),
      why: '',
      plan: this.data.note.trim().slice(0, LENGTHS.wishPlan),
      done,
      doneOn: done ? this.data.doneOn : '',
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
