import type { Expense, Household, LedgerSummary } from '../../models';
import {
  byPartner,
  memberNames,
  requireHousehold,
} from '../../services/household';
import { listMonth } from '../../services/ledger';
import { errorMessage } from '../../services/cloud';
import { CATEGORIES, SETTLEMENT, SPLITS } from '../../config/options';
import { monthLabel, shiftMonth, shortDate, todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';

type CategoryRow = {
  cat: string;
  amountText: string;
  percent: number;
  width: number;
};

/** 合计支出与分类统计同一口径：每笔算在付款人头上，包含「自己的」，不含结算记录。 */
function spending(records: Expense[]) {
  const paid = { a: 0, b: 0 };
  const byCat = new Map<string, number>();
  for (const record of records) {
    if (record.cat === SETTLEMENT) continue;
    paid[record.payer] += record.amount;
    byCat.set(record.cat, (byCat.get(record.cat) || 0) + record.amount);
  }
  const total = paid.a + paid.b;
  // 金额相同时按契约里的分类顺序，结果稳定。
  const sorted = [...byCat].sort(
    (x, y) =>
      y[1] - x[1] || CATEGORIES.indexOf(x[0]) - CATEGORIES.indexOf(y[0]),
  );
  const top = sorted[0]?.[1] || 0;
  // 占比四舍五入到整数；条的长度相对最大的一类，最大的一类占满。
  const categories: CategoryRow[] = sorted.map(([cat, amount]) => ({
    cat,
    amountText: formatYuan(amount),
    percent: total ? Math.round((amount * 100) / total) : 0,
    width: top ? Math.max(2, Math.round((amount * 100) / top)) : 0,
  }));
  return {
    categories,
    spentText: {
      total: formatYuan(total),
      a: formatYuan(paid.a),
      b: formatYuan(paid.b),
    },
  };
}

type Row = Expense & {
  amountText: string;
  dateText: string;
  payerName: string;
  splitText: string;
  isSettlement: boolean;
  byText: string;
  editedText: string;
};

let loadVersion = 0;
let household: Household | null = null;

Page({
  data: {
    month: todayKey().slice(0, 7),
    monthText: monthLabel(todayKey().slice(0, 7)),
    isCurrentMonth: true,
    names: { a: '', b: '' },
    loading: true,
    error: '',
    records: [] as Row[],
    summary: null as LedgerSummary | null,
    spentText: { total: '', a: '', b: '' },
    categories: [] as CategoryRow[],
  },
  onShow() {
    void this.load();
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
      const result = await listMonth(this.data.month);
      if (version !== loadVersion) return;
      this.show(names, result.records, result.summary);
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
    this.setData({
      names,
      summary,
      ...spending(records),
      records: records.map((record) => ({
        ...record,
        amountText: formatYuan(record.amount),
        dateText: shortDate(record.date),
        payerName: names[record.payer],
        splitText:
          record.cat === SETTLEMENT
            ? '结算'
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
  open(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/expense-edit/index?id=${event.currentTarget.dataset.id}`,
    });
  },
});
