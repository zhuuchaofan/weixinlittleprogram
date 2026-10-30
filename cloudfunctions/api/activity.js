const validate = require('./validate');
const CONTRACT = require('./contract.json');
const { ApiError } = require('./errors');
const { publicRecord, requireRecord } = require('./records');
const { todayKey, addDays } = require('./dates');

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

const FEED_FIELDS = ['type', 'title', 'kind', 'date', 'reactions'];
const FEED_DAYS = 14;
const FEED_SHOWN = 10;

/**
 * 主页「TA 最近」：最近 14 天两人做过的事（就吃这个、勾完待办、去过了），最近的在前，最多 10 条；
 * 每条带两人各自的回应（thanks / great / love）。只能回应对方做的事，再点同一个收回。
 */
function createActivityFeed({ repository, requireMembership, now }) {
  const view = (record, household) => ({
    ...publicRecord(record, household, FEED_FIELDS),
    reactions: record.reactions || {},
  });
  return {
    async 'activity.recent'(openid) {
      const household = await requireMembership(openid);
      if (!repository) return [];
      const since = addDays(todayKey(now()), -FEED_DAYS);
      const records = await repository.listAll(household._id);
      return records
        .filter((record) => record.date >= since)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, FEED_SHOWN)
        .map((record) => view(record, household));
    },
    async 'activity.react'(openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      const reaction = payload.reaction === '' ? '' : payload.reaction;
      if (reaction !== '' && !CONTRACT.reactions.includes(reaction))
        throw new ApiError('VALIDATION', '先选一个回应吧。');
      if (!repository) throw new ApiError('NOT_FOUND', '这条动态已经不在了。');
      const record = await requireRecord(repository, household, id);
      if (record.by === openid)
        throw new ApiError('VALIDATION', '只能回应对方做的事。');
      const role = household.members.find(
        (member) => member.openid === openid,
      )?.role;
      const reactions = { ...(record.reactions || {}) };
      if (reaction) reactions[role] = reaction;
      else delete reactions[role];
      await repository.update(household._id, id, { reactions });
      return view({ ...record, reactions }, household);
    },
  };
}

module.exports = { createActivityLog, createActivityFeed };
