import type { BillItem, FileSkipped, Household } from '../../models';
import { getHousehold, memberNames } from '../../services/household';
import {
  importBills,
  matchBills,
  parseBillFile,
  type FileApp,
  parseScreenshot,
  takePendingFile,
  takePendingImages,
} from '../../services/bills';
import { ApiError, errorMessage } from '../../services/cloud';
import { shortDate, todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';
import { arrange, toRow, type DraftRow } from '../../utils/drafts';
import { applyTheme, themeData } from '../../services/theme';

// 一次同时识别几张：太多容易超时，太少等得久。
const PARALLEL = 3;
// 保存时每次提交几笔（expense.addMany 的上限）。
const SAVE_BATCH = 100;

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

let household: Household | null = null;
// 确认列表的全部行。账单文件一次可能上千笔，页面上只放当前月份的那些，其余留在这里。
let allRows: DraftRow[] = [];

interface MonthTab {
  month: string;
  label: string;
  count: number;
}

function monthTabs(rows: DraftRow[]): MonthTab[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const month = row.date.slice(0, 7) || '';
    counts.set(month, (counts.get(month) || 0) + 1);
  }
  const months = [...counts.keys()].sort((a, b) =>
    (b || '9').localeCompare(a || '9'),
  );
  // 跨年时（导了一整年）带上年份，免得两个「11月」分不清。
  const years = new Set(months.filter(Boolean).map((m) => m.slice(0, 4)));
  return months.map((month) => ({
    month,
    label: !month
      ? '日期待补'
      : (years.size > 1 ? `${month.slice(2, 4)}年` : '') +
        `${Number(month.slice(5))}月`,
    count: counts.get(month) || 0,
  }));
}

function skippedText(skipped: FileSkipped): string {
  const parts = [
    skipped.refunded && `${skipped.refunded} 笔退款已从原账扣掉`,
    skipped.neutral && `${skipped.neutral} 笔提现、零钱通等不计收支`,
    skipped.closed && `${skipped.closed} 笔没付成`,
    skipped.broken && `${skipped.broken} 笔读不全`,
  ].filter(Boolean);
  return parts.length ? `已跳过：${parts.join('，')}。` : '';
}

// 提示里引用已记账目的备注最多显示几个字，免得一条提示撑成好几行。
const NOTE_SHOW = 12;

function clip(text: string): string {
  return text.length > NOTE_SHOW ? `${text.slice(0, NOTE_SHOW)}…` : text;
}

function matchText(item: BillItem): string {
  const match = item.match;
  if (!match || !household) return '';
  const who =
    match.byRole === household.myRole
      ? '我'
      : memberNames(household)[match.byRole || 'a'];
  return `${who}记过：${shortDate(match.date)} ${clip(match.note) || '（无备注）'} ${formatYuan(match.amount)}`;
}

const present = (item: BillItem): DraftRow => toRow(item, matchText(item));

Page({
  data: {
    ...themeData(),
    mode: 'screenshot' as 'screenshot' | 'file',
    phase: 'reading' as 'reading' | 'review' | 'empty',
    progressText: '',
    tip: TIPS[0],
    failures: [] as string[],
    // 今天的识别次数用完了：失败提示下面给一个去会员页的入口。
    limitHit: false,
    rows: [] as DraftRow[],
    // 账单文件按月分页；截图导入只有一页，不显示月份。
    months: [] as MonthTab[],
    month: '',
    skippedText: '',
    selectedCount: 0,
    summaryText: '',
    saveText: '',
    today: todayKey(),
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
  },
  onLoad(query: Record<string, string | undefined>) {
    allRows = [];
    if (query.mode === 'file') {
      const { path, app } = takePendingFile();
      if (!path) {
        wx.navigateBack();
        return;
      }
      wx.setNavigationBarTitle({ title: '导入账单文件' });
      this.setData({ mode: 'file', progressText: '正在读取账单文件…' });
      void this.readFile(path, app);
      return;
    }
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
    allRows = matched.map(present);
    this.show();
  },
  /** 账单文件（微信 Excel、支付宝 CSV）：手机上读出几列 → 云端整理、查重。文件读完就丢，不上传。 */
  async readFile(path: string, app: FileApp) {
    try {
      household = await getHousehold();
      const { items, skipped } = await parseBillFile(path, app, (done, total) =>
        this.setData({ progressText: `正在整理账单 ${done}/${total} 笔…` }),
      );
      if (!items.length) {
        this.setData({
          phase: 'empty',
          error: `这份账单里没有要记的账。${skippedText(skipped)}`,
        });
        return;
      }
      allRows = items.map(present);
      const months = monthTabs(allRows);
      this.setData({
        phase: 'review',
        months,
        month: months[0].month,
        skippedText: skippedText(skipped),
      });
      this.show();
    } catch (error) {
      // 网络类错误把微信返回的原文也带上，方便定位是超时、请求太大还是云函数没部署好。
      const detail = error instanceof ApiError ? error.detail : '';
      this.setData({
        phase: 'empty',
        error:
          errorMessage(error) + (detail ? `\n${detail.slice(0, 200)}` : ''),
      });
    }
  },
  /** 当前月份的行放进页面，顶部统计按全部行算。 */
  show() {
    const file = this.data.mode === 'file';
    const visible = file
      ? allRows.filter((row) => row.date.slice(0, 7) === this.data.month)
      : allRows;
    const selected = allRows.filter((row) => row.selected).length;
    const flagged = allRows.filter(
      (row) => row.status && row.status !== 'new' && !row.selected,
    ).length;
    this.setData({
      rows: arrange(visible),
      selectedCount: selected,
      summaryText:
        `${file ? '读出' : '识别出'} ${allRows.length} 笔` +
        (flagged ? `，${flagged} 笔可能已记过或不用记，已取消勾选` : ''),
    });
  },
  /** 确认列表里勾选或改了一笔：换掉 allRows 里对应的行。 */
  changeRows(event: WechatMiniprogram.CustomEvent<{ rows: DraftRow[] }>) {
    const changed = new Map(event.detail.rows.map((row) => [row.key, row]));
    allRows = allRows.map((row) => changed.get(row.key) || row);
    this.show();
  },
  chooseMonth(event: WechatMiniprogram.TouchEvent) {
    this.setData({ month: String(event.currentTarget.dataset.month) });
    this.show();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  /** 这个月全选或全不选；读不全的不勾。 */
  selectMonth(event: WechatMiniprogram.TouchEvent) {
    const on = event.currentTarget.dataset.on === true;
    allRows = allRows.map((row) =>
      row.date.slice(0, 7) === this.data.month
        ? { ...row, selected: on && !row.problem }
        : row,
    );
    this.show();
  },
  async save() {
    if (this.data.busy) return;
    const chosen = allRows.filter((row) => row.selected);
    if (!chosen.length) return;
    const broken = chosen.find((row) => row.problem);
    if (broken) {
      this.setData({ error: `有一笔${broken.problem}，请补好或取消勾选。` });
      return;
    }
    this.setData({ busy: true, error: '' });
    const result = { added: 0, skipped: 0 };
    try {
      // 分批提交；中途失败时已保存的不会重复（_id 由交易指纹决定），重试即可。
      for (let i = 0; i < chosen.length; i += SAVE_BATCH) {
        if (chosen.length > SAVE_BATCH)
          this.setData({ saveText: `正在保存 ${i}/${chosen.length} 笔…` });
        const batch = await importBills(
          chosen.slice(i, i + SAVE_BATCH).map((row) => ({
            amount: row.amount,
            note: row.note.trim(),
            cat: row.cat,
            date: row.date,
            flow: row.flow,
            src: row.src,
          })),
        );
        result.added += batch.added;
        result.skipped += batch.skipped;
      }
      wx.showToast({
        title: result.skipped
          ? `已记 ${result.added} 笔，${result.skipped} 笔之前导入过`
          : `已记 ${result.added} 笔`,
        icon: result.skipped ? 'none' : 'success',
      });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error) {
      this.setData({
        error:
          errorMessage(error) +
          (result.added
            ? `（已保存 ${result.added} 笔，再点一次保存剩下的）`
            : ''),
        busy: false,
        saveText: '',
      });
    }
  },
  openVip() {
    wx.navigateTo({ url: '/pages/vip/index' });
  },
  back() {
    wx.navigateBack();
  },
});
