import {
  createHousehold,
  getHousehold,
  joinHousehold,
} from '../../services/household';
import { errorMessage } from '../../services/cloud';
import { applyTheme, themeData } from '../../services/theme';

type Mode = 'choose' | 'create' | 'join';

Page({
  data: {
    ...themeData(),
    mode: 'choose' as Mode,
    name: '',
    code: '',
    busy: false,
    checking: true,
    error: '',
  },
  /** 从分享卡片点进来：直接是加入页，邀请码已填好。 */
  onLoad(options: Record<string, string | undefined>) {
    const code = (options.code || '').toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(code)) this.setData({ mode: 'join', code });
  },
  async onShow() {
    applyTheme(this);
    this.setData({ checking: true, error: '' });
    try {
      // 已经在小家里（例如另一台设备完成了绑定），直接回到首页。
      if (await getHousehold(true)) {
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
      this.setData({ error: '请填写 1–12 字的称呼。' });
      return;
    }
    if (
      this.data.mode === 'join' &&
      !/^[A-Z0-9]{6}$/.test(this.data.code.trim())
    ) {
      this.setData({ error: '请输入 6 位邀请码。' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      if (this.data.mode === 'create') await createHousehold(name);
      else await joinHousehold(name, this.data.code.trim());
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
