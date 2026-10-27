import type { BillItem, BillStatus, Flow, Household } from '../../models';
import { getHousehold, memberNames } from '../../services/household';
import {
  importBills,
  matchBills,
  parseScreenshot,
  takePendingImages,
} from '../../services/bills';
import { ApiError, errorMessage } from '../../services/cloud';
import { CATEGORIES, FLOWS, LENGTHS } from '../../config/options';
import { shortDate, todayKey } from '../../utils/date';
import { fenToInput, formatYuan, parseYuan } from '../../utils/money';
import { applyTheme, themeData } from '../../services/theme';

// 一次同时识别几张：太多容易超时，太少等得久。
const PARALLEL = 3;

// 等待时轮流显示的小提示。
const TIPS = [
  '小猫正在一笔一笔对账…',
  '先喝口茶，马上就好',
  '在核对日期和金额',
  '顺便看看有没有记过的',
];
const TIP_MS = 2500;
let tipTimer: number | undefined;

function stopTips(): void {
  if (tipTimer !== undefined) clearInterval(tipTimer);
  tipTimer = undefined;
}

const STATUS_TEXT: Record<BillStatus, string> = {
  imported: '已导入过',
  possible: '可能已记过',
  partner: '你们俩之间的转账，默认不记',
  new: '',
};

/** 云函数还是旧版时可能回来不认识的 status（如 likely）：没勾的都要说明原因。 */
function statusText(status: BillStatus | undefined): string {
  if (!status) return '';
  return STATUS_TEXT[status] ?? STATUS_TEXT.possible;
}

type Row = BillItem & {
  selected: boolean;
  expanded: boolean;
  amountInput: string;
  amountText: string;
  dateText: string;
  statusText: string;
  matchText: string;
  showDate: boolean;
};

let household: Household | null = null;

/** 只有新的默认勾选；已导入过、可能已记过、两人互转、读不全的默认不勾。 */
function defaultSelected(item: BillItem): boolean {
  if (item.problem) return false;
  return item.status === 'new';
}

function matchText(item: BillItem): string {
  const match = item.match;
  if (!match || !household) return '';
  const who =
    match.byRole === household.myRole
      ? '我'
      : memberNames(household)[match.byRole || 'a'];
  return `${who}记过：${shortDate(match.date)} ${match.note || '（无备注）'} ${formatYuan(match.amount)}`;
}

function present(item: BillItem, previous?: Row): Row {
  return {
    ...item,
    selected: previous ? previous.selected : defaultSelected(item),
    expanded: previous ? previous.expanded : false,
    amountInput: previous ? previous.amountInput : fenToInput(item.amount),
    amountText:
      (item.flow === 'in' ? '+' : '') +
      (item.amount ? formatYuan(item.amount) : '¥?'),
    dateText: item.date ? shortDate(item.date) : '日期待补',
    statusText: statusText(item.status),
    matchText: matchText(item),
    showDate: false,
  };
}

/** 按日期从新到旧；同一天只在第一笔上方显示日期。 */
function arrange(rows: Row[]): Row[] {
  const sorted = [...rows].sort(
    (a, b) =>
      (b.date || '9').localeCompare(a.date || '9') ||
      b.time.localeCompare(a.time),
  );
  return sorted.map((row, index) => ({
    ...row,
    showDate: index === 0 || sorted[index - 1].date !== row.date,
  }));
}

Page({
  data: {
    ...themeData(),
    phase: 'reading' as 'reading' | 'review' | 'empty',
    progressText: '',
    tip: TIPS[0],
    failures: [] as string[],
    // 今天的识别次数用完了：失败提示下面给一个去会员页的入口。
    limitHit: false,
    rows: [] as Row[],
    selectedCount: 0,
    summaryText: '',
    categories: CATEGORIES,
    flows: FLOWS,
    limits: LENGTHS,
    today: todayKey(),
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
  },
  onLoad() {
    const paths = takePendingImages();
    if (!paths.length) {
      wx.navigateBack();
      return;
    }
    let index = 0;
    tipTimer = setInterval(() => {
      index = (index + 1) % TIPS.length;
      this.setData({ tip: TIPS[index] });
    }, TIP_MS);
    void this.read(paths).finally(stopTips);
  },
  onUnload() {
    stopTips();
  },
  async read(paths: string[]) {
    try {
      household = await getHousehold();
    } catch (error) {
      this.setData({ phase: 'empty', error: errorMessage(error) });
      return;
    }
    const found: BillItem[][] = [];
    const failures: string[] = [];
    let done = 0;
    const progress = () =>
      this.setData({
        progressText: `正在识别 ${Math.min(done + 1, paths.length)}/${paths.length} 张截图…`,
      });
    progress();
    let next = 0;
    const worker = async () => {
      while (next < paths.length) {
        const index = next++;
        try {
          found[index] = await parseScreenshot(paths[index], index);
        } catch (error) {
          failures.push(`第 ${index + 1} 张：${errorMessage(error)}`);
          if (error instanceof ApiError && error.code === 'LIMIT')
            this.setData({ limitHit: true });
        }
        done++;
        progress();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, paths.length) }, worker),
    );
    // 按截图顺序合并，连续截图的重叠部分由 bill.match 去掉。
    const items = found.flat().filter(Boolean);
    failures.sort();
    if (!items.length) {
      this.setData({
        phase: 'empty',
        failures,
        error: failures.length ? '' : '截图里没有读到账目。',
      });
      return;
    }
    this.setData({ progressText: '正在和已记的账比对…' });
    let matched: BillItem[];
    try {
      matched = await matchBills(items);
    } catch (error) {
      this.setData({ phase: 'empty', failures, error: errorMessage(error) });
      return;
    }
    this.setData({ phase: 'review', failures });
    this.show(arrange(matched.map((item) => present(item))));
  },
  show(rows: Row[]) {
    const selected = rows.filter((row) => row.selected).length;
    const flagged = rows.filter(
      (row) => row.status && row.status !== 'new' && !row.selected,
    ).length;
    this.setData({
      rows,
      selectedCount: selected,
      summaryText:
        `识别出 ${rows.length} 笔` +
        (flagged ? `，${flagged} 笔可能已记过或不用记，已取消勾选` : ''),
    });
  },
  /** 改了某一行之后重新算显示字段。 */
  update(index: number, fields: Partial<Row>) {
    const rows = [...this.data.rows];
    const row = { ...rows[index], ...fields };
    const problems = [
      !row.amount && '金额没读出来',
      !row.date && '日期没读出来',
    ].filter(Boolean);
    rows[index] = present({ ...row, problem: problems.join('，') }, row);
    rows[index].showDate = this.data.rows[index].showDate;
    this.show(rows);
  },
  indexOf(event: WechatMiniprogram.BaseEvent): number {
    return Number(event.currentTarget.dataset.index);
  },
  toggle(event: WechatMiniprogram.TouchEvent) {
    const index = this.indexOf(event);
    const row = this.data.rows[index];
    if (!row.selected && row.problem) {
      this.update(index, { expanded: true });
      wx.showToast({ title: row.problem, icon: 'none' });
      return;
    }
    this.update(index, { selected: !row.selected });
  },
  expand(event: WechatMiniprogram.TouchEvent) {
    const index = this.indexOf(event);
    this.update(index, { expanded: !this.data.rows[index].expanded });
  },
  inputAmount(event: WechatMiniprogram.Input) {
    this.update(this.indexOf(event), {
      amountInput: event.detail.value,
      amount: parseYuan(event.detail.value),
    });
  },
  inputNote(event: WechatMiniprogram.Input) {
    this.update(this.indexOf(event), { note: event.detail.value });
  },
  pickDate(event: WechatMiniprogram.PickerChange) {
    this.update(this.indexOf(event), {
      date: String(event.detail.value),
      dateGuessed: false,
    });
  },
  chooseCat(event: WechatMiniprogram.TouchEvent) {
    this.update(this.indexOf(event), {
      cat: String(event.currentTarget.dataset.value),
    });
  },
  chooseFlow(event: WechatMiniprogram.TouchEvent) {
    this.update(this.indexOf(event), {
      flow: event.currentTarget.dataset.value as Flow,
    });
  },
  async save() {
    if (this.data.busy) return;
    const chosen = this.data.rows.filter((row) => row.selected);
    if (!chosen.length) return;
    const broken = chosen.find((row) => row.problem);
    if (broken) {
      this.setData({ error: `有一笔${broken.problem}，请补好或取消勾选。` });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const result = await importBills(
        chosen.map((row) => ({
          amount: row.amount,
          note: row.note.trim(),
          cat: row.cat,
          date: row.date,
          flow: row.flow,
          src: row.src,
        })),
      );
      wx.showToast({
        title: result.skipped
          ? `已记 ${result.added} 笔，${result.skipped} 笔之前导入过`
          : `已记 ${result.added} 笔`,
        icon: result.skipped ? 'none' : 'success',
      });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error) {
      this.setData({ error: errorMessage(error), busy: false });
    }
  },
  openVip() {
    wx.navigateTo({ url: '/pages/vip/index' });
  },
  back() {
    wx.navigateBack();
  },
});
