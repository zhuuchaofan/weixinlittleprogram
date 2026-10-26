import type { Household } from '../../models';
import { getHousehold, updateHousehold } from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { exportAllText } from '../../services/export';
import { applyTheme, setTheme, themeData } from '../../services/theme';
import { THEMES } from '../../config/themes';

Page({
  data: {
    ...themeData(),
    loading: true,
    busy: false,
    exporting: false,
    error: '',
    message: '',
    household: null as Household | null,
    myName: '',
    themes: THEMES.map(({ id, name, swatch }) => ({ id, name, swatch })),
  },
  onShow() {
    applyTheme(this);
  },
  /** 换主题只影响这台手机；返回其他页面时各自在 onShow 里套用。 */
  chooseTheme(event: WechatMiniprogram.TouchEvent) {
    setTheme(String(event.currentTarget.dataset.id));
    applyTheme(this);
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
      myName: household.members.find((member) => member.isMe)?.name || '',
    });
  },
  inputName(event: WechatMiniprogram.Input) {
    this.setData({ myName: event.detail.value });
  },
  async save() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', message: '' });
    try {
      this.show(await updateHousehold({ name: this.data.myName.trim() }));
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
  /** 两人分摊与结算的开关：两个人共用一个设置。 */
  async toggleSplitting(event: WechatMiniprogram.SwitchChange) {
    const splitting = event.detail.value;
    this.setData({ error: '', message: '' });
    try {
      this.show(await updateHousehold({ splitting }));
      this.setData({
        message: splitting
          ? '已开启两人分摊：记账页会显示结算。'
          : '已关闭两人分摊：只记账，不再显示结算。',
      });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
      // 保存失败：开关拨回原来的状态。
      if (this.data.household)
        this.setData({ household: { ...this.data.household } });
    }
  },
  copyCode() {
    const code = this.data.household?.inviteCode;
    if (code) wx.setClipboardData({ data: code });
  },
});
