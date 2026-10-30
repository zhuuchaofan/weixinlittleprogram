const validate = require('./validate');
const { createCrudHandler } = require('./crud');
const { countdown } = require('./anniversary');
const { todayKey } = require('./dates');
const { ApiError } = require('./errors');
const { requireRecord } = require('./records');
const { isVip } = require('./vip');
const { photos: PHOTOS, settlement: SETTLEMENT } = require('./contract.json');

const DISH_FIELDS = ['name', 'kind', 'tag', 'ateOn'];

/** 没有 kind 的旧记录当作菜品。 */
const withDishKind = (view) => ({ ...view, kind: view.kind || 'dish' });
const WISH_FIELDS = [
  'title',
  'why',
  'plan',
  'done',
  'doneOn',
  'memo',
  'photos',
  'wants',
];
const FOOTPRINT_SHOWN = 100;
const DATE_FIELDS = ['title', 'date', 'yearly'];

/**
 * 吃啥（dishes）、想去（wishes）、纪念日（dates）。
 * activity：createActivityLog() 的返回值，记下每次「就吃这个」和「去过了」；没有时不记。
 */
function createCollectionHandlers({
  dishes,
  wishes,
  dates,
  activity = null,
  expenses = null,
  storage = null,
  requireMembership,
  now,
}) {
  const shared = { requireMembership, now };
  const wishCrud = createCrudHandler({
    ...shared,
    prefix: 'wish',
    repository: wishes,
    check: validate.wish,
    fields: WISH_FIELDS,
    present: (view) => ({
      ...view,
      memo: view.memo || '',
      photos: view.photos || [],
      wants: view.wants || {},
    }),
    async onUpdate(household, openid, id, before, after) {
      if (!activity || Boolean(before.done) === after.done) return;
      if (after.done)
        await activity.add(household, openid, {
          type: 'wish',
          refId: id,
          title: after.title,
          date: after.doneOn || todayKey(now()),
        });
      else
        await activity.remove(household, {
          type: 'wish',
          refId: id,
          date: before.doneOn,
        });
    },
  });

  /** 照片只能是自己小家文件夹里的，张数不超过额度（普通 1 张，会员 3 张）。 */
  const checkPhotos = (household, list) => {
    if (!list.length) return;
    const folder = `/wish-photos/${household._id}/`;
    if (!list.every((id) => id.includes(folder)))
      throw new ApiError('VALIDATION', '照片不对，请重新选择。');
    const limit = isVip(household, now()) ? PHOTOS.vip : PHOTOS.free;
    if (list.length > limit)
      throw new ApiError(
        'VALIDATION',
        limit === PHOTOS.free
          ? `每条最多放 ${PHOTOS.free} 张照片，开通会员可以放 ${PHOTOS.vip} 张。`
          : `每条最多放 ${limit} 张照片。`,
      );
  };
  /** 删云存储里的文件；删不掉只打日志，不挡正常操作（文件成了孤儿，可在控制台清理）。 */
  const removeFiles = async (ids) => {
    if (!storage || !ids.length) return;
    try {
      await storage.remove(ids);
    } catch (error) {
      console.log(
        JSON.stringify({
          event: 'storage',
          ok: false,
          error: error.code || error.message,
        }),
      );
    }
  };
  const isSpending = (record) =>
    record.cat !== SETTLEMENT && record.flow !== 'in';

  const wishHandlers = {
    ...wishCrud,
    async 'wish.add'(openid, payload) {
      checkPhotos(
        await requireMembership(openid),
        validate.photos(payload.photos),
      );
      return wishCrud['wish.add'](openid, payload);
    },
    async 'wish.update'(openid, payload) {
      if (payload.photos === undefined)
        return wishCrud['wish.update'](openid, payload);
      const household = await requireMembership(openid);
      checkPhotos(household, validate.photos(payload.photos));
      const before = await wishes.get(household._id, validate.id(payload.id));
      const result = await wishCrud['wish.update'](openid, payload);
      await removeFiles(
        (before?.photos || []).filter((id) => !result.photos.includes(id)),
      );
      return result;
    },
    async 'wish.remove'(openid, payload) {
      const household = await requireMembership(openid);
      const before = await wishes.get(household._id, validate.id(payload.id));
      const result = await wishCrud['wish.remove'](openid, payload);
      await removeFiles(before?.photos || []);
      return result;
    },
    /** 点「我也想去」：只改自己那一个，再点一次收回。 */
    async 'wish.want'(openid, payload) {
      const household = await requireMembership(openid);
      const id = validate.id(payload.id);
      if (typeof payload.want !== 'boolean')
        throw new ApiError('VALIDATION', '请选择想去或不想去。');
      const record = await requireRecord(wishes, household, id);
      const role = household.members.find(
        (member) => member.openid === openid,
      )?.role;
      const wants = { ...(record.wants || {}) };
      if (payload.want) wants[role] = true;
      else delete wants[role];
      await wishes.update(household._id, id, { wants });
      return wishCrud['wish.get'](openid, { id });
    },
    /** 给小程序换照片的临时地址（对方上传的照片，自己直接读可能没有权限）。 */
    async 'photo.urls'(openid, payload) {
      const household = await requireMembership(openid);
      const ids = validate.photos(
        Array.isArray(payload.ids) ? payload.ids.slice(0, 30) : [],
      );
      if (!ids.every((id) => id.includes(`/wish-photos/${household._id}/`)))
        throw new ApiError('VALIDATION', '照片不对。');
      return storage && ids.length
        ? { urls: await storage.tempUrls(ids) }
        : { urls: {} };
    },
    /** 「我们的足迹」：去过的地方，最近的在前，带回忆、照片和那天一起花了多少。 */
    async 'footprint.list'(openid) {
      const household = await requireMembership(openid);
      const done = (await wishes.listAll(household._id))
        .filter((wish) => wish.done)
        .sort(
          (a, b) =>
            String(b.doneOn || '').localeCompare(String(a.doneOn || '')) ||
            b.ts - a.ts,
        )
        .slice(0, FOOTPRINT_SHOWN);
      const spentByDay = new Map();
      if (expenses)
        for (const month of new Set(
          done.map((wish) => String(wish.doneOn || '').slice(0, 7)),
        ))
          if (month)
            for (const record of await expenses.listMonth(household._id, month))
              if (isSpending(record))
                spentByDay.set(
                  record.date,
                  (spentByDay.get(record.date) || 0) + record.amount,
                );
      return done.map((wish) => ({
        id: wish._id,
        title: wish.title,
        doneOn: wish.doneOn || '',
        memo: wish.memo || '',
        photos: wish.photos || [],
        spent: spentByDay.get(wish.doneOn) || 0,
      }));
    },
  };
  return {
    ...createCrudHandler({
      ...shared,
      prefix: 'dish',
      repository: dishes,
      check: validate.dish,
      fields: DISH_FIELDS,
      present: withDishKind,
      sort: (a, b) => a.name.localeCompare(b.name, 'zh'),
      async onUpdate(household, openid, id, before, after) {
        if (activity && after.ateOn && after.ateOn !== before.ateOn)
          await activity.add(household, openid, {
            type: 'dish',
            refId: id,
            title: after.name,
            date: after.ateOn,
          });
      },
    }),
    ...wishHandlers,
    ...createCrudHandler({
      ...shared,
      prefix: 'date',
      repository: dates,
      check: validate.anniversary,
      fields: DATE_FIELDS,
      present: (view, clock) => ({
        ...view,
        ...countdown(view.date, view.yearly, todayKey(clock())),
      }),
      // 即将到来的在前，已经过去的（不重复）放最后。
      sort: (a, b) => Number(a.passed) - Number(b.passed) || a.days - b.days,
    }),
  };
}

module.exports = {
  createCollectionHandlers,
  DISH_FIELDS,
  withDishKind,
  WISH_FIELDS,
  DATE_FIELDS,
};
