import { dateService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { todayKey } from '../../utils/date';
import { confirmAction } from '../../utils/confirm';
import { LENGTHS } from '../../config/options';
import { applyTheme, themeData } from '../../services/theme';

Page({
  data: {
    ...themeData(),
    limits: LENGTHS,
    id: '',
    title: '',
    date: todayKey(),
    yearly: true,
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
  },
  async onLoad(options: Record<string, string | undefined>) {
    if (!options.id) return;
    let item;
    try {
      item = await dateService.get(options.id);
    } catch (error) {
      this.setData({ error: errorMessage(error) });
      return;
    }
    this.setData({
      id: item.id,
      title: item.title,
      date: item.date,
      yearly: item.yearly,
    });
  },
  inputTitle(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value });
  },
  pickDate(event: WechatMiniprogram.PickerChange) {
    this.setData({ date: String(event.detail.value) });
  },
  toggleYearly(event: WechatMiniprogram.SwitchChange) {
    this.setData({ yearly: event.detail.value });
  },
  async save() {
    if (this.data.busy) return;
    const input = {
      title: this.data.title.trim(),
      date: this.data.date,
      yearly: this.data.yearly,
    };
    if (!input.title) {
      this.setData({ error: '请填写名称。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      if (this.data.id) await dateService.update(this.data.id, input);
      else await dateService.add(input);
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async remove() {
    if (this.data.busy || !this.data.id) return;
    if (!(await confirmAction('删除这个纪念日？', '删除后无法恢复。'))) return;
    this.setData({ busy: true, error: '' });
    try {
      await dateService.remove(this.data.id);
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
