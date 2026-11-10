import type { InsightSummary, YearReview } from '../../models';
import { getYear, writeYearNote } from '../../services/year';
import { ApiError, errorMessage } from '../../services/cloud';
import { categoryLook } from '../../config/options';
import { formatTimestamp, shortDate, todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';
import { applyTheme, currentTheme, themeData } from '../../services/theme';

/**
 * 年度情侣账单回顾（会员）：一年一起花了多少、每个月、花在哪、之最、一起吃的和去过的，加喵喵的年度寄语。
 * 不是会员只看封面。可以存成一张图（画在屏幕外的 canvas 上，再交给微信的分享图片菜单），也能把页面分享给 TA。
 */
const thisYear = () => todayKey().slice(0, 4);
const POSTER = { width: 375, height: 600 };

/** 画海报用到的那几样 canvas 2d 接口（小程序的类型里没有 DOM 的 CanvasRenderingContext2D）。 */
interface Ctx {
  fillStyle: unknown;
  font: string;
  textAlign: string;
  textBaseline: string;
  scale(x: number, y: number): void;
  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): { addColorStop(offset: number, color: string): void };
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

function noteView(note: InsightSummary | null) {
  return {
    noteText: note?.text || '',
    noteHint: note
      ? note.stale
        ? '写完之后这一年有新的变化，可以重新写'
        : `${formatTimestamp(note.ts)} 写的`
      : '',
  };
}

function view(review: YearReview) {
  const { spend } = review;
  const cover = [
    `记了 ${spend.count} 笔`,
    review.togetherDay ? `在一起第 ${review.togetherDay} 天` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const base = { totalText: formatYuan(spend.total), coverText: cover };
  if (review.locked)
    return { ...base, locked: true, quiet: false, ...noteView(null) };
  const months = spend.months || [];
  const max = Math.max(1, ...months.map((row) => row.amount));
  const peak = spend.peakMonth?.month;
  const top = (spend.top || []).map((row) => ({
    cat: row.cat,
    color: categoryLook(row.cat).color,
    amountText: formatYuan(row.amount),
    share: spend.total
      ? `${Math.round((row.amount / spend.total) * 100)}%`
      : '',
  }));
  const facts: Array<{ label: string; value: string }> = [];
  if (spend.peakMonth)
    facts.push({
      label: '花得最多的月',
      value: `${Number(spend.peakMonth.month.slice(5))} 月 · ${formatYuan(spend.peakMonth.amount)}`,
    });
  if (spend.biggest)
    facts.push({
      label: '最大的一笔',
      value: `${shortDate(spend.biggest.date)} ${spend.biggest.note || spend.biggest.cat} · ${formatYuan(spend.biggest.amount)}`,
    });
  if (spend.count) {
    facts.push({ label: '平均每天', value: formatYuan(spend.perDay || 0) });
    facts.push({ label: '没花钱的日子', value: `${spend.freeDays || 0} 天` });
  }
  const meals = review.meals || { count: 0, top: [] };
  const places = review.places || { count: 0, titles: [] };
  const todos = review.todos?.count || 0;
  const saved = review.saved || 0;
  const together = [
    {
      label: '吃',
      on: meals.count > 0,
      text: meals.count
        ? `「就吃这个」${meals.count} 顿，最常吃 ${meals.top.map((row) => `${row.title}（${row.count}）`).join('、')}`
        : '还没记过「就吃这个」',
    },
    {
      label: '去过',
      on: places.count > 0,
      text: places.count
        ? `${places.count} 个地方：${places.titles.join('、')}`
        : '还没有标「去过了」的地方',
    },
    {
      label: '做完',
      on: todos > 0,
      text: todos ? `${todos} 件待办` : '还没勾完过待办',
    },
    {
      label: '攒下',
      on: saved > 0,
      text: saved ? formatYuan(saved) : '还没存过钱',
    },
  ];
  return {
    ...base,
    locked: false,
    quiet: !spend.count,
    months: months.map((row) => ({
      label: `${Number(row.month.slice(5))}月`,
      percent: Math.round((row.amount / max) * 100),
      amountText: row.amount ? formatYuan(row.amount) : '—',
      peak: row.month === peak,
    })),
    top,
    facts,
    together,
    ...noteView(review.note),
  };
}

/** 主题的渐变色（取 swatch 里的几个色值），画海报的底色用。 */
function themeColors(): string[] {
  const colors = currentTheme().swatch.match(/#[0-9a-fA-F]{3,8}/g) || [];
  return colors.length ? colors : [currentTheme().accent];
}

Page({
  data: {
    ...themeData(),
    year: thisYear(),
    isThisYear: true,
    loading: false,
    ready: false,
    error: '',
    locked: false,
    quiet: false,
    totalText: '',
    coverText: '',
    months: [] as Array<{
      label: string;
      percent: number;
      amountText: string;
      peak: boolean;
    }>,
    top: [] as Array<{
      cat: string;
      color: string;
      amountText: string;
      share: string;
    }>,
    facts: [] as Array<{ label: string; value: string }>,
    together: [] as Array<{ label: string; text: string; on: boolean }>,
    noteText: '',
    noteHint: '',
    noteError: '',
    writing: false,
    drawing: false,
    posterWidth: POSTER.width,
    posterHeight: POSTER.height,
  },
  review: null as YearReview | null,
  onLoad(options: Record<string, string | undefined>) {
    const year =
      options.year && /^\d{4}$/.test(options.year) ? options.year : thisYear();
    this.setData({ year, isThisYear: year === thisYear() });
  },
  onShow() {
    applyTheme(this);
    if (!this.data.ready) void this.load();
  },
  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh());
  },
  async load() {
    const year = this.data.year;
    this.setData({ loading: true, error: '' });
    try {
      const review = await getYear(year);
      if (this.data.year !== year) return;
      this.review = review;
      this.setData({ ...view(review), ready: true });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  changeYear(event: WechatMiniprogram.TouchEvent) {
    const year = String(
      Number(this.data.year) + Number(event.currentTarget.dataset.delta),
    );
    if (year > thisYear()) return;
    this.review = null;
    this.setData({
      year,
      isThisYear: year === thisYear(),
      ready: false,
      noteError: '',
    });
    void this.load();
  },
  openVip() {
    wx.navigateTo({ url: '/pages/vip/index' });
  },
  async writeNote() {
    if (this.data.writing) return;
    const year = this.data.year;
    this.setData({ writing: true, noteError: '' });
    try {
      const note = await writeYearNote(year);
      if (this.data.year === year) this.setData(noteView(note));
    } catch (error) {
      if (this.data.year !== year) return;
      if (error instanceof ApiError && error.code === 'NETWORK') {
        // 模型慢时小程序可能先断开，云端照常写完：再读一次。
        await this.load();
      } else this.setData({ noteError: errorMessage(error) });
    } finally {
      this.setData({ writing: false });
    }
  },
  /** 把封面、花在哪、一起做的事画成一张竖图，交给微信的图片菜单（发给朋友、存到手机都在里面）。 */
  savePoster() {
    const review = this.review;
    if (!review || review.locked || this.data.drawing) return;
    this.setData({ drawing: true });
    const done = () => this.setData({ drawing: false });
    wx.createSelectorQuery()
      .in(this)
      .select('#poster')
      .fields({ node: true, size: true })
      .exec((result) => {
        const canvas = result?.[0]?.node as
          WechatMiniprogram.Canvas | undefined;
        if (!canvas) {
          done();
          wx.showToast({ title: '这台手机画不了图，截个屏也行', icon: 'none' });
          return;
        }
        const ratio = 2;
        canvas.width = POSTER.width * ratio;
        canvas.height = POSTER.height * ratio;
        const ctx = canvas.getContext('2d') as unknown as Ctx;
        ctx.scale(ratio, ratio);
        this.drawPoster(ctx, review);
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          success: ({ tempFilePath }) => {
            done();
            if (wx.showShareImageMenu)
              wx.showShareImageMenu({ path: tempFilePath });
            else wx.previewImage({ urls: [tempFilePath] });
          },
          fail: () => {
            done();
            wx.showToast({ title: '图没画出来，稍后再试一次吧', icon: 'none' });
          },
        });
      });
  },
  drawPoster(ctx: Ctx, review: YearReview) {
    const { width, height } = POSTER;
    const colors = themeColors();
    const grad = ctx.createLinearGradient(0, 0, width, height);
    colors.forEach((color, index) =>
      grad.addColorStop(
        colors.length > 1 ? index / (colors.length - 1) : 0,
        color,
      ),
    );
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    const text = (
      value: string,
      x: number,
      y: number,
      size: number,
      bold = false,
    ) => {
      ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
      ctx.fillText(value, x, y);
    };
    text(`${review.year} 年我们一起花了`, 28, 40, 15);
    text(formatYuan(review.spend.total), 28, 64, 40, true);
    text(this.data.coverText, 28, 116, 13);
    let y = 160;
    text('花在哪', 28, y, 15, true);
    y += 28;
    for (const row of this.data.top.slice(0, 5)) {
      text(`${row.cat}  ${row.share}`, 28, y, 14);
      ctx.textAlign = 'right';
      text(row.amountText, width - 28, y, 14);
      ctx.textAlign = 'left';
      y += 24;
    }
    y += 16;
    text('这一年一起', 28, y, 15, true);
    y += 28;
    for (const row of this.data.together.filter((item) => item.on)) {
      const line = `${row.label}：${row.text}`;
      text(line.length > 24 ? `${line.slice(0, 23)}…` : line, 28, y, 14);
      y += 24;
    }
    text('喵喵记一笔 · 我们俩的小账本', 28, height - 40, 12);
  },
  onShareAppMessage() {
    return {
      title: `我们的 ${this.data.year} 年度回顾`,
      path: '/pages/home/index',
    };
  },
});
