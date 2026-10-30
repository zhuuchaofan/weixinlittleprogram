import type { Anniversary } from '../models';

/** 「在一起」起点那条纪念日在主页和纪念日页上显示的几行字；起点还没到时为 null。 */
export function togetherView(item: Anniversary | undefined) {
  if (!item?.together || !item.togetherDay) return null;
  const milestone = item.milestone;
  return {
    id: item.id,
    day: item.togetherDay,
    milestoneToday: milestone?.days === 0,
    milestoneText: !milestone
      ? ''
      : milestone.days === 0
        ? `今天是第 ${milestone.day} 天，一起庆祝吧`
        : `第 ${milestone.day} 天（${milestone.date.replace(/-/g, '.')}）还有 ${milestone.days} 天`,
  };
}

export type TogetherRow = NonNullable<ReturnType<typeof togetherView>>;
