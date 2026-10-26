import type { BudgetUse } from '../models';
import { formatYuan } from './money';

/** 提醒的两档：用到 80%、超出预算。 */
const WARN = 0.8;

/** 预算用了百分之几（整数）。 */
export function budgetPercent(used: number, limit: number): number {
  return Math.floor((used * 100) / limit);
}

/** 这次保存刚跨过 80% 或 100% 时返回要弹的提示，否则 null。 */
export function budgetAlert(
  budget: BudgetUse | undefined,
): { title: string; content: string } | null {
  if (!budget) return null;
  const { cat, limit, used, before } = budget;
  if (before <= limit && used > limit)
    return {
      title: `${cat}超预算了`,
      content: `本月${cat}已花 ${formatYuan(used)}，预算 ${formatYuan(limit)}，超出 ${formatYuan(used - limit)}。`,
    };
  if (before < limit * WARN && used >= limit * WARN && used <= limit)
    return {
      title: `${cat}预算用了 ${budgetPercent(used, limit)}%`,
      content: `本月${cat}已花 ${formatYuan(used)}，预算 ${formatYuan(limit)}，还剩 ${formatYuan(limit - used)}。`,
    };
  return null;
}

/** 记账页分类行下面的一行字和颜色档：ok / warn / over。 */
export function budgetLine(
  used: number,
  limit: number | undefined,
): { text: string; tone: string; percent: number } | null {
  if (!limit) return null;
  const percent = budgetPercent(used, limit);
  return {
    text:
      used > limit
        ? `预算 ${formatYuan(limit)} · 超出 ${formatYuan(used - limit)}`
        : `预算 ${formatYuan(limit)} · 用了 ${percent}%`,
    tone: used > limit ? 'over' : used >= limit * WARN ? 'warn' : 'ok',
    percent: Math.min(100, percent),
  };
}
