import { formatUpdatedAt } from '../../utils/date';
import { uiCopy } from '../../config/ui-copy';
import { rsvpService, isMock, getRsvpRevision } from '../../services/rsvp';
import { friendlyError, validateRsvp } from '../../utils/validate';
Page({
  data: {
    copy: uiCopy.rsvp,
    isMock,
    guestName: '',
    attending: true,
    partySize: 1,
    note: '',
    consent: false,
    loading: true,
    loadFailed: false,
    saving: false,
    error: '',
    saved: false,
    existing: false,
    updatedAt: '',
  },
  seenRevision: 0,
  onLoad() {
    this.seenRevision = getRsvpRevision();
    void this.load();
  },
  onShow() {
    if (this.seenRevision !== getRsvpRevision()) void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '', loadFailed: false });
    try {
      const mine = await rsvpService.getMine();
      this.seenRevision = getRsvpRevision();
      if (mine)
        this.setData({
          guestName: mine.guestName,
          attending: mine.attending,
          partySize: mine.partySize,
          note: mine.note,
          consent: mine.consent,
          existing: true,
          updatedAt: formatUpdatedAt(mine.updatedAt),
        });
      else
        this.setData({
          guestName: '',
          attending: true,
          partySize: 1,
          note: '',
          consent: false,
          existing: false,
          saved: false,
          updatedAt: '',
        });
    } catch (error) {
      this.setData({ error: friendlyError(error), loadFailed: true });
    } finally {
      this.setData({ loading: false });
    }
  },
  nameInput(event: WechatMiniprogram.Input) {
    this.setData({ guestName: event.detail.value, saved: false });
  },
  noteInput(event: WechatMiniprogram.Input) {
    this.setData({ note: event.detail.value, saved: false });
  },
  attend(event: WechatMiniprogram.TouchEvent) {
    const attending = event.currentTarget.dataset.value === 'yes';
    this.setData({
      attending,
      partySize: attending ? Math.max(1, this.data.partySize) : 0,
      saved: false,
    });
  },
  step(event: WechatMiniprogram.TouchEvent) {
    this.setData({
      partySize: Math.max(
        1,
        Math.min(
          10,
          this.data.partySize + Number(event.currentTarget.dataset.delta),
        ),
      ),
      saved: false,
    });
  },
  consentChange(event: WechatMiniprogram.CheckboxGroupChange) {
    this.setData({
      consent: event.detail.value.includes('agree'),
      saved: false,
    });
  },
  async submit() {
    if (this.data.saving || this.data.loading || this.data.loadFailed) return;
    const input = {
      guestName: this.data.guestName,
      attending: this.data.attending,
      partySize: this.data.partySize,
      note: this.data.note,
      consent: this.data.consent,
    };
    const error = validateRsvp(input);
    if (error) {
      this.setData({ error, saved: false });
      return;
    }
    this.setData({ saving: true, error: '', saved: false });
    try {
      const result = await rsvpService.save(input);
      this.seenRevision = getRsvpRevision();
      this.setData({
        existing: true,
        saved: true,
        updatedAt: formatUpdatedAt(result.updatedAt),
      });
      wx.showToast({
        title: isMock ? uiCopy.rsvp.text34 : uiCopy.rsvp.text35,
        icon: 'success',
      });
    } catch (error) {
      this.setData({ error: friendlyError(error) });
    } finally {
      this.setData({ saving: false });
    }
  },
});
