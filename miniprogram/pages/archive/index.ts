import type { Archive } from '../../models';
import { getArchive } from '../../services/archive';
import { withLoading } from '../../services/page-load';
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
  load() {
    return withLoading(this, async () => {
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
    });
  },
});
