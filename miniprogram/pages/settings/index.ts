import type { Household } from '../../models';
import { getHousehold, updateHousehold } from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { exportAllText } from '../../services/export';

Page({
  data: {
    loading: true,
    busy: false,
    exporting: false,
    error: '',
    message: '',
    household: null as Household | null,
    myName: '',
    city: '',
  },
  onLoad() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const household = await getHousehold(true);
      if (household) this.show(household);
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  show(household: Household) {
    this.setData({
      household,
      city: household.city,
      myName: household.members.find((member) => member.isMe)?.name || '',
    });
  },
  inputName(event: WechatMiniprogram.Input) {
    this.setData({ myName: event.detail.value });
  },
  inputCity(event: WechatMiniprogram.Input) {
    this.setData({ city: event.detail.value });
  },
  async save() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', message: '' });
    try {
      this.show(
        await updateHousehold({
          name: this.data.myName.trim(),
          city: this.data.city.trim(),
        }),
      );
      this.setData({ message: '已保存。' });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async exportData() {
    if (this.data.exporting) return;
    this.setData({ exporting: true, error: '', message: '' });
    try {
      await wx.setClipboardData({ data: await exportAllText() });
      this.setData({
        message: '全部数据已复制，可以粘贴到备忘录或文件里保存。',
      });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ exporting: false });
    }
  },
  copyCode() {
    const code = this.data.household?.inviteCode;
    if (code) wx.setClipboardData({ data: code });
  },
});
