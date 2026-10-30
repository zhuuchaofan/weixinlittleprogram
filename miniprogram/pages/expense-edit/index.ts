import type { ExpenseInput, Flow, Household, Payer, Split } from '../../models';
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
  categoryLook,
  FLOWS,
  LENGTHS,
  RATIO_RANGE,
  SETTLEMENT,
  SPLITS,
  billAppLabel,
} from '../../config/options';
import { formatTimestamp, todayKey } from '../../utils/date';
import { fenToInput, formatYuan, parseYuan } from '../../utils/money';
import { confirmAction } from '../../utils/confirm';
import { applyTheme, themeData } from '../../services/theme';
import { budgetAlert } from '../../utils/budget';

/** 付款人承担的百分比：只接受范围内的整数，否则返回 null。 */
function parseRatio(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= RATIO_RANGE.min && value <= RATIO_RANGE.max ? value : null;
}

Page({
  data: {
    ...themeData(),
    limits: LENGTHS,
    id: '',
    isSettlement: false,
    categories: CATEGORIES.map((name) => ({ name, ...categoryLook(name) })),
    splits: SPLITS,
    flows: FLOWS,
    flow: 'out' as Flow,
    splitting: false,
    sourceText: '',
    names: { a: '', b: '' },
    amountText: '',
    settleText: '',
    note: '',
    cat: CATEGORIES[0],
    date: todayKey(),
    today: todayKey(),
    recordedText: '',
    editedText: '',
    payer: 'a' as Payer,
    split: 'half' as Split,
    ratioText: '60',
    ratioHint: '',
    busy: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
  },
  async onLoad(options: Record<string, string | undefined>) {
    let household: Household | null = null;
    try {
      household = await getHousehold();
      if (!household) return;
      // 不开两人分摊时只记账：新记的账算自己的，不显示「怎么分」。
      this.setData({
        names: memberNames(household),
        payer: household.myRole,
        splitting: household.splitting,
        split: household.splitting ? 'half' : 'self',
      });
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
      flow: record.flow,
      sourceText: record.src
        ? `从${billAppLabel(record.src.app)}截图导入${record.src.merchant ? '：' + record.src.merchant : ''}`
        : '',
      ratioText: record.ratio === undefined ? '60' : String(record.ratio),
      recordedText:
        (household ? byPartner(record.byRole, household, '') || '我' : '') +
        ' 记录于 ' +
        formatTimestamp(record.ts),
      editedText:
        household && record.editedAt
          ? (byPartner(record.editedByRole || '', household, '') || '我') +
            ' 修改于 ' +
            formatTimestamp(record.editedAt)
          : '',
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
      field: 'cat' | 'payer' | 'split' | 'flow';
      value: string;
    };
    this.setData({ [field]: value });
    this.refreshRatioHint();
  },
  async save() {
    if (this.data.busy || this.data.isSettlement) return;
    const amount = parseYuan(this.data.amountText);
    if (!amount) {
      this.setData({ error: '金额要大于 0，最多写到分哦。' });
      return;
    }
    const flow = this.data.flow;
    const input: ExpenseInput = {
      amount,
      note: this.data.note.trim(),
      cat: this.data.cat,
      date: this.data.date,
      payer: this.data.payer,
      // 收入不分摊，只能是「自己的」。
      split: flow === 'in' ? 'self' : this.data.split,
      flow,
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
      const saved = this.data.id
        ? await updateExpense(this.data.id, input)
        : await addExpense(input);
      // 这一类刚花到预算的 80% 或超出时提醒一下，点「知道了」再返回。
      const alert = budgetAlert(saved.budget);
      if (alert)
        await wx.showModal({
          ...alert,
          showCancel: false,
          confirmText: '知道了',
        });
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
