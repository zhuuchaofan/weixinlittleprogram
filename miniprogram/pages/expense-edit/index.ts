import type { ExpenseInput, Household, Payer, Split } from '../../models';
import { byPartner, getHousehold, memberNames } from '../../services/household';
import {
  addExpense,
  cachedExpense,
  removeExpense,
  updateExpense,
} from '../../services/ledger';
import { errorMessage } from '../../services/cloud';
import { CATEGORIES, SETTLEMENT, SPLITS } from '../../config/options';
import { formatTimestamp, todayKey } from '../../utils/date';
import { fenToInput, formatYuan, parseYuan } from '../../utils/money';
import { confirmAction } from '../../utils/confirm';

Page({
  data: {
    id: '',
    isSettlement: false,
    categories: CATEGORIES,
    splits: SPLITS,
    names: { a: '', b: '' },
    amountText: '',
    settleText: '',
    note: '',
    cat: CATEGORIES[0],
    date: todayKey(),
    today: todayKey(),
    recordedText: '',
    payer: 'a' as Payer,
    split: 'half' as Split,
    busy: false,
    error: '',
  },
  async onLoad(options: Record<string, string | undefined>) {
    let household: Household | null = null;
    try {
      household = await getHousehold();
      if (!household) return;
      this.setData({ names: memberNames(household), payer: household.myRole });
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    }
    if (!options.id) return;
    const record = cachedExpense(options.id);
    if (!record) {
      this.setData({ error: '没有找到这条记录，请返回刷新后重试。' });
      return;
    }
    wx.setNavigationBarTitle({ title: '编辑账目' });
    this.setData({
      id: record.id,
      isSettlement: record.cat === SETTLEMENT,
      amountText: fenToInput(record.amount),
      settleText: formatYuan(record.amount),
      note: record.note,
      cat: record.cat,
      date: record.date,
      payer: record.payer,
      split: record.split,
      recordedText:
        (household ? byPartner(record.byRole, household, '') || '我' : '') +
        ' 记录于 ' +
        formatTimestamp(record.ts),
    });
  },
  inputAmount(event: WechatMiniprogram.Input) {
    this.setData({ amountText: event.detail.value });
  },
  inputNote(event: WechatMiniprogram.Input) {
    this.setData({ note: event.detail.value });
  },
  pickDate(event: WechatMiniprogram.PickerChange) {
    this.setData({ date: String(event.detail.value) });
  },
  choose(event: WechatMiniprogram.TouchEvent) {
    const { field, value } = event.currentTarget.dataset as {
      field: 'cat' | 'payer' | 'split';
      value: string;
    };
    this.setData({ [field]: value });
  },
  async save() {
    if (this.data.busy || this.data.isSettlement) return;
    const amount = parseYuan(this.data.amountText);
    if (!amount) {
      this.setData({ error: '请填写大于 0 的金额，最多两位小数。' });
      return;
    }
    const input: ExpenseInput = {
      amount,
      note: this.data.note.trim(),
      cat: this.data.cat,
      date: this.data.date,
      payer: this.data.payer,
      split: this.data.split,
    };
    this.setData({ busy: true, error: '' });
    try {
      if (this.data.id) await updateExpense(this.data.id, input);
      else await addExpense(input);
      wx.navigateBack();
    } catch (error) {
      // 保留表单内容，提示后可直接重试。
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async remove() {
    if (this.data.busy || !this.data.id) return;
    const ok = await confirmAction(
      this.data.isSettlement ? '撤销这次结算？' : '删除这笔账？',
      '删除后无法恢复。',
    );
    if (!ok) return;
    this.setData({ busy: true, error: '' });
    try {
      await removeExpense(this.data.id);
      wx.navigateBack();
    } catch (error) {
      this.setData({ error: errorMessage(error) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
