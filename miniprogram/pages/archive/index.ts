import type { Archive } from '../../models';
import { getArchive } from '../../services/archive';
import { errorMessage } from '../../services/cloud';
import { formatDateTime } from '../../utils/date';

Page({
  data: {
    loading: true,
    error: '',
    archive: null as Archive | null,
  },
  onLoad() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const archive = await getArchive();
      this.setData({
        archive: {
          ...archive,
          rsvps: archive.rsvps.map((item) => ({
            ...item,
            updatedAt: formatDateTime(item.updatedAt),
          })),
          messages: archive.messages.map((item) => ({
            ...item,
            updatedAt: formatDateTime(item.updatedAt),
          })),
        },
      });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
});
