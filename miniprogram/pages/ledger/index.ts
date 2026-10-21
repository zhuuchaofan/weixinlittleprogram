import type { Expense, Household, LedgerSummary } from '../../models';
import {
  byPartner,
  memberNames,
  requireHousehold,
} from '../../services/household';
import { listMonth, settleMonth } from '../../services/ledger';
import { ApiError, errorMessage } from '../../services/cloud';
import { SETTLEMENT, SPLITS } from '../../config/options';
import { monthLabel, shiftMonth, shortDate, todayKey } from '../../utils/date';
import { formatYuan } from '../../utils/money';
import { confirmAction } from '../../utils/confirm';

type Row = Expense & {
  amountText: string;
  dateText: string;
  payerName: string;
  splitText: string;
  isSettlement: boolean;
  byText: string;
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
    busy: false,
    error: '',
    records: [] as Row[],
    summary: null as LedgerSummary | null,
    summaryText: { total: '', a: '', b: '', suggestion: '' },
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
      summaryText: {
        total: formatYuan(summary.sharedTotal),
        a: formatYuan(summary.paid.a),
        b: formatYuan(summary.paid.b),
        suggestion: summary.suggestion
          ? `${names[summary.suggestion.from]} 应付给 ${names[summary.suggestion.to]} ${formatYuan(summary.suggestion.amount)}`
          : '本月已结清',
      },
      records: records.map((record) => ({
        ...record,
        amountText: formatYuan(record.amount),
        dateText: shortDate(record.date),
        payerName: names[record.payer],
        splitText:
          record.cat === SETTLEMENT ? '结算' : splitLabel(record.split),
        isSettlement: record.cat === SETTLEMENT,
        byText: household ? byPartner(record.byRole, household, '记') : '',
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
