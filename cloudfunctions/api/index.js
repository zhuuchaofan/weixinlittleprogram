const cloudbase = require('@cloudbase/js-sdk');
const { createRouter } = require('./router');
const {
  invocationFromContext,
  cloudConfigForInvocation,
} = require('./invocation');
const { listAll, readComplete } = require('./paging');
const { createVision } = require('./vision');
const { createXpay, DELIVER_EVENT } = require('./xpay');

function createHouseholdRepository(db) {
  const collection = db.collection('households');
  const _ = db.command;
  return {
    async findByMember(openid) {
      const result = await collection
        .where({ 'members.openid': openid })
        .limit(1)
        .get();
      return result.data[0] || null;
    },
    async findByCode(code) {
      const result = await collection
        .where({ inviteCode: code })
        .limit(1)
        .get();
      return result.data[0] || null;
    },
    async insert(doc) {
      const result = await collection.add(doc);
      return result.id;
    },
    async findById(id) {
      const result = await collection.where({ _id: id }).limit(1).get();
      return result.data[0] || null;
    },
    async setVip(id, expectedUntil, vip) {
      // 条件更新：到期日和读到时一样才写入，两笔订单同时到账也不会互相覆盖。
      const result = await collection
        .where({
          _id: id,
          'vip.until':
            expectedUntil === undefined ? _.exists(false) : expectedUntil,
        })
        .update({ vip: _.set(vip) });
      return result.updated === 1;
    },
    async addMember(id, code, member) {
      // 条件更新保证并发加入时只有一人成功；满员后邀请码清空即失效。
      const result = await collection
        .where({ _id: id, inviteCode: code, memberCount: 1 })
        .update({
          members: _.push([member]),
          memberCount: 2,
          inviteCode: '',
        });
      return result.updated === 1;
    },
    async update(id, fields) {
      // 对象字段（如 budgets）整体替换：直接传对象时云数据库会和旧值合并，删掉的分类会留着。
      const changes = {};
      for (const [key, value] of Object.entries(fields))
        changes[key] =
          value && typeof value === 'object' && !Array.isArray(value)
            ? _.set(value)
            : value;
      await collection.where({ _id: id }).update(changes);
    },
    async takeQuota(id, field, day, limit) {
      // 每日次数（截图识别 billQuota、AI 小结 summaryQuota）。条件更新保证两人同时用也不会超出当天上限。换日后先把计数重置为 1。
      for (let attempt = 0; attempt < 2; attempt++) {
        const today = await collection
          .where({
            _id: id,
            [`${field}.day`]: day,
            [`${field}.count`]: _.lt(limit),
          })
          .update({ [`${field}.count`]: _.inc(1) });
        if (today.updated === 1) return true;
        const fresh = await collection
          .where({ _id: id, [`${field}.day`]: _.neq(day) })
          .update({ [field]: _.set({ day, count: 1 }) });
        if (fresh.updated === 1) return true;
      }
      return false;
    },
  };
}

/** 会员订单：下单时记一条 pending，收到微信发货推送并到账后标记 delivered。 */
function createOrderRepository(db) {
  const collection = db.collection('orders');
  return {
    async insert(doc) {
      await collection.add(doc);
    },
    async get(outTradeNo) {
      const result = await collection.where({ outTradeNo }).limit(1).get();
      return result.data[0] || null;
    },
    async markDelivered(outTradeNo) {
      // 只改还没发货的那条，重复推送不会改掉第一次的发货时间。
      await collection
        .where({ outTradeNo, status: 'pending' })
        .update({ status: 'delivered', deliveredAt: Date.now() });
    },
  };
}

/** 攒钱目标：通用记录操作，加上原子的「存了一笔」。 */
function createGoalRepository(db) {
  const _ = db.command;
  const collection = db.collection('goals');
  return {
    ...createRecordRepository(db, 'goals'),
    async deposit(householdId, id, entry) {
      // 两人同时存也不会丢：saved 用 inc，log 用 push。
      await collection
        .where({ _id: id, householdId })
        .update({ saved: _.inc(entry.amount), log: _.push([entry]) });
    },
  };
}

/** 业务记录集合：所有读写都限定在 householdId 之内。 */
function createRecordRepository(db, collectionName) {
  const collection = db.collection(collectionName);
  const _ = db.command;
  return {
    listAll: (householdId) => listAll(collection, { householdId }),
    listMonth: (householdId, month) =>
      listAll(collection, {
        householdId,
        date: _.gte(`${month}-01`).and(_.lte(`${month}-31`)),
      }),
    listRange: (householdId, fromMonth, toMonth) =>
      listAll(collection, {
        householdId,
        date: _.gte(`${fromMonth}-01`).and(_.lte(`${toMonth}-31`)),
      }),
    readComplete: (householdId) => readComplete(collection, { householdId }),
    async get(householdId, id) {
      const result = await collection
        .where({ _id: id, householdId })
        .limit(1)
        .get();
      return result.data[0] || null;
    },
    async insert(doc) {
      const result = await collection.add(doc);
      return result.id;
    },
    async insertWithId(id, doc) {
      try {
        await collection.add({ ...doc, _id: id });
        return true;
      } catch (error) {
        // 主键冲突的错误码随 SDK 版本变化，以「该 _id 已存在」为准。
        const existing = await collection.where({ _id: id }).limit(1).get();
        if (existing.data.length > 0) return false;
        throw error;
      }
    },
    async update(householdId, id, fields) {
      await collection.where({ _id: id, householdId }).update(fields);
    },
    async remove(householdId, id) {
      await collection.where({ _id: id, householdId }).remove();
    },
    async removeWhere(householdId, where) {
      const result = await collection.where({ ...where, householdId }).remove();
      return result.deleted || 0;
    },
  };
}

exports.main = async (event, context) => {
  // 微信的发货推送：不靠 openid，真假靠向微信查单（见 vip.js 的 deliver）。
  const isDeliver = event?.Event === DELIVER_EVENT;
  const { openid, envId } = invocationFromContext(
    context,
    cloudbase.parseContext,
    process.env.TCB_ENV || '',
  );
  if (!envId)
    return { ok: false, code: 'UNAVAILABLE', message: '云环境信息缺失' };
  const db = cloudbase.init(cloudConfigForInvocation(envId)).database();
  const route = createRouter({
    households: createHouseholdRepository(db),
    archive: {
      listRsvps: () => listAll(db.collection('rsvps')),
      listMessages: () => listAll(db.collection('guest_messages')),
    },
    expenses: createRecordRepository(db, 'expenses'),
    todos: createRecordRepository(db, 'todos'),
    dishes: createRecordRepository(db, 'dishes'),
    wishes: createRecordRepository(db, 'wishes'),
    dates: createRecordRepository(db, 'dates'),
    insights: createRecordRepository(db, 'insights'),
    goals: createGoalRepository(db),
    vision: createVision(),
    orders: createOrderRepository(db),
    xpay: createXpay(),
  });
  if (isDeliver) return route.deliver(event);
  return route(event, openid);
};
