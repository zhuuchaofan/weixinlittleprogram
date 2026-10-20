/** 整数日元显示：¥12,345 */
export function yen(amount: number): string {
  const rounded = Math.round(amount);
  return '¥' + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 只接受正整数日元；无效返回 0。 */
export function parseYen(input: string): number {
  const text = input.replace(/[,，\s¥￥]/g, '');
  if (!/^\d{1,9}$/.test(text)) return 0;
  return Number(text);
}
