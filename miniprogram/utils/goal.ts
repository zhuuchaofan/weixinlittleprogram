import type { Goal } from '../models';
import { formatYuan } from './money';

/** 一个目标在列表和主页上显示的几行字。 */
export function goalView(goal: Goal) {
  return {
    id: goal.id,
    title: goal.title,
    percent: goal.percent,
    done: goal.done,
    savedText: formatYuan(goal.saved),
    targetText: formatYuan(goal.target),
    planText: goal.done
      ? '攒够啦'
      : goal.monthsLeft
        ? `还剩 ${goal.monthsLeft} 个月，每月要存 ${formatYuan(goal.perMonth)}`
        : `已过截止月，还差 ${formatYuan(goal.remaining)}`,
    monthText: goal.done
      ? ''
      : goal.behind
        ? `本月还差 ${formatYuan(goal.behind)}`
        : '本月已存够 ✓',
    behind: goal.behind > 0,
  };
}

export type GoalRow = ReturnType<typeof goalView>;
