import { formatUpdatedAt } from '../../utils/date';
import { uiCopy } from '../../config/ui-copy';
import { rsvpService, isMock } from '../../services/rsvp';
import { friendlyError } from '../../utils/validate';
import type { Dashboard, RsvpRecord } from '../../models';
function formatRecords(records: RsvpRecord[]): RsvpRecord[] {
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
  },
  onShow() {
    this.setData({ records: [], authorized: false });
    void this.load();
  },
  async load() {
    if (this.data.loading) return;
    this.setData({
      loading: true,
      error: '',
      authorized: false,
      records: [],
      nextCursor: '',
    });
    try {
      const result = await rsvpService.dashboard();
      this.setData({
        ...result,
        records: formatRecords(result.records),
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
});
