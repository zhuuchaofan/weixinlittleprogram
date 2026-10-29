import type { Household } from '../../models';
import { deleteAccount, getHousehold } from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { exportAllText } from '../../services/export';
import { applyTheme, themeData } from '../../services/theme';
import { confirmAction } from '../../utils/confirm';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 会员还剩几天（不足一天算一天），没有会员为 0。 */
function vipDays(household: Household): number {
  if (!household.vip?.active) return 0;
  return Math.max(1, Math.ceil((household.vip.until - Date.now()) / DAY_MS));
}

/**
 * 注销账号（规则见 docs/PLAN.md「注销账号」）：
 * - pair：两个人时退出小家，共同账本留给对方，会员天数也留给对方；
 * - alone：只剩自己时清空整个小家，会员作废；
 * - none：没有小家，只清理退出记录。
 * 要先输入「注销」再点，点了还有一次确认框。
 */
Page({
  data: {
    ...themeData(),
    loading: true,
    mode: '' as '' | 'pair' | 'alone' | 'none',
    partner: '',
    vipDays: 0,
    typed: '',
    busy: false,
    exporting: false,
    error: '',
    message: '',
  },
  onShow() {
    applyTheme(this);
  },
  onLoad() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const household = await getHousehold(true);
      this.setData({
        mode: !household
          ? 'none'
          : household.members.length > 1
            ? 'pair'
            : 'alone',
        partner:
          household?.members.find((member) => !member.isMe)?.name ||
          (household && household.members.length > 1 ? '对方' : ''),
        vipDays: household ? vipDays(household) : 0,
      });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  inputTyped(event: WechatMiniprogram.Input) {
    this.setData({ typed: event.detail.value });
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
  async confirm() {
    if (this.data.busy || this.data.typed.trim() !== '注销') return;
    if (
      await confirmAction(
        '确定注销账号？',
        '你的数据会被删除，不能恢复。已经复制保存了吗？',
      )
    )
      await this.remove();
  },
  async remove() {
    this.setData({ busy: true, error: '', message: '' });
    try {
      await deleteAccount(() =>
        this.setData({
          message: `正在替${this.data.partner || '对方'}复制副本…`,
        }),
      );
      await wx.showModal({
        title: '已注销',
        content: '你的数据已经删除。以后想用，可以重新创建或加入小家。',
        showCancel: false,
      });
      wx.reLaunch({ url: '/pages/welcome/index' });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
      // 状态可能已变（比如对方刚好退出了）：重新读。
      void this.load();
    } finally {
      this.setData({ busy: false });
    }
  },
});
