import type { Expense, Household, LedgerSummary } from '../../models';
import {
  byPartner,
  memberNames,
  peekHousehold,
  requireHousehold,
} from '../../services/household';
import { listMonth, peekMonth, settleMonth } from '../../services/ledger';
import { markLoaded, needsReload } from '../../services/snapshot';
import { setPendingImages } from '../../services/bills';
import { ApiError, errorMessage } from '../../services/cloud';
import {
  BILL_IMPORT,
  SETTLEMENT,
  SPLITS,
  billAppLabel,
} from '../../config/options';
import { monthLabel, shiftMonth, shortDate, todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';
import { confirmAction } from '../../utils/confirm';

type CategoryRow = {
  cat: string;
  amountText: string;
  percent: number;
  width: number;
};

/** 占比四舍五入到整数；条宽就是占比（占满整条是 100%），太小的类至少画 2% 以免看不见。 */
function categoryRows(
  total: number,
  byCategory: LedgerSummary['byCategory'],
): CategoryRow[] {
  return byCategory.map(({ cat, amount }) => {
    const percent = total ? Math.round((amount * 100) / total) : 0;
    return {
      cat,
      amountText: formatYuan(amount),
      percent,
      width: total ? Math.max(2, percent) : 0,
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
};

let loadVersion = 0;
let household: Household | null = null;

Page({
  data: {
    month: todayKey().slice(0, 7),
    monthText: monthLabel(todayKey().slice(0, 7)),
    isCurrentMonth: true,
    names: { a: '', b: '' },
    splitting: false,
    loading: true,
    busy: false,
    error: '',
    records: [] as Row[],
    summary: null as LedgerSummary | null,
    summaryText: { total: '', a: '', b: '', suggestion: '' },
    categories: [] as CategoryRow[],
  },
  onShow() {
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
  async load(force = false) {
    const version = ++loadVersion;
    this.setData({ loading: true, error: '' });
    try {
      household = await requireHousehold(force === true);
      if (!household) return;
      const names = memberNames(household);
      const month = this.data.month;
      const result = await listMonth(month);
      if (version !== loadVersion) return;
      this.show(names, result.records, result.summary);
      markLoaded(`ledger:${month}`);
    } catch (error) {
      if (version === loadVersion) this.setData({ error: errorMessage(error) });
    } finally {
      if (version === loadVersion) this.setData({ loading: false });
    }
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
    this.setData({
      names,
      summary,
      splitting,
      categories: categoryRows(shown.total, shown.byCategory),
      summaryText: {
        total: formatYuan(shown.total),
        a: formatYuan(shown.paid.a),
        b: formatYuan(shown.paid.b),
        suggestion: summary.suggestion
          ? `${names[summary.suggestion.from]} 应付给 ${names[summary.suggestion.to]} ${formatYuan(summary.suggestion.amount)}`
          : '本月已结清',
      },
      records: records.map((record) => ({
        ...record,
        amountText:
          (record.flow === 'in' ? '+' : '') + formatYuan(record.amount),
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
      })),
    });
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
      summary: null,
      categories: [],
    });
    void this.load();
  },
  add() {
    wx.navigateTo({ url: '/pages/expense-edit/index' });
  },
  /** 截图记账：从相册选微信 / 支付宝账单列表截图，到导入页识别和确认。 */
  async importScreenshots() {
    let paths: string[];
    try {
      const result = await wx.chooseMedia({
        count: BILL_IMPORT.maxImages,
        mediaType: ['image'],
        sourceType: ['album'],
        sizeType: ['original'],
      });
      paths = result.tempFiles.map((file) => file.tempFilePath);
    } catch {
      return; // 取消选择
    }
    if (!paths.length) return;
    setPendingImages(paths);
    wx.navigateTo({ url: '/pages/bill-import/index' });
  },
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/expense-edit/index?id=${event.currentTarget.dataset.id}`,
    });
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
