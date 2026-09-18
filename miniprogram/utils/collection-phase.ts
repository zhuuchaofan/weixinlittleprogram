/** 以中国时区的日历日判断收集是否关闭，关闭日当天起不再接受新增或修改。 */
export function isCollectionClosed(
  closeDate: string,
  now: Date = new Date(),
): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(closeDate);
  if (!match) throw new Error('收集截止日期格式应为 YYYY-MM-DD。');
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const today = Date.UTC(
    china.getUTCFullYear(),
    china.getUTCMonth(),
    china.getUTCDate(),
  );
  const closingDay = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return today >= closingDay;
}
