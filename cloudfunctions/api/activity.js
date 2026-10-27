/**
 * 年度回顾要用的「做过的事」（activity 集合）：每次「就吃这个」、勾完一条待办、想去打勾「去过了」。
 * 只记类型、原记录 id、当时的名字和日期；原记录改名或删掉（包括「清除已完成」）这里也留着。
 * _id 由类型、原记录和日期决定：同一天重复点只算一次，取消勾选时删掉那天的一条。
 * 写不进去（例如集合还没建）只打日志，不挡正常操作。
 */
function createActivityLog({
  repository,
  now,
  log = (line) => console.log(line),
}) {
  const idOf = (type, refId, date) => `${type}_${refId}_${date}`;
  const warn = (error) =>
    log(
      JSON.stringify({
        event: 'activity',
        ok: false,
        error: error.code || error.message,
      }),
    );
  return {
    /** entry：{ type: 'dish' | 'todo' | 'wish', refId, title, date, kind? } */
    async add(household, openid, entry) {
      if (!repository || !entry.date) return;
      try {
        await repository.insertWithId(
          idOf(entry.type, entry.refId, entry.date),
          {
            ...entry,
            householdId: household._id,
            ts: now(),
            by: openid,
          },
        );
      } catch (error) {
        warn(error);
      }
    },
    async remove(household, { type, refId, date }) {
      if (!repository || !date) return;
      try {
        await repository.remove(household._id, idOf(type, refId, date));
      } catch (error) {
        warn(error);
      }
    },
  };
}

module.exports = { createActivityLog };
