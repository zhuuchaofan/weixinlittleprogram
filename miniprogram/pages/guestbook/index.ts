import { uiCopy } from '../../config/ui-copy';
import { isGuestbookMock, guestbookService } from '../../services/guestbook';
import { formatUpdatedAt } from '../../utils/date';
import { friendlyError, validateGuestMessage } from '../../utils/validate';

function guestbookError(error: unknown): string {
  const message = friendlyError(error);
  return message === '不支持的操作。'
    ? uiCopy.guestbook.deployRequired
    : message;
}

Page({
  data: {
    copy: uiCopy.guestbook,
    isMock: isGuestbookMock,
    signature: '',
    message: '',
    consent: false,
    loading: true,
    loadFailed: false,
    saving: false,
    deleting: false,
    existing: false,
    saved: false,
    updatedAt: '',
    error: '',
  },
  onLoad() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, loadFailed: false, error: '' });
    try {
      const mine = await guestbookService.getMine();
      if (mine)
        this.setData({
          signature: mine.signature,
          message: mine.message,
          consent: mine.consent,
          existing: true,
          updatedAt: formatUpdatedAt(mine.updatedAt),
        });
      else
        this.setData({
          signature: '',
          message: '',
          consent: false,
          existing: false,
          saved: false,
          updatedAt: '',
        });
    } catch (error) {
      this.setData({ error: guestbookError(error), loadFailed: true });
    } finally {
      this.setData({ loading: false });
    }
  },
  signatureInput(event: WechatMiniprogram.Input) {
    this.setData({ signature: event.detail.value, saved: false });
  },
  messageInput(event: WechatMiniprogram.Input) {
    this.setData({ message: event.detail.value, saved: false });
  },
  consentChange(event: WechatMiniprogram.CheckboxGroupChange) {
    this.setData({
      consent: event.detail.value.includes('agree'),
      saved: false,
    });
  },
  async submit() {
    if (this.data.loading || this.data.saving || this.data.loadFailed) return;
    const input = {
      signature: this.data.signature,
      message: this.data.message,
      consent: this.data.consent,
    };
    const error = validateGuestMessage(input);
    if (error) return this.setData({ error, saved: false });
    this.setData({ saving: true, error: '', saved: false });
    try {
      const result = await guestbookService.save(input);
      this.setData({
        signature: result.signature,
        message: result.message,
        consent: result.consent,
        existing: true,
        saved: true,
        updatedAt: formatUpdatedAt(result.updatedAt),
      });
      wx.showToast({
        title: this.data.isMock ? this.data.copy.text20 : this.data.copy.text21,
        icon: 'success',
      });
    } catch (error) {
      this.setData({ error: guestbookError(error) });
    } finally {
      this.setData({ saving: false });
    }
  },
  async remove() {
    if (this.data.deleting || !this.data.existing) return;
    const result = await wx.showModal({
      title: this.data.copy.text23,
      content: this.data.copy.text24,
      confirmText: this.data.copy.text25,
      confirmColor: '#783e3c',
    });
    if (!result.confirm) return;
    this.setData({ deleting: true, error: '', saved: false });
    try {
      await guestbookService.removeMine();
      this.setData({
        signature: '',
        message: '',
        consent: false,
        existing: false,
        updatedAt: '',
      });
      wx.showToast({ title: this.data.copy.text26, icon: 'success' });
    } catch (error) {
      this.setData({ error: guestbookError(error) });
    } finally {
      this.setData({ deleting: false });
    }
  },
});
