/**
 * 记账页「导出本月」：把这个月的明细排成 CSV，Excel 和 Numbers 都能直接打开。
 * 不 import 别的文件，方便在 node 里直接测。
 */

export interface CsvRecord<A extends string = string> {
  date: string;
  flow: 'in' | 'out';
  cat: string;
  /** 分 */
  amount: number;
  note: string;
  payer: 'a' | 'b';
  splitText: string;
  src?: { app: A; merchant: string };
}

/** 一格：有逗号、引号、换行时用引号包起来；= + - @ 开头的前面加 '，免得表格软件当成公式。 */
function cell(value: string): string {
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function yuan(fen: number): string {
  const sign = fen < 0 ? '-' : '';
  const value = Math.abs(Math.round(fen));
  return `${sign}${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

/** 日期从早到晚；开头带 BOM，Excel 才认得中文。 */
export function ledgerCsv<A extends string>(
  records: CsvRecord<A>[],
  names: { a: string; b: string },
  appLabel: (app: A) => string = (app) => app,
): string {
  const head = [
    '日期',
    '收支',
    '分类',
    '金额（元）',
    '备注',
    '付款人',
    '怎么分',
    '来源',
  ];
  const rows = [...records]
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
    .map((record) => [
      record.date,
      record.flow === 'in' ? '收入' : '支出',
      record.cat,
      yuan(record.amount),
      record.note || '',
      names[record.payer] || '',
      record.splitText || '',
      record.src
        ? `${appLabel(record.src.app)}导入${record.src.merchant ? ' · ' + record.src.merchant : ''}`
        : '',
    ]);
  return (
    '\uFEFF' +
    [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') +
    '\r\n'
  );
}
