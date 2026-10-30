import {
  clearPendingInvite,
  createHousehold,
  getHousehold,
  joinHousehold,
  readPendingInvite,
  savePendingInvite,
} from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { applyTheme, themeData } from '../../services/theme';

// occupied：带着邀请码点进来，但已经在一个小家里了。
type Mode = 'choose' | 'create' | 'join' | 'occupied';

Page({
  data: {
    ...themeData(),
    mode: 'choose' as Mode,
    name: '',
    code: '',
    // 从邀请卡片点进来的（不是本机记着的邀请码）。
    invited: false,
    // occupied 时：现在的小家只有自己 / 对方的称呼。
    alone: false,
    partner: '',
    busy: false,
    checking: true,
    error: '',
  },
  /**
   * 从分享卡片点进来：直接是加入页，邀请码已填好。
   * 之前点过卡片、退出小家后回到这里：用本机记着的邀请码。
   */
  onLoad(options: Record<string, string | undefined>) {
    const code = (options.code || '').toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(code))
      this.setData({ mode: 'join', code, invited: true });
    else {
      const pending = readPendingInvite();
      if (pending) this.setData({ mode: 'join', code: pending });
    }
  },
  async onShow() {
    applyTheme(this);
    this.setData({ checking: true, error: '' });
    try {
      const household = await getHousehold(true);
      // 带着别人的邀请码点进来，但已经在小家里：说清楚要先退出，不直接跳走。
      if (
        household &&
        this.data.invited &&
        household.inviteCode !== this.data.code
      ) {
        savePendingInvite(this.data.code);
        const partner = household.members.find((member) => !member.isMe);
        this.setData({
          mode: 'occupied',
          alone: !partner,
          partner: partner ? partner.name : '',
        });
        return;
      }
      // 已经在小家里（例如另一台设备完成了绑定，或点了自己发的卡片），直接回到首页。
      if (household) {
        wx.reLaunch({ url: '/pages/home/index' });
        return;
      }
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ checking: false });
    }
  },
  choose(event: WechatMiniprogram.TouchEvent) {
    this.setData({ mode: event.currentTarget.dataset.mode as Mode, error: '' });
  },
  /** 不加入了：忘掉邀请码，回自己的小家。 */
  stay() {
    clearPendingInvite();
    wx.reLaunch({ url: '/pages/home/index' });
  },
  toLeave() {
    wx.navigateTo({ url: '/pages/leave/index' });
  },
  inputName(event: WechatMiniprogram.Input) {
    this.setData({ name: event.detail.value });
  },
  inputCode(event: WechatMiniprogram.Input) {
    this.setData({ code: event.detail.value.toUpperCase() });
  },
  async submit() {
    if (this.data.busy) return;
    const name = this.data.name.trim();
    if (!name || name.length > 12) {
      this.setData({ error: '称呼写 1–12 个字就好。' });
      return;
    }
    if (
      this.data.mode === 'join' &&
      !/^[A-Z0-9]{6}$/.test(this.data.code.trim())
    ) {
      this.setData({ error: '邀请码是 6 位哦，再看看 TA 发来的。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      if (this.data.mode === 'create') await createHousehold(name);
      else await joinHousehold(name, this.data.code.trim());
      clearPendingInvite();
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
