import type { Household } from '../../models';
import { requireHousehold, updateHousehold } from '../../services/household';
import { errorMessage } from '../../services/cloud';

Page({
  data: {
    loading: true,
    busy: false,
    error: '',
    message: '',
    household: null as Household | null,
    myName: '',
    city: '',
  },
  onShow() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const household = await requireHousehold();
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
  copyCode() {
    const code = this.data.household?.inviteCode;
    if (code) wx.setClipboardData({ data: code });
  },
});
