import type { Goal } from '../models';
import { formatYuan } from './money';
import { daysBetween, todayKey } from './date';

/** 创建到攒够用了几天（至少 1 天）。 */
function daysTaken(goal: Goal): number {
  return Math.max(1, daysBetween(todayKey(goal.ts), goal.doneOn) + 1);
}

/** 一个目标在列表和主页上显示的几行字；names 是两人的名字，只有两人都在时才传。 */
export function goalView(goal: Goal, names?: { a: string; b: string }) {
  const { a, b } = goal.savedBy;
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
    // 两人各存了多少；只有一个人存过时也照写，另一个人写 0 反而像催促。
    byText:
      names && (a || b)
        ? [
            a && `${names.a}存了 ${formatYuan(a)}`,
            b && `${names.b}存了 ${formatYuan(b)}`,
          ]
            .filter(Boolean)
            .join(' · ')
        : '',
    // 攒够了：哪天攒够的、用了几天。
    doneText:
      goal.done && goal.doneOn
        ? `${goal.doneOn.replace(/-/g, '.')} 攒够啦，一共用了 ${daysTaken(goal)} 天`
        : '',
  };
}

export type GoalRow = ReturnType<typeof goalView>;
