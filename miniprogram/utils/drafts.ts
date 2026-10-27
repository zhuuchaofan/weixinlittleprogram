import type { BillItem, BillStatus } from '../models';
import { shortDate } from './date';
import { fenToInput, formatYuan } from './money';

/**
 * 「先确认再保存」列表里的一行（components/draft-list）：AI 识别或拆出来的一笔，
 * 加上勾选、展开和显示用的字段。截图记账在用，以后一句话记账也用它。
 */
export type DraftRow = BillItem & {
  selected: boolean;
  expanded: boolean;
  amountInput: string;
  amountText: string;
  dateText: string;
  statusText: string;
  matchText: string;
  showDate: boolean;
};

const STATUS_TEXT: Record<BillStatus, string> = {
  imported: '已导入过',
  possible: '可能已记过',
  partner: '你们俩之间的转账，默认不记',
  new: '',
};

/** 云函数还是旧版时可能回来不认识的 status（如 likely）：没勾的都要说明原因。 */
function statusText(status: BillStatus | undefined): string {
  if (!status) return '';
  return STATUS_TEXT[status] ?? STATUS_TEXT.possible;
}

/** 只有新的默认勾选；已导入过、可能已记过、两人互转、读不全的默认不勾。 */
function defaultSelected(item: BillItem): boolean {
  if (item.problem) return false;
  return item.status === 'new';
}

/** matchText：「我记过：10/24 午饭 ¥23.50」这类说明，由页面按小家成员算好传进来。 */
export function toRow(
  item: BillItem,
  matchText: string,
  previous?: DraftRow,
): DraftRow {
  return {
    ...item,
    selected: previous ? previous.selected : defaultSelected(item),
    expanded: previous ? previous.expanded : false,
    amountInput: previous ? previous.amountInput : fenToInput(item.amount),
    amountText:
      (item.flow === 'in' ? '+' : '') +
      (item.amount ? formatYuan(item.amount) : '¥?'),
    dateText: item.date ? shortDate(item.date) : '日期待补',
    statusText: statusText(item.status),
    matchText,
    showDate: previous ? previous.showDate : false,
  };
}

/** 按日期从新到旧；同一天只在第一笔上方显示日期。 */
export function arrange(rows: DraftRow[]): DraftRow[] {
  const sorted = [...rows].sort(
    (a, b) =>
      (b.date || '9').localeCompare(a.date || '9') ||
      b.time.localeCompare(a.time),
  );
  return sorted.map((row, index) => ({
    ...row,
    showDate: index === 0 || sorted[index - 1].date !== row.date,
  }));
}

/** 改了某一行之后重新检查缺什么、重新算显示字段；日期分组不动。 */
export function editRow(row: DraftRow, fields: Partial<DraftRow>): DraftRow {
  const next = { ...row, ...fields };
  const problems = [
    !next.amount && '金额没读出来',
    !next.date && '日期没读出来',
  ].filter(Boolean);
  return toRow({ ...next, problem: problems.join('，') }, row.matchText, next);
}
