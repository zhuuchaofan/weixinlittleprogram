import type { Expense, Household, LedgerSummary } from '../../models';
import {
  byPartner,
  memberNames,
  peekHousehold,
} from '../../services/household';
import { listMonth, peekMonth, settleMonth } from '../../services/ledger';
import { needsReload } from '../../services/snapshot';
import { createLoader } from '../../services/page-load';
import { chooseBillImport } from '../../services/bills';
import { ApiError, errorMessage } from '../../services/cloud';
import {
  SETTLEMENT,
  SPLITS,
  billAppLabel,
  categoryLook,
} from '../../config/options';
import { monthLabel, shiftMonth, shortDate, todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';
import { confirmAction } from '../../utils/confirm';
import { applyTheme, themeData } from '../../services/theme';
import { budgetLine } from '../../utils/budget';
import { ledgerCsv } from '../../utils/csv';

type CategoryRow = {
  cat: string;
  amountText: string;
  percent: number;
  width: number;
  color: string;
  budget: ReturnType<typeof budgetLine>;
};

/** 占比四舍五入到整数；条宽就是占比（占满整条是 100%），太小的类至少画 2% 以免看不见。 */
function categoryRows(
  total: number,
  byCategory: LedgerSummary['byCategory'],
  spending: LedgerSummary['byCategory'],
  budgets: Record<string, number>,
): CategoryRow[] {
  // 预算按所有支出算（同 summary.spending），开了两人分摊时也一样。
  const spent = (cat: string) =>
    spending.find((row) => row.cat === cat)?.amount || 0;
  return byCategory.map(({ cat, amount }) => {
    const percent = total ? Math.round((amount * 100) / total) : 0;
    return {
      cat,
      amountText: formatYuan(amount),
      percent,
      width: total ? Math.max(2, percent) : 0,
      color: categoryLook(cat).color,
      budget: budgetLine(spent(cat), budgets[cat]),
    };
  });
}

type Row = Expense & {
  amountText: string;
  dateText: string;
  payerName: string;
  splitText: string;
  isSettlement: boolean;
  byText: string;
  editedText: string;
  isIncome: boolean;
  sourceText: string;
  icon: string;
  tint: string;
};

/** 明细一次显示的笔数；滑到底再显示下一批。整月账目仍一次读完（汇总要用），只是分批渲染。 */
const BATCH = 30;

const loader = createLoader();
let household: Household | null = null;
/** 当月全部明细；records 里只放已经显示的前若干笔。 */
let allRows: Row[] = [];

Page({
  data: {
    ...themeData(),
    month: todayKey().slice(0, 7),
    monthText: monthLabel(todayKey().slice(0, 7)),
    isCurrentMonth: true,
    names: { a: '', b: '' },
    splitting: false,
    loading: true,
    busy: false,
    error: '',
    records: [] as Row[],
    total: 0,
    hasMore: false,
    summary: null as LedgerSummary | null,
    summaryText: { total: '', a: '', b: '', suggestion: '' },
    shareA: 50,
    categories: [] as CategoryRow[],
  },
  onShow() {
    applyTheme(this);
    if (!this.data.summary) this.showSnapshot();
    if (needsReload(`ledger:${this.data.month}`)) void this.load();
  },
  /** 冷启动：先显示上次存在本机的本月账目，云端读完再替换。 */
  showSnapshot() {
    const saved = peekMonth(this.data.month);
    household = peekHousehold();
    if (saved && household)
      this.show(memberNames(household), saved.records, saved.summary);
  },
  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  load(force = false) {
    const month = this.data.month;
    return loader(this, {
      key: `ledger:${month}`,
      force,
      fetch: () => listMonth(month),
      show: (result, current) => {
        household = current;
        this.show(memberNames(current), result.records, result.summary);
      },
    });
  },
  show(
    names: { a: string; b: string },
    records: Expense[],
    summary: LedgerSummary,
  ) {
    const splitLabel = (value: string) =>
      SPLITS.find((item) => item.value === value)?.label || '';
    // 不开两人分摊时只记账：统计所有支出，不显示怎么分和结算。
    const splitting = household?.splitting === true;
    const shown = splitting
      ? {
          total: summary.sharedTotal,
          paid: summary.paid,
          byCategory: summary.byCategory,
        }
      : summary.spending;
    allRows = records.map((record): Row => ({
      ...record,
      icon: categoryLook(record.cat).icon,
      tint: categoryLook(record.cat).tint,
      amountText: (record.flow === 'in' ? '+' : '') + formatYuan(record.amount),
      isIncome: record.flow === 'in',
      sourceText: record.src ? billAppLabel(record.src.app) + '导入' : '',
      dateText: shortDate(record.date),
      payerName: names[record.payer],
      splitText:
        record.cat === SETTLEMENT
          ? '结算'
          : record.flow === 'in'
            ? '收入'
            : !splitting
              ? ''
              : record.split === 'ratio' && record.ratio !== undefined
                ? `按比例 ${record.ratio}:${100 - record.ratio}`
                : splitLabel(record.split),
      isSettlement: record.cat === SETTLEMENT,
      byText: household ? byPartner(record.byRole, household, '记') : '',
      // 只提示对方改过的，自己改自己的不用提醒。
      editedText:
        household && record.editedByRole
          ? byPartner(record.editedByRole, household, '改过')
          : '',
    }));
    this.setData({
      names,
      summary,
      splitting,
      categories: categoryRows(
        shown.total,
        shown.byCategory,
        summary.spending.byCategory,
        household?.budgets || {},
      ),
      // 总卡片里那条白色进度条：左边是 A 付的占比。
      shareA:
        shown.paid.a + shown.paid.b
          ? Math.round((shown.paid.a * 100) / (shown.paid.a + shown.paid.b))
          : 50,
      summaryText: {
        total: formatYuan(shown.total),
        a: formatYuan(shown.paid.a),
        b: formatYuan(shown.paid.b),
        suggestion: summary.suggestion
          ? `${names[summary.suggestion.from]} 应付给 ${names[summary.suggestion.to]} ${formatYuan(summary.suggestion.amount)}`
          : '本月已结清',
      },
      total: allRows.length,
    });
    // 重新读取（如改完一笔返回）时保持已经显示的笔数，不跳回顶部那一批。
    this.showRows(Math.max(BATCH, this.data.records.length));
  },
  showRows(count: number) {
    this.setData({
      records: allRows.slice(0, count),
      hasMore: allRows.length > count,
    });
  },
  onReachBottom() {
    if (this.data.hasMore) this.showRows(this.data.records.length + BATCH);
  },
  changeMonth(event: WechatMiniprogram.TouchEvent) {
    const delta = Number(event.currentTarget.dataset.delta);
    if (delta > 0 && this.data.isCurrentMonth) return;
    const month = shiftMonth(this.data.month, delta);
    this.setData({
      month,
      monthText: monthLabel(month),
      isCurrentMonth: month === todayKey().slice(0, 7),
      records: [],
      total: 0,
      hasMore: false,
      summary: null,
      categories: [],
    });
    allRows = [];
    void this.load();
  },
  add() {
    wx.navigateTo({ url: '/pages/expense-edit/index' });
  },
  openInsight() {
    wx.navigateTo({ url: `/pages/insight/index?month=${this.data.month}` });
  },
  importBill() {
    void chooseBillImport();
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/expense-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
  /** 导出本月：存成 CSV 文件发到微信聊天里（发给自己或文件传输助手），电脑上用 Excel 打开。 */
  exportCsv() {
    if (!allRows.length) return;
    const csv = ledgerCsv(allRows, this.data.names, billAppLabel);
    const fileName = `喵喵记一笔-${this.data.month}.csv`;
    if (!wx.canIUse('shareFileMessage')) {
      wx.setClipboardData({ data: csv });
      return;
    }
    try {
      const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
      wx.getFileSystemManager().writeFileSync(filePath, csv, 'utf8');
      wx.shareFileMessage({
        filePath,
        fileName,
        fail: (error) => {
          if (!/cancel/.test(error.errMsg)) {
            this.setData({ error: '文件没发出去，再试一次吧。' });
          }
        },
      });
    } catch {
      this.setData({
        error: '文件没存下来，手机空间可能不够了，清一清再试试吧。',
      });
    }
  },
  async settle() {
    const summary = this.data.summary;
    if (this.data.busy || !summary?.suggestion) return;
    const ok = await confirmAction(
      '记为已结算？',
      `将新增一条结算记录：${this.data.summaryText.suggestion}。删除这条记录即可撤销。`,
    );
    if (!ok) return;
    this.setData({ busy: true, error: '' });
    try {
      const result = await settleMonth(this.data.month);
      this.show(this.data.names, result.records, result.summary);
      wx.showToast({ title: '已记为结算', icon: 'success' });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ALREADY_SETTLED') {
        // 对方刚刚结算过：重新读取，显示那条结算记录。
        wx.showToast({ title: '本月已经结清了', icon: 'none' });
        void this.load();
        return;
      }
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
