const validate = require('./validate');
const { ApiError } = require('./errors');
const { createCrudHandler } = require('./crud');
const { countdown, together } = require('./anniversary');
const { todayKey } = require('./dates');
const { requireRecord } = require('./records');
const { isVip } = require('./vip');
const CONTRACT = require('./contract.json');
const { photos: PHOTOS, settlement: SETTLEMENT } = CONTRACT;

const DISH_FIELDS = [
  'name',
  'kind',
  'tag',
  'ateOn',
  'votes',
  'votesOn',
  'ratings',
];

/** 没有 kind 的旧记录当作菜品。 */
const withDishKind = (view) => ({ ...view, kind: view.kind || 'dish' });

/**
 * 吃啥的两人互动，都按角色（a / b）存在菜品上：
 * - votes：今天想吃（want）或不想吃（no），votesOn 是投票那天，过了今天就不算；
 * - ratings：吃过之后觉得好吃（good）、一般（ok）、踩雷（bad），长期保留。
 */
const withDishTalk = (view, clock = Date.now) => ({
  ...withDishKind(view),
  votes: view.votesOn === todayKey(clock()) ? view.votes || {} : {},
  ratings: view.ratings || {},
});
const DATE_FIELDS = ['title', 'date', 'yearly', 'together'];
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
// 一年里最多取这么多条；再多的年份里，最早的几条先不显示。
const FOOTPRINT_SHOWN = 200;

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
  /** 「在一起的起点」全家只留一个：新设的把别的取消。 */
  const keepOneTogether = async (household, keepId) => {
    for (const record of await dates.listAll(household._id))
      if (record.together && record._id !== keepId)
        await dates.update(household._id, record._id, { together: false });
  };
  const dateCrud = createCrudHandler({
    ...shared,
    prefix: 'date',
    repository: dates,
    check: validate.anniversary,
    fields: DATE_FIELDS,
    present: (view, clock) => {
      const today = todayKey(clock());
      const result = {
        ...view,
        together: view.together === true,
        ...countdown(view.date, view.yearly, today),
      };
      if (!result.together) return result;
      const { day, milestone } = together(view.date, today);
      return { ...result, togetherDay: day, milestone };
    },
    // 即将到来的在前，已经过去的（不重复）放最后。
    sort: (a, b) => Number(a.passed) - Number(b.passed) || a.days - b.days,
    async onUpdate(household, openid, id, before, after) {
      if (after.together) await keepOneTogether(household, id);
    },
  });
  const dateHandlers = {
    ...dateCrud,
    async 'date.add'(openid, payload) {
      const added = await dateCrud['date.add'](openid, payload);
      if (added.together)
        await keepOneTogether(await requireMembership(openid), added.id);
      return added;
    },
  };
  const dishCrud = createCrudHandler({
    ...shared,
    prefix: 'dish',
    repository: dishes,
    check: validate.dish,
    fields: DISH_FIELDS,
    present: withDishTalk,
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
  });
  /** 角色 → 选项，只改自己那一个；选项为空表示收回。 */
  const setOwn = async (
    openid,
    payload,
    field,
    options,
    extra = () => ({}),
  ) => {
    const household = await requireMembership(openid);
    const id = validate.id(payload.id);
    const choice = payload[field.input];
    if (choice !== '' && !options.includes(choice))
      throw new ApiError('VALIDATION', field.message);
    const record = await requireRecord(dishes, household, id);
    const role = household.members.find(
      (member) => member.openid === openid,
    )?.role;
    const changes = extra(record);
    const own = { ...(changes[field.key] || record[field.key] || {}) };
    if (choice) own[role] = choice;
    else delete own[role];
    changes[field.key] = own;
    await dishes.update(household._id, id, changes);
    return dishCrud['dish.get'](openid, { id });
  };
  const dishHandlers = {
    ...dishCrud,
    'dish.vote': (openid, payload) =>
      setOwn(
        openid,
        payload,
        { input: 'vote', key: 'votes', message: '选一下想吃还是不想吧。' },
        CONTRACT.dishVotes,
        (record) => {
          const today = todayKey(now());
          // 昨天的票作废：换了一天先清空再记。
          return {
            votesOn: today,
            votes: record.votesOn === today ? { ...record.votes } : {},
          };
        },
      ),
    'dish.rate': (openid, payload) =>
      setOwn(
        openid,
        payload,
        {
          input: 'rating',
          key: 'ratings',
          message: '选一下好吃、一般还是踩雷吧。',
        },
        CONTRACT.dishRatings,
      ),
  };

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
      throw new ApiError('VALIDATION', '这张照片没传好，重新选一张吧。');
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
        throw new ApiError('VALIDATION', '选一下想去还是不想吧。');
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
    /**
     * 「我们的足迹」：按年份取。years 是各年的个数（新的在前），items 是 year 那一年的记录
     * （默认最近一年，新的在前，带那天一起花了多少），total 是全部年份的总数。
     */
    async 'footprint.list'(openid, payload = {}) {
      const household = await requireMembership(openid);
      const all = (await wishes.listAll(household._id))
        .filter((wish) => wish.done)
        .sort(
          (a, b) =>
            String(b.doneOn || '').localeCompare(String(a.doneOn || '')) ||
            b.ts - a.ts,
        );
      const counts = new Map();
      for (const wish of all) {
        const key = String(wish.doneOn || '').slice(0, 4) || '0';
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const years = [...counts].map(([year, places]) => ({ year, places }));
      const year =
        typeof payload.year === 'string' && counts.has(payload.year)
          ? payload.year
          : years[0]?.year || '';
      const inYear = all
        .filter(
          (wish) => (String(wish.doneOn || '').slice(0, 4) || '0') === year,
        )
        .slice(0, FOOTPRINT_SHOWN);
      const spentByDay = new Map();
      if (expenses)
        for (const month of new Set(
          inYear.map((wish) => String(wish.doneOn || '').slice(0, 7)),
        ))
          if (month.length === 7)
            for (const record of await expenses.listMonth(household._id, month))
              if (isSpending(record))
                spentByDay.set(
                  record.date,
                  (spentByDay.get(record.date) || 0) + record.amount,
                );
      return {
        year,
        years,
        total: {
          places: all.length,
          photos: all.reduce(
            (sum, wish) => sum + (wish.photos || []).length,
            0,
          ),
        },
        items: inYear.map((wish) => ({
          id: wish._id,
          title: wish.title,
          doneOn: wish.doneOn || '',
          memo: wish.memo || '',
          photos: wish.photos || [],
          spent: spentByDay.get(wish.doneOn) || 0,
          both: Boolean(wish.wants?.a && wish.wants?.b),
        })),
      };
    },
  };
  return {
    ...dishHandlers,
    ...wishHandlers,
    ...dateHandlers,
  };
}

module.exports = {
  createCollectionHandlers,
  withDishTalk,
  DISH_FIELDS,
  withDishKind,
  WISH_FIELDS,
  DATE_FIELDS,
};
