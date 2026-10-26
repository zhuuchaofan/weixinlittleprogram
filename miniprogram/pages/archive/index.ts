import type { Archive } from '../../models';
import { getArchive } from '../../services/archive';
import { errorMessage } from '../../services/cloud';
import { formatDateTime } from '../../utils/date';
import { applyTheme, themeData } from '../../services/theme';

Page({
  data: {
    ...themeData(),
    loading: true,
    error: '',
    archive: null as Archive | null,
  },
  onShow() {
    applyTheme(this);
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
