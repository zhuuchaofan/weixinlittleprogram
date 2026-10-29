import type { Household } from '../../models';
import {
  getHousehold,
  inviteShare,
  updateHousehold,
} from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { exportAllText } from '../../services/export';
import { withLoading } from '../../services/page-load';
import { applyTheme, setTheme, themeData } from '../../services/theme';
import { THEMES } from '../../config/themes';
import { todayKey } from '../../utils/date';

function vipText(household: Household): string {
  return household.vip?.active
    ? `会员有效中 · ${todayKey(household.vip.until)} 到期`
    : '开通会员';
}

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
    myPayName: '',
    vipText: '开通会员',
    themes: THEMES.map(({ id, name, swatch }) => ({ id, name, swatch })),
  },
  onShow() {
    applyTheme(this);
    // 从会员页回来时刷新会员状态（只改这一行，不动正在编辑的名字）。
    if (this.data.household)
      void getHousehold()
        .then((household) => {
          if (household) this.setData({ vipText: vipText(household) });
        })
        .catch(() => {});
  },
  /** 换主题只影响这台手机；返回其他页面时各自在 onShow 里套用。 */
  chooseTheme(event: WechatMiniprogram.TouchEvent) {
    setTheme(String(event.currentTarget.dataset.id));
    applyTheme(this);
  },
  onLoad() {
    void this.load();
  },
  load() {
    return withLoading(this, async () => {
      const household = await getHousehold(true);
      if (household) this.show(household);
    });
  },
  show(household: Household) {
    this.setData({
      household,
      myName: household.members.find((member) => member.isMe)?.name || '',
      myPayName: household.members.find((member) => member.isMe)?.payName || '',
      vipText: vipText(household),
    });
  },
  inputName(event: WechatMiniprogram.Input) {
    this.setData({ myName: event.detail.value });
  },
  inputPayName(event: WechatMiniprogram.Input) {
    this.setData({ myPayName: event.detail.value });
  },
  async save() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', message: '' });
    try {
      this.show(
        await updateHousehold({
          name: this.data.myName.trim(),
          payName: this.data.myPayName.trim(),
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
  onShareAppMessage() {
    return inviteShare(this.data.household?.inviteCode);
  },
  copyCode() {
    const code = this.data.household?.inviteCode;
    if (code) wx.setClipboardData({ data: code });
  },
  openVip() {
    wx.navigateTo({ url: '/pages/vip/index' });
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/${event.currentTarget.dataset.page}/index` });
  },
  openBudgets() {
    wx.navigateTo({ url: '/pages/budgets/index' });
  },
});
