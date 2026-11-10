/** 打开「记一笔」并先填好分类、备注、日期（吃啥、想去用）。金额留给用户写。 */
export function openExpenseWith(fields: {
  cat: string;
  note: string;
  date?: string;
}): void {
  const query = [
    `cat=${encodeURIComponent(fields.cat)}`,
    `note=${encodeURIComponent(fields.note)}`,
    ...(fields.date ? [`date=${fields.date}`] : []),
  ].join('&');
  wx.navigateTo({ url: `/pages/expense-edit/index?${query}` });
}
