import type { Flow } from '../../models';
import { CATEGORIES, FLOWS, LENGTHS } from '../../config/options';
import { editRow, type DraftRow } from '../../utils/drafts';
import { parseYuan } from '../../utils/money';

/**
 * 「先确认再保存」列表：每笔可以勾选、点开改收支 / 金额 / 备注 / 日期 / 分类。
 * 只管显示和编辑，每次改动通过 change 事件把整张新列表交回页面（detail.rows），保存由页面做。
 * 页面先用 utils/drafts 的 toRow、arrange 把识别结果变成行。
 */
Component({
  properties: {
    rows: { type: Array, value: [] as DraftRow[] },
    /** 日期选择的上限，YYYY-MM-DD。 */
    today: { type: String, value: '' },
  },
  data: {
    categories: CATEGORIES,
    flows: FLOWS,
    limits: LENGTHS,
  },
  methods: {
    indexOf(event: WechatMiniprogram.BaseEvent): number {
      return Number(event.currentTarget.dataset.index);
    },
    rowAt(index: number): DraftRow {
      return (this.data.rows as DraftRow[])[index];
    },
    edit(index: number, fields: Partial<DraftRow>) {
      const rows = [...(this.data.rows as DraftRow[])];
      rows[index] = editRow(rows[index], fields);
      this.triggerEvent('change', { rows });
    },
    toggle(event: WechatMiniprogram.TouchEvent) {
      const index = this.indexOf(event);
      const row = this.rowAt(index);
      if (!row.selected && row.problem) {
        this.edit(index, { expanded: true });
        wx.showToast({ title: row.problem, icon: 'none' });
        return;
      }
      this.edit(index, { selected: !row.selected });
    },
    expand(event: WechatMiniprogram.TouchEvent) {
      const index = this.indexOf(event);
      this.edit(index, { expanded: !this.rowAt(index).expanded });
    },
    inputAmount(event: WechatMiniprogram.Input) {
      this.edit(this.indexOf(event), {
        amountInput: event.detail.value,
        amount: parseYuan(event.detail.value),
      });
    },
    inputNote(event: WechatMiniprogram.Input) {
      this.edit(this.indexOf(event), { note: event.detail.value });
    },
    pickDate(event: WechatMiniprogram.PickerChange) {
      this.edit(this.indexOf(event), {
        date: String(event.detail.value),
        dateGuessed: false,
      });
    },
    chooseCat(event: WechatMiniprogram.TouchEvent) {
      this.edit(this.indexOf(event), {
        cat: String(event.currentTarget.dataset.value),
      });
    },
    chooseFlow(event: WechatMiniprogram.TouchEvent) {
      this.edit(this.indexOf(event), {
        flow: event.currentTarget.dataset.value as Flow,
      });
    },
  },
});
