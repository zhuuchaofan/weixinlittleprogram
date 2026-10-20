import type { Anniversary, Household } from '../../models';
import { requireHousehold, updateHousehold } from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { exportAllText } from '../../services/export';
import { dateService } from '../../services/collections';
import { shortDate } from '../../utils/date';

Page({
  data: {
    loading: true,
    busy: false,
    exporting: false,
    error: '',
    message: '',
    household: null as Household | null,
    dates: [] as Array<Anniversary & { label: string; dateText: string }>,
    datesError: '',
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
      if (household) {
        this.show(household);
        void this.loadDates();
      }
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  async loadDates() {
    try {
      const dates = await dateService.list();
      this.setData({
        datesError: '',
        dates: dates.map((item) => ({
          ...item,
          dateText: shortDate(item.nextDate),
          label: item.passed
            ? `已经 ${item.days} 天`
            : item.days === 0
              ? '就是今天'
              : `还有 ${item.days} 天`,
        })),
      });
    } catch (error) {
      this.setData({ datesError: errorMessage(error) });
    }
  },
  addDate() {
    wx.navigateTo({ url: '/pages/date-edit/index' });
  },
  openDate(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/date-edit/index?id=${event.currentTarget.dataset.id}`,
    });
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
      const text = await exportAllText();
      await wx.setClipboardData({ data: text });
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
