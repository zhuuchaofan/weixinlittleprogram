import type { ExpenseInput, Household, Payer, Split } from '../../models';
import { byPartner, getHousehold, memberNames } from '../../services/household';
import {
  addExpense,
  getExpense,
  removeExpense,
  updateExpense,
} from '../../services/ledger';
import { errorMessage } from '../../services/cloud';
import {
  CATEGORIES,
  LENGTHS,
  RATIO_RANGE,
  SETTLEMENT,
  SPLITS,
} from '../../config/options';
import { formatTimestamp, todayKey } from '../../utils/date';
import { fenToInput, formatYuan, parseYuan } from '../../utils/money';
import { confirmAction } from '../../utils/confirm';

/** 付款人承担的百分比：只接受范围内的整数，否则返回 null。 */
function parseRatio(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= RATIO_RANGE.min && value <= RATIO_RANGE.max ? value : null;
}

Page({
  data: {
    limits: LENGTHS,
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
    ratioText: '60',
    ratioHint: '',
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
    let record;
    try {
      record = await getExpense(options.id);
    } catch (error) {
      this.setData({ error: errorMessage(error) });
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
      ratioText: record.ratio === undefined ? '60' : String(record.ratio),
      recordedText:
        (household ? byPartner(record.byRole, household, '') || '我' : '') +
        ' 记录于 ' +
        formatTimestamp(record.ts),
    });
    this.refreshRatioHint();
  },
  inputAmount(event: WechatMiniprogram.Input) {
    this.setData({ amountText: event.detail.value });
    this.refreshRatioHint();
  },
  inputRatio(event: WechatMiniprogram.Input) {
    this.setData({ ratioText: event.detail.value });
    this.refreshRatioHint();
  },
  /** 按比例分摊时说明两人各承担多少；输入不合法时留空，保存时再提示。 */
  refreshRatioHint() {
    const ratio = parseRatio(this.data.ratioText);
    const amount = parseYuan(this.data.amountText);
    if (this.data.split !== 'ratio' || ratio === null) {
      this.setData({ ratioHint: '' });
      return;
    }
    const names = this.data.names;
    const payer = names[this.data.payer];
    const other = names[this.data.payer === 'a' ? 'b' : 'a'];
    const owed = amount ? Math.round((amount * (100 - ratio)) / 100) : null;
    this.setData({
      ratioHint:
        `${payer}承担 ${ratio}%，${other}承担 ${100 - ratio}%` +
        (owed === null ? '' : `（${other}应付 ${formatYuan(owed)}）`),
    });
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
    this.refreshRatioHint();
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
    if (input.split === 'ratio') {
      const ratio = parseRatio(this.data.ratioText);
      if (ratio === null) {
        this.setData({
          error: `请填写 ${RATIO_RANGE.min}–${RATIO_RANGE.max} 的整数，表示付款人承担的百分比。`,
        });
        return;
      }
      input.ratio = ratio;
    }
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
