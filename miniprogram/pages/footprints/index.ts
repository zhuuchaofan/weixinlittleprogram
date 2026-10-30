import type { Footprint } from '../../models';
import { footprintService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { photoUrls } from '../../services/photos';
import { formatYuan } from '../../utils/money';
import { applyTheme, themeData } from '../../services/theme';

interface Row {
  id: string;
  title: string;
  dateText: string;
  memo: string;
  spentText: string;
  photos: string[];
}

function toRow(item: Footprint, urls: Record<string, string>): Row {
  return {
    id: item.id,
    title: item.title,
    dateText: item.doneOn ? item.doneOn.replace(/-/g, '.') : '',
    memo: item.memo,
    spentText: item.spent > 0 ? `那天一起花了 ¥${formatYuan(item.spent)}` : '',
    photos: item.photos.map((id) => urls[id]).filter(Boolean),
  };
}

Page({
  data: {
    ...themeData(),
    rows: [] as Row[],
    loading: true,
    error: '',
  },
  onShow() {
    applyTheme(this);
    void this.load();
  },
  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh());
  },
  async load() {
    try {
      const items = await footprintService.list();
      const urls = await photoUrls(items.flatMap((item) => item.photos));
      this.setData({
        rows: items.map((item) => toRow(item, urls)),
        error: '',
      });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  preview(event: WechatMiniprogram.TouchEvent) {
    const { row, url } = event.currentTarget.dataset;
    const current = this.data.rows.find((item) => item.id === row);
    if (current)
      void wx.previewImage({ current: String(url), urls: current.photos });
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/wish-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
});
