import {
  createHousehold,
  getHousehold,
  joinHousehold,
} from '../../services/household';
import { errorMessage } from '../../services/cloud';

type Mode = 'choose' | 'create' | 'join';

Page({
  data: {
    mode: 'choose' as Mode,
    name: '',
    code: '',
    busy: false,
    checking: true,
    error: '',
  },
  async onShow() {
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
