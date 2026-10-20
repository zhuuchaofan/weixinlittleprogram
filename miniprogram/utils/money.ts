// 金额统一以「分」为单位的整数传输和存储，只在界面上换算成元。

/** 分 → 显示：¥1,234 / ¥1,234.50 */
export function formatYuan(fen: number): string {
  const value = Math.abs(Math.round(fen));
  const yuan = Math.floor(value / 100);
  const cents = value % 100;
  const integer = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '¥' + integer + (cents ? '.' + String(cents).padStart(2, '0') : '');
}

/** 分 → 输入框文本：1250 → "12.5" */
export function fenToInput(fen: number): string {
  const yuan = Math.floor(fen / 100);
  const cents = fen % 100;
  if (!cents) return String(yuan);
  return `${yuan}.${String(cents).padStart(2, '0')}`.replace(/0$/, '');
}

/** 输入文本 → 分；只接受最多两位小数的正数，无效返回 0。 */
export function parseYuan(input: string): number {
  const text = input.replace(/[,，\s¥￥元]/g, '');
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
}
