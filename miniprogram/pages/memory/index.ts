import { dateService, wishService } from '../../services/collections';
import { errorMessage } from '../../services/cloud';
import { photoUrls } from '../../services/photos';
import { daysBetween, todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';
import { applyTheme, themeData } from '../../services/theme';

/** 那天一起花的钱（分），从足迹页带过来。 */
let spent = 0;

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 2026-10-12 → 2026.10.12 · 周一 */
function dateLine(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${date.replace(/-/g, '.')} · 周${WEEKDAYS[new Date(y, m - 1, d).getDay()]}`;
}

/** 只读的回忆页：照片、日期、一句话，和几个小数字；要改点「编辑」。 */
Page({
  data: {
    ...themeData(),
    id: '',
    title: '',
    dateText: '',
    subText: '',
    memo: '',
    note: '',
    photos: [] as string[],
    chips: [] as string[],
    loading: true,
    error: '',
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id || '' });
    spent = Number(options.spent) || 0;
  },
  onShow() {
    applyTheme(this);
    void this.load();
  },
  async load() {
    const id = this.data.id;
    if (!id) return;
    try {
      const [wish, dates] = await Promise.all([
        wishService.get(id),
        dateService.list().catch(() => []),
      ]);
      const start = dates.find((item) => item.together)?.date;
      const doneOn = wish.doneOn || '';
      const day = start && doneOn ? daysBetween(start, doneOn) + 1 : 0;
      const waited = doneOn ? daysBetween(todayKey(wish.ts), doneOn) : 0;
      wx.setNavigationBarTitle({ title: wish.title });
      const chips: string[] = [];
      if (wish.wants?.a && wish.wants?.b) chips.push('♥ 两个人都想去');
      if (waited >= 1) chips.push(`想了 ${waited} 天才去成`);
      if (spent > 0) chips.push(`那天一起花了 ${formatYuan(spent)}`);
      this.setData({
        title: wish.title,
        dateText: doneOn ? dateLine(doneOn) : '日子没记',
        subText: day >= 1 ? `在一起第 ${day} 天` : '',
        memo: wish.memo || '',
        note: [wish.why, wish.plan].filter(Boolean).join('\n'),
        chips,
        loading: false,
        error: '',
      });
      const urls = await photoUrls(wish.photos || []);
      this.setData({
        photos: (wish.photos || []).map((photo) => urls[photo]).filter(Boolean),
      });
    } catch (error) {
      this.setData({ loading: false, error: errorMessage(error) });
    }
  },
  preview(event: WechatMiniprogram.TouchEvent) {
    void wx.previewImage({
      current: String(event.currentTarget.dataset.url),
      urls: this.data.photos,
    });
  },
  edit() {
    wx.navigateTo({ url: `/pages/wish-edit/index?id=${this.data.id}` });
  },
});
