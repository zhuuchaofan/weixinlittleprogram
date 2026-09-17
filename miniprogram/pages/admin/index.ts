import { formatUpdatedAt } from '../../utils/date';
import { uiCopy } from '../../config/ui-copy';
import { rsvpService, isMock } from '../../services/rsvp';
import { guestbookService } from '../../services/guestbook';
import { friendlyError } from '../../utils/validate';
import type {
  Dashboard,
  GuestMessageDashboard,
  GuestMessageRecord,
  RsvpRecord,
} from '../../models';

function formatRecords(records: RsvpRecord[]): RsvpRecord[] {
  return records.map((record) => ({
    ...record,
    updatedAt: formatUpdatedAt(record.updatedAt),
  }));
}
function formatMessages(records: GuestMessageRecord[]): GuestMessageRecord[] {
  return records.map((record) => ({
    ...record,
    updatedAt: formatUpdatedAt(record.updatedAt),
  }));
}

Page({
  data: {
    copy: uiCopy.admin,
    isMock,
    loading: false,
    authorized: false,
    error: '',
    records: [] as RsvpRecord[],
    summary: {
      responses: 0,
      attending: 0,
      guests: 0,
      declined: 0,
    } as Dashboard['summary'],
    nextCursor: '',
    messages: [] as GuestMessageRecord[],
    messageSummary: { messages: 0 } as GuestMessageDashboard['summary'],
    messageNextCursor: '',
  },
  onShow() {
    this.setData({ records: [], messages: [], authorized: false });
    void this.load();
  },
  async load() {
    if (this.data.loading) return;
    this.setData({
      loading: true,
      error: '',
      authorized: false,
      records: [],
      messages: [],
      nextCursor: '',
      messageNextCursor: '',
    });
    try {
      const [rsvp, guestbook] = await Promise.all([
        rsvpService.dashboard(),
        guestbookService.dashboard(),
      ]);
      this.setData({
        ...rsvp,
        records: formatRecords(rsvp.records),
        messages: formatMessages(guestbook.records),
        messageSummary: guestbook.summary,
        messageNextCursor: guestbook.nextCursor,
        authorized: true,
      });
    } catch (error) {
      this.setData({ error: friendlyError(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  async more() {
    if (this.data.loading || !this.data.nextCursor) return;
    this.setData({ loading: true, error: '' });
    try {
      const result = await rsvpService.dashboard(this.data.nextCursor);
      this.setData({
        ...result,
        records: [...this.data.records, ...formatRecords(result.records)],
      });
    } catch (error) {
      this.setData({
        error: friendlyError(error),
        authorized: false,
        records: [],
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  async moreMessages() {
    if (this.data.loading || !this.data.messageNextCursor) return;
    this.setData({ loading: true, error: '' });
    try {
      const result = await guestbookService.dashboard(
        this.data.messageNextCursor,
      );
      this.setData({
        messages: [...this.data.messages, ...formatMessages(result.records)],
        messageSummary: result.summary,
        messageNextCursor: result.nextCursor,
      });
    } catch (error) {
      this.setData({
        error: friendlyError(error),
        authorized: false,
        messages: [],
      });
    } finally {
      this.setData({ loading: false });
    }
  },
});
