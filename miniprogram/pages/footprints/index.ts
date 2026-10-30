import type { Footprint } from '../../models';
import { footprintService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { photoUrls } from '../../services/photos';
import { formatYuan } from '../../utils/money';
import { applyTheme, themeData } from '../../services/theme';

/** 一次画这么多条；往下滑再加。 */
const BATCH = 12;

interface Row {
  id: string;
  title: string;
  dateText: string;
  memo: string;
  spent: number;
  spentText: string;
  both: boolean;
  photoIds: string[];
  photos: string[];
  /** 相纸里第一张照片；其余张数写在角标上。 */
  cover: string;
  month: string;
}

function toRow(item: Footprint): Row {
  return {
    id: item.id,
    title: item.title,
    dateText: item.doneOn ? item.doneOn.slice(5).replace('-', '.') : '',
    memo: item.memo,
    spent: item.spent,
    spentText: item.spent > 0 ? `花了 ¥${formatYuan(item.spent)}` : '',
    both: item.both,
    photoIds: item.photos,
    photos: [],
    cover: '',
    month: item.doneOn ? `${Number(item.doneOn.slice(5, 7))} 月` : '',
  };
}

let all: Row[] = [];

Page({
  data: {
    ...themeData(),
    years: [] as Array<{ year: string; places: number }>,
    year: '',
    total: { places: 0, photos: 0 },
    since: '',
    // 每个月一组，每组分左右两列。
    groups: [] as Array<{
      month: string;
      count: number;
      left: Row[];
      right: Row[];
    }>,
    shown: 0,
    more: false,
    loading: true,
    error: '',
  },
  onShow() {
    applyTheme(this);
    void this.load(this.data.year);
  },
  onPullDownRefresh() {
    void this.load(this.data.year).finally(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    if (this.data.more) void this.showMore();
  },
  async load(year = '') {
    try {
      const page = await footprintService.list(year);
      all = page.items.map(toRow);
      const oldest = page.years[page.years.length - 1]?.year;
      this.setData({
        years: page.years,
        year: page.year,
        total: page.total,
        since: oldest && oldest !== '0' ? `${oldest} 年起` : '',
        shown: 0,
        groups: [],
        error: '',
      });
      await this.showMore();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  pickYear(event: WechatMiniprogram.TouchEvent) {
    const year = String(event.currentTarget.dataset.year);
    if (year === this.data.year) return;
    this.setData({ loading: true });
    void this.load(year);
  },
  /** 再画一批：只给这一批取照片地址。 */
  async showMore() {
    const from = this.data.shown;
    const batch = all.slice(from, from + BATCH);
    const urls = await photoUrls(batch.flatMap((row) => row.photoIds));
    for (const row of batch) {
      row.photos = row.photoIds.map((id) => urls[id]).filter(Boolean);
      row.cover = row.photos[0] || '';
    }
    const groups = [...this.data.groups];
    batch.forEach((row) => {
      let group = groups[groups.length - 1];
      if (!group || group.month !== row.month) {
        group = { month: row.month, count: 0, left: [], right: [] };
        groups.push(group);
      }
      group.count += 1;
      (group.count % 2 === 1 ? group.left : group.right).push(row);
    });
    this.setData({
      groups,
      shown: from + batch.length,
      more: from + batch.length < all.length,
    });
  },
  preview(event: WechatMiniprogram.TouchEvent) {
    const row = all.find((item) => item.id === event.currentTarget.dataset.id);
    if (row?.photos.length)
      void wx.previewImage({ current: row.photos[0], urls: row.photos });
  },
  /** 点相纸：看这一条的回忆页，要改再从那里点「编辑」。 */
  open(event: WechatMiniprogram.TouchEvent) {
    const row = all.find((item) => item.id === event.currentTarget.dataset.id);
    wx.navigateTo({
      url: `/pages/memory/index?id=${event.currentTarget.dataset.id}&spent=${row?.spent || 0}`,
    });
  },
  /** 补记以前去过的地方。 */
  addPast() {
    wx.navigateTo({ url: '/pages/wish-edit/index?past=1' });
  },
});
