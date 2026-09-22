export function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 仅转换展示时间，保留记录字段且不修改服务返回的原对象。 */
export function formatRecordDates<T extends { updatedAt: string }>(
  records: T[],
): T[] {
  return records.map((record) => ({
    ...record,
    updatedAt: formatUpdatedAt(record.updatedAt),
  }));
}
