import type { Household } from '../../models';
import {
  copyStep,
  getHousehold,
  leaveHousehold,
} from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { exportAllText } from '../../services/export';
import { withLoading } from '../../services/page-load';
import { applyTheme, themeData } from '../../services/theme';
import { confirmAction } from '../../utils/confirm';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 会员还剩几天（不足一天算一天），没有会员为 0。 */
function vipDays(household: Household): number {
  if (!household.vip?.active) return 0;
  return Math.max(1, Math.ceil((household.vip.until - Date.now()) / DAY_MS));
}

/**
 * 退出小家（规则见 docs/PLAN.md「退出小家」）：
 * - pair：两个人时，退出的人去一个新小家，默认带走完整副本；
 * - alone：只剩自己时，退出等于清空这个小家的全部记录，回到创建 / 加入页；
 * - copying：副本还没复制完（刚退出，或上次中途断了），一批批接着复制。
 */
Page({
  data: {
    ...themeData(),
    loading: true,
    mode: '' as '' | 'pair' | 'alone' | 'copying',
    partner: '',
    vipDays: 0,
    noCopy: false,
    busy: false,
    exporting: false,
    copied: 0,
    error: '',
    message: '',
  },
  onShow() {
    applyTheme(this);
  },
  onLoad() {
    void this.load();
  },
  load() {
    return withLoading(this, async () => {
      const household = await getHousehold(true);
      if (!household) {
        wx.reLaunch({ url: '/pages/welcome/index' });
        return;
      }
      if (household.copying) {
        this.setData({ mode: 'copying' });
        void this.copy();
        return;
      }
      this.setData({
        mode: household.members.length > 1 ? 'pair' : 'alone',
        partner:
          household.members.find((member) => !member.isMe)?.name || '对方',
        vipDays: vipDays(household),
      });
    });
  },
  toggleNoCopy() {
    this.setData({ noCopy: !this.data.noCopy });
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
    if (this.data.busy) return;
    const { mode, noCopy, vipDays: days, partner } = this.data;
    const vipLine = days
      ? mode === 'pair'
        ? `会员还剩 ${days} 天，全部留给${partner}。`
        : `会员还剩 ${days} 天，会一起作废。`
      : '';
    const content =
      mode === 'pair'
        ? `${noCopy ? '新小家从空开始，不带走任何记录。' : '会带走一份完整副本。'}${vipLine}`
        : `这个小家的全部记录都会删掉，删了找不回来。${vipLine}`;
    if (await confirmAction('确定退出小家？', content)) await this.leave();
  },
  async leave() {
    this.setData({ busy: true, error: '', message: '' });
    try {
      const copy = this.data.mode === 'pair' && !this.data.noCopy;
      await leaveHousehold(copy, () =>
        this.setData({ message: `正在替${this.data.partner}复制副本…` }),
      );
      if (this.data.mode === 'alone') {
        wx.reLaunch({ url: '/pages/welcome/index' });
        return;
      }
      if (!copy) {
        wx.reLaunch({ url: '/pages/home/index' });
        return;
      }
      this.setData({ mode: 'copying', message: '' });
      await this.copy();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
      // 对方刚好先退出了：重新读，按「只剩自己」显示。
      void this.load();
    } finally {
      this.setData({ busy: false });
    }
  },
  /** 一批批复制，断了可以点「重试」接着来，已复制的不会重复。 */
  async copy() {
    this.setData({ busy: true, error: '' });
    try {
      for (;;) {
        const { done, copied } = await copyStep();
        this.setData({ copied });
        if (done) break;
      }
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
