import {
  getReduceMotion,
  setReduceMotion,
} from '../../services/motion-preference';
import { uiCopy } from '../../config/ui-copy';
import { appConfig } from '../../services/content';
import { rsvpService, isMock } from '../../services/rsvp';
import { friendlyError } from '../../utils/validate';
import { openPlatformPrivacyGuide } from '../../services/privacy';
Page({
  data: {
    copy: uiCopy.privacy,
    appConfig,
    isMock,
    reduceMotion: true,
    busy: false,
    message: '',
    error: '',
  },
  onShow() {
    this.setData({
      reduceMotion: getReduceMotion(),
    });
  },
  motion(event: WechatMiniprogram.SwitchChange) {
    try {
      setReduceMotion(event.detail.value);
      this.setData({ reduceMotion: event.detail.value });
    } catch {
      this.setData({ error: uiCopy.privacy.text18 });
    }
  },
  async remove() {
    if (this.data.busy) return;
    const confirmation = await wx.showModal({
      title: isMock ? uiCopy.privacy.text19 : uiCopy.privacy.text20,
      content: uiCopy.privacy.text21,
      confirmText: uiCopy.privacy.text22,
      confirmColor: '#783e3c',
    });
    if (!confirmation.confirm) return;
    this.setData({ busy: true, error: '', message: '' });
    try {
      await rsvpService.removeMine();
      this.setData({ message: uiCopy.privacy.text23 });
    } catch (error) {
      this.setData({ error: friendlyError(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async openPlatformGuide() {
    this.setData({ error: '', message: '' });
    try {
      await openPlatformPrivacyGuide();
    } catch (error) {
      this.setData({ error: friendlyError(error) });
    }
  },
});
