import type { BillItem } from '../../models';
import { ApiError, errorMessage } from '../../services/cloud';
import {
  addSomeExpenses,
  agreedToAiText,
  quickExpenses,
  type QuickItem,
} from '../../services/assist';
import { LENGTHS } from '../../config/options';
import { todayKey } from '../../utils/date';
import { toRow, type DraftRow } from '../../utils/drafts';
import { applyTheme, themeData } from '../../services/theme';
import { doneBack } from '../../utils/feedback';

/**
 * 一句话记账：写（或用键盘的话筒说）一句话 → 喵喵拆成几笔 → 在确认列表里改、勾选 → 一起记进账本。
 * 确认列表和截图记账共用 components/draft-list，所以把每一笔包成 BillItem 的样子；src 只在本页用，不发给云端。
 */
function toDraft(item: QuickItem, index: number): DraftRow {
  const bill: BillItem = {
    ...item,
    time: '',
    kind: item.cat,
    merchant: '',
    src: {
      app: 'wechat',
      merchant: '',
      time: '',
      date: item.date,
      amount: item.amount,
      flow: item.flow,
    },
    key: `quick-${index}`,
    problem: '',
    status: 'new',
  };
  return toRow(bill, '');
}

Page({
  data: {
    ...themeData(),
    limits: LENGTHS,
    today: todayKey(),
    text: '',
    rows: [] as DraftRow[],
    selectedCount: 0,
    parsing: false,
    busy: false,
    error: '',
    limitHit: false,
  },
  onShow() {
    applyTheme(this);
  },
  inputText(event: WechatMiniprogram.TextareaInput) {
    this.setData({ text: event.detail.value });
  },
  async parse() {
    if (this.data.parsing) return;
    const text = this.data.text.trim();
    if (text.length < 2) {
      this.setData({ error: '先写一句吧，例如「午饭 68，打车 23」。' });
      return;
    }
    if (!(await agreedToAiText())) return;
    this.setData({ parsing: true, error: '', limitHit: false });
    try {
      const { items } = await quickExpenses(text);
      this.showRows(items.map(toDraft));
    } catch (error) {
      this.setData({
        error: errorMessage(error),
        limitHit: error instanceof ApiError && error.code === 'LIMIT',
      });
    } finally {
      this.setData({ parsing: false });
    }
  },
  showRows(rows: DraftRow[]) {
    this.setData({
      rows,
      selectedCount: rows.filter((row) => row.selected).length,
    });
  },
  changeRows(event: WechatMiniprogram.CustomEvent<{ rows: DraftRow[] }>) {
    this.showRows(event.detail.rows);
  },
  again() {
    this.setData({ rows: [], selectedCount: 0, error: '' });
  },
  manual() {
    wx.redirectTo({ url: '/pages/expense-edit/index' });
  },
  openVip() {
    wx.navigateTo({ url: '/pages/vip/index' });
  },
  async save() {
    if (this.data.busy) return;
    const chosen = this.data.rows.filter((row) => row.selected);
    if (!chosen.length) return;
    const broken = chosen.find((row) => row.problem);
    if (broken) {
      this.setData({ error: `有一笔${broken.problem}，补好或取消勾选吧。` });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const { added } = await addSomeExpenses(
        chosen.map((row) => ({
          amount: row.amount,
          flow: row.flow,
          cat: row.cat,
          note: row.note.trim(),
          date: row.date,
        })),
      );
      await doneBack(`记下 ${added} 笔`);
    } catch (error) {
      this.setData({ error: errorMessage(error), busy: false });
    }
  },
});
